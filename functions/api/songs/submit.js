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

/* 音乐 ID 形态（2026-10-17 收紧）：
   站主要求「游客添加的歌曲 ID 要符合，而不是什么英文和 1234 这些捣乱的」——
   真实的 Roblox 音频 ID 全是**纯数字**（data/roblox_music.json 里 4799 条实测
   最短 9 位、最长 15 位），所以这里只收 9~20 位纯数字。
   ⚠️ 这里一收紧，老库里可能残留的非数字投稿就永远进不了 songs_extra ——
      那正是我们要的（它们本来就不是有效 ID）；
      但**审核通过时**（functions/api/songs/submissions.js）还没有这些行，
      所以不会影响任何已经在 D1 里的数据。
   【回退办法】把这一行换回 /^[A-Za-z0-9_-]{1,32}$/ 即可恢复旧口径。 */
const ID_PATTERN = /^\d{9,20}$/;
/* 浏览器匿名身份（前端 getClientId()）：小写字母数字 8~64 位 */
const REPORTER_PATTERN = /^[a-z0-9]{8,64}$/;

/* 2026-10-17 站主要求：认不出分类时一律记「🧩 玩家提供」，不再留空 / 未完成。
   这个字面量必须和前端 roblox_music.html 的 CAT_PLAYER_PROVIDED 一致。 */
const CATEGORY_PLAYER_PROVIDED = '🧩 玩家提供';

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
      /* 2026-10-17：分类只收 30 字以内；空 / 认不出 → 「🧩 玩家提供」 */
      const rawCategory = String(item.category || '').trim().slice(0, 30);
      const category = rawCategory && rawCategory !== '未分类' && rawCategory !== '未完成'
        ? rawCategory
        : CATEGORY_PLAYER_PROVIDED;

      stmts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO song_submissions (music_id, name, category, reporter)
           VALUES (?, ?, ?, ?)`
        ).bind(id, name || null, category, validReporter)
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
