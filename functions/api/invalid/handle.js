/* ============================================================
   织雾满穗 · 处理无效上报（需认证 + 同源）
   2026-10-05：新增。action：
     remove        确认无效 → 写入 quarantine_admin（全站隐藏）+ 清掉后台加的歌 + 上报标记 removed
     ignore        这个上报不算 → status='ignored'
     restore       撤销下架 / 把已忽略恢复为待处理 → 回到 pending
     clear-ignored 清空已忽略段

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

const ACTIONS = ['remove', 'ignore', 'restore', 'clear-ignored'];

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

    /* 清空已忽略不需要 ids，其余三个动作都要 */
    if (action === 'clear-ignored') {
      const result = await env.DB.prepare(
        `DELETE FROM invalid_reports WHERE status = 'ignored'`
      ).run();
      return json({ ok: true, action, changed: changes(result) });
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
        ).bind(idJson)
      ]);
      /* changed = 本次真正新写进「已下架」的条数（原本就已下架的不会再算一次） */
      changed = changes(results[0]);
    } else if (action === 'ignore') {
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE invalid_reports
           SET status = 'ignored', updated_at = datetime('now', 'localtime')
           WHERE status = 'pending' AND music_id IN (SELECT value FROM json_each(?))`
        ).bind(idJson)
      ]);
      changed = changes(results[0]);
    } else {
      /* restore 一条路服务后台两个按钮：
           「已下架 → 🔓 恢复上架」= 删 quarantine_admin + 上报从 removed 退回 pending；
           「已忽略 → ♻️ 恢复为待处理」= 上报从 ignored 退回 pending。
         2026-10-05：契约 3.4 只写了 status='removed'，但第 5 节的「已忽略恢复为待处理」
         也走 restore，只匹配 removed 会让那个按钮静默失效，所以这里放开到两种状态。 */
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
