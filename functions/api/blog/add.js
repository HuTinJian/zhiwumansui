/* ============================================================
   织雾满穗 · 发布文章 / 评论（需要登录）
   ------------------------------------------------------------
   POST /api/blog/add
   body: { content, title?, cover?, tags?, parentId?, clientId? }
   作者名取自登录会话，不再由前端自报昵称 —— 这样作者名才可信。
   parentId 有值就是评论（只允许一层，评论的评论会挂到同一篇文章下）
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin, tooLong } from '../_utils.js';
import { AUTO_HIDE_REPORTS, LIMITS, cleanBody, findBlockedWord, isBanned, normalizeClientId } from './_moderation.js';
import { currentUser } from './_auth.js';

/* 单 IP 10 分钟最多发 8 条（文章 + 评论一起算），挡住刷屏 */
const limiter = createRateLimiter(8, 10 * 60 * 1000);

/* 封面只接受 http(s) 图片地址；长度也卡一下，别把超长 data: 塞进来 */
function cleanCover(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.length > 300) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

/* 标签：逗号 / 顿号 / 空白分隔，最多 5 个，每个最多 12 字 */
function cleanTags(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const list = s.split(/[,，、\s]+/).map(function (t) {
    return t.replace(/[\u0000-\u001f\u007f#]/g, '').trim().slice(0, 12);
  }).filter(Boolean).slice(0, 5);
  return list.length ? list.join(',') : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!limiter.check(clientIp(request)).ok) {
    return json({ ok: false, error: 'too_many_requests', wait: 0 }, 429);
  }

  try {
    /* ---------- 必须是登录用户 ---------- */
    const user = await currentUser(request, env);
    if (!user) return json({ ok: false, error: 'login_required' }, 401);
    if (user.banned) return json({ ok: false, error: 'banned' }, 403);

    const body = await readJsonBody(request);

    const clientId = normalizeClientId(body.clientId);
    const name = user.username.slice(0, LIMITS.name);
    const title = cleanBody(body.title).slice(0, LIMITS.title);
    const rawContent = cleanBody(body.content);
    const cover = cleanCover(body.cover);
    const tags = cleanTags(body.tags);
    const parentId = Number(body.parentId);
    const isReply = Number.isSafeInteger(parentId) && parentId > 0;

    const maxLen = isReply ? LIMITS.reply : LIMITS.content;
    if (!rawContent) return json({ ok: false, error: 'empty content' }, 400);
    if (tooLong(rawContent, maxLen)) {
      return json({ ok: false, error: 'too_long', max: maxLen }, 400);
    }

    /* 博客是「文章制」：主帖必须有标题；评论才不需要 */
    if (!isReply && !title) {
      return json({ ok: false, error: 'empty title' }, 400);
    }

    if (clientId && await isBanned(env, clientId)) {
      return json({ ok: false, error: 'banned' }, 403);
    }

    /* 敏感词：整条拒收，并把命中的词回给前端，方便用户自己改 */
    const hit = findBlockedWord(name, title, rawContent, tags);
    if (hit) {
      return json({ ok: false, error: 'blocked_word', word: hit }, 400);
    }

    /* 评论统一挂到文章上：如果 parentId 本身是评论，就上溯到它的文章 */
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
      `INSERT INTO blog_posts (parent_id, user_id, name, title, content, cover, tags, client_id, likes, views, reports, pinned, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'visible')`
    ).bind(
      rootId,
      user.id,
      name,
      isReply ? null : (title || null),
      rawContent,
      isReply ? null : cover,
      isReply ? null : tags,
      clientId
    ).run();

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
