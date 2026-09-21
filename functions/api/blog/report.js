/* ============================================================
   织雾满穗 · 博客举报（公开）
   ------------------------------------------------------------
   POST /api/blog/report  body: { postId, clientId, reason? }
   同一个人对同一条只能举报一次（blog_reports 主键去重）。
   举报数达到阈值就自动下线，等管理员复核 —— 这样刷屏内容不会一直挂在墙上。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin, tooLong } from '../_utils.js';
import { AUTO_HIDE_REPORTS, cleanBody, normalizeClientId } from './_moderation.js';

/* 举报接口不需要很快，一个人一小时最多 10 次 */
const limiter = createRateLimiter(10, 60 * 60 * 1000);

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
    const reason = cleanBody(body.reason).slice(0, 100);

    if (!Number.isSafeInteger(postId) || postId <= 0) return json({ ok: false }, 400);
    if (!clientId) return json({ ok: false, error: 'bad client' }, 400);
    if (tooLong(reason, 100)) return json({ ok: false }, 400);

    const ins = await env.DB.prepare(
      'INSERT OR IGNORE INTO blog_reports (post_id, client_id, reason) VALUES (?, ?, ?)'
    ).bind(postId, clientId, reason || null).run();

    if (((ins.meta && ins.meta.changes) || 0) === 0) {
      return json({ ok: true, already: true, hidden: false });
    }

    await env.DB.prepare(
      'UPDATE blog_posts SET reports = reports + 1 WHERE id = ?'
    ).bind(postId).run();

    const row = await env.DB.prepare(
      'SELECT reports, status FROM blog_posts WHERE id = ?'
    ).bind(postId).first();

    const reports = Number(row && row.reports) || 0;
    let hidden = false;

    if (row && row.status === 'visible' && reports >= AUTO_HIDE_REPORTS) {
      await env.DB.prepare(
        "UPDATE blog_posts SET status = 'hidden' WHERE id = ?"
      ).bind(postId).run();
      hidden = true;
    }

    return json({ ok: true, already: false, reports, hidden });
  } catch (err) {
    console.error('[blog/report]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
