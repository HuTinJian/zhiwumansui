/* ============================================================
   织雾满穗 · 「💡 建议 / 🐞 反馈」收件箱（列表）
   ------------------------------------------------------------
   2026-10-24 新增。背景：站主要求加「建议」「反馈」两个页面收集玩家想法与网站问题，
   页面和接口做完之后发现**后台没有查看界面** —— 数据进了 D1，站长却看不到，
   等于单行道。这个接口就是给后台那个新面板用的。

   GET /api/inbox/list?limit=200
     → { ok: true, suggestions: [...], feedback: [...], counts: {...} }
   需要管理员登录（checkAuth）；不是公开接口。

   【回退办法】删掉本文件与 functions/api/inbox/action.js，
     并去掉 admin.html 里的「建议 / 反馈」标签与 js/admin.js 里的 loadInbox 调用即可。
   ============================================================ */

import { json, checkAuth, requireSameOrigin } from '../_utils.js';

/* 单次最多取多少条（后台列表 + 前端分页，够用就行） */
const MAX_LIMIT = 500;

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }
  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let limit = MAX_LIMIT;
  try {
    const url = new URL(request.url);
    const raw = Number(url.searchParams.get('limit'));
    if (Number.isFinite(raw) && raw > 0) limit = Math.min(Math.floor(raw), MAX_LIMIT);
  } catch (err) { /* 解析失败就用默认值 */ }

  const empty = { ok: true, suggestions: [], feedback: [], counts: { suggestions: 0, feedback: 0 } };

  try {
    /* 两张表分别读。任何一张不存在（迁移没跑）都不该让另一个也挂掉 ——
       所以分开 try，各自兜底成空数组。 */
    let suggestions = [];
    try {
      const r = await env.DB.prepare(
        `SELECT id, nickname, content, contact, created_at, status
           FROM suggestions
          ORDER BY id DESC
          LIMIT ?`
      ).bind(limit).all();
      suggestions = (r && r.results) || [];
    } catch (err) {
      console.error('[inbox/list] suggestions', err);
    }

    let feedback = [];
    try {
      const r = await env.DB.prepare(
        `SELECT id, nickname, content, contact, created_at, status
           FROM site_feedback
          ORDER BY id DESC
          LIMIT ?`
      ).bind(limit).all();
      feedback = (r && r.results) || [];
    } catch (err) {
      console.error('[inbox/list] site_feedback', err);
    }

    return json({
      ok: true,
      suggestions,
      feedback,
      counts: {
        suggestions: suggestions.length,
        feedback: feedback.length,
        /* 未读（status = 'new'）的条数，给标签上那个小红点用 */
        newSuggestions: suggestions.filter(x => String(x.status || '') === 'new').length,
        newFeedback: feedback.filter(x => String(x.status || '') === 'new').length
      }
    });
  } catch (err) {
    console.error('[inbox/list]', err);
    return json({ ok: false, error: 'server error' }, 500);
  } finally {
    void empty;
  }
}
