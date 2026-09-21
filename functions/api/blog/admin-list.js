/* ============================================================
   织雾满穗 · 博客列表（后台，含被隐藏的）  GET /api/blog/admin-list
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const rows = await env.DB.prepare(
      `SELECT p.id, p.parent_id, p.name, p.title, p.content, p.client_id,
              p.likes, p.reports, p.status, p.created_at,
              (SELECT COUNT(*) FROM blog_posts r WHERE r.parent_id = p.id) AS reply_count
         FROM blog_posts p
        WHERE p.parent_id IS NULL
        ORDER BY p.id DESC
        LIMIT 300`
    ).all();

    const list = (rows && rows.results) ? rows.results : [];

    let bans = [];
    try {
      const b = await env.DB.prepare(
        'SELECT client_id, reason, created_at FROM blog_bans ORDER BY created_at DESC LIMIT 200'
      ).all();
      bans = ((b && b.results) ? b.results : []).map(r => ({
        clientId: String(r.client_id || ''),
        reason: String(r.reason || ''),
        createdAt: String(r.created_at || '')
      }));
    } catch (e) {
      /* 没跑迁移时忽略 */
    }

    return json({
      ok: true,
      data: list.map(r => ({
        id: Number(r.id) || 0,
        name: String(r.name || ''),
        title: String(r.title || ''),
        content: String(r.content || ''),
        clientId: String(r.client_id || ''),
        likes: Number(r.likes) || 0,
        reports: Number(r.reports) || 0,
        status: String(r.status || 'visible'),
        replies: Number(r.reply_count) || 0,
        createdAt: String(r.created_at || '')
      })),
      bans,
      total: list.length
    });
  } catch (err) {
    console.error('[blog/admin-list]', err);
    return json({ ok: false, error: 'unavailable', data: [], bans: [] }, 200);
  }
}
