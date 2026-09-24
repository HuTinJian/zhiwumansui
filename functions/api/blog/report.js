/* ============================================================
   织雾满穗 · 社区举报（公开）
   ------------------------------------------------------------
   POST /api/blog/report  body: { postId, clientId, reason? }
   同一个人对同一条只能举报一次（blog_reports 主键去重）。

   【已取消自动隐藏】举报只累计次数、通知站长，不再自动下线内容。
   理由：3 个人就能把别人的帖子弄没，太容易被恶意举报利用。
   是否下架改由站长在后台人工判断（后台按举报数排序，一眼看到被集中举报的帖子）。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin, tooLong } from '../_utils.js';
import { cleanBody, normalizeClientId } from './_moderation.js';

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
      return json({ ok: true, already: true });
    }

    /* 只累计次数，内容照常显示 —— 不会再自动改成 hidden */
    await env.DB.prepare(
      'UPDATE blog_posts SET reports = reports + 1 WHERE id = ?'
    ).bind(postId).run();

    const row = await env.DB.prepare(
      'SELECT reports FROM blog_posts WHERE id = ?'
    ).bind(postId).first();

    return json({ ok: true, already: false, reports: Number(row && row.reports) || 0 });
  } catch (err) {
    console.error('[blog/report]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
