/* ============================================================
   织雾满穗 · 博客列表（公开，浏览不需要登录）
   ------------------------------------------------------------
   GET /api/blog/list                   → 文章列表（每篇带评论数）
   GET /api/blog/list?parent=<id>       → 某篇文章下的评论
   GET /api/blog/list?client=<clientId> → 顺带告诉我哪些文章我点过赞
   ============================================================ */

import { json } from '../_utils.js';
import { DEFAULT_KIND, normalizeKind, normalizeClientId } from './_moderation.js';
import { currentUser } from './_auth.js';
import { hasAvatarColumn, hasKindColumn } from './_schema.js';

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

    /* 作者头像存在 blog_users.avatar 里。字段没建就不 JOIN ——
       否则整条查询会因为「未知列 / 未知表」直接报错。 */
    const avatarReady = await hasAvatarColumn(env);
    const avatarJoin = avatarReady ? ' LEFT JOIN blog_users u ON u.id = p.user_id' : '';
    const avatarSel = avatarReady ? ', u.avatar AS author_avatar' : '';

    /* ---------- 某篇文章下的评论 ---------- */
    if (Number.isSafeInteger(parent) && parent > 0) {
      const rows = await env.DB.prepare(
        `SELECT p.id, p.parent_id, p.user_id, p.name, p.content, p.user_id AS uid, p.created_at` + avatarSel + `
           FROM blog_posts p` + avatarJoin + `
          WHERE p.parent_id = ? AND p.status = 'visible'
          ORDER BY p.id ASC
          LIMIT 300`
      ).bind(parent).all();

      const list = (rows && rows.results) ? rows.results : [];
      return json({
        ok: true,
        data: list.map(r => ({
          id: Number(r.id) || 0,
          parentId: Number(r.parent_id) || 0,
          name: String(r.name || ''),
          avatar: String(r.author_avatar || ''),
          content: String(r.content || ''),
          mine: !!(me && Number(r.uid) === me.id),
          createdAt: String(r.created_at || '')
        }))
      });
    }

    /* ---------- 文章列表 ---------- */
    /* 这里故意写 p.* 而不是逐个列字段：以后再加字段时，老库即使漏跑迁移，
       查询也不会因为「未知列」整个报错，最多是拿不到那个字段（下面用 `|| 默认值` 兜住）。 */
    const rows = await env.DB.prepare(
      `SELECT p.*` + avatarSel + `,
              (SELECT COUNT(*) FROM blog_posts r
                WHERE r.parent_id = p.id AND r.status = 'visible') AS reply_count
         FROM blog_posts p` + avatarJoin + `
        WHERE p.parent_id IS NULL AND p.status = 'visible'
        ORDER BY p.id DESC
        LIMIT ?`
    ).bind(PAGE_LIMIT).all();

    const list = (rows && rows.results) ? rows.results : [];

    /* 板块字段准备好了没（没准备好不影响浏览，只是内容都归到默认板块） */
    const kindReady = await hasKindColumn(env);

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
      avatar: String(r.author_avatar || ''),
      title: String(r.title || ''),
      content: String(r.content || ''),
      cover: String(r.cover || ''),
      kind: normalizeKind(r.kind) || DEFAULT_KIND,
      tags: splitTags(r.tags),
      likes: Number(r.likes) || 0,
      views: Number(r.views) || 0,
      replies: Number(r.reply_count) || 0,
      pinned: Number(r.pinned) === 1,
      liked: likedSet.has(Number(r.id)),
      mine: !!(me && Number(r.user_id) === me.id),
      createdAt: String(r.created_at || ''),
      editedAt: String(r.edited_at || '')
    }));

    return json({ ok: true, data, total: data.length, kindReady, avatarReady });
  } catch (err) {
    console.error('[blog/list]', err);
    /* 表还没建时给出友好提示，而不是 500 白屏 */
    return json({ ok: false, error: 'unavailable', data: [] }, 200);
  }
}
