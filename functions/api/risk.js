/* ============================================================
   织雾满穗 · 风险弹窗版本
   ============================================================ */

import { json, checkAuth, requireSameOrigin } from './_utils.js';

/* 获取当前风险版本（公开） */
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const row = await env.DB.prepare(
      `SELECT version FROM page_updates WHERE page_key = 'risk'`
    ).first();
    return json({ ok: true, version: (row && row.version) || 'v1.0.0' });
  } catch (err) {
    console.error('[risk GET]', err);
    return json({ ok: true, version: 'v1.0.0' });
  }
}

/* 重置风险版本（需认证） */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const newVersion = 'v' + Date.now();
    const now = new Date();
    const date = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');

    await env.DB.prepare(
      `INSERT INTO page_updates (page_key, version, date, updates, updated_at)
       VALUES ('risk', ?, ?, '[]', datetime('now', 'localtime'))
       ON CONFLICT(page_key) DO UPDATE SET
         version = excluded.version,
         date = excluded.date,
         updated_at = excluded.updated_at`
    ).bind(newVersion, date).run();

    return json({ ok: true, version: newVersion });
  } catch (err) {
    console.error('[risk POST]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}