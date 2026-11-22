/* ============================================================
   织雾满穗 · 功能建议列表（后台专用）
   ------------------------------------------------------------
   只给 /admin 的「💡 功能建议」面板用：
     GET /api/suggestions/list → 全部建议（未读在前、新的在前）
   登录态由 checkAuth 校验（cookie zm_auth），未登录一律 401。
   返回形状：
     { ok: true, items: [...], stats: { total, unread } }
   name / content 是玩家原始文本（后台用 escapeHtml 再渲染），
   IP 不在这张表里，所以接口也不会返回任何网络身份。
   【回退办法】删掉本文件即可；后台面板会显示「加载失败」，
   不影响其它页面与已提交的数据。
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

/* 一次最多取 1000 条：功能建议不是高频数据，够翻很久；
   总数 / 未读数另用 COUNT 查，不受这个上限影响。 */
const MAX_ROWS = 1000;

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, name, chapter, category, content, status, created_at
       FROM feature_suggestions
       ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, id DESC
       LIMIT ${MAX_ROWS}`
    ).all();

    const totalRow = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM feature_suggestions'
    ).first();
    const unreadRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM feature_suggestions WHERE status = 'new'"
    ).first();

    return json({
      ok: true,
      items: result.results || [],
      stats: {
        total: Number(totalRow && totalRow.n) || 0,
        unread: Number(unreadRow && unreadRow.n) || 0
      }
    });
  } catch (err) {
    console.error('[suggestions list]', err);
    const text = String((err && err.message) || '');
    if (/no such table/i.test(text)) {
      return json({ ok: false, error: 'table missing' }, 500);
    }
    return json({ ok: false, error: 'server error' }, 500);
  }
}
