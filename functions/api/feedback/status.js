/* ============================================================
   织雾满穗 · 更新反馈状态（需认证）
   ============================================================ */

import { json, checkAuth, requireSameOrigin } from '../_utils.js';

const VALID_STATUS = ['pending', 'approved', 'rejected'];

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();
    const id = Number(body.id);
    const status = String(body.status || '').trim();

    if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false }, 400);
    if (!VALID_STATUS.includes(status)) return json({ ok: false }, 400);

    const result = await env.DB.prepare(
      'UPDATE feedback SET status = ? WHERE id = ?'
    ).bind(status, id).run();

    return json({ ok: true, updated: (result.meta && result.meta.changes) || 0 });
  } catch (err) {
    console.error('[feedback/status]', err);
    return json({ ok: false }, 500);
  }
}
