/* ============================================================
   织雾满穗 · 退出登录
   ============================================================ */

import { json } from '../_utils.js';

export async function onRequestPost() {
  const cookie = 'zm_auth=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}