/* ============================================================
   POST /api/quarantine/delete
   删除隔离区ID（需认证）
   body: { id: 'xxx' }  或  { ids: ['xxx', 'yyy'] }
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

    /* 单个或多个 */
    let ids = [];
    if (body.id) ids = [String(body.id)];
    if (Array.isArray(body.ids)) ids = body.ids.map(String);

    if (ids.length === 0) {
      return json({ ok: false, error: 'missing id' }, 400);
    }

    let deleted = 0;
    const stmts = ids.map(id =>
      env.DB.prepare('DELETE FROM quarantine_admin WHERE music_id = ?').bind(id)
    );
    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if (r.meta && r.meta.changes > 0) deleted++;
    }

    return json({ ok: true, deleted });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}