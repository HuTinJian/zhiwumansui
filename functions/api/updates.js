/* ============================================================
   织雾满穗 · 版本信息
   GET  ?page=xxx 单页（公开） | ?all=1 全部（需认证）
   POST 更新（需认证）
   ============================================================ */

import { json, checkAuth, requireSameOrigin, safeParse } from './_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const page = url.searchParams.get('page');
  const all = url.searchParams.get('all');

  try {
    if (all === '1') {
      if (!(await checkAuth(request, env))) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      const result = await env.DB.prepare(
        `SELECT page_key, version, date, updates, updated_at
         FROM page_updates
         WHERE page_key != 'risk'
         ORDER BY CASE page_key
           WHEN 'index' THEN 1
           WHEN 'feedback' THEN 2
           WHEN 'roblox' THEN 3
           ELSE 4
         END`
      ).all();

      const list = (result.results || []).map(r => ({
        page_key: r.page_key,
        version: r.version,
        date: r.date,
        updates: safeParse(r.updates, []),
        updated_at: r.updated_at
      }));

      return json({ ok: true, data: list });
    }

    if (!page) {
      return json({ ok: false, error: 'missing page' }, 400);
    }

    const row = await env.DB.prepare(
      `SELECT page_key, version, date, updates
       FROM page_updates
       WHERE page_key = ?`
    ).bind(page).first();

    if (!row) {
      return json({ ok: false, error: 'not found' }, 404);
    }

    return json({
      ok: true,
      data: {
        page_key: row.page_key,
        version: row.version,
        date: row.date,
        updates: safeParse(row.updates, [])
      }
    });
  } catch (err) {
    console.error('[updates GET]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();
    const page = String(body.page || '').trim();
    const version = String(body.version || '').trim();
    const updates = Array.isArray(body.updates) ? body.updates : [];

    if (!page || !version) {
      return json({ ok: false, error: 'missing fields' }, 400);
    }
    if (!['index', 'feedback', 'roblox'].includes(page)) {
      return json({ ok: false, error: 'invalid page' }, 400);
    }
    if (updates.length === 0) {
      return json({ ok: false, error: 'updates required' }, 400);
    }
    if (updates.length > 50) {
      return json({ ok: false, error: 'too many updates' }, 400);
    }
    /* 单条上限 2000 字符：
       更新公告生成器会把整个配置对象打包成一个 JSON 字符串提交
       （{"theme":...,"lines":"..."} 光外壳就约 90 字符）。
       最早是 200 —— 连稍微长一点的公告都会被拒，这里放宽到 2000。 */
    if (updates.some(u => typeof u !== 'string' || u.length > 2000)) {
      return json({ ok: false, error: 'invalid updates' }, 400);
    }

    const now = new Date();
    const date = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');

    await env.DB.prepare(
      `INSERT INTO page_updates (page_key, version, date, updates, updated_at)
       VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
       ON CONFLICT(page_key) DO UPDATE SET
         version = excluded.version,
         date = excluded.date,
         updates = excluded.updates,
         updated_at = excluded.updated_at`
    ).bind(page, version, date, JSON.stringify(updates)).run();

    return json({ ok: true, date });
  } catch (err) {
    console.error('[updates POST]', err);
    return json({
      ok: false,
      error: 'server error',
      message: String((err && err.message) || err)
    }, 500);
  }
}