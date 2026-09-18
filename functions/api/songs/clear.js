/* ============================================================
   织雾满穗 · 清空歌曲（需认证 + 显式二次确认）
   ============================================================ */

import { json, checkAuth, readJsonBody, requireSameOrigin } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await readJsonBody(request);
    if (body.confirm !== 'DELETE_ALL') {
      return json({ ok: false, error: 'confirm required' }, 400);
    }

    const result = await env.DB.prepare('DELETE FROM songs_extra').run();
    return json({ ok: true, deleted: (result.meta && result.meta.changes) || 0 });
  } catch (err) {
    console.error('[songs/clear]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
