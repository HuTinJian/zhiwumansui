/* ============================================================
   织雾满穗 · 导入反馈隔离区
   将反馈中的隔离区ID导入开发者隔离区（需认证）
   ============================================================ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function readCookie(cookieHeader, key) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...v] = part.trim().split('=');
    if (k === key) return v.join('=');
  }
  return null;
}

function checkAuth(request, env) {
  const token = readCookie(request.headers.get('Cookie'), 'zm_auth');
  return token && token === env.AUTH_TOKEN;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();
    const feedbackId = Number(body.feedbackId);
    const selectedIds = Array.isArray(body.ids) ? body.ids.map(String) : [];

    if (!feedbackId || selectedIds.length === 0) {
      return json({ ok: false, error: 'missing params' }, 400);
    }

    /* 读取该反馈里的隔离区数据 */
    const row = await env.DB.prepare(
      'SELECT quarantine_ids FROM feedback WHERE id = ?'
    ).bind(feedbackId).first();

    if (!row || !row.quarantine_ids) {
      return json({ ok: false, error: 'no quarantine data' }, 404);
    }

    let allItems = [];
    try { allItems = JSON.parse(row.quarantine_ids); } catch {}

    /* 只保留用户勾选的 */
    const selectedSet = new Set(selectedIds);
    const toImport = allItems.filter(i => selectedSet.has(String(i.id)));

    if (toImport.length === 0) {
      return json({ ok: false, error: 'no matching items' }, 400);
    }

    /* 批量写入开发者隔离区 */
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
    return json({ ok: false, error: 'server error' }, 500);
  }
}