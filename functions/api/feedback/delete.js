/* ============================================================
   织雾满穗 · 删除反馈（需认证）
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();
    const id = Number(body.id);
    if (!id) return json({ ok: false, error: 'invalid id' }, 400);

    const result = await env.DB.prepare(
      'DELETE FROM feedback WHERE id = ?'
    ).bind(id).run();

    return json({ ok: true, deleted: result.meta.changes });
  } catch (err) {
    return json({
      ok: false,
      error: 'server error',
      message: String((err && err.message) || err)
    }, 500);
  }
}