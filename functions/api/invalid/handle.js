/* ============================================================
   织雾满穗 · 处理上报（需认证 + 同源）
   结果语义（后台动作 → 写入 + 上报者隔离区显示）：
     remove         「确认无效并下架」→ 写入 quarantine_admin + 上报标 removed
                    = 上报者隔离区「✅ 反馈成功」
     delete-records 「无效反馈」（这条反馈不成立）→ 上报标 noted
                    = 上报者隔离区「❌ 无效反馈」；按 body.type 只处理 invalid / info 其中一类
     fix-info       「信息出错 → 修改信息」保存成功 → 上报标 fixed
                    = 上报者隔离区「✅ 反馈成功」（只处理 type='info'）
     restore        撤销下架 → removed/ignored 回到 pending
   ⚠️ delete-records 是软删：只把 status 标成 'noted'（已审核·无需处理），行留在表里；
     后台待处理只查 pending，上报者查自己的上报表还能看到结果（GET /api/invalid/mine）；
     歌本身照旧留在宝库里能搜到。不碰 quarantine_admin、不碰 songs_extra。
   ⚠️ remove / delete-records 两个动作都会先给**报过这个 ID 的人**写一条 report_notices
     （kind = removed / deleted），访客下次打开页面时由 js/common.js 弹我们自己的提示。
   【回退办法】整体回到 git 历史版本即可；各分支内还有细项回退说明。
   ------------------------------------------------------------
   为什么整份 ID 列表塞进 json_each(?) 而不是逐 ID 拼 SQL：
     D1 单条语句最多 100 个绑定参数、一次批量动作最多 500 个 ID，
     逐 ID 写法要 1500 条语句 + 一条 500 参数的 IN 查询（直接超限）。
     json_each 是 Cloudflare 官方推荐的「数组展开成行」用法
     （https://developers.cloudflare.com/d1/sql-api/query-json/#expand-arrays-for-in-queries），
     这样每个动作固定 1~3 条语句、每条 1~2 个参数，一次 batch 搞定。
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody } from '../_utils.js';
import { removeIds, dismissIds } from './_actions.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/* 一次最多处理 500 个 ID（后台是分页勾选，正常远小于这个数） */
const MAX_IDS = 500;

const ACTIONS = ['remove', 'delete-records', 'fix-info', 'restore'];

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
      /* 写 quarantine_admin + 清 songs_extra + 标记上报 + 通知上报者，
         这一整套已经抽到 ./_actions.js，自动审核与后台手动下架共用。 */
      changed = await removeIds(env, ids);
    } else if (action === 'delete-records') {
      /* 结果语义保持不变：软删成 noted，歌本身不动；typeFilter 只处理对应那一类。
         具体 SQL 在 ./_actions.js，自动审核驳回也走这里。 */
      const rawType = String(body.type || '').trim();
      const typeFilter = rawType === 'info' ? 'info' : (rawType === 'invalid' ? 'invalid' : '');
      changed = await dismissIds(env, ids, typeFilter);
    } else if (action === 'fix-info') {
      /* 后台「✏️ 信息出错管理 → 修改信息」保存成功后走这里。
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
               （ignored 状态只剩历史数据，这里仍兼容着。） */
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
