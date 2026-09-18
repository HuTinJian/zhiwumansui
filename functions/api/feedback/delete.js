/* ============================================================
   织雾满穗 · 删除反馈（需认证）
   ============================================================ */

import { json, checkAuth, requireSameOrigin } from '../_utils.js';

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
    if (!Number.isSafeInteger(id) || id <= 0) {
      return json({ ok: false, error: 'invalid id' }, 400);
    }

    const result = await env.DB.prepare(
      'DELETE FROM feedback WHERE id = ?'
    ).bind(id).run();

    return json({ ok: true, deleted: result.meta.changes });
  } catch (err) {
    console.error('[feedback/delete]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
