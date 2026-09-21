/* ============================================================
   织雾满穗 · 博客点赞（公开）
   ------------------------------------------------------------
   POST /api/blog/like  body: { postId, clientId }
   同一个浏览器对同一条只能点一次（blog_likes 主键去重）。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../_utils.js';
import { normalizeClientId } from './_moderation.js';

const limiter = createRateLimiter(120, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const limit = limiter.check(clientIp(request));
  if (!limit.ok) return json({ ok: false, error: 'too_many_requests' }, 429);

  try {
    const body = await readJsonBody(request);
    const postId = Number(body.postId);
    const clientId = normalizeClientId(body.clientId);

    if (!Number.isSafeInteger(postId) || postId <= 0) return json({ ok: false }, 400);
    if (!clientId) return json({ ok: false, error: 'bad client' }, 400);

    /* INSERT OR IGNORE：已经赞过就不会有变化，天然幂等 */
    const ins = await env.DB.prepare(
      'INSERT OR IGNORE INTO blog_likes (post_id, client_id) VALUES (?, ?)'
    ).bind(postId, clientId).run();

    const changed = (ins.meta && ins.meta.changes) || 0;

    if (changed > 0) {
      await env.DB.prepare(
        'UPDATE blog_posts SET likes = likes + 1 WHERE id = ?'
      ).bind(postId).run();
    }

    const row = await env.DB.prepare(
      'SELECT likes FROM blog_posts WHERE id = ?'
    ).bind(postId).first();

    return json({ ok: true, liked: true, likes: Number(row && row.likes) || 0, changed: changed > 0 });
  } catch (err) {
    console.error('[blog/like]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
