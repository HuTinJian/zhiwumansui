/* ============================================================
   织雾满穗 · 登录状态检查
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (checkAuth(request, env)) {
    return json({ ok: true });
  }
  return json({ ok: false }, 401);
}