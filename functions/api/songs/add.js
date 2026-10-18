/* ============================================================
   织雾满穗 · 添加歌曲（需认证，自动分配 lineIndex）
   ============================================================ */

import { json, checkAuth, requireSameOrigin } from '../_utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const body = await request.json();
    const musicId = String(body.musicId || '').trim();
    const name = String(body.name || '').trim();
    /* 2026-10-17：后台导入时“认不出”的分类由 admin.html 的 guessCategory() 决定，
       这里只是最后一道兜底 —— 空 / 「未分类」/「未完成」都归到「🧩 玩家提供」
       （跟 functions/api/songs/submit.js、submissions.js 保持同一个字面量）。
       【回退办法】把这一行换回 `String(body.category || '未分类').trim() || '未分类'`。 */
    const rawCategory = String(body.category || '').trim();
    const category = (!rawCategory || rawCategory === '未分类' || rawCategory === '未完成')
      ? '🧩 玩家提供'
      : rawCategory;

    if (!musicId || !name) {
      return json({ ok: false, error: 'missing fields' }, 400);
    }
    if (musicId.length > 30 || name.length > 100 || category.length > 30) {
      return json({ ok: false, error: 'too long' }, 400);
    }

    /* line_index 在单条 INSERT 内用子查询计算，避免「先读后写」竞态 */
    await env.DB.prepare(
      `INSERT INTO songs_extra (music_id, name, category, line_index)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(line_index), 99999) + 1 FROM songs_extra))
       ON CONFLICT(music_id) DO UPDATE SET
         name = excluded.name,
         category = excluded.category`
    ).bind(musicId, name, category).run();

    /* ============================================================
       2026-10-18 站主要求：加入的歌如果已经在「隔离区」里，要提示「该 ID 处在隔离区」。
       隔离区 = 全站下架，写进 songs_extra 也不会在宝库页显示；不提示的话站长会以为没生效。
       【回退办法】删掉下面这段查询，把 return 改回 json({ ok: true })。 */
    let quarantined = false;
    try {
      const hit = await env.DB.prepare(
        'SELECT 1 AS hit FROM quarantine_admin WHERE music_id = ? LIMIT 1'
      ).bind(musicId).first();
      quarantined = !!(hit && hit.hit);
    } catch (err) {
      /* 查不到就当没命中：提示是锦上添花，不能因为它让「添加」失败 */
      console.error('[songs/add] quarantine check', err);
    }

    return json({ ok: true, quarantined });
  } catch (err) {
    console.error('[songs/add]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
