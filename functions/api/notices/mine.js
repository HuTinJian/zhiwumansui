/* ============================================================
   织雾满穗 · 上报的人收到的通知（公开，按浏览器身份取）
   2026-10-07 站主要求：「我如果下架了歌曲ID或者是删除了记录，上报的人都会收到弹窗提示，
   弹窗是我们自己的」。
   ------------------------------------------------------------
   写入方（不是这个文件）：functions/api/invalid/handle.js ——
     站长点「✅ 确认无效并下架」→ kind='removed'；
     站长点「🗑️ 删除记录」  → kind='deleted'（先写通知、再删上报记录）。
   读取方：js/common.js 的 checkReportNotices()（任意页面打开时拉一次，弹自己的弹窗）。
   ------------------------------------------------------------
   GET  ?reporter=xxxx   → 未读通知（最多 20 条，时间倒序）
   POST { reporter, ids } → 把这几条标成已读（点「我知道了」时调用）
   口径跟 /api/invalid/mine 一致：没有合法身份一律 400，只认自己的。
   ============================================================ */

import { json, clientIp, createRateLimiter, readJsonBody, requireSameOrigin } from '../_utils.js';
import { toUtcIso } from '../_time.js';

/* 浏览器匿名身份（common.js 的 getClientId）：小写字母数字 8~64 位 */
const REPORTER_PATTERN = /^[a-z0-9]{8,64}$/;

const MAX_ROWS = 20;

/* 同一身份 10 分钟最多 60 次查询（正常访客一个页面一次） */
const limiter = createRateLimiter(60, 10 * 60 * 1000);

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const reporter = String(url.searchParams.get('reporter') || '').trim().toLowerCase();
  if (!REPORTER_PATTERN.test(reporter)) {
    return json({ ok: false, error: 'missing reporter' }, 400);
  }

  const limit = limiter.check(reporter || clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  try {
    const result = await env.DB.prepare(
      `SELECT id, music_id, name, kind, created_at
         FROM report_notices
        WHERE reporter = ? AND seen = 0
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    ).bind(reporter, MAX_ROWS).all();

    const items = (result.results || []).map(row => ({
      id: Number(row.id) || 0,
      musicId: String(row.music_id || ''),
      name: row.name || '',
      /* removed = 🚫 已下架；deleted = 🗑️ 上报记录被删（歌还在库里） */
      kind: String(row.kind || 'deleted') === 'removed' ? 'removed' : 'deleted',
      /* 带时区的 UTC ISO（…Z）：前端换算成北京时间显示 */
      createdAt: toUtcIso(row.created_at)
    }));

    return json({ ok: true, items, count: items.length });
  } catch (err) {
    console.error('[notices/mine]', err);
    /* 迁移还没跑（没有这张表）时：当作「没有通知」，绝不打扰访客 */
    return json({ ok: true, items: [], count: 0 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  try {
    const body = await readJsonBody(request);
    const reporter = String(body.reporter || '').trim().toLowerCase();
    if (!REPORTER_PATTERN.test(reporter)) {
      return json({ ok: false, error: 'missing reporter' }, 400);
    }

    const raw = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
    const ids = [];
    for (const v of raw) {
      const n = Number(v);
      if (Number.isSafeInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
    }
    if (ids.length === 0) return json({ ok: false, error: 'missing ids' }, 400);

    const result = await env.DB.prepare(
      `UPDATE report_notices SET seen = 1
        WHERE reporter = ? AND id IN (SELECT value FROM json_each(?))`
    ).bind(reporter, JSON.stringify(ids)).run();

    return json({ ok: true, seenCount: (result.meta && Number(result.meta.changes)) || 0 });
  } catch (err) {
    console.error('[notices/mine post]', err);
    /* 标记失败不影响访客（下次打开还会弹一次），如实返回 ok:false 让前端静默处理 */
    return json({ ok: false, error: 'server error' }, 500);
  }
}
