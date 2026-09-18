/* ============================================================
   织雾满穗 · Functions 共享工具
   （以下划线开头，Cloudflare 不会把它当路由）
   ============================================================ */

const textEncoder = new TextEncoder();

/* 统一 JSON 响应 */
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

/* 从 Cookie 头中读取指定键（值做安全解码，解码失败回退原值） */
export function readCookie(cookieHeader, key) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...v] = part.trim().split('=');
    if (k === key) {
      const raw = v.join('=');
      try {
        return decodeURIComponent(raw);
      } catch (e) {
        return raw;
      }
    }
  }
  return null;
}

/* ArrayBuffer / Uint8Array → 小写十六进制 */
export function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* 定长比较：长度不同也不提前返回，逐字符异或累积差异 */
export function timingSafeEqual(a, b) {
  const sa = String(a === undefined || a === null ? '' : a);
  const sb = String(b === undefined || b === null ? '' : b);
  const len = Math.max(sa.length, sb.length, 1);
  let diff = sa.length === sb.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ca = i < sa.length ? sa.charCodeAt(i) : 0;
    const cb = i < sb.length ? sb.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

/* 部署自检：缺少必要绑定/密钥时抛出可读错误，避免「莫名 500」 */
export function assertEnv(env) {
  const missing = [];
  if (!env || !env.DB) missing.push('DB');
  if (!env || !env.AUTH_HASH) missing.push('AUTH_HASH');
  if (!env || !env.AUTH_TOKEN) missing.push('AUTH_TOKEN');
  if (missing.length > 0) {
    throw new Error(
      '[织雾满穗] 缺少必需的环境绑定/密钥：' + missing.join(', ') +
      ' —— 请在 Cloudflare Pages 项目设置里以加密变量（Secret）配置，详见 README.md'
    );
  }
}

/* 长度校验（供 thanks 等接口复用） */
export function tooLong(value, max) {
  return String(value === undefined || value === null ? '' : value).length > max;
}

/* ---------- 会话 Cookie ---------- */

export const SESSION_COOKIE = 'zm_auth';

/* hexHmac = HMAC-SHA256(message, secret) 的小写十六进制 */
async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(String(message)));
  return toHex(sig);
}

/* 校验签名会话 Cookie：<exp>.<hexHmac>，hexHmac = HMAC-SHA256(exp, AUTH_TOKEN) */
export async function checkSession(request, env) {
  try {
    if (!env || !env.AUTH_TOKEN) return false;

    const raw = readCookie(request.headers.get('Cookie'), SESSION_COOKIE);
    if (!raw) return false;

    const dot = raw.indexOf('.');
    if (dot <= 0) return false;

    const expStr = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    if (!/^[0-9]{1,15}$/.test(expStr)) return false;
    if (!/^[0-9a-fA-F]{64}$/.test(sig)) return false;

    const exp = Number(expStr);
    if (!Number.isSafeInteger(exp)) return false;
    if (exp <= Math.floor(Date.now() / 1000)) return false;

    const expected = await hmacHex(expStr, env.AUTH_TOKEN);
    return timingSafeEqual(sig.toLowerCase(), expected.toLowerCase());
  } catch (err) {
    return false;
  }
}

/* 签发会话 Cookie（返回 Set-Cookie 的值） */
export async function makeSessionCookie(env, ttlSeconds) {
  if (!env || !env.AUTH_TOKEN) {
    throw new Error('[织雾满穗] AUTH_TOKEN 未配置，拒绝签发会话 Cookie');
  }
  const ttl = Math.max(0, Math.floor(Number(ttlSeconds) || 0));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = await hmacHex(String(exp), env.AUTH_TOKEN);
  return [
    SESSION_COOKIE + '=' + encodeURIComponent(exp + '.' + sig),
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=' + ttl
  ].join('; ');
}

/* 清空会话 Cookie（属性与签发时保持一致） */
export function clearSessionCookie() {
  return [
    SESSION_COOKIE + '=',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0'
  ].join('; ');
}

/* 检查登录态（异步：签名 + 过期时间的会话 Cookie） */
export async function checkAuth(request, env) {
  return checkSession(request, env);
}

/* ---------- 同源校验 ---------- */

/* 非 GET 请求：Origin 缺失 或 Origin 主机与请求主机一致才算通过 */
export function requireSameOrigin(request) {
  try {
    const method = String((request && request.method) || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return true;

    const origin = request.headers.get('Origin');
    if (!origin) return true;

    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    return originUrl.host === requestUrl.host;
  } catch (err) {
    return false;
  }
}

/* 读取 JSON 请求体：非法 JSON 或非对象一律返回 {} */
export async function readJsonBody(request) {
  const body = await request.json().catch(() => null);
  return (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
}

/* ---------- 简易内存限速（单 isolate 内生效） ---------- */

const RATE_LIMIT_MAX_KEYS = 5000;

/* createRateLimiter(max, windowMs) → { check(key), reset(key) } */
export function createRateLimiter(max, windowMs) {
  const store = new Map();

  /* 条目过多时先清过期项，仍超限则按插入顺序淘汰最旧的 */
  function prune(now) {
    if (store.size <= RATE_LIMIT_MAX_KEYS) return;
    for (const [k, rec] of store) {
      if (now - rec.firstAt > windowMs) store.delete(k);
    }
    let overflow = store.size - RATE_LIMIT_MAX_KEYS;
    if (overflow > 0) {
      for (const k of store.keys()) {
        if (overflow <= 0) break;
        store.delete(k);
        overflow--;
      }
    }
  }

  return {
    check(key) {
      const now = Date.now();
      prune(now);

      const k = String(key || 'unknown');
      const rec = store.get(k);
      if (!rec || now - rec.firstAt > windowMs) {
        store.set(k, { count: 1, firstAt: now });
        return { ok: true };
      }
      if (rec.count >= max) {
        return { ok: false, wait: Math.ceil((windowMs - (now - rec.firstAt)) / 1000) };
      }
      rec.count += 1;
      return { ok: true };
    },
    reset(key) {
      store.delete(String(key || 'unknown'));
    }
  };
}

/* 客户端 IP：只信任 Cloudflare 注入的 CF-Connecting-IP，缺失时为 'unknown' */
export function clientIp(request) {
  const ip = request && request.headers.get('CF-Connecting-IP');
  return (ip && String(ip).trim()) || 'unknown';
}

/* 登录态探测（auth/check）的共享限速器：
   同一 IP 10 分钟 5 次；登录成功时由 login.js 清零该 IP 的计数，
   避免「Cookie 过期后反复打开后台」把管理员自己锁在限速外。 */
export const authProbeLimiter = createRateLimiter(5, 10 * 60 * 1000);

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
