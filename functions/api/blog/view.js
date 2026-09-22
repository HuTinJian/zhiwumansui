/* ============================================================
   织雾满穗 · 记一次浏览（公开）
   POST /api/blog/view  body: { postId }
   文章详情页打开时调用一次。用 IP 限速，防止有人写个循环把数字刷上去。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../_utils.js';

/* 单 IP 一小时最多记 120 次 —— 正常浏览远用不到，脚本刷量会撞到 */
const limiter = createRateLimiter(120, 60 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!limiter.check(clientIp(request)).ok) {
    return json({ ok: true, skipped: true });
  }

  try {
    const body = await readJsonBody(request);
    const postId = Number(body.postId);
    if (!Number.isSafeInteger(postId) || postId <= 0) return json({ ok: false }, 400);

    await env.DB.prepare(
      'UPDATE blog_posts SET views = views + 1 WHERE id = ? AND parent_id IS NULL'
    ).bind(postId).run();

    const row = await env.DB.prepare(
      'SELECT views FROM blog_posts WHERE id = ?'
    ).bind(postId).first();

    return json({ ok: true, views: Number(row && row.views) || 0 });
  } catch (err) {
    console.error('[blog/view]', err);
    return json({ ok: false }, 500);
  }
}
