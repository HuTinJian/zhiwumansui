const P = require('./musicid-grabber.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n        expected ' + e + '\n        actual   ' + a); }
}

const SONG = '\u8d77\u98ce\u4e86';
const WORLD = '\u6211\u7684\u4e16\u754c';
const VER = '\u7248';
const LIKE = '\u70b9\u8d5e';
const CI = '\u6b21';
const LOU = '\u697c';

console.log('\n[1] pager detection');
eq(P.detectPager('https://tieba.baidu.com/f?kw=roblox&pn=0'), { key: 'pn', base: 0, step: 50 }, 'forum list pn=0 -> step 50');
eq(P.detectPager('https://tieba.baidu.com/p/123456789?pn=2'), { key: 'pn', base: 2, step: 1 }, 'thread page pn=2 -> step 1');
eq(P.detectPager('https://example.com/list?page=3'), { key: 'page', base: 3, step: 1 }, 'generic page=3');
eq(P.detectPager('https://pd.qq.com/'), null, 'no pager -> null');

console.log('\n[2] next page URL');
eq(P.buildPageUrl('https://tieba.baidu.com/f?kw=roblox&pn=0', P.detectPager('https://tieba.baidu.com/f?kw=roblox&pn=0'), 2),
   'https://tieba.baidu.com/f?kw=roblox&pn=100', 'forum list page 3 -> pn=100');
eq(P.buildPageUrl('https://tieba.baidu.com/p/123?pn=2', P.detectPager('https://tieba.baidu.com/p/123?pn=2'), 1),
   'https://tieba.baidu.com/p/123?pn=3', 'thread next -> pn=3');
eq(P.buildPageUrl('https://example.com/list?page=3', P.detectPager('https://example.com/list?page=3'), 1),
   'https://example.com/list?page=4', 'generic next -> page=4');

console.log('\n[3] extract IDs from text (strict)');
const sample = [
  '[Playlist] roblox music IDs',
  SONG + ' - 1836547291',
  'Something Just Like This: 1837007494',
  LIKE + ' 12345678 ' + CI,
  'tel 13800138000',
  'updated 20240315',
  'https://www.roblox.com/library/1838999999',
  'rbxassetid://1841234567 ' + WORLD,
  'floor 12345 ' + LOU,
  'a very long name used to check the 60 char cut off behaviour 999888777'
];
const strictHits = P.extractFromLines(sample, true);
const strictIds = strictHits.map(h => Number(h.id)).sort((a, b) => a - b);
eq(strictIds, [999888777, 1836547291, 1837007494, 1838999999, 1841234567].sort((a, b) => a - b),
   'strict mode: exactly 5 IDs (all noise filtered)');
eq(strictHits.find(h => h.id === '1836547291').name, SONG, 'name pairing works for Chinese text');
eq(strictHits.find(h => h.id === '1841234567').name.indexOf(WORLD) >= 0, true, 'rbxassetid:// form recognized');
eq(strictHits.find(h => h.id === '1838999999').name, '', 'bare URL gives empty name (not a fake name)');

console.log('\n[4] strict vs loose / dedupe / noise');
eq(P.extractFromLines([LIKE + ' 12345678 ' + CI], true), [], 'strict drops "likes N times"');
eq(P.extractFromLines([LIKE + ' 12345678 ' + CI], false).length, 1, 'loose keeps it');
eq(P.extractFromLines([SONG + ' 1836547291', SONG + ' (Live' + VER + ') 1836547291'], true).length, 1, 'same ID kept once');
eq(P.extractFromLines([SONG + ' 1836547291', SONG + ' (Live' + VER + ') 1836547291'], true)[0].name,
   SONG + ' Live' + VER, 'same ID keeps the richer name (brackets normalized)');
eq(/^[\x00-\x7F]*$/.test(P.NOISE_SRC), true, 'noise regex source itself is pure ASCII');

console.log('\n[5] blob scan (JSON bodies from the network sniffer)');
const blob = '{"nextPage":2,"items":[' +
  '{"postId":1790437565935849744,"createTime":1735689000,"title":"Song-1-0","audioId":1830000100},' +
  '{"postId":1790437565935849745,"createTime":1735689001,"title":"Song-1-1","audioId":1830000101},' +
  '{"postId":1790437565935849746,"createTime":1735689002,"title":"Song-1-2","soundId":1830000102}' +
  ']}';
const blobHits = P.extractFromBlob(blob, true);
eq(blobHits.map(h => Number(h.id)).sort((a, b) => a - b), [1830000100, 1830000101, 1830000102],
   'blob: 3 asset ids found, post ids and timestamps dropped');
eq(blobHits.every(h => h.key === true), true, 'blob: all three flagged as explicit asset keys');
eq(blobHits.find(h => h.id === '1830000100').name.indexOf('Song-1-0') >= 0, true, 'blob: context kept as name');
eq(P.hasTimeKey('"createTime":'), true, 'time key "createTime": detected');
eq(P.hasTimeKey('"ts":'), true, 'time key "ts": detected');
eq(P.hasTimeKey('"audioId":'), false, 'asset key is not a time key');
eq(P.hasAssetKey('"audioId":'), true, 'asset key "audioId": detected');
eq(P.extractFromBlob('{"updateTime":1735689000}', true), [], 'bare timestamp is dropped');
eq(P.extractFromBlob('{"id":1735689000}', true).length, 1, 'a generic numeric id is still kept (may need manual filtering)');
eq(P.extractFromBlob(blob, true).length, 3, 'the same id appearing twice inside one blob is kept once');

console.log('\n[6] adjustable ID length range');
P.setIdRange(6, 12);
eq(P.extractFromBlob('{"musicId":138765729162919}', true), [], '6-12: a 15 digit id is skipped');
P.setIdRange(6, 16);
eq(P.extractFromBlob('{"musicId":138765729162919}', true).length, 1, '6-16: the same 15 digit id is captured');
eq(P.extractFromBlob('{"musicId":138765729162919}', true)[0].key, true, '6-16: it is still flagged as an explicit asset key');
eq(P.extractFromBlob('{"postId":1790437565935849744}', true), [], 'a 19 digit internal id stays excluded');
eq(P.extractFromBlob('{"ts":1735689000,"audioId":1836547291}', true).length, 1, 'timestamp still dropped while the id is kept');
eq(/^[\x00-\x7F]*$/.test(P.idSrc()), true, 'the dynamic id regex source is pure ASCII');
eq(P.extractFromBlob('{"postId":9000000000001}', true).length, 1,
   '6-16: a 13 digit internal id is also captured (pick 6-12 to exclude it)');
P.setIdRange(6, 12);
eq(P.extractFromBlob('{"postId":9000000000001}', true), [], '6-12: the same 13 digit internal id is excluded');
P.setIdRange(6, 16);

console.log('\nresult: ' + pass + ' passed / ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
