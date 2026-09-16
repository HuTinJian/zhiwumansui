/* ============================================================
   织雾满穗 · 批量导入隔离区（需认证，最多 500 条）
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const source = String(body.source || '手动导入').slice(0, 30);

    if (items.length === 0) {
      return json({ ok: false, error: 'empty items' }, 400);
    }
    if (items.length > 500) {
      return json({ ok: false, error: 'too many items' }, 400);
    }

    let added = 0;
    let skipped = 0;
    const stmts = [];

    for (const item of items) {
      const id = String(item.id || '').trim();
      const name = String(item.name || '').trim().slice(0, 100);
      const category = String(item.category || '').trim().slice(0, 30);
      if (!id) { skipped++; continue; }

      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO quarantine_admin (music_id, name, category, source)
           VALUES (?, ?, ?, ?)`
        ).bind(id, name || null, category || null, source)
      );
    }

    if (stmts.length > 0) {
      const results = await env.DB.batch(stmts);
      for (const r of results) {
        if (r.meta && r.meta.changes > 0) added++;
        else skipped++;
      }
    }

    return json({ ok: true, added, skipped, total: items.length });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}