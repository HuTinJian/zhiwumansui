/* ============================================================
   织雾满穗 · 访问渠道统计（公开）
   ============================================================ */

import { json } from '../_utils.js';

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(
      `SELECT source, COUNT(*) AS count
       FROM visit_sources
       GROUP BY source
       ORDER BY count DESC`
    ).all();

    return json({ ok: true, data: result.results || [] });
  } catch (err) {
    console.error('[visit/stats]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}