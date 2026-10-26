/* ============================================================
   织雾满穗 · 处理上报（需认证 + 同源）
   2026-10-05：新增。2026-10-26 站主重新定死结果语义：
     remove         「确认无效并下架」→ 写入 quarantine_admin + 上报标 removed
                    = 上报者隔离区「✅ 反馈成功」
     delete-records 「无效反馈」（这条反馈不成立）→ 上报标 noted
                    = 上报者隔离区「❌ 无效反馈」；按 body.type 只处理 invalid / info 其中一类
     fix-info       「信息出错 → 修改信息」保存成功 → 上报标 fixed
                    = 上报者隔离区「✅ 反馈成功」（只处理 type='info'）
     restore        撤销下架 → removed/ignored 回到 pending
   【回退办法】整体回到 git 历史版本即可；各分支内还有细项回退说明。
   2026-10-07 站主要求「『已忽略』其实没必要，没有问题的上报的 ID 直接删除后台记录就行」：
     · 去掉 ignore / clear-ignored 两个动作；
     · 新增 delete-records：把待处理里那条 ID 移出「待处理」——
       2026-10-07 当时是**真删行**；2026-10-17 站主又说「自己反馈的 ID 想要看到有没有过审核」，
       于是改成**软删**：status 标成 'noted'（已审核·无需处理），行留在表里。
       后台待处理只查 pending，所以站主那边看到的还是「这条没了」，但上报者查自己的上报表
       还能看到结果（GET /api/invalid/mine）。歌本身照旧留在宝库里能搜到。
       ⚠️ 不碰 quarantine_admin、不碰 songs_extra：只是「这条上报处理完了」。
   2026-10-07 同日站主又要求「我如果下架了歌曲ID或者是删除了记录，上报的人都会收到弹窗提示」：
     · remove / delete-records 两个动作都会先给**报过这个 ID 的人**写一条 report_notices
       （kind = removed / deleted），访客下次打开页面时由 js/common.js 弹我们自己的提示。
   ------------------------------------------------------------
   为什么整份 ID 列表塞进 json_each(?) 而不是逐 ID 拼 SQL：
     D1 单条语句最多 100 个绑定参数、一次批量动作最多 500 个 ID，
     逐 ID 写法要 1500 条语句 + 一条 500 参数的 IN 查询（直接超限）。
     json_each 是 Cloudflare 官方推荐的「数组展开成行」用法
     （https://developers.cloudflare.com/d1/sql-api/query-json/#expand-arrays-for-in-queries），
     这样每个动作固定 1~3 条语句、每条 1~2 个参数，一次 batch 搞定。
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody } from '../_utils.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/* 一次最多处理 500 个 ID（后台是分页勾选，正常远小于这个数） */
const MAX_IDS = 500;

const ACTIONS = ['remove', 'delete-records', 'fix-info', 'restore'];

/* 已下架记录里的来源标记：后台「已下架」段据此区分是谁下架的 */
const SOURCE_INVALID = '无效上报';

