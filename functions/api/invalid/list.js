/* ============================================================
   织雾满穗 · 无效上报列表（需认证）
   2026-10-05：新增。给后台「🚫 无效音乐ID管理」用：
   待处理 / 已忽略两段按 music_id 聚合，外加统计卡的四个数字。
   ============================================================ */

import { json, checkAuth } from '../_utils.js';

const STATUSES = ['pending', 'ignored', 'all'];

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const url = new URL(request.url);

    const rawStatus = String(url.searchParams.get('status') || '').trim();
    const status = STATUSES.includes(rawStatus) ? rawStatus : 'pending';

    const rawLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

    /* 只查需要的状态：pending / ignored 单查，all 两个都查 */
    const wanted = status === 'all' ? ['pending', 'ignored'] : [status];

    const rows = [];
    for (const s of wanted) {
      /* 歌名 / 分类取「最近一条上报」的值（子查询按 id 倒序），
         而不是 MAX(name) —— 那是字典序最大，会拿到风马牛不相及的名字 */
      const result = await env.DB.prepare(
        `SELECT r1.music_id AS music_id,
                COUNT(*) AS report_count,
                MIN(r1.created_at) AS first_at,
                MAX(r1.created_at) AS last_at,
                (SELECT r2.name FROM invalid_reports r2
                  WHERE r2.music_id = r1.music_id AND r2.status = r1.status
                  ORDER BY r2.id DESC LIMIT 1) AS latest_name,
                (SELECT r2.category FROM invalid_reports r2
                  WHERE r2.music_id = r1.music_id AND r2.status = r1.status
                  ORDER BY r2.id DESC LIMIT 1) AS latest_category
         FROM invalid_reports r1
         WHERE r1.status = ?
         GROUP BY r1.music_id
         ORDER BY report_count DESC, last_at DESC
         LIMIT ?`
      ).bind(s, limit).all();

      for (const row of (result.results || [])) {
        rows.push({
          musicId: String(row.music_id),
          name: row.latest_name || '未知歌名',
          category: row.latest_category || '未分类',
          count: Number(row.report_count) || 0,
          status: s,
          firstAt: row.first_at || '',
          lastAt: row.last_at || ''
        });
      }
    }

    /* status=all 时两段混在一起，按 count DESC, lastAt DESC 重排，再截到 limit */
    rows.sort((a, b) => (b.count - a.count) || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
    const data = rows.slice(0, limit);

    /* 统计卡四个数字一次查询拿到（避免四次往返） */
    const summaryRow = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM invalid_reports WHERE status = 'pending') AS pending_reports,
         (SELECT COUNT(DISTINCT music_id) FROM invalid_reports WHERE status = 'pending') AS pending_ids,
         (SELECT COUNT(DISTINCT music_id) FROM invalid_reports WHERE status = 'ignored') AS ignored_ids,
         (SELECT COUNT(*) FROM quarantine_admin) AS removed_ids`
    ).first();

    const s = summaryRow || {};
    return json({
      ok: true,
      data,
      summary: {
        pendingIds: Number(s.pending_ids) || 0,
        pendingReports: Number(s.pending_reports) || 0,
        ignoredIds: Number(s.ignored_ids) || 0,
        removedIds: Number(s.removed_ids) || 0
      }
    });
  } catch (err) {
    console.error('[invalid/list]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
