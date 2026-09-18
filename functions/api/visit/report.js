/* ============================================================
   织雾满穗 · 访问渠道上报（公开，带 IP 限速）
   ============================================================ */

import { json, clientIp, createRateLimiter, requireSameOrigin } from '../_utils.js';

/* 单 IP 10 分钟最多 20 次上报（同一用户只会选一次渠道） */
const limiter = createRateLimiter(20, 10 * 60 * 1000);

/* userId 形如 u_<base36>_<base36>，与 hot/report 的 id 用同一约束 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,30}$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too_many_requests', wait: limit.wait }, 429);
  }

  try {
    const body = await request.json();
    const userId = String(body.userId || '').trim();
    let source = String(body.source || '').trim().slice(0, 30);

    if (!ID_PATTERN.test(userId)) {
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
    console.error('[visit/report]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
