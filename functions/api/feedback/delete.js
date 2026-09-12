/* ============================================================
   织雾满穗 · 删除反馈
   需认证，删除指定 ID 的反馈
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
    if (!id) return json({ ok: false, error: 'invalid id' }, 400);

    const result = await env.DB.prepare(
      'DELETE FROM feedback WHERE id = ?'
    ).bind(id).run();

    return json({ ok: true, deleted: result.meta.changes });
  } catch (err) {
    return json({
      ok: false,
      error: 'server error',
      message: String((err && err.message) || err)
    }, 500);
  }
}