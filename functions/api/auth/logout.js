/* ============================================================
   织雾满穗 · 退出登录
   清除登录 Cookie
   ============================================================ */

export async function onRequestPost() {
  const cookie = 'zm_auth=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie
    }
  });
}