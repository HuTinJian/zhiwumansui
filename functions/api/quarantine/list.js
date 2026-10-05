/* ============================================================
   织雾满穗 · 开发者隔离区列表（公开）
   ============================================================ */

import { json } from '../_utils.js';
import { toUtcIso } from '../_time.js';

/* 2026-10-05：**故意不加缓存头**（保持 _utils.json() 默认的 no-store）。
   我一度给它加过 `public, max-age=60`（想省掉重复访问那次 617ms 的 D1 查询），
   但独立验收的端到端用例 E34 当场证伪：管理员在后台「✅ 确认无效并下架」之后，
   访客的下一次宝库页加载**因为浏览器缓存命中而没有重新拉这个接口**，
   那条 ID 依旧显示 —— 也就是最关键的「下架生效」闭环被打断了。
   结论：已下架名单属于「必须立刻生效」的数据，宁可每次多花一次往返，也不能缓存。
   （性能收益改由 HTML 缓存 + 主数据缓存 + 静态快照 data/admin_quarantine.json 去拿。） */

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const result = await env.DB.prepare(
      `SELECT music_id, name, category, source, created_at
       FROM quarantine_admin
       ORDER BY created_at DESC, id DESC`
    ).all();

    const list = (result.results || []).map(r => ({
      id: r.music_id,
      name: r.name || '未知歌名',
      category: r.category || '未分类',
      source: r.source || '',
      /* 带时区的 UTC ISO（…Z）：后台「已下架」那一栏按北京时间显示，不会差 8 小时 */
      quarantinedAt: toUtcIso(r.created_at)
    }));

    return json({ ok: true, data: list });
  } catch (err) {
    console.error('[quarantine/list]', err);
    return json({ ok: false, data: [] }, 200);
  }
}