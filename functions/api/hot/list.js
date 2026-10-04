/* ============================================================
   织雾满穗 · 热门列表（公开）
   ------------------------------------------------------------
   默认返回前 100 条（老行为，后台「📊 数据统计」按这个口径数）。
   2026-10-01 站主要求：宝库页的「🔥 热门推荐」要按「100 组」算，
   不是「100 个 ID」—— 组是按歌名合并后的单位，一个名字可能带好几个 ID，
   所以那边会传 ?limit=500 多拿一些 ID，再由前端合并成组、取前 100 组。
   limit 上限 500，防止被人拿去一次拉空整张表。
   ============================================================ */

import { json } from '../_utils.js';

/* 2026-10-05：公开只读的「统计/名单」接口，允许浏览器与 Cloudflare 边缘缓存 60 秒
   （stale-while-revalidate 600 秒：过期后先拿旧的顶上，再后台刷新）。
   口径：热门计数晚 60 秒对外生效对访客毫无影响，换来的是重复访问不再每次都打 D1（实测 599–873ms）。
   ⚠️ 必须配合前端去掉 `?t=Date.now()`：URL 每次都不一样的话缓存永远不命中，这个头就是白加。
   ⚠️ 500 分支不加这个头：一次 D1 抖动不能被缓存 60 秒。 */
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' };

export async function onRequestGet(context) {
  const { request, env } = context;

  let limit = 100;
  try {
    const q = new URL(request.url).searchParams.get('limit');
    if (q !== null) {
      const n = Number(q);
      if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), 500);
    }
  } catch (e) { /* 拿不到 query 就用默认 100 */ }

  try {
    const result = await env.DB.prepare(
      `SELECT music_id, copy_count, play_count, fav_count,
              (copy_count + play_count + fav_count) AS total
       FROM hot_songs
       WHERE (copy_count + play_count + fav_count) > 0
       ORDER BY total DESC, last_updated DESC
       LIMIT ?`
    ).bind(limit).all();

    const list = (result.results || []).map(r => ({
      id: r.music_id,
      copy: r.copy_count || 0,
      play: r.play_count || 0,
      fav: r.fav_count || 0,
      total: r.total || 0
    }));

    return json({ ok: true, data: list }, 200, CACHE_HEADERS);
  } catch (err) {
    console.error('[hot/list]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}