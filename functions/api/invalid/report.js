/* ============================================================
   织雾满穗 · 上报无效音乐 ID（公开，支持单个或批量）
   2026-10-05：新增。替代旧「访客隔离区 + 反馈上传」那条链路 ——
   访客只负责说「这个 ID 无效」，下不下架由管理员在后台定。
   ============================================================ */

import {
  json,
  checkTurnstile,
  clientIp,
  createRateLimiter,
  readJsonBody,
  requireSameOrigin,
  turnstileRejection
} from '../_utils.js';

/* 音乐 ID 形态：1~32 位字母 / 数字 / 下划线 / 连字符 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/* 浏览器匿名身份（前端 getClientId()）：小写字母数字 8~64 位 */
const REPORTER_PATTERN = /^[a-z0-9]{8,64}$/;

/* 一次最多 200 条，和前端的批量上限对齐 */
const MAX_ITEMS = 200;

/* 同一浏览器身份（拿不到身份时退化为单 IP）10 分钟最多 60 次上报，防刷 */
const limiter = createRateLimiter(60, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  /* 限速 key 优先用浏览器身份、缺失时退化为 IP，所以必须先读 body。
     readJsonBody 不会抛：非法 JSON 一律当空对象，交给下面的校验兜。 */
  const body = await readJsonBody(request);

  const reporter = String(body.reporter || '').trim().toLowerCase();
  /* 身份不合法不报错、只存空串（规格 3.1）—— 但去重键会退化成「全站同一条」，
     所以前端尽量带上 getClientId() */
  const validReporter = REPORTER_PATTERN.test(reporter) ? reporter : '';

  const limit = limiter.check(validReporter || clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  /* 人机验证：配了 TURNSTILE_SECRET 才生效；strict 模式下没带有效 token 直接 403 */
  const ts = await checkTurnstile(request, env, body);
  if (!ts.ok) return turnstileRejection(ts);

  try {
    /* 两种写法都收：单条 { id, name, category } / 批量 { items: [...] } */
    const raw = Array.isArray(body.items) ? body.items : [body];
    if (raw.length > MAX_ITEMS) {
      return json({ ok: false, error: 'too many items' }, 400);
    }

    const stmts = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;

      const id = String(item.id === undefined || item.id === null ? '' : item.id).trim();
      /* 非法 ID 直接丢，不打断整批（批量里混进坏数据是常事） */
      if (!ID_PATTERN.test(id)) continue;

      const name = String(item.name || '').trim().slice(0, 100);
      const category = String(item.category || '').trim().slice(0, 30);

      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO invalid_reports (music_id, name, category, reporter)
           VALUES (?, ?, ?, ?)`
        ).bind(id, name || null, category || null, validReporter)
      );
    }

    if (stmts.length === 0) {
      return json({ ok: false, error: 'missing id' }, 400);
    }

    /* 唯一键 (music_id, reporter) 负责去重：INSERT OR IGNORE 命中的行 changes=0 */
    let added = 0;
    let duplicates = 0;
    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if (r && r.meta && r.meta.changes > 0) added++;
      else duplicates++;
    }

    return json({ ok: true, added, duplicates });
  } catch (err) {
    console.error('[invalid/report]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
