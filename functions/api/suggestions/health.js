/* ============================================================
   织雾满穗 · 功能建议自检口（公开，只建表，不返回任何数据）
   ------------------------------------------------------------
   用途：部署后访问一次 /api/suggestions/health，确认 D1 绑定能用、
         并顺手把 feature_suggestions 表建好。
   返回：{ ok:true, table:'feature_suggestions' }
   安全：只执行写死的 CREATE TABLE / INDEX IF NOT EXISTS，不接收参数、
         不读数据、不泄露任何配置。想关掉：删掉本文件即可（三个业务
         接口里也各自会 ensure，不依赖它）。
   ============================================================ */

import { json } from '../_utils.js';
import { ensureFeatureSuggestionsTable } from './_schema.js';

export async function onRequestGet(context) {
  try {
    await ensureFeatureSuggestionsTable(context.env);
    return json({ ok: true, table: 'feature_suggestions' });
  } catch (err) {
    console.error('[suggestions health]', err);
    return json({ ok: false, error: 'server error' }, 500);
  }
}
