/* ============================================================
   织雾满穗 · 批量导入隔离区
   需认证，最多一次 500 条
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

    /* 逐条准备 INSERT，最后批量执行 */
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