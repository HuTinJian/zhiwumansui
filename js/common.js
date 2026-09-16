/* ============================================================
   织雾满穗 · 共享工具
   所有页面共用：Toast、弹窗、复制、防抖、版本检查
   ============================================================ */

/* 显示 Toast 短提示 */
function showToast(msg, duration = 2500) {
  let el = document.getElementById('globalToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration);
}

/* 打开弹窗（同时锁住页面滚动） */
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('show');
  modal.classList.remove('closing');
  document.body.classList.add('modal-open');
}

/* 关闭弹窗（带退出动画） */
function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('closing');
  setTimeout(() => {
    modal.classList.remove('show', 'closing');
    if (!document.querySelector('.modal.show')) {
      document.body.classList.remove('modal-open');
    }
  }, 220);
}

/* 复制文本到剪贴板 */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (e) {
    return false;
  }
}

/* 防抖函数 */
function debounce(fn, wait = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* 转义 HTML，防止 XSS（含引号，属性位置也安全） */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* 显示顶部提示条（3 秒自动消失） */
function showNotice(msg) {
  let el = document.getElementById('globalNotice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalNotice';
    el.className = 'notice-bar';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

/* 确认弹窗（返回 Promise） */
function showConfirm(title, message) {
  return new Promise(resolve => {
    let modal = document.getElementById('globalConfirm');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'globalConfirm';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content">
          <h2 id="gcTitle"></h2>
          <p id="gcMessage"></p>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="gcCancel">取消</button>
            <button class="btn btn-primary" id="gcOk">确认</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    document.getElementById('gcTitle').textContent = title;
    document.getElementById('gcMessage').textContent = message;
    openModal('globalConfirm');

    const ok = () => { closeModal('globalConfirm'); resolve(true); };
    const cancel = () => { closeModal('globalConfirm'); resolve(false); };
    document.getElementById('gcOk').onclick = ok;
    document.getElementById('gcCancel').onclick = cancel;
  });
}

/* ============================================================
   检查页面版本更新（图片弹窗版）
   ============================================================ */
async function checkPageUpdate(pageKey, options = {}) {
  const storageKey = `pageVersion_${pageKey}`;

  let version, date, updates;

  try {
    const res = await fetch(`/api/updates?page=${pageKey}&t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.data) return;
    version = data.data.version;
    date = data.data.date;
    updates = data.data.updates;
  } catch (e) {
    return;
  }

  const stored = localStorage.getItem(storageKey);
  if (stored === version) return;

  if (typeof options.onNewVersion === 'function') {
    options.onNewVersion();
  }

  let cfg = null;
  if (Array.isArray(updates) && updates.length > 0) {
    const first = updates[0];
    if (typeof first === 'string') {
      try {
        const parsed = JSON.parse(first);
        if (parsed && typeof parsed === 'object' && parsed.theme) cfg = parsed;
      } catch (e) {}
    }
  }

  if (!cfg) {
    showOldTextModal(version, date, updates, storageKey);
    return;
  }

  injectUpdateImageCSS();

  if (window.innerWidth < 640) {
    showSimpleUpdateModal(cfg, version, storageKey);
  } else {
    showCanvasUpdateModal(cfg, version, storageKey);
  }
}

/* ============================================================
   手机端：简化纵向弹窗
   ============================================================ */
function showSimpleUpdateModal(cfg, version, storageKey) {
  const modalId = 'updateModal';
  const old = document.getElementById(modalId);
  if (old) old.remove();

  let lines = String(cfg.lines || '')
    .split('\n').map(s => s.trim()).filter(s => '');
  if (lines.length === 0) lines.push('本次更新内容');
  const display = lines.slice(0, 8);

  const modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal update-image-modal';
  modal.innerHTML = `
    <div class="modal-content update-simple-content ${cfg.theme || 'theme-pink'}">
      <div class="update-simple-header">
        <span class="update-simple-badge">🎉 版本更新</span>
        <button class="update-image-close" id="updateCloseBtn" aria-label="关闭">✕</button>
      </div>
      <div class="update-simple-title">${escapeHtml(cfg.title || '日常更新')}</div>
      <div class="update-simple-version">${escapeHtml(cfg.version || version)}</div>
      <div class="update-simple-body">
        ${display.map(l => `<div class="update-simple-line">${escapeHtml(l)}</div>`).join('')}
      </div>
      <div class="update-simple-footer">
        <button class="update-image-ok" id="updateOkBtn">我知道了</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  openModal(modalId);

  const finish = () => {
    localStorage.setItem(storageKey, version);
    closeModal(modalId);
  };
  document.getElementById('updateOkBtn').onclick = finish;
  document.getElementById('updateCloseBtn').onclick = finish;
}

/* ============================================================
   桌面 / 平板：canvas 图片式弹窗
   ============================================================ */
function showCanvasUpdateModal(cfg, version, storageKey) {
  const modalId = 'updateModal';
  const old = document.getElementById(modalId);
  if (old) old.remove();

  const FALLBACK_LINES = [
    '🎨 更新弹窗全面升级',
    '✨ 5 种主题色可选'
  ];
  let lines = String(cfg.lines || '').split('\n').map(s => s.trim()).filter(s => '');
  if (lines.length === 0 && (cfg.line1 || cfg.line2)) {
    if (cfg.line1) lines.push(String(cfg.line1).trim());
    if (cfg.line2) lines.push(String(cfg.line2).trim());
  }
  if (lines.length === 0) lines = FALLBACK_LINES.slice();

  const display = lines.slice(0, 6);
  const rightSize = display.length >= 6 ? 14
                  : display.length === 5 ? 15
                  : display.length === 4 ? 16
                  : display.length === 3 ? 18
                  : 20;

  const STRIP_TEXT = '织雾满穗 · ZHIWU · 织雾满穗 · ZHIWU · 织雾满穗 · ZHIWU · 织雾满穗 · ZHIWU';

  const modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal update-image-modal';
  modal.innerHTML = `
    <div class="modal-content update-image-content">
      <div class="update-image-header">
        <span class="update-image-title">🎉 版本更新</span>
        <button class="update-image-close" id="updateCloseBtn" aria-label="关闭">✕</button>
      </div>
      <div class="update-image-inner">
        <div class="canvas-scaler">
          <div class="update-canvas ${cfg.theme || 'theme-pink'}">
            <div class="light-band"></div>
            <div class="glow glow-left"></div>
            <div class="glow glow-right"></div>
            <div class="canvas-frame">
              <div class="frame-dot left"></div>
              <div class="frame-dot right"></div>
            </div>
            <div class="strip strip-top">${STRIP_TEXT}</div>
            <div class="wheat-deco left">🌾</div>
            <div class="wheat-deco right">🌾</div>
            <div class="sparkle s1"></div>
            <div class="sparkle s2"></div>
            <div class="sparkle s3"></div>
            <div class="sparkle s4"></div>
            <div class="sparkle s5"></div>
            <div class="sparkle s6"></div>
            <div class="sparkle s7"></div>
            <div class="sparkle s8"></div>
            <div class="sparkle s9"></div>
            <div class="sparkle s10"></div>
            <div class="canvas-inner">
              <div class="left-block">
                <div class="title"></div>
                <div class="title-rule"></div>
                <div class="version-pill"></div>
              </div>
              <div class="divider"></div>
              <div class="logo-center">
                <div class="logo-ring"></div>
                <div class="logo-circle"></div>
              </div>
              <div class="divider"></div>
              <div class="right-block"></div>
            </div>
            <div class="strip strip-bottom">${STRIP_TEXT}</div>
          </div>
        </div>
      </div>
      <div class="update-image-footer">
        <button class="update-image-ok" id="updateOkBtn">我知道了</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.left-block .title').textContent        = cfg.title   || '日常更新';
  modal.querySelector('.left-block .version-pill').textContent = cfg.version || '';
  modal.querySelector('.logo-circle').textContent              = cfg.logo    || '穗';

  const rightEl = modal.querySelector('.right-block');
  display.forEach(line => {
    const div = document.createElement('div');
    div.className = 'right-line';
    div.style.fontSize = rightSize + 'px';
    div.textContent = line;
    rightEl.appendChild(div);
  });

  openModal(modalId);

  const fitCanvas = () => {
    const inner = modal.querySelector('.update-image-inner');
    const scaler = modal.querySelector('.canvas-scaler');
    if (!inner || !scaler) return;
    const availW = inner.clientWidth - 32;
    if (availW <= 0) return;
    const scale = Math.min(1, availW / 960);
    scaler.style.transform = `scale(${scale})`;
    scaler.style.transformOrigin = 'top left';
    scaler.style.width = '960px';
    scaler.style.height = '340px';
    scaler.style.marginLeft = 'auto';
    scaler.style.marginRight = 'auto';
    inner.style.height = (340 * scale + 32) + 'px';
  };

  requestAnimationFrame(fitCanvas);
  window.addEventListener('resize', fitCanvas);

  const finish = () => {
    localStorage.setItem(storageKey, version);
    closeModal(modalId);
    window.removeEventListener('resize', fitCanvas);
  };

  document.getElementById('updateOkBtn').onclick = finish;
  document.getElementById('updateCloseBtn').onclick = finish;
}

/* ============================================================
   旧格式文字弹窗（兼容老数据用）
   ============================================================ */
function showOldTextModal(version, date, updates, storageKey) {
  const modalId = 'updateModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal update-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="update-header">
          <h2>
            🎉 版本更新
            <span class="update-version" id="updateVersion"></span>
            <span class="update-date" id="updateDate"></span>
          </h2>
        </div>
        <div class="update-body" id="updateBody"></div>
        <div class="update-footer">
          <div class="update-thanks">感谢你的使用 ❤️</div>
          <button class="btn btn-primary" id="updateOkBtn">我已知晓</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.getElementById('updateVersion').textContent = version;
  document.getElementById('updateDate').textContent = '📅 ' + date;
  document.getElementById('updateBody').innerHTML = (updates || [])
    .map(t => `<div class="update-item">• ${escapeHtml(t)}</div>`)
    .join('');

  openModal(modalId);
  document.getElementById('updateOkBtn').onclick = () => {
    localStorage.setItem(storageKey, version);
    closeModal(modalId);
  };
}

/* ============================================================
   注入图片弹窗的 CSS
   ============================================================ */
function injectUpdateImageCSS() {
  if (document.getElementById('updateImageCSS')) return;
  const style = document.createElement('style');
  style.id = 'updateImageCSS';
  style.textContent = `
    .update-image-modal {
      background: rgba(74, 63, 68, 0.65);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .update-image-modal .modal-content {
      max-width: 1000px;
      width: 92vw;
      padding: 0;
      overflow: hidden;
      background: #ffffff;
      border: none;
      border-radius: 20px;
      box-shadow: 0 40px 100px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
    }

    /* ---- 顶部标题栏 ---- */
    .update-image-modal .update-image-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      background: linear-gradient(135deg, #fde8ef 0%, #fbd5e0 100%);
      border-bottom: 1px solid rgba(220, 107, 130, 0.15);
    }
    .update-image-modal .update-image-title {
      font-size: 0.95rem;
      font-weight: 800;
      color: #c7546a;
      letter-spacing: 1px;
    }
    .update-image-modal .update-image-close {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.75);
      color: #c7546a;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 700;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.25s;
      font-family: inherit;
      flex-shrink: 0;
    }
    .update-image-modal .update-image-close:hover {
      background: #ffffff;
      transform: rotate(90deg) scale(1.1);
      box-shadow: 0 4px 12px rgba(220, 107, 130, 0.2);
    }
    .update-image-modal .update-image-close:active {
      transform: rotate(90deg) scale(0.9);
    }

    /* ---- 画布区 ---- */
    .update-image-modal .update-image-inner {
      padding: 16px;
      background: #fdf8fa;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      overflow: hidden;
      position: relative;
      transition: height 0.15s ease;
    }
    .update-image-modal .canvas-scaler {
      width: 960px;
      height: 340px;
      transform-origin: top left;
      border-radius: 14px;
      overflow: hidden;
      box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.15),
        0 0 0 1px rgba(220, 107, 130, 0.1);
      background: #fdf2f5;
      flex-shrink: 0;
    }
    .update-image-modal .update-canvas {
      width: 960px;
      height: 340px;
      position: relative;
      overflow: hidden;
      border-radius: 14px;
      font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .update-image-modal .update-canvas.theme-pink   { background: linear-gradient(135deg, #f0a3b4 0%, #dc6b82 50%, #b84460 100%); }
    .update-image-modal .update-canvas.theme-purple { background: linear-gradient(135deg, #a89ce8 0%, #7b68c7 50%, #5544a6 100%); }
    .update-image-modal .update-canvas.theme-blue   { background: linear-gradient(135deg, #8bc7e8 0%, #5aa5d8 50%, #2d6f9c 100%); }
    .update-image-modal .update-canvas.theme-gold   { background: linear-gradient(135deg, #eed4a8 0%, #d4a06a 50%, #926a3a 100%); }
    .update-image-modal .update-canvas.theme-green  { background: linear-gradient(135deg, #a8d4c0 0%, #72a392 50%, #567a6c 100%); }

    /* 柔光层 */
    .update-image-modal .update-canvas::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 12% 15%, rgba(255,255,255,0.20) 0%, transparent 45%),
        radial-gradient(circle at 88% 85%, rgba(255,255,255,0.10) 0%, transparent 50%);
      pointer-events: none;
      z-index: 0;
    }
    /* 网格点纹 */
    .update-image-modal .update-canvas::after {
      content: '';
      position: absolute;
      inset: 0;
      background-image: radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px);
      background-size: 24px 24px;
      opacity: 0.5;
      pointer-events: none;
      z-index: 1;
      -webkit-mask-image: radial-gradient(ellipse at center, transparent 20%, black 80%);
      mask-image: radial-gradient(ellipse at center, transparent 20%, black 80%);
    }

    /* ---- 斜向光带 ---- */
    .update-image-modal .light-band {
      position: absolute;
      top: -40%;
      left: 32%;
      width: 180px;
      height: 180%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent);
      transform: rotate(20deg);
      pointer-events: none;
      z-index: 2;
    }

    /* ---- 两处光晕 ---- */
    .update-image-modal .glow {
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
      z-index: 0;
      filter: blur(40px);
    }
    .update-image-modal .glow-left {
      width: 220px;
      height: 220px;
      left: 30px;
      top: 50%;
      transform: translateY(-50%);
      background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 70%);
    }
    .update-image-modal .glow-right {
      width: 280px;
      height: 280px;
      right: -60px;
      bottom: -60px;
      background: radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 70%);
    }

    /* ---- 内边框 + 角部装饰 ---- */
    .update-image-modal .canvas-frame {
      position: absolute;
      inset: 14px;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px;
      pointer-events: none;
      z-index: 3;
    }
    .update-image-modal .canvas-frame::before,
    .update-image-modal .canvas-frame::after {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      border-color: rgba(255, 235, 200, 0.6);
      border-style: solid;
      border-width: 0;
    }
    .update-image-modal .canvas-frame::before {
      top: -1px;
      left: -1px;
      border-top-width: 2px;
      border-left-width: 2px;
      border-top-left-radius: 10px;
    }
    .update-image-modal .canvas-frame::after {
      bottom: -1px;
      right: -1px;
      border-bottom-width: 2px;
      border-right-width: 2px;
      border-bottom-right-radius: 10px;
    }
    .update-image-modal .frame-dot {
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(255,235,200,0.5);
      box-shadow: 0 0 8px rgba(255,235,200,0.5);
      z-index: 4;
      pointer-events: none;
    }
    .update-image-modal .frame-dot.left {
      left: -3px;
      top: 50%;
      transform: translateY(-50%);
    }
    .update-image-modal .frame-dot.right {
      right: -3px;
      top: 50%;
      transform: translateY(-50%);
    }

    /* ---- 上下文字带 ---- */
    .update-image-modal .strip {
      position: absolute;
      left: 0; right: 0;
      height: 30px;
      line-height: 30px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 8px;
      color: rgba(255, 255, 255, 0.5);
      white-space: nowrap;
      overflow: hidden;
      text-align: center;
      z-index: 5;
      pointer-events: none;
      -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%);
      mask-image: linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%);
    }
    .update-image-modal .strip-top {
      top: 0;
      background: linear-gradient(to bottom, rgba(0,0,0,0.10), transparent);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      padding-top: 1px;
    }
    .update-image-modal .strip-bottom {
      bottom: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.10), transparent);
      border-top: 1px solid rgba(255,255,255,0.08);
      padding-bottom: 1px;
    }

    /* ---- 稻穗 ---- */
    .update-image-modal .wheat-deco {
      position: absolute;
      font-size: 120px;
      line-height: 1;
      z-index: 2;
      pointer-events: none;
      color: #fff;
      opacity: 0.13;
      filter: blur(0.3px);
    }
    .update-image-modal .wheat-deco.left {
      left: -12px;
      bottom: 20px;
      transform: rotate(-22deg);
      transform-origin: bottom left;
    }
    .update-image-modal .wheat-deco.right {
      right: -12px;
      top: 20px;
      transform: rotate(-22deg) scaleX(-1);
      transform-origin: top right;
    }

    /* ---- 漂浮光点 ---- */
    .update-image-modal .sparkle {
      position: absolute;
      width: 3px;
      height: 3px;
      background: #fff;
      border-radius: 50%;
      box-shadow: 0 0 8px 2px rgba(255,255,255,0.7);
      pointer-events: none;
      z-index: 4;
      opacity: 0;
      animation: updateSparkle 3.4s ease-in-out infinite;
    }
    .update-image-modal .sparkle.s1  { top: 42px;    left: 180px;  animation-delay: 0s;    }
    .update-image-modal .sparkle.s2  { top: 55px;    left: 360px;  animation-delay: 0.4s;  }
    .update-image-modal .sparkle.s3  { top: 48px;    right: 130px; animation-delay: 0.8s;  }
    .update-image-modal .sparkle.s4  { top: 58px;    right: 280px; animation-delay: 1.2s;  }
    .update-image-modal .sparkle.s5  { bottom: 42px; left: 200px;  animation-delay: 1.6s;  }
    .update-image-modal .sparkle.s6  { bottom: 55px; left: 380px;  animation-delay: 2.0s;  }
    .update-image-modal .sparkle.s7  { bottom: 48px; right: 140px; animation-delay: 2.4s;  }
    .update-image-modal .sparkle.s8  { bottom: 58px; right: 300px; animation-delay: 2.8s;  }
    .update-image-modal .sparkle.s9  { top: 155px;   left: 34px;   animation-delay: 3.2s;  }
    .update-image-modal .sparkle.s10 { top: 165px;   right: 34px;  animation-delay: 3.6s;  }
    @keyframes updateSparkle {
      0%, 100% { opacity: 0; transform: scale(0.4); }
      50%      { opacity: 1; transform: scale(1); }
    }

    /* ---- 内容区（5 段式） ---- */
    .update-image-modal .canvas-inner {
      position: absolute;
      top: 30px;
      bottom: 30px;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 44px;
      gap: 26px;
      z-index: 6;
    }

    /* 左块 */
    .update-image-modal .left-block {
      flex: 0 1 auto;
      min-width: 0;
      text-align: right;
      color: #fff;
    }
    .update-image-modal .left-block .title {
      font-size: 30px;
      font-weight: 800;
      letter-spacing: 5px;
      line-height: 1.15;
      margin-bottom: 10px;
      background: linear-gradient(180deg, #ffffff 0%, #fff5d8 45%, #ffd98a 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
      filter:
        drop-shadow(0 1px 0 rgba(0,0,0,0.20))
        drop-shadow(0 3px 10px rgba(0,0,0,0.25));
    }
    .update-image-modal .update-canvas.theme-gold .left-block .title {
      background: linear-gradient(180deg, #ffffff 0%, #fffbf0 55%, #ffeeda 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .update-image-modal .left-block .title-rule {
      width: 56px;
      height: 2px;
      margin: 0 0 10px auto;
      background: linear-gradient(90deg, transparent, rgba(255,240,200,0.85), transparent);
      border-radius: 2px;
    }
    .update-image-modal .left-block .version-pill {
      display: inline-block;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 1px;
      color: #fff;
      padding: 6px 16px;
      background: rgba(255,255,255,0.16);
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 20px;
      white-space: nowrap;
    }

    /* 分隔线 */
    .update-image-modal .divider {
      width: 1px;
      height: 52%;
      background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.45), transparent);
      flex-shrink: 0;
    }

    /* 中央圆环 logo */
    .update-image-modal .logo-center {
      position: relative;
      flex: 0 0 116px;
      width: 116px;
      height: 116px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .update-image-modal .logo-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1px dashed rgba(255,255,255,0.38);
      animation: updateRotateSlow 34s linear infinite;
    }
    .update-image-modal .logo-ring::before {
      content: '';
      position: absolute;
      inset: 8px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.16);
    }
    @keyframes updateRotateSlow {
      from { transform: rotate(0); }
      to   { transform: rotate(360deg); }
    }
    .update-image-modal .logo-circle {
      width: 88px;
      height: 88px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 34px;
      font-weight: 900;
      letter-spacing: 2px;
      text-shadow:
        0 1px 0 rgba(255,255,255,0.30),
        0 3px 12px rgba(0,0,0,0.35);
      background:
        radial-gradient(circle at 35% 28%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.15) 30%, transparent 65%),
        radial-gradient(circle at 50% 55%, rgba(255,255,255,0.18), rgba(255,255,255,0.05) 70%, rgba(0,0,0,0.12) 100%);
      border: 1.5px solid rgba(255,255,255,0.52);
      box-shadow:
        0 10px 30px rgba(0,0,0,0.22),
        0 0 0 6px rgba(255,255,255,0.05),
        inset 0 -6px 15px rgba(0,0,0,0.15),
        inset 0 6px 15px rgba(255,255,255,0.28);
    }

    /* 右块 */
    .update-image-modal .right-block {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      gap: 9px;
      color: #fff;
      min-width: 0;
    }
    .update-image-modal .right-block .right-line {
      font-weight: 600;
      letter-spacing: 0.5px;
      line-height: 1.5;
      padding-left: 18px;
      position: relative;
      color: #fff;
      text-shadow: 0 2px 10px rgba(0,0,0,0.22);
      word-break: break-word;
    }
    .update-image-modal .right-block .right-line::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: rgba(255,255,255,0.95);
      box-shadow: 0 0 8px rgba(255,255,255,0.6);
    }

    /* ---- 底部按钮区 ---- */
    .update-image-modal .update-image-footer {
      padding: 14px 20px 18px;
      text-align: center;
      background: #ffffff;
      border-top: 1px solid rgba(220, 107, 130, 0.12);
    }
    .update-image-modal .update-image-ok {
      padding: 12px 52px;
      border: none;
      border-radius: 50px;
      font-family: inherit;
      font-size: 0.98rem;
      font-weight: 800;
      letter-spacing: 1px;
      cursor: pointer;
      color: #fff;
      background: linear-gradient(135deg, #dc6b82, #e88da1);
      box-shadow: 0 8px 20px rgba(220, 107, 130, 0.35);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      white-space: nowrap;
      min-width: 200px;
    }
    .update-image-modal .update-image-ok:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(220, 107, 130, 0.5);
    }
    .update-image-modal .update-image-ok:active {
      transform: scale(0.95);
    }

    /* ---- 手机端简化弹窗 ---- */
    .update-image-modal .update-simple-content {
      max-width: 400px;
      width: 92vw;
      padding: 0;
      overflow: hidden;
      border: none;
      border-radius: 22px;
      background: #fff;
      display: flex;
      flex-direction: column;
    }
    .update-image-modal .update-simple-content.theme-pink {
      background: linear-gradient(135deg, #e8a2b0 0%, #c7546a 100%);
    }
    .update-image-modal .update-simple-content.theme-purple {
      background: linear-gradient(135deg, #b6a8ee 0%, #6d5bc4 100%);
    }
    .update-image-modal .update-simple-content.theme-blue {
      background: linear-gradient(135deg, #9ed2ee 0%, #3d8dc0 100%);
    }
    .update-image-modal .update-simple-content.theme-gold {
      background: linear-gradient(135deg, #eed4a8 0%, #b8894f 100%);
    }
    .update-image-modal .update-simple-content.theme-green {
      background: linear-gradient(135deg, #bcdccd 0%, #72a392 100%);
    }
    .update-image-modal .update-simple-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px 0;
    }
    .update-image-modal .update-simple-badge {
      font-size: 0.8rem;
      font-weight: 800;
      color: #fff;
      letter-spacing: 1px;
      background: rgba(255,255,255,0.25);
      padding: 4px 12px;
      border-radius: 50px;
    }
    .update-image-modal .update-simple-content .update-image-close {
      background: rgba(255,255,255,0.28);
      color: #fff;
    }
    .update-image-modal .update-simple-content .update-image-close:hover {
      background: rgba(255,255,255,0.5);
      box-shadow: none;
    }
    .update-image-modal .update-simple-title {
      font-size: 1.7rem;
      font-weight: 800;
      color: #fff;
      text-align: center;
      letter-spacing: 3px;
      margin-top: 10px;
      text-shadow: 0 4px 16px rgba(0,0,0,0.28);
    }
    .update-image-modal .update-simple-version {
      font-size: 0.92rem;
      color: rgba(255,255,255,0.9);
      text-align: center;
      margin-bottom: 16px;
      font-weight: 500;
      letter-spacing: 1px;
    }
    .update-image-modal .update-simple-body {
      margin: 0 16px 16px;
      padding: 16px 18px;
      background: rgba(255,255,255,0.96);
      border-radius: 14px;
      max-height: 46vh;
      overflow-y: auto;
    }
    .update-image-modal .update-simple-line {
      font-size: 0.9rem;
      font-weight: 600;
      color: #4a3f44;
      line-height: 1.7;
      padding: 4px 0;
    }
    .update-image-modal .update-simple-footer {
      padding: 0 16px 16px;
      text-align: center;
    }
    .update-image-modal .update-simple-footer .update-image-ok {
      width: 100%;
      padding: 12px;
      border-radius: 50px;
      background: #fff;
      color: #c7546a;
      font-weight: 800;
      font-size: 1rem;
      border: none;
      cursor: pointer;
      font-family: inherit;
      letter-spacing: 1px;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      min-width: 0;
    }
    .update-image-modal .update-simple-footer .update-image-ok:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.2);
    }
  `;
  document.head.appendChild(style);
}