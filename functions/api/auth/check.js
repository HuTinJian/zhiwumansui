/* ============================================================
   织雾满穗 · 登录状态检查
   限速方式与 login 一致：同一 IP 10 分钟内最多 5 次，
   认证成功即清零计数（本接口曾被当成无限次的 AUTH_TOKEN 爆破口）
   ============================================================ */

import {
  json,
  assertEnv,
  authProbeLimiter,
  checkAuth,
  clientIp
} from '../_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  assertEnv(env);

  const key = clientIp(request);
  const limit = authProbeLimiter.check(key);
  if (!limit.ok) {
    return json({ ok: false, error: 'too_many_attempts', wait: limit.wait }, 429);
  }

  try {
    if (await checkAuth(request, env)) {
      authProbeLimiter.reset(key);
      return json({ ok: true });
    }
  } catch (err) {
    console.error('[auth/check]', err);
  }
  return json({ ok: false }, 401);
}
