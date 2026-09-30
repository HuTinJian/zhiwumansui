/* 自测：只测纯逻辑（不碰浏览器），跑法：node self-test.js */
const P = require('./musicid-grabber.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n        期望 ' + e + '\n        实际 ' + a); }
}

console.log('\n[1] 翻页参数识别');
eq(P.detectPager('https://tieba.baidu.com/f?kw=roblox&pn=0'), { key: 'pn', base: 0, step: 50 }, '贴吧吧列表 pn=0 → 步长 50');
eq(P.detectPager('https://tieba.baidu.com/p/123456789?pn=2'), { key: 'pn', base: 2, step: 1 }, '贴吧帖子页 pn=2 → 步长 1');
eq(P.detectPager('https://example.com/list?page=3'), { key: 'page', base: 3, step: 1 }, '通用 page=3');
eq(P.detectPager('https://pd.qq.com/'), null, '没有翻页参数 → null');

console.log('\n[2] 翻页 URL 生成');
eq(P.buildPageUrl('https://tieba.baidu.com/f?kw=roblox&pn=0', P.detectPager('https://tieba.baidu.com/f?kw=roblox&pn=0'), 2),
   'https://tieba.baidu.com/f?kw=roblox&pn=100', '吧列表第 3 页 → pn=100');
eq(P.buildPageUrl('https://tieba.baidu.com/p/123?pn=2', P.detectPager('https://tieba.baidu.com/p/123?pn=2'), 1),
   'https://tieba.baidu.com/p/123?pn=3', '帖子页下一页 → pn=3');
eq(P.buildPageUrl('https://example.com/list?page=3', P.detectPager('https://example.com/list?page=3'), 1),
   'https://example.com/list?page=4', '通用下一页 → page=4');

console.log('\n[3] 从文字里抠 ID（严格模式）');
const sample = [
  '【歌单】roblox 音乐ID 大全',
  '起风了 - 1836547291',
  'Something Just Like This：1837007494',
  '点赞 12345678 次',
  '联系方式 13800138000',
  '更新日期 20240315',
  'https://www.roblox.com/library/1838999999',
  'rbxassetid://1841234567 我的世界BGM',
  '第 12345 楼',
  '歌名很长的测试曲目名称超过二十个字的时候也应该正常保存下来 999888777'
];
const strictHits = P.extractFromLines(sample, true);
const strictIds = strictHits.map(h => Number(h.id)).sort((a, b) => a - b);
eq(strictIds, [999888777, 1836547291, 1837007494, 1838999999, 1841234567].sort((a, b) => a - b), '严格模式抠出 5 个 ID（噪声全被过滤）');
eq(strictHits.find(h => h.id === '1836547291').name, '起风了', '歌名配对：起风了');
eq(strictHits.find(h => h.id === '1841234567').name.indexOf('我的世界BGM') >= 0, true, 'rbxassetid:// 形式也认');

console.log('\n[4] 宽松模式 / 去重 / 噪声');
eq(P.extractFromLines(['点赞 12345678 次'], true), [], '严格模式排除「点赞 N 次」');
eq(P.extractFromLines(['点赞 12345678 次'], false).length, 1, '宽松模式保留它');
eq(P.extractFromLines(['起风了 1836547291', '起风了（Live版） 1836547291'], true).length, 1, '同一个 ID 只留一条');
eq(P.extractFromLines(['起风了 1836547291', '起风了（Live版） 1836547291'], true)[0].name, '起风了 Live版', '同名 ID 保留信息更全的那个');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
