/* ============================================================
   织雾满穗 · 「💡 建议 / 🐞 反馈」收件箱（操作）
   ------------------------------------------------------------
   2026-10-24 新增，配合 functions/api/inbox/list.js（那个负责读，这个负责改）。

   POST /api/inbox/action
     body: { kind: 'suggestion' | 'feedback', action: 'read' | 'delete', ids: [1,2,3] }
       read   → 把 status 标成 'read'（已看过，列表里变灰）
       delete → 真删这一行（站长确认后）
   需要管理员登录。

   【回退办法】删掉本文件，并去掉 js/admin.js 里对应按钮的绑定。
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody } from '../_utils.js';

const KINDS = { suggestion: 'suggestions', feedback: 'site_feedback' };
const ACTIONS = ['read', 'delete'];
const MAX_IDS = 200;

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

    const table = KINDS[String(body.kind || '')];
    if (!table) return json({ ok: false, error: 'invalid kind' }, 400);

    const action = String(body.action || '');
    if (!ACTIONS.includes(action)) return json({ ok: false, error: 'invalid action' }, 400);

    /* 只收正整数 id，去重，限个数 */
    const raw = Array.isArray(body.ids) ? body.ids : (body.id !== undefined ? [body.id] : []);
    const ids = [];
    for (const v of raw) {
      const n = Number(v);
      if (Number.isSafeInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
      if (ids.length >= MAX_IDS) break;
    }
    if (ids.length === 0) return json({ ok: false, error: 'missing ids' }, 400);

    const idJson = JSON.stringify(ids);

    /* 表名来自上面的白名单映射，不是用户输入 —— 不存在注入面 */
    const sql = action === 'delete'
      ? `DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`
      : `UPDATE ${table} SET status = 'read' WHERE id IN (SELECT value FROM json_each(?))`;

    const r = await env.DB.prepare(sql).bind(idJson).run();
    const changed = Number((r && r.meta && r.meta.changes) || 0);

    return json({ ok: true, changed });
  } catch (err) {
    console.error('[inbox/action]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
