/* ============================================================
   织雾满穗 · 博客内容处置（需管理员认证）
   ------------------------------------------------------------
   POST /api/blog/moderate
   body: { action, id?, clientId?, userId?, reason? }
     pin / unpin   —— 置顶 / 取消置顶
     hide / show   —— 上下线某篇文章（连同它的评论一起）
     delete        —— 永久删除某条及其评论、点赞、举报记录
     ban           —— 拉黑某篇的作者：账号封禁 + 浏览器身份拉黑，存量内容全部下线
     unban         —— 解除浏览器的拉黑
     unbanUser     —— 解封账号
     resetReports  —— 清空举报数并恢复显示（误报时用）
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody, tooLong } from '../_utils.js';
import { cleanBody, normalizeClientId } from './_moderation.js';

const ACTIONS = ['pin', 'unpin', 'hide', 'show', 'delete', 'ban', 'unban', 'unbanUser', 'resetReports'];

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }
  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await readJsonBody(request);
    const action = String(body.action || '').trim();
    const id = Number(body.id);
    const reason = cleanBody(body.reason).slice(0, 100);

    if (!ACTIONS.includes(action)) return json({ ok: false, error: 'bad action' }, 400);
    if (tooLong(reason, 100)) return json({ ok: false }, 400);

    /* ---------- 解除浏览器的拉黑：只需要 clientId ---------- */
    if (action === 'unban') {
      const clientId = normalizeClientId(body.clientId);
      if (!clientId) return json({ ok: false, error: 'bad client' }, 400);
      await env.DB.prepare('DELETE FROM blog_bans WHERE client_id = ?').bind(clientId).run();
      return json({ ok: true });
    }

    /* ---------- 解封账号：只需要 userId ---------- */
    if (action === 'unbanUser') {
      const userId = Number(body.userId);
      if (!Number.isSafeInteger(userId) || userId <= 0) return json({ ok: false, error: 'bad user' }, 400);
      await env.DB.prepare('UPDATE blog_users SET banned = 0 WHERE id = ?').bind(userId).run();
      return json({ ok: true });
    }

    if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, error: 'bad id' }, 400);

    /* ---------- 拉黑作者 ---------- */
    if (action === 'ban') {
      const post = await env.DB.prepare(
        'SELECT client_id, user_id, name FROM blog_posts WHERE id = ?'
      ).bind(id).first();

      if (!post) return json({ ok: false, error: 'not_found' }, 404);

      const targetClient = normalizeClientId(post.client_id);
      const targetUser = Number(post.user_id) || 0;

      if (!targetClient && !targetUser) {
        return json({ ok: false, error: 'no_identity' }, 400);
      }

      /* 1) 浏览器身份拉黑（挡游客） */
      if (targetClient) {
        await env.DB.prepare(
          `INSERT INTO blog_bans (client_id, reason) VALUES (?, ?)
           ON CONFLICT(client_id) DO UPDATE SET reason = excluded.reason`
        ).bind(targetClient, reason || null).run();
      }

      /* 2) 账号封禁（挡登录用户） */
      if (targetUser) {
        try {
          await env.DB.prepare('UPDATE blog_users SET banned = 1 WHERE id = ?').bind(targetUser).run();
        } catch (e) { /* 老库没这张表时忽略 */ }
      }

      /* 3) 他名下的内容全部下线 */
      let hidden = 0;
      if (targetUser) {
        const u = await env.DB.prepare(
          "UPDATE blog_posts SET status = 'hidden' WHERE user_id = ?"
        ).bind(targetUser).run();
        hidden = (u.meta && u.meta.changes) || 0;
      } else {
        const c = await env.DB.prepare(
          "UPDATE blog_posts SET status = 'hidden' WHERE client_id = ?"
        ).bind(targetClient).run();
        hidden = (c.meta && c.meta.changes) || 0;
      }

      return json({ ok: true, userId: targetUser, clientId: targetClient || '', hidden });
    }

    /* ---------- 删除 ---------- */
    if (action === 'delete') {
      await env.DB.prepare('DELETE FROM blog_posts WHERE id = ? OR parent_id = ?').bind(id, id).run();
      try {
        await env.DB.prepare('DELETE FROM blog_likes WHERE post_id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM blog_reports WHERE post_id = ?').bind(id).run();
      } catch (e) { /* 忽略 */ }
      return json({ ok: true });
    }

    /* ---------- 上线 / 下线 ---------- */
    if (action === 'hide' || action === 'show') {
      const status = action === 'hide' ? 'hidden' : 'visible';
      await env.DB.prepare('UPDATE blog_posts SET status = ? WHERE id = ?').bind(status, id).run();
      return json({ ok: true, status });
    }

    /* ---------- 置顶 / 取消置顶 ---------- */
    if (action === 'pin' || action === 'unpin') {
      const pinned = action === 'pin' ? 1 : 0;
      await env.DB.prepare(
        'UPDATE blog_posts SET pinned = ? WHERE id = ? AND parent_id IS NULL'
      ).bind(pinned, id).run();
      return json({ ok: true, pinned });
    }

    /* ---------- 误报复位 ---------- */
    if (action === 'resetReports') {
      await env.DB.prepare(
        "UPDATE blog_posts SET reports = 0, status = 'visible' WHERE id = ?"
      ).bind(id).run();
      try {
        await env.DB.prepare('DELETE FROM blog_reports WHERE post_id = ?').bind(id).run();
      } catch (e) { /* 忽略 */ }
      return json({ ok: true });
    }

    return json({ ok: false, error: 'bad action' }, 400);
  } catch (err) {
    console.error('[blog/moderate]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
