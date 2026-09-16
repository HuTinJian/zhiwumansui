/* ============================================================
   织雾满穗 · Functions 共享工具
   （以下划线开头，Cloudflare 不会把它当路由）
   ============================================================ */

/* 统一 JSON 响应 */
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  });
}

/* 从 Cookie 头中读取指定键 */
export function readCookie(cookieHeader, key) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...v] = part.trim().split('=');
    if (k === key) return v.join('=');
  }
  return null;
}

/* 检查登录态 */
export function checkAuth(request, env) {
  const token = readCookie(request.headers.get('Cookie'), 'zm_auth');
  return !!token && token === env.AUTH_TOKEN;
}

/* 安全解析 JSON 字符串 */
export function safeParse(str, fallback = []) {
  try {
    if (!str) return fallback;
    const parsed = JSON.parse(str);
    return parsed || fallback;
  } catch (e) {
    return fallback;
  }
}