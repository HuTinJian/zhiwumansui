/* ============================================================
   织雾满穗 · 删除自己的博客帖子（公开，但只能删自己的）
   ------------------------------------------------------------
   POST /api/blog/remove  body: { postId, clientId }
   校验帖子里的 client_id 和请求里的 clientId 一致才允许删除。
   （管理员的"删除任意帖"走 /api/blog/moderate）
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../_utils.js';
import { normalizeClientId } from './_moderation.js';

const limiter = createRateLimiter(20, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!limiter.check(clientIp(request)).ok) {
    return json({ ok: false, error: 'too_many_requests' }, 429);
  }

  try {
    const body = await readJsonBody(request);
    const postId = Number(body.postId);
    const clientId = normalizeClientId(body.clientId);

    if (!Number.isSafeInteger(postId) || postId <= 0) return json({ ok: false, error: 'bad id' }, 400);
    if (!clientId) return json({ ok: false, error: 'bad client' }, 400);

    const row = await env.DB.prepare(
      'SELECT id, client_id FROM blog_posts WHERE id = ?'
    ).bind(postId).first();

    if (!row) return json({ ok: false, error: 'not_found' }, 404);

    const owner = normalizeClientId(row.client_id);
    if (!owner || owner !== clientId) {
      return json({ ok: false, error: 'not_yours' }, 403);
    }

    await env.DB.prepare(
      'DELETE FROM blog_posts WHERE id = ? OR parent_id = ?'
    ).bind(postId, postId).run();

    try {
      await env.DB.prepare('DELETE FROM blog_likes WHERE post_id = ?').bind(postId).run();
      await env.DB.prepare('DELETE FROM blog_reports WHERE post_id = ?').bind(postId).run();
    } catch (e) { /* 老库没这两张表时忽略 */ }

    return json({ ok: true });
  } catch (err) {
    console.error('[blog/remove]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
