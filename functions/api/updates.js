/* ============================================================
   /api/updates
   GET  ?page=xxx   获取单个页面版本信息（公开）
   GET  ?all=1      获取全部页面（需认证）
   POST             更新指定页面（需认证）
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

/* ---------- GET ---------- */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const page = url.searchParams.get('page');
  const all = url.searchParams.get('all');

  try {
    /* 获取全部（需认证） */
    if (all === '1') {
      if (!checkAuth(request, env)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const result = await env.DB.prepare(
        `SELECT page_key, version, date, updates, updated_at
         FROM page_updates
         ORDER BY page_key`
      ).all();
      const list = (result.results || []).map(r => ({
        page_key: r.page_key,
        version: r.version,
        date: r.date,
        updates: JSON.parse(r.updates || '[]'),
        updated_at: r.updated_at
      }));
      return json({ ok: true, data: list });
    }

    /* 获取单个页面（公开） */
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
        updates: JSON.parse(row.updates || '[]')
      }
    });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}

/* ---------- POST（更新，需认证） ---------- */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
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
    if (updates.some(u => typeof u !== 'string' || u.length > 200)) {
      return json({ ok: false, error: 'invalid updates' }, 400);
    }

    /* 自动生成日期（当前时间） */
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
    return json({ ok: false, error: 'server error' }, 500);
  }
}