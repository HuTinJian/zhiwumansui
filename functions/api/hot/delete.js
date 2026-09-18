/* ============================================================
   织雾满穗 · 删除某条热门记录（需认证）
   ------------------------------------------------------------
   用途：后台「数据统计」里清掉某首歌的热度。
   场景：某个 ID 被刷了、或者某首歌已经不收录了，可以把它的计数清零。
   ============================================================ */

import { json, checkAuth, requireSameOrigin, readJsonBody } from '../_utils.js';

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
    const id = String(body.id || '').trim();

    /* 长度与 hot/report.js 保持一致，避免超长字符串进到 SQL */
    if (!id || id.length > 30) {
      return json({ ok: false, error: 'invalid id' }, 400);
    }

    const result = await env.DB.prepare(
      'DELETE FROM hot_songs WHERE music_id = ?'
    ).bind(id).run();

    return json({ ok: true, deleted: (result.meta && result.meta.changes) || 0 });
  } catch (err) {
    console.error('[hot/delete]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
