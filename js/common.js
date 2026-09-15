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
    /* 如果还有其他弹窗，保持滚动锁定 */
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

/* 转义 HTML，防止 XSS */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
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

  const modalId = 'updateModal';
  const oldModal = document.getElementById(modalId);
  if (oldModal) oldModal.remove();

  /* 计算右侧多行字号 */
  const lines = String(cfg.lines || '').split('\n').map(s => s.trim()).filter(s => '');
  if (lines.length === 0 && (cfg.line1 || cfg.line2)) {
    if (cfg.line1) lines.push(cfg.line1);
    if (cfg.line2) lines.push(cfg.line2);
  }
  const display = lines.slice(0, 6);
  const rightSize = display.length >= 6 ? 16
                  : display.length === 5 ? 17
                  : display.length === 4 ? 19
                  : display.length === 3 ? 21
                  : 23;

  const modal = document.createElement('div');
  modal.id = modalId;
  modal.className = 'modal update-image-modal';
  modal.innerHTML = `
    <div class="modal-content update-image-content">
      <div class="update-image-inner">
        <div class="canvas-scaler">
          <div class="update-canvas ${cfg.theme || 'theme-pink'}">
            <div class="light-band"></div>
            <div class="strip strip-top"></div>
            <div class="wheat-deco left">🌾</div>
            <div class="wheat-deco right">🌾</div>
            <div class="content">
              <div class="info-left">
                <div class="title"></div>
                <div class="version"></div>
              </div>
              <div class="logo-center">
                <div class="logo-circle"></div>
              </div>
              <div class="info-right"></div>
            </div>
            <div class="strip strip-bottom"></div>
          </div>
        </div>
      </div>
      <div class="update-image-footer">
        <button class="btn btn-primary" id="updateOkBtn">我知道了</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const stripText = cfg.strip || '织雾满穗 ZHIWU UPDATE';
  const repeated = (stripText + '　　').repeat(14);
  modal.querySelectorAll('.strip-top, .strip-bottom').forEach(el => el.textContent = repeated);
  modal.querySelector('.info-left .title').textContent   = cfg.title   || '日常更新';
  modal.querySelector('.info-left .version').textContent = cfg.version || '';
  modal.querySelector('.logo-circle').textContent        = cfg.logo    || '穗';

  const rightEl = modal.querySelector('.info-right');
  if (display.length === 0) {
    const div = document.createElement('div');
    div.className = 'right-line';
    div.style.fontSize = '19px';
    div.style.opacity = '0.55';
    div.textContent = '（暂无更新内容）';
    rightEl.appendChild(div);
  } else {
    display.forEach(line => {
      const div = document.createElement('div');
      div.className = 'right-line';
      div.style.fontSize = rightSize + 'px';
      div.textContent = line;
      rightEl.appendChild(div);
    });
  }

  openModal(modalId);

  document.getElementById('updateOkBtn').onclick = () => {
    localStorage.setItem(storageKey, version);
    closeModal(modalId);
  };
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
   注入图片弹窗的 CSS（只需一次）
   ============================================================ */
function injectUpdateImageCSS() {
  if (document.getElementById('updateImageCSS')) return;
  const style = document.createElement('style');
  style.id = 'updateImageCSS';
  style.textContent = `
    .update-image-modal {
      background: rgba(74, 63, 68, 0.6);
    }
    .update-image-modal .modal-content {
      max-width: 1240px;
      width: 95vw;
      padding: 0;
      overflow: visible;
      background: transparent;
      border: none;
      border-radius: 24px;
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
      position: relative;
    }
    .update-image-modal .update-image-inner {
      padding: 0;
      background: transparent;
      display: flex;
      justify-content: center;
      overflow: hidden;
      border-radius: 24px;
    }
    .update-image-modal .canvas-scaler {
      width: 1200px;
      height: 300px;
      transform-origin: top left;
      border-radius: 24px;
      overflow: hidden;
    }
    .update-image-modal .update-canvas {
      width: 1200px;
      height: 300px;
      position: relative;
      overflow: hidden;
      border-radius: 24px;
      font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .update-image-modal .update-canvas.theme-pink { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.20), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.14), transparent 70%),
      linear-gradient(125deg, #e8a2b0 0%, #dc6b82 40%, #c7546a 75%, #a83e56 100%); }
    .update-image-modal .update-canvas.theme-purple { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.20), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.14), transparent 70%),
      linear-gradient(125deg, #b6a8ee 0%, #8878d8 40%, #6d5bc4 75%, #5544a6 100%); }
    .update-image-modal .update-canvas.theme-blue { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.20), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.14), transparent 70%),
      linear-gradient(125deg, #9ed2ee 0%, #5aa5d8 40%, #3d8dc0 75%, #2d6f9c 100%); }
    .update-image-modal .update-canvas.theme-gold { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.22), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.15), transparent 70%),
      linear-gradient(125deg, #eed4a8 0%, #d4a06a 40%, #b8894f 75%, #926a3a 100%); }
    .update-image-modal .update-canvas.theme-green { background:
      radial-gradient(ellipse 600px 400px at 15% 0%, rgba(255,255,255,0.20), transparent 70%),
      radial-gradient(ellipse 500px 350px at 90% 100%, rgba(255,255,255,0.14), transparent 70%),
      linear-gradient(125deg, #bcdccd 0%, #8cb8a8 40%, #72a392 75%, #567a6c 100%); }

    .update-image-modal .update-canvas::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Ccircle cx='24' cy='24' r='1.6' fill='rgba(255,255,255,0.20)'/%3E%3C/svg%3E");
      background-repeat: repeat;
      pointer-events: none;
      z-index: 1;
    }
    .update-image-modal .light-band {
      position: absolute;
      top: -50%; left: 30%;
      width: 220px; height: 200%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
      transform: rotate(20deg);
      pointer-events: none;
      z-index: 2;
    }
    .update-image-modal .strip {
      position: absolute;
      left: 0; right: 0;
      height: 26px; line-height: 26px;
      font-size: 10px; font-weight: 600;
      letter-spacing: 6px;
      color: rgba(255, 255, 255, 0.42);
      white-space: nowrap; overflow: hidden;
      text-align: center;
      z-index: 5;
    }
    .update-image-modal .strip-top {
      top: 0;
      background: linear-gradient(to bottom, rgba(0,0,0,0.12), transparent);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      border-radius: 24px 24px 0 0;
    }
    .update-image-modal .strip-bottom {
      bottom: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.12), transparent);
      border-top: 1px solid rgba(255,255,255,0.06);
      border-radius: 0 0 24px 24px;
    }
    .update-image-modal .wheat-deco {
      position: absolute;
      font-size: 90px;
      opacity: 0.09;
      z-index: 3;
      pointer-events: none;
      color: #fff;
    }
    .update-image-modal .wheat-deco.left  { left: 8px;  bottom: 15px; transform: rotate(-18deg); }
    .update-image-modal .wheat-deco.right { right: 8px; top: 15px;    transform: rotate(18deg) scaleX(-1); }
    .update-image-modal .content {
      position: absolute;
      top: 26px; bottom: 26px;
      left: 0; right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 60px;
      gap: 50px;
      z-index: 6;
    }
    .update-image-modal .info-left {
      flex: 1; text-align: right; color: #fff; min-width: 0;
      display: flex; flex-direction: column; justify-content: center;
    }
    .update-image-modal .info-left .title {
      font-size: 34px; font-weight: 800;
      letter-spacing: 4px; margin-bottom: 10px;
      line-height: 1.15;
      background: linear-gradient(180deg, #ffffff 0%, #fff0c8 45%, #ffcf7a 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
      filter:
        drop-shadow(0 1px 0 rgba(0,0,0,0.25))
        drop-shadow(0 4px 12px rgba(0,0,0,0.3))
        drop-shadow(0 10px 28px rgba(0,0,0,0.2));
    }
    .update-image-modal .update-canvas.theme-gold .info-left .title {
      background: linear-gradient(180deg, #ffffff 0%, #fffbf0 45%, #ffeeda 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }
    .update-image-modal .info-left .version {
      font-size: 22px; font-weight: 600;
      letter-spacing: 2px; opacity: 0.95;
      color: #fff;
      text-shadow: 0 2px 10px rgba(0,0,0,0.28);
    }
    .update-image-modal .logo-center {
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }
    .update-image-modal .logo-circle {
      width: 148px; height: 148px;
      border-radius: 50%;
      position: relative;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 56px; font-weight: 900;
      letter-spacing: 2px;
      text-shadow: 0 1px 0 rgba(255,255,255,0.3), 0 4px 16px rgba(0,0,0,0.35);
      background:
        radial-gradient(circle at 35% 28%, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.20) 25%, transparent 60%),
        radial-gradient(circle at 50% 50%, rgba(255,255,255,0.16), rgba(255,255,255,0.06) 70%, rgba(0,0,0,0.10) 100%);
      border: 2px solid rgba(255,255,255,0.55);
      box-shadow:
        0 16px 50px rgba(0,0,0,0.28),
        0 0 0 8px rgba(255,255,255,0.05),
        0 0 0 20px rgba(255,255,255,0.025),
        inset 0 -10px 25px rgba(0,0,0,0.16),
        inset 0 10px 25px rgba(255,255,255,0.30);
    }
    .update-image-modal .logo-circle::after {
      content: '';
      position: absolute;
      inset: -18px;
      border-radius: 50%;
      border: 1px dashed rgba(255,255,255,0.30);
      animation: rotate-slow 40s linear infinite;
    }
    @keyframes rotate-slow {
      from { transform: rotate(0); }
      to   { transform: rotate(360deg); }
    }
    .update-image-modal .info-right {
      flex: 1; text-align: left; color: #fff; min-width: 0;
      display: flex; flex-direction: column; justify-content: center;
      gap: 4px;
    }
    .update-image-modal .info-right .right-line {
      font-weight: 700;
      letter-spacing: 1px;
      line-height: 1.35;
      color: #fff;
      text-shadow:
        0 1px 0 rgba(255,255,255,0.12),
        0 4px 16px rgba(0,0,0,0.28);
    }

    /* 我知道了按钮：浮在右下角，白底粉字，玻璃感 */
    .update-image-modal .update-image-footer {
      position: absolute;
      right: 20px;
      bottom: 20px;
      padding: 0;
      background: transparent;
      text-align: right;
      z-index: 10;
    }
    .update-image-modal .update-image-footer .btn {
      background: rgba(255, 255, 255, 0.92);
      color: var(--primary-dark, #c7546a);
      border: none;
      padding: 10px 26px;
      border-radius: 50px;
      font-family: inherit;
      font-size: 0.92rem;
      font-weight: 800;
      letter-spacing: 1px;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255,255,255,0.5) inset;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      white-space: nowrap;
    }
    .update-image-modal .update-image-footer .btn:hover {
      background: #fff;
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.25);
    }
    .update-image-modal .update-image-footer .btn:active {
      transform: scale(0.95);
    }

    @media (max-width: 1240px) {
      .update-image-modal .canvas-scaler {
        transform: scale(calc((95vw - 40px) / 1200));
        width: calc(95vw - 40px);
        height: calc(300px * (95vw - 40px) / 1200);
      }
    }
  `;
  document.head.appendChild(style);
}