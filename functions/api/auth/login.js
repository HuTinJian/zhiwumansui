/* ============================================================
   织雾满穗 · 登录接口
   接收密码 → SHA-512 → 定长比对 → 签发签名会话 Cookie
   附带简易 IP 限速：10 分钟内最多 5 次
   ============================================================ */

import {
  json,
  assertEnv,
  authProbeLimiter,
  clientIp,
  createRateLimiter,
  makeSessionCookie,
  readJsonBody,
  requireSameOrigin,
  timingSafeEqual
} from '../_utils.js';

/* ---------- 简易内存限速（单 isolate 内生效） ---------- */
const limiter = createRateLimiter(5, 10 * 60 * 1000);

const MAX_PASSWORD_LENGTH = 200;
const SESSION_TTL = 7 * 24 * 3600;

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

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  /* 没有 AUTH_TOKEN 就无法签发会话：明确报错，绝不写入 "undefined" Cookie */
  if (!env || !env.AUTH_TOKEN) {
    console.error('[login] AUTH_TOKEN 未配置，拒绝签发会话 Cookie');
    return json({ ok: false, error: 'server misconfigured' }, 500);
  }
  assertEnv(env);

  const key = clientIp(request);
  const limit = limiter.check(key);
  if (!limit.ok) {
    return json(
      { ok: false, error: 'too_many_attempts', wait: limit.wait },
      429
    );
  }

  try {
    const body = await readJsonBody(request);
    const password = body.password;

    if (!password || typeof password !== 'string') {
      return json({ ok: false, error: 'missing' }, 400);
    }
    /* 限长：避免超长口令拖垮 SHA-512，也降低离线爆破收益 */
    if (password.length > MAX_PASSWORD_LENGTH) {
      return json({ ok: false, error: 'too long' }, 400);
    }

    const hash = await sha512(password);
    const expected = String(env.AUTH_HASH || '').trim().toLowerCase();

    if (!timingSafeEqual(hash.toLowerCase(), expected)) {
      return json({ ok: false }, 401);
    }

    /* 登录成功 → 清除失败计数；同时清掉该 IP 的登录态探测计数，
       避免「Cookie 过期后反复打开后台」的管理员仍被 check 限速挡住 */
    limiter.reset(key);
    authProbeLimiter.reset(key);

    const cookie = await makeSessionCookie(env, SESSION_TTL);

    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  } catch (err) {
    console.error('[login]', err);
    return json({ ok: false }, 500);
  }
}
