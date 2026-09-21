/* ============================================================
   织雾满穗 · 博客内容处置（需认证）
   ------------------------------------------------------------
   POST /api/blog/moderate
   body: { action, id?, clientId?, reason? }
     hide / show   —— 上下线某条主帖（连同它的回复一起）
     delete        —— 永久删除某条及其回复、点赞、举报记录
     ban           —— 拉黑某帖作者：他的帖子全部下线，且不能再发
     unban         —— 解除拉黑
     resetReports  —— 清空举报数并恢复显示（误报时用）
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody, tooLong } from '../_utils.js';
import { cleanBody, normalizeClientId } from './_moderation.js';

const ACTIONS = ['hide', 'show', 'delete', 'ban', 'unban', 'resetReports'];

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

    /* ---------- 解除拉黑：只需要 clientId ---------- */
    if (action === 'unban') {
      const clientId = normalizeClientId(body.clientId);
      if (!clientId) return json({ ok: false, error: 'bad client' }, 400);
      await env.DB.prepare('DELETE FROM blog_bans WHERE client_id = ?').bind(clientId).run();
      return json({ ok: true });
    }

    if (!Number.isSafeInteger(id) || id <= 0) return json({ ok: false, error: 'bad id' }, 400);

    /* ---------- 拉黑作者 ---------- */
    if (action === 'ban') {
      const post = await env.DB.prepare(
        'SELECT client_id FROM blog_posts WHERE id = ?'
      ).bind(id).first();

      const target = normalizeClientId(post && post.client_id);
      if (!target) {
        return json({ ok: false, error: 'no_client_id' }, 400);
      }

      await env.DB.prepare(
        `INSERT INTO blog_bans (client_id, reason) VALUES (?, ?)
         ON CONFLICT(client_id) DO UPDATE SET reason = excluded.reason`
      ).bind(target, reason || null).run();

      /* 他名下的帖子与回复全部下线 */
      const upd = await env.DB.prepare(
        "UPDATE blog_posts SET status = 'hidden' WHERE client_id = ?"
      ).bind(target).run();

      return json({ ok: true, banned: target, hidden: (upd.meta && upd.meta.changes) || 0 });
    }

    /* ---------- 删除 ---------- */
    if (action === 'delete') {
      await env.DB.prepare('DELETE FROM blog_posts WHERE id = ? OR parent_id = ?').bind(id, id).run();
      try {
        await env.DB.prepare('DELETE FROM blog_likes WHERE post_id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM blog_reports WHERE post_id = ?').bind(id).run();
      } catch (e) { /* 老库没有这些表时忽略 */ }
      return json({ ok: true });
    }

    /* ---------- 上线 / 下线 ---------- */
    if (action === 'hide' || action === 'show') {
      const status = action === 'hide' ? 'hidden' : 'visible';
      await env.DB.prepare('UPDATE blog_posts SET status = ? WHERE id = ?').bind(status, id).run();
      return json({ ok: true, status });
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
