/* ============================================================
   织雾满穗 · 提交功能建议（公开接口）
   ------------------------------------------------------------
   为什么有这个接口（2026-11-23）：
     站主想开始收集玩家对网站功能的任何建议。首页原来那颗
     「🔗 分享本站」按钮改成「💡 功能建议」，弹窗里选分类
     （第几章 / 第一章的【卡片】）、填昵称和建议正文，提交到这里。
   公开数据口径（前端也只能看到这些）：
     · 只保存「玩家自己填的昵称、选的位置、建议正文」；
     · 不保存 IP（IP 只在内存里做限速，进程重启即丢）；
     · 没有 openid / 手机号 / 订单号，也没有任何第三方统计。
   安全边界（与站内其它公开写接口同一套）：
     · 必须同源（requireSameOrigin）；
     · 按 IP 限速：10 分钟最多 6 条（正常人一次就够，脚本也写不爆 D1）；
     · 配了 Turnstile 就必须带通行证（checkTurnstile，未配置时自动放行）；
     · 昵称 / 分类 / 正文里的尖括号一律抹掉，防止把 HTML 存进库；
     · 所有字段都有长度上限，正文保留换行（后台按原文显示）。
   数据去向：D1 表 feature_suggestions，后台「💡 功能建议」面板读它。
   【回退办法】
     · 删掉 functions/api/suggestions/ 整个目录 → 接口消失，弹窗提交会报错；
     · 想连入口一起撤：把 index.html 那颗按钮改回「🔗 分享本站」并去掉
       data-suggest（分享弹窗代码仍在 js/common.js 0.7 节）；
     · 表可以留着不动；要清数据跑：
       DROP TABLE IF EXISTS feature_suggestions;
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
import { ensureFeatureSuggestionsTable } from './_schema.js';

/* 同一 IP 10 分钟最多 6 条。正常玩家提建议不会连着刷；
   就算被恶意刷，也只是在后台多几条可删的记录。 */
const limiter = createRateLimiter(6, 10 * 60 * 1000);

const MAX_NAME = 40;
const MAX_CHAPTER = 40;
const MAX_CATEGORY = 80;
const MAX_CONTENT = 500;

/* 抹掉尖括号：这些内容最终会渲染进后台，绝不能把 HTML 当昵称存进去。
   正文里的换行保留（玩家可能分点写），只去掉标签字符。 */
function stripTags(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[<>]/g, '').trim();
}

/* 昵称 / 分类压成一行：它们没有多行语义，压缩空白能让后台列表更好读 */
function oneLine(value) {
  return stripTags(value).replace(/\s+/g, ' ');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!requireSameOrigin(request)) {
    return json({ ok: false, error: 'bad origin' }, 403);
  }

  const body = await readJsonBody(request);

  /* 限速键用 IP；绝不能用 body 里的昵称（那等于让刷子无限换桶） */
  const limit = limiter.check(clientIp(request));
  if (!limit.ok) {
    return json({ ok: false, error: 'too many requests', wait: limit.wait }, 429);
  }

  /* 人机验证：没配 TURNSTILE_SECRET 时直接放行（与站内其它公开接口一致） */
  const ts = await checkTurnstile(request, env, body);
  if (!ts.ok) return turnstileRejection(ts);

  const name = oneLine(body.name);
  const chapter = oneLine(body.chapter);
  const category = oneLine(body.category);
  const content = stripTags(body.content);

  if (!name) return json({ ok: false, error: 'missing name' }, 400);
  if (name.length > MAX_NAME) return json({ ok: false, error: 'name too long' }, 400);
  if (chapter.length > MAX_CHAPTER) return json({ ok: false, error: 'chapter too long' }, 400);
  if (category.length > MAX_CATEGORY) return json({ ok: false, error: 'category too long' }, 400);
  if (!content) return json({ ok: false, error: 'missing content' }, 400);
  if (content.length > MAX_CONTENT) return json({ ok: false, error: 'content too long' }, 400);

  try {
    /* 第一次被真正用到时自动建表（token 没有列账户权限，跑不了 D1 迁移；
       这里的 DDL 全是写死的 IF NOT EXISTS，不碰已有数据）。 */
    await ensureFeatureSuggestionsTable(env);

    await env.DB.prepare(
      `INSERT INTO feature_suggestions (name, chapter, category, content, status)
       VALUES (?, ?, ?, ?, 'new')`
    ).bind(name, chapter, category, content).run();

    return json({ ok: true });
  } catch (err) {
    console.error('[suggestions submit]', err);
    /* 表还没建的时候给后台一句人话，别只留 500 */
    const text = String((err && err.message) || '');
    if (/no such table/i.test(text)) {
      return json({ ok: false, error: 'table missing' }, 500);
    }
    return json({ ok: false, error: 'server error' }, 500);
  }
}
