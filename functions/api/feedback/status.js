/* ============================================================
   POST /api/feedback/status
   修改反馈状态（需认证）
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
    const id = Number(body.id);
    const status = String(body.status || '').trim();

    if (!id || !status) return json({ ok: false }, 400);

    await env.DB.prepare(
      'UPDATE feedback SET status = ? WHERE id = ?'
    ).bind(status, id).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false }, 500);
  }
}