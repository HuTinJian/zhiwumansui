/* ============================================================
   织雾满穗 · 鸣谢名单
   GET 公开；POST add / delete / update（需认证）
   ============================================================ */

import { json, checkAuth } from './_utils.js';

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(
      `SELECT id, category, name, platform, message
       FROM thanks
       ORDER BY category, id`
    ).all();

    const rows = result.results || [];
    const grouped = [];
    const map = new Map();

    for (const row of rows) {
      if (!map.has(row.category)) {
        const item = { category: row.category, people: [] };
        map.set(row.category, item);
        grouped.push(item);
      }
      map.get(row.category).people.push({
        id: row.id,
        name: row.name,
        platform: row.platform || '',
        message: row.message || ''
      });
    }

    return json(grouped);
  } catch (err) {
    return json([], 200);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();

    if (action === 'add') {
      const category = String(body.category || '').trim();
      const name = String(body.name || '').trim();
      const platform = String(body.platform || '').trim();
      const message = String(body.message || '').trim();
      const feedbackId = body.feedbackId ? Number(body.feedbackId) : null;

      if (!category || !name) {
        return json({ ok: false, error: 'missing fields' }, 400);
      }
      if (name.length > 40 || category.length > 30 || platform.length > 30 || message.length > 200) {
        return json({ ok: false, error: 'too long' }, 400);
      }

      const result = await env.DB.prepare(
        `INSERT INTO thanks (category, name, platform, message, feedback_id)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(category, name, platform || null, message || null, feedbackId).run();

      return json({ ok: true, id: result.meta.last_row_id });
    }

    if (action === 'delete') {
      const id = Number(body.id);
      if (!id) return json({ ok: false, error: 'invalid id' }, 400);
      await env.DB.prepare('DELETE FROM thanks WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    if (action === 'update') {
      const id = Number(body.id);
      const category = String(body.category || '').trim();
      const name = String(body.name || '').trim();
      const platform = String(body.platform || '').trim();
      const message = String(body.message || '').trim();

      if (!id || !category || !name) {
        return json({ ok: false, error: 'missing fields' }, 400);
      }

      await env.DB.prepare(
        `UPDATE thanks
         SET category = ?, name = ?, platform = ?, message = ?
         WHERE id = ?`
      ).bind(category, name, platform || null, message || null, id).run();

      return json({ ok: true });
    }

    return json({ ok: false, error: 'unknown action' }, 400);
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}