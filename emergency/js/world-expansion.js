/* =========================================================================
   临界 · 紧急调度 — 大世界扩展（区域与尺寸）
   说明：本文件在 data.js 之后、map.js 之前加载，只扩展世界尺寸与区域。
         警情/单位/站点扩展在 content-expansion.js；地图实现在 map.js。
   回退办法：删除本文件与 index.html 中的引用，或者 revert 本次提交。
   ========================================================================= */
(function (root) {
  'use strict';
  var D = (root.EM = root.EM || {}).data;

  // 大世界：城区/工业区保留原位，东侧新增政务区，南侧新增山区与海湾。
  D.WORLD.W = 220;
  D.WORLD.H = 160;
  D.WORLD_NAME = '织雾市';

  D.DISTRICTS.push(
    {
      id: 'gov', name: '中央政府区', short: '政务区',
      x: 144, y: 8, w: 62, h: 46, tone: '#2d3340',
      labelXY: { x: 0.5, y: 0.3 }
    },
    {
      id: 'mountain', name: '织雾山', short: '山区',
      x: 3, y: 106, w: 88, h: 50, tone: '#26302a',
      labelXY: { x: 0.45, y: 0.42 }
    },
    {
      id: 'coast', name: '织雾湾', short: '海湾',
      x: 96, y: 106, w: 120, h: 50, tone: '#24313a',
      labelXY: { x: 0.46, y: 0.34 }
    }
  );

  // map.js 用它把区域 id 映射成 zone 编号（旧地图硬编码的 1-5 保持兼容）。
  D.ZONE_IDS = { city: 1, industrial: 2, country: 3, prison: 4, airport: 5, gov: 6, mountain: 7, coast: 8 };
  D.ZONE_NAMES = { 0: '', 1: 'city', 2: 'industrial', 3: 'country', 4: 'prison', 5: 'airport', 6: 'gov', 7: 'mountain', 8: 'coast' };
})(typeof window !== 'undefined' ? window : this);
