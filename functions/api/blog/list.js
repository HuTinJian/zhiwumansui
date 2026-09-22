/* ============================================================
   织雾满穗 · 博客列表（公开，浏览不需要登录）
   ------------------------------------------------------------
   GET /api/blog/list                   → 文章列表（每篇带评论数）
   GET /api/blog/list?parent=<id>       → 某篇文章下的评论
   GET /api/blog/list?client=<clientId> → 顺带告诉我哪些文章我点过赞
   ============================================================ */

import { json } from '../_utils.js';
import { normalizeClientId } from './_moderation.js';
import { currentUser } from './_auth.js';

const PAGE_LIMIT = 200;

/* tags 在库里是 "a,b,c" 这种字符串，出库转成数组给前端用 */
function splitTags(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s.split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 5);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const parent = Number(url.searchParams.get('parent'));
    const clientId = normalizeClientId(url.searchParams.get('client'));
    const me = await currentUser(request, env);

    /* ---------- 某篇文章下的评论 ---------- */
    if (Number.isSafeInteger(parent) && parent > 0) {
      const rows = await env.DB.prepare(
        `SELECT id, parent_id, user_id, name, content, user_id AS uid, created_at
           FROM blog_posts
          WHERE parent_id = ? AND status = 'visible'
          ORDER BY id ASC
          LIMIT 300`
      ).bind(parent).all();

      const list = (rows && rows.results) ? rows.results : [];
      return json({
        ok: true,
        data: list.map(r => ({
          id: Number(r.id) || 0,
          parentId: Number(r.parent_id) || 0,
          name: String(r.name || ''),
          content: String(r.content || ''),
          mine: !!(me && Number(r.uid) === me.id),
          createdAt: String(r.created_at || '')
        }))
      });
    }

    /* ---------- 文章列表 ---------- */
    const rows = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.name, p.title, p.content, p.cover, p.tags,
              p.likes, p.views, p.pinned, p.created_at,
              (SELECT COUNT(*) FROM blog_posts r
                WHERE r.parent_id = p.id AND r.status = 'visible') AS reply_count
         FROM blog_posts p
        WHERE p.parent_id IS NULL AND p.status = 'visible'
        ORDER BY p.id DESC
        LIMIT ?`
    ).bind(PAGE_LIMIT).all();

    const list = (rows && rows.results) ? rows.results : [];

    /* 我点过赞的文章：一次查出来，避免每篇再问一次数据库 */
    let likedSet = new Set();
    if (clientId && list.length > 0) {
      const liked = await env.DB.prepare(
        'SELECT post_id FROM blog_likes WHERE client_id = ?'
      ).bind(clientId).all();
      likedSet = new Set(((liked && liked.results) ? liked.results : []).map(r => Number(r.post_id)));
    }

    const data = list.map(r => ({
      id: Number(r.id) || 0,
      name: String(r.name || ''),
      title: String(r.title || ''),
      content: String(r.content || ''),
      cover: String(r.cover || ''),
      tags: splitTags(r.tags),
      likes: Number(r.likes) || 0,
      views: Number(r.views) || 0,
      replies: Number(r.reply_count) || 0,
      pinned: Number(r.pinned) === 1,
      liked: likedSet.has(Number(r.id)),
      mine: !!(me && Number(r.user_id) === me.id),
      createdAt: String(r.created_at || '')
    }));

    return json({ ok: true, data, total: data.length });
  } catch (err) {
    console.error('[blog/list]', err);
    /* 表还没建时给出友好提示，而不是 500 白屏 */
    return json({ ok: false, error: 'unavailable', data: [] }, 200);
  }
}
