/* ============================================================
   织雾满穗 · 处理功能建议（后台专用）
   ------------------------------------------------------------
   动作（POST JSON { action, id }）：
     read     标为已读（只改状态，不动内容）
     unread   改回未读（手滑点错时用）
     delete   真删这一条（不可恢复；先确认再点）
   为什么没有「回复」：建议是单向收集，站主在后台看完自己
   找玩家回复（表里没有联系方式，也不打算收）。
   【回退办法】删掉本文件；已读状态与内容都留在 D1，不受影响。
     要清数据：DROP TABLE IF EXISTS feature_suggestions;
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody } from '../_utils.js';
import { ensureFeatureSuggestionsTable } from './_schema.js';

const ACTIONS = ['read', 'unread', 'delete'];

/* D1 语句改了几行（判断「这条还在不在」） */
function changes(result) {
  return (result && result.meta && Number(result.meta.changes)) || 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await readJsonBody(request);
  const action = String(body.action || '');
  const id = Number(body.id);

  if (ACTIONS.indexOf(action) === -1) {
    return json({ ok: false, error: 'bad action' }, 400);
  }
  if (!id || !isFinite(id) || id <= 0) {
    return json({ ok: false, error: 'invalid id' }, 400);
  }

  try {
    await ensureFeatureSuggestionsTable(env);

    if (action === 'delete') {
      const result = await env.DB.prepare(
        'DELETE FROM feature_suggestions WHERE id = ?'
      ).bind(id).run();
      if (!changes(result)) return json({ ok: false, error: 'not found' }, 404);
      return json({ ok: true });
    }

    const status = action === 'read' ? 'read' : 'new';
    const result = await env.DB.prepare(
      'UPDATE feature_suggestions SET status = ? WHERE id = ?'
    ).bind(status, id).run();
    if (!changes(result)) return json({ ok: false, error: 'not found' }, 404);
    return json({ ok: true, status });
  } catch (err) {
    console.error('[suggestions handle]', action, err);
    const text = String((err && err.message) || '');
    if (/no such table/i.test(text)) {
      return json({ ok: false, error: 'table missing' }, 500);
    }
    return json({ ok: false, error: 'server error' }, 500);
  }
}
