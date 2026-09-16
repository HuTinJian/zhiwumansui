/* ============================================================
   织雾满穗 · 反馈列表（需认证）
   ============================================================ */

import { json, checkAuth, safeParse } from '../_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, type, name, email, message,
              want_thanks, upload_quarantine, quarantine_ids,
              status, created_at
       FROM feedback
       ORDER BY id DESC`
    ).all();

    const list = (result.results || []).map(r => ({
      id: r.id,
      type: r.type,
      name: r.name,
      email: r.email || '',
      message: r.message,
      want_thanks: r.want_thanks || 0,
      upload_quarantine: r.upload_quarantine || 0,
      quarantine_ids: safeParse(r.quarantine_ids, []),
      status: r.status || 'pending',
      created_at: r.created_at
    }));

    return json(list);
  } catch (err) {
    return json([], 200);
  }
}