/* ============================================================
   织雾满穗 · 玩家「添加歌曲ID」投稿（公开）
   2026-10-07 站主要求：宝库页在「问题上报」旁边加一个「添加歌曲ID」，
   让玩家把自己找到的歌曲 ID 上报上来；**后台可以控制**（通过 / 删除），
   通过之后才进 D1 歌曲列表（songs_extra），因此这一栏在后台「D1歌曲管理」里。
   ------------------------------------------------------------
   设计（跟无效上报那条链路口径一致）：
   · 同源校验 + 人机验证（配了 Turnstile 才生效）+ 限速（同一身份 10 分钟 30 次）；
   · 只写进 song_submissions 这张**待审核**表，绝不直接进 songs_extra ——
     否则任何人都能往宝库里塞歌，站长就失去「控制」了；
   · 每条最多 20 个 ID（玩家一次贴一小批就够）；
   · 唯一键 (music_id, reporter)：同一个人重复提交同一个 ID 只算一次；
   · 后台通过时把它插进 songs_extra 并删掉投稿行（见 songs/submissions.js）。
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

const MAX_ITEMS = 20;

/* 同一浏览器身份 10 分钟最多 30 次投稿（正常玩家一次就够） */
const limiter = createRateLimiter(30, 10 * 60 * 1000);

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const body = await readJsonBody(request);

  const reporter = String(body.reporter || '').trim().toLowerCase();
  const validReporter = REPORTER_PATTERN.test(reporter) ? reporter : '';

  const limit = limiter.check(validReporter || clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  const ts = await checkTurnstile(request, env, body);
  if (!ts.ok) return turnstileRejection(ts);

  try {
    /* 两种写法都收：{ id, name, category } / { items: [{ id, name, category }] }（整组一起投） */
    const raw = Array.isArray(body.items) ? body.items : [body];
    if (raw.length > MAX_ITEMS) {
      return json({ ok: false, error: 'too many items' }, 400);
    }

    const stmts = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;

      const id = String(item.id === undefined || item.id === null ? '' : item.id).trim();
      if (!ID_PATTERN.test(id)) continue;

      const name = String(item.name || '').trim().slice(0, 100);
      const category = String(item.category || '').trim().slice(0, 30);

      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO song_submissions (music_id, name, category, reporter)
           VALUES (?, ?, ?, ?)`
        ).bind(id, name || null, category || null, validReporter)
      );
    }

    if (stmts.length === 0) {
      return json({ ok: false, error: 'missing id' }, 400);
    }

    let added = 0;
    let duplicates = 0;
    const results = await env.DB.batch(stmts);
    for (const r of results) {
      if (r && r.meta && r.meta.changes > 0) added++;
      else duplicates++;
    }

    return json({ ok: true, added, duplicates });
  } catch (err) {
    console.error('[songs/submit]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
