/* ============================================================
   织雾满穗 · 访问渠道上报（公开）
   ============================================================ */

import { json } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const userId = String(body.userId || '').trim().slice(0, 40);
    let source = String(body.source || '').trim().slice(0, 30);

    if (!userId) {
      return json({ ok: false, error: 'invalid userId' }, 400);
    }
    if (!source) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    source = source.replace(/[\r\n\t<>]/g, '').trim();
    if (!source) {
      return json({ ok: false, error: 'invalid source' }, 400);
    }

    await env.DB.prepare(
      `INSERT INTO visit_sources (user_id, source, updated_at)
       VALUES (?, ?, datetime('now', 'localtime'))
       ON CONFLICT(user_id) DO UPDATE SET
         source = excluded.source,
         updated_at = excluded.updated_at`
    ).bind(userId, source).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}