/* 取某条语句真实改动的行数（D1 的 meta.changes） */
function changes(result) {
  return (result && result.meta && Number(result.meta.changes)) || 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await readJsonBody(request);
    const action = String(body.action || '').trim();

    if (!ACTIONS.includes(action)) {
      return json({ ok: false, error: 'unknown action' }, 400);
    }

    const rawIds = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
    const ids = [];
    for (const v of rawIds) {
      const id = String(v === undefined || v === null ? '' : v).trim();
      if (ID_PATTERN.test(id) && !ids.includes(id)) ids.push(id);
    }

    if (ids.length === 0) {
      return json({ ok: false, error: 'missing ids' }, 400);
    }
    /* 超限直接报错而不是悄悄截断 —— 下架是破坏性操作，宁可让管理员分批做 */
    if (ids.length > MAX_IDS) {
      return json({ ok: false, error: 'too many ids' }, 400);
    }

    const idJson = JSON.stringify(ids);
    let changed = 0;

    if (action === 'remove') {
      const results = await env.DB.batch([
        /* 1) 写进「已下架」表；歌名/分类取该 ID 最近一条上报，没上报就留 NULL。
              INSERT OR IGNORE 兜住重复下架（quarantine_admin.music_id 是 UNIQUE）。 */
        env.DB.prepare(
          `INSERT OR IGNORE INTO quarantine_admin (music_id, name, category, source)
           SELECT j.value,
                  (SELECT r.name FROM invalid_reports r
                    WHERE r.music_id = j.value ORDER BY r.id DESC LIMIT 1),
                  (SELECT r.category FROM invalid_reports r
                    WHERE r.music_id = j.value ORDER BY r.id DESC LIMIT 1),
                  ?
           FROM json_each(?) AS j`
        ).bind(SOURCE_INVALID, idJson),

        /* 2) 万一这个 ID 是后台自己加进 songs_extra 的歌，下架时一并删掉 */
        env.DB.prepare(
          `DELETE FROM songs_extra WHERE music_id IN (SELECT value FROM json_each(?))`
        ).bind(idJson),

        /* 3) 这个 ID 的上报全部标记为已下架 */
        env.DB.prepare(
          `UPDATE invalid_reports
           SET status = 'removed', updated_at = datetime('now', 'localtime')
           WHERE music_id IN (SELECT value FROM json_each(?))`
        ).bind(idJson),

        /* 4) 2026-10-07：给**报过这些 ID 的人**各留一条通知（kind='removed'），
              他们下次打开页面会看到我们自己的弹窗提示（见 ../notices/mine.js）。
              去重靠 (reporter, music_id) 那一对：同一个人同一个 ID 只留一条未读。 */
        env.DB.prepare(
          `INSERT INTO report_notices (reporter, music_id, name, kind)
           SELECT DISTINCT r.reporter, r.music_id, r.name, 'removed'
             FROM invalid_reports r
            WHERE r.music_id IN (SELECT value FROM json_each(?))
              AND r.reporter <> ''
              AND NOT EXISTS (
                SELECT 1 FROM report_notices n
                 WHERE n.reporter = r.reporter AND n.music_id = r.music_id AND n.seen = 0
              )`
        ).bind(idJson)
      ]);
      /* changed = 本次真正新写进「已下架」的条数（原本就已下架的不会再算一次） */
      changed = changes(results[0]);
    } else if (action === 'delete-records') {
      /* 2026-10-26 站主定死语义（原来两套语义正好相反，是错的）：
         · 「确认无效并下架」= 反馈属实 → 隔离区显示「✅ 反馈成功」（remove → status='removed'）
         · 「无效反馈」      = 反馈不成立 → 隔离区显示「❌ 无效反馈」（本动作 → status='noted'）
       同一个 ID 可能既有「无效ID」又有「信息出错」上报，所以按 body.type 只处理对应那一类：
         · 后台「🚫 待处理上报」传 type='invalid'
         · 后台「✏️ 信息出错管理」传 type='info'
       不传 type 时保持旧行为（两类一起处理），兼容旧调用。
       【回退办法】删掉下面两处 `AND (? = '' OR type = ?)`、去掉两个 bind 参数，
         即回到「一个 ID 下所有 pending 一起标记」的旧逻辑。 */
      const rawType = String(body.type || '').trim();
      const typeFilter = rawType === 'info' ? 'info' : (rawType === 'invalid' ? 'invalid' : '');
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO report_notices (reporter, music_id, name, kind)
           SELECT DISTINCT r.reporter, r.music_id, r.name, 'deleted'
             FROM invalid_reports r
            WHERE r.music_id IN (SELECT value FROM json_each(?))
              AND r.status = 'pending'
              AND (? = '' OR r.type = ?)
              AND r.reporter <> ''
              AND NOT EXISTS (
                SELECT 1 FROM report_notices n
                 WHERE n.reporter = r.reporter AND n.music_id = r.music_id AND n.seen = 0
              )`
        ).bind(idJson, typeFilter, typeFilter),
        env.DB.prepare(
          `UPDATE invalid_reports
              SET status = 'noted', updated_at = datetime('now', 'localtime')
            WHERE status = 'pending'
              AND (? = '' OR type = ?)
              AND music_id IN (SELECT value FROM json_each(?))`
        ).bind(typeFilter, typeFilter, idJson)
      ]);
      changed = changes(results[1]);
    } else if (action === 'fix-info') {
      /* 2026-10-26 新增：后台「✏️ 信息出错管理 → 修改信息」保存成功后走这里。
         语义 = 管理员核实并改好了信息 → 上报者的隔离区显示「✅ 反馈成功」。
         只动 type='info' 的待处理行：同 ID 的「无效ID」上报不受影响。
         新状态 'fixed' 由宝库页映射成「反馈成功」（见 roblox_music.html 的 MY_REP_STATUS）。
         【回退办法】删掉这个分支，并把 js/admin.js 的 handleInfoEdit() 改回
           handleInvalidAction([id], 'delete-records')（那会显示成「无效反馈」，是旧错误行为）。 */
      const result = await env.DB.prepare(
        `UPDATE invalid_reports
            SET status = 'fixed', updated_at = datetime('now', 'localtime')
          WHERE status = 'pending' AND type = 'info'
            AND music_id IN (SELECT value FROM json_each(?))`
      ).bind(idJson).run();
      changed = changes(result);
    } else {
      /* restore：后台「已下架 → 🔓 恢复上架」= 删 quarantine_admin + 上报退回 pending。
         （2026-10-07「已忽略」下线后，ignored 状态只剩历史数据，这里仍兼容着。） */
      const results = await env.DB.batch([
        env.DB.prepare(
          `DELETE FROM quarantine_admin WHERE music_id IN (SELECT value FROM json_each(?))`
        ).bind(idJson),
        env.DB.prepare(
          `UPDATE invalid_reports
           SET status = 'pending', updated_at = datetime('now', 'localtime')
           WHERE status IN ('removed', 'ignored') AND music_id IN (SELECT value FROM json_each(?))`
        ).bind(idJson)
      ]);
      changed = changes(results[1]);
    }

    return json({ ok: true, action, changed });
  } catch (err) {
    console.error('[invalid/handle]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
