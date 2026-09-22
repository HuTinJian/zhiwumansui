/* ============================================================
   织雾满穗 · 删除自己写的文章 / 评论（需要登录，且只能删自己的）
   ------------------------------------------------------------
   POST /api/blog/remove  body: { postId }
   校验文章上的 user_id 与当前登录账号一致才允许删除。
   （管理员的「删除任意内容」走 /api/blog/moderate）
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../_utils.js';
import { currentUser } from './_auth.js';

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
    const user = await currentUser(request, env);
    if (!user) return json({ ok: false, error: 'login_required' }, 401);

    const body = await readJsonBody(request);
    const postId = Number(body.postId);

    if (!Number.isSafeInteger(postId) || postId <= 0) return json({ ok: false, error: 'bad id' }, 400);

    const row = await env.DB.prepare(
      'SELECT id, user_id, parent_id FROM blog_posts WHERE id = ?'
    ).bind(postId).first();

    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    if (Number(row.user_id) !== user.id) return json({ ok: false, error: 'not_yours' }, 403);

    /* 删文章时连它下面的评论一起删；删评论时只删这一条 */
    if (row.parent_id === null || row.parent_id === undefined) {
      await env.DB.prepare('DELETE FROM blog_posts WHERE id = ? OR parent_id = ?').bind(postId, postId).run();
    } else {
      await env.DB.prepare('DELETE FROM blog_posts WHERE id = ?').bind(postId).run();
    }

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
