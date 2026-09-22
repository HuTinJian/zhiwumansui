/* ============================================================
   织雾满穗 · 博客注册
   POST /api/blog/auth/register  body: { username, password }
   注册成功后直接登录（下发会话 Cookie）。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../../_utils.js';
import {
  normalizeUsername, checkPasswordStrength, makeSalt, hashPassword,
  makeUserCookie, USER_TTL_SECONDS
} from '../_auth.js';

/* 单 IP 10 分钟最多注册 5 个，挡住批量刷号 */
const limiter = createRateLimiter(5, 10 * 60 * 1000);

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

    if (!username) return json({ ok: false, error: 'bad_username' }, 400);

    const weak = checkPasswordStrength(password);
    if (weak) return json({ ok: false, error: weak }, 400);

    const exists = await env.DB.prepare(
      'SELECT id FROM blog_users WHERE username = ?'
    ).bind(username).first();

    if (exists) return json({ ok: false, error: 'username_taken' }, 409);

    const salt = makeSalt();
    const passHash = await hashPassword(password, salt);

    const result = await env.DB.prepare(
      'INSERT INTO blog_users (username, pass_hash, salt, banned) VALUES (?, ?, ?, 0)'
    ).bind(username, passHash, salt).run();

    const id = Number(result.meta && result.meta.last_row_id) || 0;
    const cookie = await makeUserCookie(env, id, USER_TTL_SECONDS);

    return json({ ok: true, user: { id, username } }, 200, { 'Set-Cookie': cookie });
  } catch (err) {
    console.error('[blog/auth/register]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
