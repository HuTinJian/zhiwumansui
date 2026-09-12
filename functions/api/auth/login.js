/* ============================================================
   织雾满穗 · 登录接口
   接收密码 → 哈希比对 → 设置 Cookie
   ============================================================ */

/* SHA-512 哈希 */
async function sha512(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const buf = await crypto.subtle.digest('SHA-512', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* JSON 响应工具 */
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const password = body && body.password;

    if (!password || typeof password !== 'string') {
      return json({ ok: false, error: 'missing' }, 400);
    }

    const hash = await sha512(password);

    if (hash !== env.AUTH_HASH) {
      return json({ ok: false }, 401);
    }

    /* 登录成功：设置 HttpOnly Cookie */
    const cookie = [
      `zm_auth=${env.AUTH_TOKEN}`,
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Path=/',
      'Max-Age=86400'
    ].join('; ');

    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  } catch {
    return json({ ok: false }, 500);
  }
}