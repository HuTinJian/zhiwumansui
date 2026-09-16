/* ============================================================
   织雾满穗 · 更新反馈状态（需认证）
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
    const status = String(body.status || '').trim();

    if (!id || !status) return json({ ok: false }, 400);

    await env.DB.prepare(
      'UPDATE feedback SET status = ? WHERE id = ?'
    ).bind(status, id).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false }, 500);
  }
}