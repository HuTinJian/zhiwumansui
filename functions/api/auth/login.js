/* ============================================================
   织雾满穗 · 登录接口
   接收密码 → SHA-512 → 比对 → 设置 Cookie
   附带简易 IP 限速：10 分钟内最多 5 次失败
   ============================================================ */

import { json } from '../_utils.js';

/* ---------- 简易内存限速（单 isolate 内生效） ---------- */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;

function getClientKey(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown'
  );
}

function checkRateLimit(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return { ok: true };
  }
  if (rec.count >= MAX_ATTEMPTS) {
    const wait = Math.ceil((WINDOW_MS - (now - rec.firstAt)) / 1000);
    return { ok: false, wait };
  }
  rec.count += 1;
  return { ok: true };
}

function clearRateLimit(key) {
  attempts.delete(key);
}

/* ---------- SHA-512 ---------- */
async function sha512(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const buf = await crypto.subtle.digest('SHA-512', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ---------- 主逻辑 ---------- */
export async function onRequestPost(context) {
  const { request, env } = context;
  const key = getClientKey(request);

  const limit = checkRateLimit(key);
  if (!limit.ok) {
    return json(
      { ok: false, error: 'too_many_attempts', wait: limit.wait },
      429
    );
  }

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

    /* 登录成功 → 清除失败计数 */
    clearRateLimit(key);

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