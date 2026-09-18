/* ============================================================
   织雾满穗 · 从反馈导入隔离区（需认证）
   ============================================================ */

import { json, checkAuth, requireSameOrigin, safeParse } from '../_utils.js';

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
    const feedbackId = Number(body.feedbackId);
    const selectedIds = Array.isArray(body.ids) ? body.ids.map(String) : [];

    if (!feedbackId || selectedIds.length === 0) {
      return json({ ok: false, error: 'missing params' }, 400);
    }

    const row = await env.DB.prepare(
      'SELECT quarantine_ids FROM feedback WHERE id = ?'
    ).bind(feedbackId).first();

    if (!row || !row.quarantine_ids) {
      return json({ ok: false, error: 'no quarantine data' }, 404);
    }

    const allItems = safeParse(row.quarantine_ids, []);
    const selectedSet = new Set(selectedIds);
    const toImport = allItems.filter(i => selectedSet.has(String(i.id)));

    if (toImport.length === 0) {
      return json({ ok: false, error: 'no matching items' }, 400);
    }

    const stmts = toImport.map(i =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO quarantine_admin (music_id, name, category, source)
         VALUES (?, ?, ?, '反馈用户')`
      ).bind(
        String(i.id),
        String(i.name || '').slice(0, 100) || null,
        String(i.category || '').slice(0, 30) || null
      )
    );

    const results = await env.DB.batch(stmts);

    let added = 0;
    let skipped = 0;
    for (const r of results) {
      if (r.meta && r.meta.changes > 0) added++;
      else skipped++;
    }

    return json({ ok: true, added, skipped, total: toImport.length });
  } catch (err) {
    console.error('[feedback/import-quarantine]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}