/* ============================================================
   织雾满穗 · 博客退出登录
   POST /api/blog/auth/logout
   ============================================================ */

import { json, requireSameOrigin } from '../../_utils.js';
import { clearUserCookie } from '../_auth.js';

export async function onRequestPost(context) {
  const { request } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  return json({ ok: true }, 200, { 'Set-Cookie': clearUserCookie() });
}
