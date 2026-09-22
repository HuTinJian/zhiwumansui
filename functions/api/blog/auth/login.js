/* ============================================================
   织雾满穗 · 博客登录
   POST /api/blog/auth/login  body: { username, password }
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../../_utils.js';
import {
  normalizeUsername, verifyPassword, makeUserCookie, USER_TTL_SECONDS
} from '../_auth.js';

/* 登录限速：单 IP 10 分钟 8 次，挡住撞库 */
const limiter = createRateLimiter(8, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!limiter.check(clientIp(request)).ok) {
    return json({ ok: false, error: 'too_many_requests' }, 429);
  }

  try {
    const body = await readJsonBody(request);
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');

    /* 用户名或密码不合法都回同一句，不透露"这个账号存不存在" */
    if (!username || !password) {
      return json({ ok: false, error: 'bad_credentials' }, 401);
    }

    const row = await env.DB.prepare(
      'SELECT id, username, pass_hash, salt, banned FROM blog_users WHERE username = ?'
    ).bind(username).first();

    if (!row) return json({ ok: false, error: 'bad_credentials' }, 401);
    if (Number(row.banned) === 1) return json({ ok: false, error: 'banned' }, 403);

    const okPass = await verifyPassword(password, row.salt, row.pass_hash);
    if (!okPass) return json({ ok: false, error: 'bad_credentials' }, 401);

    const cookie = await makeUserCookie(env, Number(row.id), USER_TTL_SECONDS);

    return json({
      ok: true,
      user: { id: Number(row.id), username: String(row.username) }
    }, 200, { 'Set-Cookie': cookie });
  } catch (err) {
    console.error('[blog/auth/login]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
