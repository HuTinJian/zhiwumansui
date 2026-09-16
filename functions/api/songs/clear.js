/* ============================================================
   织雾满穗 · 清空歌曲（需认证）
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const result = await env.DB.prepare('DELETE FROM songs_extra').run();
    return json({ ok: true, deleted: (result.meta && result.meta.changes) || 0 });
  } catch (err) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}