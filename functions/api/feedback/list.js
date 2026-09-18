/* ============================================================
   织雾满穗 · 反馈列表（需认证，支持分页）
   GET ?limit=&offset=  默认 200 条，最多 500 条
   ============================================================ */

import { json, checkAuth, safeParse } from '../_utils.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await checkAuth(request, env))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get('limit'));
    const offsetRaw = Number(url.searchParams.get('offset'));

    const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;
    const offset = Number.isSafeInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    const countRow = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM feedback'
    ).first();
    const total = (countRow && countRow.total) || 0;

    const result = await env.DB.prepare(
      `SELECT id, type, name, email, message,
              want_thanks, upload_quarantine, quarantine_ids,
              status, created_at
       FROM feedback
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();

    const list = (result.results || []).map(r => ({
      id: r.id,
      type: r.type,
      name: r.name,
      email: r.email || '',
      message: r.message,
      want_thanks: r.want_thanks || 0,
      upload_quarantine: r.upload_quarantine || 0,
      quarantine_ids: safeParse(r.quarantine_ids, []),
      status: r.status || 'pending',
      created_at: r.created_at
    }));

    return json({ ok: true, data: list, total });
  } catch (err) {
    console.error('[feedback/list]', err);
    return json({ ok: false, error: 'server error', data: [], total: 0 }, 500);
  }
}
