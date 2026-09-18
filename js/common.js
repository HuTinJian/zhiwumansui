/* ============================================================
   织雾满穗 · 共享工具  (v2)
   所有页面共用：主题、Toast、弹窗、复制、防抖、版本检查、视觉特效
   ------------------------------------------------------------
   本文件对旧版 API 保持完全向后兼容：
   showToast / openModal / closeModal / copyText / debounce /
   escapeHtml / showNotice / showConfirm / checkPageUpdate
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     0. 主题（尽早执行，避免闪烁）
     ============================================================ */
  const THEME_KEY = 'zm_theme';

  function readStoredTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#17121a' : '#fdf2f5');

    document.querySelectorAll('.theme-toggle').forEach(btn => {
      const isDark = t === 'dark';
      btn.textContent = isDark ? '☀️' : '🌙';
      btn.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
      btn.setAttribute('title', isDark ? '切换到浅色模式' : '切换到深色模式');
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    });
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  }

  function initTheme() {
    applyTheme(readStoredTheme() || (prefersDark() ? 'dark' : 'light'));
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (!readStoredTheme()) applyTheme(prefersDark() ? 'dark' : 'light'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  initTheme();

  /* ============================================================
     1. 基础工具
     ============================================================ */

  /* 显示 Toast 短提示 */
  function showToast(msg, duration = 2500) {
    let el = document.getElementById('globalToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalToast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    /* 重新触发动画：先移除再强制重排 */
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), duration);
    return el;
  }

  /* 转义 HTML，防止 XSS（含引号，属性位置也安全）
     ------------------------------------------------------------
     性能说明：老写法是「建一个 div → 设 textContent → 读 innerHTML」，
     每次调用都要真的创建一个 DOM 节点。而宝库页渲染上千条数据时，
     这个函数会被调用上万次，光是造节点就很拖速度。
     改成纯字符串替换后，速度快一个数量级，而且完全不碰 DOM。 */
  const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  const HTML_ESCAPE_RE = /[&<>"']/g;

  function escapeHtml(text) {
    const str = text === undefined || text === null ? '' : String(text);
    /* 绝大多数文本里没有需要转义的字符，测试一次就能直接返回，省掉 replace */
    HTML_ESCAPE_RE.lastIndex = 0;
    if (!HTML_ESCAPE_RE.test(str)) return str;
    return str.replace(HTML_ESCAPE_RE, c => HTML_ESCAPE_MAP[c]);
  }

  /* 防抖函数 */
  function debounce(fn, wait = 300) {
    let timer;
    function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    }
    debounced.cancel = () => { clearTimeout(timer); timer = undefined; };
    return debounced;
  }

  /* ------------------------------------------------------------
     版本号排版
     ------------------------------------------------------------
     背景：公告工具早年是把版本号存成 "v" + 毫秒时间戳的，
     于是页面上会显示成一长串数字（v1758212345678），很难看。
     这个函数负责把它变回「像版本号的样子」：

       v1758212345678     → v2026.09.19   （老数据：时间戳转日期）
       v2026.09.19-1830   → 原样显示       （新数据：本身就可读）
       v1.5.0 / 1.5.0     → v1.5.0         （手写的：只补一个 v）
     ------------------------------------------------------------ */
  function formatVersion(version) {
    const raw = String(version === undefined || version === null ? '' : version).trim();
    if (!raw) return '';

    const digits = raw.replace(/^v/i, '');

    /* 纯数字且够长 → 当成时间戳 */
    if (/^\d{10,}$/.test(digits)) {
      let ms = Number(digits);
      if (!Number.isFinite(ms)) return raw;
      if (digits.length <= 11) ms *= 1000;      /* 10~11 位按「秒」处理 */
      const d = new Date(ms);
      /* 合理性检查：落在 2001~2100 之间才认 */
      if (d.getFullYear() > 2000 && d.getFullYear() < 2100) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return 'v' + d.getFullYear() + '.' + mm + '.' + dd;
      }
      return raw;
    }

    return /^v/i.test(raw) ? raw : 'v' + raw;
  }

  /* 节流（用于滚动 / 鼠标事件） */
  function throttle(fn, wait = 100) {
    let last = 0;
    let raf = null;
    return function (...args) {
      const now = Date.now();
      if (now - last < wait) {
        if (!raf) {
          raf = requestAnimationFrame(() => {
            raf = null;
            last = Date.now();
            fn.apply(this, args);
          });
        }
        return;
      }
      last = now;
      fn.apply(this, args);
    };
  }

  /* 复制文本到剪贴板（现代 API 失败或卡住时，回退到 execCommand） */
  async function copyText(text) {
    const value = String(text ?? '');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        /* 这里必须加超时：
           部分浏览器在页面失去焦点等情况下，clipboard.writeText() 会一直挂着，
           既不成功也不报错，表现就是「按钮点了没反应」。
           最多等 1200ms，超时就走下面的兼容方案。 */
        const ok = await Promise.race([
          navigator.clipboard.writeText(value).then(() => true),
          new Promise(resolve => setTimeout(() => resolve(null), 1200))
        ]);
        if (ok === true) return true;
      } catch (e) {
        /* 权限被拒 / 非安全上下文，继续走回退方案 */
      }
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ============================================================
     2. 弹窗系统（含 ESC / 点击遮罩关闭 / 焦点管理）
     ============================================================ */
  const closeTimers = new Map();   /* modalId -> timeout */
  const returnFocus = new Map();   /* modalId -> element */
  const modalStack = [];           /* 打开顺序 */

  function focusables(root) {
    return Array.from(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null || el === document.activeElement);
  }

  /* 打开弹窗（同时锁住页面滚动） */
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    /* 若正处于关闭动画中，取消它 */
    if (closeTimers.has(id)) {
      clearTimeout(closeTimers.get(id));
      closeTimers.delete(id);
    }

    modal.classList.remove('closing');

    if (!modal.classList.contains('show')) {
      returnFocus.set(id, document.activeElement);
      modal.classList.add('show');
      modalStack.push(id);
    }

    if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    document.body.classList.add('modal-open');

    /* 焦点进入弹窗（下一帧，等动画开始） */
    requestAnimationFrame(() => {
      if (!modal.classList.contains('show')) return;
      const list = focusables(modal);
      const first = list[0];
      if (first && !modal.contains(document.activeElement)) {
        try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
      }
    });
  }

  /* 关闭弹窗（带退出动画） */
  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (!modal.classList.contains('show') && !modal.classList.contains('closing')) return;

    modal.classList.add('closing');

    /* 让页面有机会同步清理自己的状态（例如倒计时） */
    document.dispatchEvent(new CustomEvent('zm:modalclose', { detail: { id } }));

    clearTimeout(closeTimers.get(id));
    const timer = setTimeout(() => {
      closeTimers.delete(id);
      modal.classList.remove('show', 'closing');
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);

      if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
      } else {
        document.body.classList.add('modal-open');
      }

      const back = returnFocus.get(id);
      returnFocus.delete(id);
      if (back && typeof back.focus === 'function' && document.contains(back)) {
        try { back.focus({ preventScroll: true }); } catch (e) {}
      }
    }, 220);
    closeTimers.set(id, timer);
  }

  function closeTopModal() {
    if (modalStack.length === 0) return false;
    closeModal(modalStack[modalStack.length - 1]);
    return true;
  }

  /* 全局键盘 / 遮罩交互：只绑定一次 */
  let modalA11yBound = false;
  function bindModalA11y() {
    if (modalA11yBound) return;
    modalA11yBound = true;

    document.addEventListener('keydown', e => {
      const open = document.querySelector('.modal.show');
      if (!open) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeTopModal();
        return;
      }

      if (e.key === 'Tab') {
        const list = focusables(open);
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    /* 点击遮罩关闭：以 mousedown + mouseup 都在遮罩上为准，避免拖拽误关 */
    let downOnBackdrop = null;
    document.addEventListener('mousedown', e => {
      downOnBackdrop = e.target.classList && e.target.classList.contains('modal') ? e.target : null;
    });
    document.addEventListener('click', e => {
      const t = e.target;
      if (!t.classList || !t.classList.contains('modal')) return;
      if (t !== downOnBackdrop) return;
      if (t.dataset.static === 'true') return;   /* 可用 data-static="true" 禁止遮罩关闭 */
      closeModal(t.id);
    });
  }

  /* ============================================================
     3. 顶部提示条
     ============================================================ */
  function showNotice(msg, duration = 3000) {
    let el = document.getElementById('globalNotice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalNotice';
      el.className = 'notice-bar';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    /* 清掉上一次的自动关闭，避免与新提示打架 */
    clearTimeout(el._timer);
    el.classList.add('show');
    el.textContent = msg;
    el._timer = setTimeout(() => el.classList.remove('show'), duration);
    return el;
  }

  /* ============================================================
     4. 确认弹窗（返回 Promise）
     ============================================================ */
  let pendingConfirmResolve = null;

  function showConfirm(title, message, options = {}) {
    return new Promise(resolve => {
      /* 若上一次确认框还没结束，先按“取消”收尾，防止 Promise 永久挂起 */
      if (pendingConfirmResolve) {
        const prev = pendingConfirmResolve;
        pendingConfirmResolve = null;
        prev(false);
      }

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

      const okBtn = document.getElementById('gcOk');
      const cancelBtn = document.getElementById('gcCancel');
      okBtn.textContent = options.okText || '确认';
      cancelBtn.textContent = options.cancelText || '取消';
      okBtn.classList.toggle('btn-danger', options.danger === true);
      okBtn.classList.toggle('btn-primary', options.danger !== true);

      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        pendingConfirmResolve = null;
        closeModal('globalConfirm');
        resolve(value);
      };

      pendingConfirmResolve = finish;
      okBtn.onclick = () => finish(true);
      cancelBtn.onclick = () => finish(false);

      openModal('globalConfirm');

      /* ESC / 点遮罩也算取消 */
      const onClose = e => {
        if (e.detail.id !== 'globalConfirm') return;
        document.removeEventListener('zm:modalclose', onClose);
        finish(false);
      };
      document.addEventListener('zm:modalclose', onClose);
    });
  }

  /* ============================================================
     5. 页面装修：氛围层、主题开关、回到顶部、进度条、揭示动画
     ============================================================ */
  const FX_ENABLED = () => document.documentElement.getAttribute('data-fx') !== 'off';

  function hasSharedStyles() {
    return !!document.querySelector('link[href*="style.css"]');
  }

  /* ------------------------------------------------------------
     精简模式（lite）
     ------------------------------------------------------------
     目的：在手机、低配设备、省流量模式下自动「关掉好看但不划算的特效」，
     换来更顺滑的滚动和更快的打开速度。判断依据：
       · 屏幕宽度 ≤ 768px（先按手机处理，稳妥）
       · 系统开了「减少动态效果」
       · CPU 核心数 ≤ 4 或内存 ≤ 4GB（navigator 只在部分浏览器提供）
       · 开了省流量模式
     ------------------------------------------------------------ */
  function isLiteMode() {
    if (!window.matchMedia) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    if (window.matchMedia('(max-width: 768px)').matches) return true;

    const cores = navigator.hardwareConcurrency || 0;
    const memory = navigator.deviceMemory || 0;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.saveData) return true;
    if (cores && cores <= 4) return true;
    if (memory && memory <= 4) return true;

    return false;
  }

  function applyLiteMode() {
    if (isLiteMode()) document.documentElement.classList.add('lite');
  }

  function injectAtmosphere() {
    if (!FX_ENABLED() || !hasSharedStyles()) return;

    /* 极光背景：纯 CSS 渐变，不用 filter:blur（大范围模糊在手机上非常吃性能） */
    if (!document.querySelector('.aurora-bg')) {
      const aurora = document.createElement('div');
      aurora.className = 'aurora-bg';
      aurora.setAttribute('aria-hidden', 'true');
      aurora.innerHTML = '<span class="a1"></span><span class="a2"></span><span class="a3"></span>';
      document.body.appendChild(aurora);
    }

    const lite = document.documentElement.classList.contains('lite');

    /* 颗粒纹理：手机上直接不做 */
    if (!lite && !document.querySelector('.grain-overlay')) {
      const grain = document.createElement('div');
      grain.className = 'grain-overlay';
      grain.setAttribute('aria-hidden', 'true');
      document.body.appendChild(grain);
    }

    /* 跟随鼠标的柔光：只在「电脑 + 精确指针 + 非精简模式」下启用。
       这里用 transform 移动一个固定大小的圆，而不是每帧重画整屏渐变，
       所以滚动和移动鼠标都不会触发重绘。 */
    const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    if (!lite && finePointer && !document.querySelector('.cursor-glow')) {
      const glow = document.createElement('div');
      glow.className = 'cursor-glow';
      glow.setAttribute('aria-hidden', 'true');
      document.body.appendChild(glow);

      let shown = false;
      let x = -9999;
      let y = -9999;
      let queued = false;

      const flush = () => {
        queued = false;
        glow.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      };

      window.addEventListener('mousemove', e => {
        x = e.clientX;
        y = e.clientY;
        if (!shown) { glow.classList.add('active'); shown = true; }
        if (!queued) { queued = true; requestAnimationFrame(flush); }
      }, { passive: true });

      window.addEventListener('mouseleave', () => glow.classList.remove('active'));
    }
  }

  function injectThemeToggle() {
    /* 已经有就不要重复注入 */
    if (document.querySelector('.theme-toggle')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.addEventListener('click', toggleTheme);

    /* 1) 常规页面：挂在导航栏里 */
    const nav = document.querySelector('.navbar .nav-links');
    if (nav) {
      const li = document.createElement('li');
      li.appendChild(btn);
      nav.appendChild(li);
      applyTheme(currentTheme());
      return;
    }

    /* 2) 后台页：挂在顶栏操作区 */
    const adminActions = document.querySelector('.admin-topbar .actions');
    if (adminActions) {
      adminActions.appendChild(btn);
      applyTheme(currentTheme());
      return;
    }

    /* 3) 指定插槽 */
    const slot = document.querySelector('[data-theme-slot]');
    if (slot) {
      slot.appendChild(btn);
      applyTheme(currentTheme());
    }
  }

  function injectBackToTop() {
    if (document.querySelector('.back-to-top')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', '回到顶部');
    btn.setAttribute('title', '回到顶部');
    btn.textContent = '↑';
    btn.addEventListener('click', () => {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
    document.body.appendChild(btn);
    return btn;
  }

  function injectScrollProgress() {
    if (document.querySelector('.scroll-progress')) return null;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    return bar;
  }

  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (items.length === 0) return;

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach(el => el.classList.add('is-visible'));
      return;
    }

    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = Number(el.dataset.revealDelay || 0);
        setTimeout(() => el.classList.add('is-visible'), delay);
        obs.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    items.forEach(el => io.observe(el));
  }

  /* 按钮水波纹 */
  function initRipple() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const SELECTOR = '.btn, .btn-more, .visit-source-btn, .theme-toggle, .back-to-top';
    document.addEventListener('pointerdown', e => {
      const target = e.target.closest && e.target.closest(SELECTOR);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const size = Math.max(rect.width, rect.height);
      const span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = span.style.height = size + 'px';
      span.style.left = (e.clientX - rect.left - size / 2) + 'px';
      span.style.top = (e.clientY - rect.top - size / 2) + 'px';

      const prevPosition = getComputedStyle(target).position;
      if (prevPosition === 'static') target.style.position = 'relative';
      target.appendChild(span);
      setTimeout(() => span.remove(), 650);
    }, { passive: true });
  }

  /* 导航栏滚动阴影 + 回到顶部显隐 + 进度条 */
  function initScrollUI() {
    const bar = injectScrollProgress();
    const topBtn = injectBackToTop();
    const navbar = document.querySelector('.navbar');

    const onScroll = throttle(() => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;

      if (navbar) navbar.classList.toggle('scrolled', y > 8);
      if (topBtn) topBtn.classList.toggle('show', y > 360);

      if (bar) {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const pct = docHeight > 0 ? Math.min(100, Math.max(0, (y / docHeight) * 100)) : 0;
        bar.style.width = pct + '%';
      }
    }, 60);

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  }

  /* 页面离场过渡（仅同源内部链接） */
  function initPageTransition() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;

      let url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;

      e.preventDefault();
      document.body.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
      document.body.style.opacity = '0';
      document.body.style.transform = 'translateY(-6px)';

      let navigated = false;
      const go = () => {
        if (navigated) return;
        navigated = true;
        location.href = url.href;
      };
      setTimeout(go, 200);

      /* 安全兜底：若跳转因故未发生（例如目标不存在被拦截），恢复页面可见 */
      setTimeout(() => {
        if (navigated && document.visibilityState === 'visible') {
          document.body.style.opacity = '';
          document.body.style.transform = '';
        }
      }, 1400);
    });
  }

  /* ============================================================
     5.5 预览版告知弹窗
     ------------------------------------------------------------
     · 每个浏览器只弹一次（记住在 localStorage 里）
     · 想让它重新弹给所有访客看，只要把下面的版本号 +1
     ============================================================ */
  const PREVIEW_NOTICE_KEY = 'zm_preview_notice_seen';
  /* 注意：内容有改动时把这个数字 +1，所有访客下次打开就会重新看到一次 */
  const PREVIEW_NOTICE_VERSION = '2';

  /* 用来让「版本更新弹窗」等预览版弹窗关掉之后再出现，避免两个弹窗撞在一起 */
  let releaseNoticeGate;
  const noticeGate = new Promise(resolve => { releaseNoticeGate = resolve; });
  /* 兜底：万一预览弹窗没跑起来，20 秒后也必须放行 */
  setTimeout(() => { if (releaseNoticeGate) releaseNoticeGate(); }, 20000);

  function showPreviewNotice() {
    if (!hasSharedStyles()) { if (releaseNoticeGate) releaseNoticeGate(); return; }
    if (document.documentElement.getAttribute('data-notice') === 'off') {
      if (releaseNoticeGate) releaseNoticeGate();
      return;
    }

    let seen = null;
    try { seen = localStorage.getItem(PREVIEW_NOTICE_KEY); } catch (e) {}
    if (seen === PREVIEW_NOTICE_VERSION) {
      if (releaseNoticeGate) releaseNoticeGate();
      return;
    }

    const modalId = 'previewNoticeModal';
    if (document.getElementById(modalId)) return;

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal preview-notice-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', modalId + 'Title');
    modal.innerHTML = `
      <div class="modal-content preview-notice-content">
        <div class="preview-notice-top">
          <span class="preview-notice-badge">🚧 预览版</span>
          <span class="preview-notice-ver">DeepSeek V4.1-Flash</span>
        </div>
        <h2 id="${modalId}Title">这里是预览版，先跟你说一声</h2>
        <p class="preview-notice-body">
          本站由 <strong>DeepSeek V4.1-Flash</strong> 编写，目前仍是预览版，
          功能和内容都还在陆续补完，可能会有小毛病或者样式不统一的地方。
          如果你发现了问题，或者有想加的功能，欢迎随时告诉我们 —— 你的每一条反馈都会被看到。
        </p>
        <p class="preview-notice-note">
          <span class="preview-notice-note-icon" aria-hidden="true">⚠️</span>
          <span>我们不能保证任何事情都没有可能发生。使用本网站时，请对重要内容自行二次确认；如遇数据异常、内容错误或其他问题，欢迎及时反馈。</span>
        </p>
        <div class="preview-notice-actions">
          <button type="button" class="btn btn-primary" id="previewNoticeOk">我知道了</button>
          <a class="btn btn-secondary" id="previewNoticeFeedback" href="feedback.html">💬 去提意见</a>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    openModal(modalId);

    /* 让「版本更新」弹窗等这个关掉之后再出现 */
    const release = () => { if (releaseNoticeGate) { releaseNoticeGate(); releaseNoticeGate = null; } };
    const markSeen = () => { try { localStorage.setItem(PREVIEW_NOTICE_KEY, PREVIEW_NOTICE_VERSION); } catch (e) {} };
    const finish = () => { markSeen(); release(); closeModal(modalId); };

    document.getElementById('previewNoticeOk').onclick = finish;
    document.getElementById('previewNoticeFeedback').onclick = () => { markSeen(); release(); };

    /* ESC / 点遮罩关闭也算「已经看过」 */
    const onClose = e => {
      if (e.detail.id !== modalId) return;
      document.removeEventListener('zm:modalclose', onClose);
      markSeen();
      release();
    };
    document.addEventListener('zm:modalclose', onClose);
  }

  /* 统一初始化 */
  function initUI() {
    applyLiteMode();
    bindModalA11y();
    injectAtmosphere();
    injectThemeToggle();
    initScrollUI();
    initRipple();
    initReveal();
    initPageTransition();

    /* 稍微延后一点弹，先让页面画出来，避免「白屏等弹窗」的感觉 */
    setTimeout(showPreviewNotice, document.documentElement.classList.contains('lite') ? 300 : 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  /* ============================================================
     6. 版本更新检查（图片弹窗版）
     ============================================================ */
  async function checkPageUpdate(pageKey) {
    const storageKey = `pageVersion_${pageKey}`;

    let version, date, updates;

    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;

      const res = await fetch(`/api/updates?page=${encodeURIComponent(pageKey)}&t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);

      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok || !data.data) return;
      version = data.data.version;
      date = data.data.date;
      updates = data.data.updates;
    } catch (e) {
      return;
    }

    let stored = null;
    try { stored = localStorage.getItem(storageKey); } catch (e) {}
    if (stored === version) return;

    /* 等「预览版告知」弹窗关掉之后再弹更新公告，避免两个弹窗叠在一起 */
    await noticeGate;

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

    /* 等弹窗样式加载好再弹，避免"先没样式、后跳成正常"的闪一下 */
    await injectUpdateImageCSS();

    if (window.innerWidth < 640) {
      showSimpleUpdateModal(cfg, version, storageKey);
    } else {
      showCanvasUpdateModal(cfg, version, storageKey);
    }
  }

  /* 安全写入 localStorage（隐私模式 / 配额满时不抛错） */
  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  /* ============================================================
     7. 手机端：简化纵向弹窗
     ============================================================ */
  function showSimpleUpdateModal(cfg, version, storageKey) {
    const modalId = 'updateModal';
    const old = document.getElementById(modalId);
    if (old) old.remove();

    let lines = String(cfg.lines || '')
      .split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) lines.push('本次更新内容');
    const display = lines.slice(0, 8);

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal update-image-modal';
    modal.innerHTML = `
      <div class="modal-content update-simple-content ${escapeHtml(cfg.theme || 'theme-pink')}">
        <div class="update-simple-header">
          <span class="update-simple-badge">🎉 版本更新</span>
          <button class="update-image-close" id="updateCloseBtn" aria-label="关闭">✕</button>
        </div>
        <div class="update-simple-title">${escapeHtml(cfg.title || '日常更新')}</div>
        <div class="update-simple-version">${escapeHtml(formatVersion(cfg.version || version))}</div>
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
      safeSetItem(storageKey, version);
      closeModal(modalId);
    };
    const okBtn = document.getElementById('updateOkBtn');
    const closeBtn = document.getElementById('updateCloseBtn');
    if (okBtn) okBtn.onclick = finish;
    if (closeBtn) closeBtn.onclick = finish;

    /* ESC / 遮罩关闭同样视为已读 */
    const onClose = e => {
      if (e.detail.id !== modalId) return;
      document.removeEventListener('zm:modalclose', onClose);
      safeSetItem(storageKey, version);
    };
    document.addEventListener('zm:modalclose', onClose);
  }

  /* ============================================================
     8. 桌面 / 平板：canvas 图片式弹窗
     ============================================================ */
  function showCanvasUpdateModal(cfg, version, storageKey) {
    const modalId = 'updateModal';
    const old = document.getElementById(modalId);
    if (old) old.remove();

    const FALLBACK_LINES = [
      '🎨 更新弹窗全面升级',
      '✨ 5 种主题色可选'
    ];
    let lines = String(cfg.lines || '').split('\n').map(s => s.trim()).filter(Boolean);
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
    const CANVAS_W = 960;
    const CANVAS_H = 340;

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
            <div class="update-canvas ${escapeHtml(cfg.theme || 'theme-pink')}">
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

    const titleEl = modal.querySelector('.left-block .title');
    const pillEl = modal.querySelector('.left-block .version-pill');
    const logoEl = modal.querySelector('.logo-circle');
    const rightEl = modal.querySelector('.right-block');
    if (titleEl) titleEl.textContent = cfg.title || '日常更新';
    if (pillEl) pillEl.textContent = formatVersion(cfg.version || '');
    if (logoEl) logoEl.textContent = cfg.logo || '穗';

    display.forEach(line => {
      const div = document.createElement('div');
      div.className = 'right-line';
      div.style.fontSize = rightSize + 'px';
      div.textContent = line;
      rightEl.appendChild(div);
    });

    openModal(modalId);

    /* 自适应缩放：以顶部中心为原点，保证缩放后依然居中 */
    const fitCanvas = () => {
      const inner = modal.querySelector('.update-image-inner');
      const scaler = modal.querySelector('.canvas-scaler');
      if (!inner || !scaler) return;

      const availW = inner.clientWidth - 32;
      if (availW <= 0) return;

      const scale = Math.min(1, availW / CANVAS_W);
      scaler.style.width = CANVAS_W + 'px';
      scaler.style.height = CANVAS_H + 'px';
      scaler.style.transformOrigin = 'top center';
      scaler.style.transform = `scale(${scale})`;
      scaler.style.marginLeft = 'auto';
      scaler.style.marginRight = 'auto';
      inner.style.height = Math.round(CANVAS_H * scale + 32) + 'px';
    };

    requestAnimationFrame(fitCanvas);
    window.addEventListener('resize', fitCanvas);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('resize', fitCanvas);
    };

    const finish = () => {
      safeSetItem(storageKey, version);
      cleanup();
      closeModal(modalId);
    };

    const okBtn = document.getElementById('updateOkBtn');
    const closeBtn = document.getElementById('updateCloseBtn');
    if (okBtn) okBtn.onclick = finish;
    if (closeBtn) closeBtn.onclick = finish;

    const onClose = e => {
      if (e.detail.id !== modalId) return;
      document.removeEventListener('zm:modalclose', onClose);
      cleanup();
      safeSetItem(storageKey, version);
    };
    document.addEventListener('zm:modalclose', onClose);
  }

  /* ============================================================
     9. 旧格式文字弹窗（兼容老数据用）
     ============================================================ */
  function showOldTextModal(version, date, updates, storageKey) {
    const modalId = 'updateModal';
    let modal = document.getElementById(modalId);

    /* 复用节点时必须确认它确实是“文字版”结构，否则重建 */
    if (modal && !modal.querySelector('#updateBody')) {
      modal.remove();
      modal = null;
    }

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

    const versionEl = document.getElementById('updateVersion');
    const dateEl = document.getElementById('updateDate');
    const bodyEl = document.getElementById('updateBody');
    const okBtn = document.getElementById('updateOkBtn');

    if (versionEl) versionEl.textContent = version;
    if (dateEl) dateEl.textContent = '📅 ' + date;
    if (bodyEl) {
      bodyEl.innerHTML = (updates || [])
        .map(t => `<div class="update-item">• ${escapeHtml(t)}</div>`)
        .join('');
    }

    openModal(modalId);
    if (okBtn) {
      okBtn.onclick = () => {
        safeSetItem(storageKey, version);
        closeModal(modalId);
      };
    }

    const onClose = e => {
      if (e.detail.id !== modalId) return;
      document.removeEventListener('zm:modalclose', onClose);
      safeSetItem(storageKey, version);
    };
    document.addEventListener('zm:modalclose', onClose);
  }

  /* ============================================================
     10. 按需加载「版本更新弹窗」的样式
     ------------------------------------------------------------
     这份样式单独放在 css/update-modal.css，只在真的要弹公告时才加载，
     平时访问页面完全不会下载它。
     注意：既然是网络加载，就一定要等它到位再弹窗，
     否则会先闪出一个"没有样式的弹窗"再跳成正常样子。
     ============================================================ */
  let updateCssPromise = null;

  function injectUpdateImageCSS() {
    if (updateCssPromise) return updateCssPromise;

    updateCssPromise = new Promise(resolve => {
      const link = document.createElement('link');
      link.id = 'updateImageCSS';
      link.rel = 'stylesheet';
      link.href = 'css/update-modal.css';

      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };

      link.onload = finish;
      link.onerror = finish;
      /* 兜底：网络太慢或加载失败时也不能一直卡着不弹窗 */
      setTimeout(finish, 2500);

      document.head.appendChild(link);
    });

    return updateCssPromise;
  }

  /* ============================================================
     11. 导出到全局
     ------------------------------------------------------------
     只导出「页面脚本真的会用到」的这几个。其余函数（限速、主题切换、
     各类更新弹窗的渲染函数等）都只在内部使用，不必挂到 window 上，
     免得全局命名空间被一堆没人用的名字占满。
     ============================================================ */
  Object.assign(window, {
    showToast,        // 底部短提示
    showNotice,       // 顶部提示条
    showConfirm,      // 确认弹窗（返回 Promise）
    openModal,        // 打开弹窗
    closeModal,       // 关闭弹窗
    copyText,         // 复制到剪贴板
    debounce,         // 防抖
    escapeHtml,       // 转义，防 XSS
    formatVersion,    // 把版本号排成好看的样子
    checkPageUpdate   // 检查该页面是否有新版本公告
  });
})();
