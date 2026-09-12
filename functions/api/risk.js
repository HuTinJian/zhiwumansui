/* ============================================================
   /api/risk
   GET  获取当前风险版本（公开）
   POST 更新风险版本（需认证）
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
  const { env } = context;
  try {
    const row = await env.DB.prepare(
      `SELECT version FROM page_updates WHERE page_key = 'risk'`
    ).first();
    return json({ ok: true, version: (row && row.version) || 'v1.0.0' });
  } catch (err) {
    return json({ ok: true, version: 'v1.0.0' });
  }
}

/* ---------- POST（重置，需认证） ---------- */
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    /* 用时间戳作为新版本 */
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
    return json({ ok: false, error: 'server error' }, 500);
  }
}