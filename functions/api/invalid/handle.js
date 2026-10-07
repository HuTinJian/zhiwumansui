/* ============================================================
   织雾满穗 · 处理上报（需认证 + 同源）
   2026-10-05：新增。action：
     remove         确认无效 → 写入 quarantine_admin（全站隐藏）+ 清掉后台加的歌 + 上报标记 removed
     ignore         这个上报不算 → status='ignored'
     restore        撤销下架 / 把已忽略恢复为待处理 → 回到 pending
     clear-ignored  清空已忽略段
   2026-10-07 站主要求「『已忽略』其实没必要，没有问题的上报的 ID 直接删除后台记录就行」：
     · 去掉 ignore / clear-ignored 两个动作；
     · 新增 delete-records：把待处理里那条 ID 的上报记录**真删掉** ——
       删完之后，上报的人在他自己的「问题上报」里也就看不到这个 ID 了
       （页面上列的就是这同一张表），而歌本身照旧留在宝库里能搜到。
       ⚠️ 不碰 quarantine_admin、不碰 songs_extra：只是「这条上报不作数」。
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

const ACTIONS = ['remove', 'delete-records', 'restore'];

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
      /* 2026-10-07：这条上报不作数 → 把记录真删掉（不是打标记）。
         ⚠️ 顺序不能反：**先给上报的人写通知**（kind='deleted'），再删记录 ——
         记录一删就查不到 reporter 了，通知也就无从写起。
         只删这一张表：宝库里的歌、已下架名单、D1 加的歌都不受影响。
         删完上报者自己的「📌 问题上报」里也就没有这个 ID 了 —— 那是同一张表。 */
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO report_notices (reporter, music_id, name, kind)
           SELECT DISTINCT r.reporter, r.music_id, r.name, 'deleted'
             FROM invalid_reports r
            WHERE r.music_id IN (SELECT value FROM json_each(?))
              AND r.reporter <> ''
              AND NOT EXISTS (
                SELECT 1 FROM report_notices n
                 WHERE n.reporter = r.reporter AND n.music_id = r.music_id AND n.seen = 0
              )`
        ).bind(idJson),
        env.DB.prepare(
          `DELETE FROM invalid_reports
            WHERE music_id IN (SELECT value FROM json_each(?))`
        ).bind(idJson)
      ]);
      changed = changes(results[1]);
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
