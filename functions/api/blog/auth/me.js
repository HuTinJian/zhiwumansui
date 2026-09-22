/* ============================================================
   织雾满穗 · 查询当前登录用户
   GET /api/blog/auth/me  → { ok:true, user:{id,username} | null }
   未登录不算错误：游客模式是正常状态。
   ============================================================ */

import { json } from '../../_utils.js';
import { currentUser } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await currentUser(request, env);
    return json({ ok: true, user: user || null });
  } catch (err) {
    console.error('[blog/auth/me]', err);
    return json({ ok: true, user: null });
  }
}
