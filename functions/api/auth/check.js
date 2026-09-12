/* ============================================================
   织雾满穗 · 登录状态检查
   读取 Cookie 判断是否已登录
   ============================================================ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/* 从 Cookie 中读取指定键 */
function readCookie(cookieHeader, key) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...v] = part.trim().split('=');
    if (k === key) return v.join('=');
  }
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cookieHeader = request.headers.get('Cookie');
  const token = readCookie(cookieHeader, 'zm_auth');

  if (token && token === env.AUTH_TOKEN) {
    return json({ ok: true });
  }
  return json({ ok: false }, 401);
}