/* ============================================================
   织雾满穗 · 博客发帖 / 回复（公开）
   ------------------------------------------------------------
   POST /api/blog/add
   body: { clientId, name, title?, content, parentId? }
   parentId 有值就是回复（只允许一层，回复的回复会挂到同一条主帖下）
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin, tooLong } from '../_utils.js';
import {
  AUTO_HIDE_REPORTS, LIMITS, cleanName, cleanBody, findBlockedWord,
  isBanned, normalizeClientId
} from './_moderation.js';

/* 单 IP 10 分钟最多发 8 条（帖子 + 回复一起算），挡住刷屏 */
const limiter = createRateLimiter(8, 10 * 60 * 1000);

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
    const body = await readJsonBody(request);

    const clientId = normalizeClientId(body.clientId);
    const name = cleanName(body.name).slice(0, LIMITS.name);
    const title = cleanBody(body.title).slice(0, LIMITS.title);
    const rawContent = cleanBody(body.content);
    const parentId = Number(body.parentId);
    const isReply = Number.isSafeInteger(parentId) && parentId > 0;

    if (!clientId) return json({ ok: false, error: 'bad client' }, 400);
    if (!name) return json({ ok: false, error: 'invalid name' }, 400);

    const maxLen = isReply ? LIMITS.reply : LIMITS.content;
    if (!rawContent) return json({ ok: false, error: 'empty content' }, 400);
    if (tooLong(rawContent, maxLen)) {
      return json({ ok: false, error: 'too_long', max: maxLen }, 400);
    }

    if (await isBanned(env, clientId)) {
      return json({ ok: false, error: 'banned' }, 403);
    }

    /* 敏感词：整条拒收，并把命中的词回给前端，方便用户自己改 */
    const hit = findBlockedWord(name, title, rawContent);
    if (hit) {
      return json({ ok: false, error: 'blocked_word', word: hit }, 400);
    }

    /* 回复统一挂到主帖上：如果 parentId 本身是回复，就上溯到它的主帖 */
    let rootId = null;
    if (isReply) {
      const parent = await env.DB.prepare(
        'SELECT id, parent_id, status FROM blog_posts WHERE id = ?'
      ).bind(parentId).first();

      if (!parent || parent.status !== 'visible') {
        return json({ ok: false, error: 'parent_gone' }, 404);
      }
      rootId = parent.parent_id ? Number(parent.parent_id) : Number(parent.id);
    }

    const result = await env.DB.prepare(
      `INSERT INTO blog_posts (parent_id, name, title, content, client_id, likes, reports, status)
       VALUES (?, ?, ?, ?, ?, 0, 0, 'visible')`
    ).bind(rootId, name, isReply ? null : (title || null), rawContent, clientId).run();

    return json({
      ok: true,
      id: Number(result.meta && result.meta.last_row_id) || 0,
      autoHideAt: AUTO_HIDE_REPORTS
    });
  } catch (err) {
    console.error('[blog/add]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
