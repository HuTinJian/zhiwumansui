/* ============================================================
   织雾满穗 · 访问渠道统计（公开）
   ============================================================ */

import { json } from '../_utils.js';

/* 2026-10-05：公开只读的「统计/名单」接口，允许浏览器与 Cloudflare 边缘缓存 60 秒
   （stale-while-revalidate 600 秒：过期后先拿旧的顶上，再后台刷新）。
   口径：访问渠道统计本来就是累加数，晚 60 秒对外生效对访客毫无影响；
   换来的是重复访问不再每次都打 D1（同类接口实测 600ms 上下）。
   ⚠️ 必须配合前端去掉 `?t=Date.now()`：URL 每次都不一样的话缓存永远不命中，这个头就是白加。
   ⚠️ 500 分支不加这个头：一次 D1 抖动不能被缓存 60 秒。 */
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' };

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(
      `SELECT source, COUNT(*) AS count
       FROM visit_sources
       GROUP BY source
       ORDER BY count DESC`
    ).all();

    return json({ ok: true, data: result.results || [] }, 200, CACHE_HEADERS);
  } catch (err) {
    console.error('[visit/stats]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}