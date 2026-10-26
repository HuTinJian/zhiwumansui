/* ============================================================
   织雾满穗 · 怀旧版「只读」守卫（2026-10-26 新增）
   ------------------------------------------------------------
   作用：让 legacy/2026-08-25/ 里的旧版页面只作展示 ——
   所有功能按钮点了只弹一句提示，不执行原来的功能，也不向新版接口写数据。

   为什么不用「逐个改按钮」：旧版三页一共有 34 个 <button>，分散在十几段逻辑里，
   漏一个就可能真的把反馈提交进新版、或者把复制/试听算进新版热度榜。
   这里用「捕获阶段统一拦截」：在页面自己的 click 处理器之前就把事件拦住，
   不管按钮绑的是哪段代码，都不可能执行。

   保留不拦的只有两类：
     · 页面跳转链接（<a>）—— 旧版三页互跳、顶部「回到新版」；
     · 弹窗的关闭/取消按钮（按 id 白名单）—— 万一有弹窗被打开，不至于关不掉。
   表单 submit 也单独拦一层（回车提交、或以后有人加 input[type=submit]）。

   【回退办法】删掉本文件，并删掉三个旧版页面里
   <script src="js/legacy-readonly.js"></script> 那一行，旧版就回到可以真的点按钮的状态。
   ============================================================ */
(function () {
  'use strict';

  /* 提示文案：和旧版来源问卷里那句「怀旧版只做展示」保持同一口径 */
  var NOTICE = '🕰️ 怀旧版只作展示，这个操作不会生效；要用请回新版。';

  /* 弹窗关闭/取消：这些按钮不写数据，留着是为了不把访客困在弹窗里。
     旧版页面目前没有会自动打开的弹窗，属于保险措施。 */
  var ALLOW_IDS = {
    closeQuarantineBtn: 1,
    closeThanksBtn: 1,
    riskCancelBtn: 1,
    riskConfirmCancel: 1,
    visitOtherCancel: 1,
    updateCloseBtn: 1,
    updateOkBtn: 1
  };

  function notice() {
    if (typeof window.showToast === 'function') {
      window.showToast(NOTICE, 2800);
    } else {
      /* common.js 万一没加载成功，至少别静默无反应（旧版没有别的通知方式） */
      window.alert(NOTICE);
    }
  }

  /* 给页面内联脚本一个统一入口（反馈页的空壳 submit 会用到） */
  window.legacyNotice = notice;

  /* 1) 按钮：捕获阶段拦截，页面自己的处理器不会执行 */
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.closest) return;

    var btn = target.closest('button');
    if (!btn) return;
    if (ALLOW_IDS[btn.id]) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    notice();
  }, true);

  /* 2) 表单：回车 / 程序化 submit 也拦（反馈页第二道保险） */
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    notice();
  }, true);

  /* 3) 旧页面目前没有 input[type=submit|button]，防以后加进来漏网 */
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    var type = String(el.type || '').toLowerCase();
    if (type !== 'submit' && type !== 'button') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    notice();
  }, true);
})();
