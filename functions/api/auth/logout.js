/* ============================================================
   织雾满穗 · 退出登录
   ============================================================ */

import { json, clearSessionCookie, requireSameOrigin } from '../_utils.js';

export async function onRequestPost(context) {
  const { request } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
