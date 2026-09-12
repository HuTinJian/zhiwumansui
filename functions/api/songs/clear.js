/* ============================================================
   织雾满穗 · 清空歌曲
   需认证，一键清空所有 D1 歌曲
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
    const result = await env.DB.prepare('DELETE FROM songs_extra').run();
    return json({ ok: true, deleted: (result.meta && result.meta.changes) || 0 });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}