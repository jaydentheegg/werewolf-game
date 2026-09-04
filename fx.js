/* ============================================================
 * fx.js —— 纯附加视觉层（氛围画布 + 事件特效）
 * 不改动任何游戏逻辑：只观察 DOM 变化并作出反应。
 * 观察点：#stDay 相位 / #veil 过场 / #table 死亡 / #log 关键行 / #overlay 结算
 * ============================================================ */
(() => {
  'use strict';

  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  /* ---------- 画布 ---------- */
  const cv = document.createElement('canvas');
  cv.id = 'fxCanvas';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');

  let W = 0, H = 0, DPR = 1;
  let stars = [], fog = [], motes = [], bits = [];

  /* 夜 / 昼 两套配色，按 phaseT 线性插值 */
  const NIGHT = { top: [11, 16, 38], bot: [26, 16, 51], orb: [232, 230, 240], glow: [130, 140, 255] };
  const DAY   = { top: [32, 46, 96], bot: [70, 54, 108], orb: [255, 214, 140], glow: [255, 176, 96]  };

  let phaseTarget = 0;  // 0 = 夜, 1 = 昼
  let phaseT = 0;       // 实际插值位置
  let flashA = 0, flashCol = [255, 93, 93];
  let t = 0;

  const lerp = (a, b, k) => a + (b - a) * k;
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
    if (REDUCE) draw(); // 静态模式：尺寸变化时重绘一帧
  }

  function seed() {
    const starCount = Math.round(Math.min(140, Math.max(50, (W * H) / 14000)));
    stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * W, y: Math.random() * H * 0.75,
      r: Math.random() * 1.2 + 0.35,
      tw: Math.random() * Math.PI * 2,
      sp: 0.4 + Math.random() * 1.1,
    }));
    fog = Array.from({ length: 5 }, (_, i) => ({
      x: Math.random() * W, y: H * (0.45 + Math.random() * 0.5),
      r: 180 + Math.random() * 260,
      sp: 0.06 + Math.random() * 0.10,
      ph: (i / 5) * Math.PI * 2,
      dir: i % 2 ? 1 : -1,
    }));
    motes = Array.from({ length: 34 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.5 + 0.5,
      vy: -(0.08 + Math.random() * 0.22),
      vx: (Math.random() - 0.5) * 0.12,
      ph: Math.random() * Math.PI * 2,
    }));
  }

  /* ---------- 绘制 ---------- */
  function draw() {
    const k = phaseT;
    const P = { top: mix(NIGHT.top, DAY.top, k), bot: mix(NIGHT.bot, DAY.bot, k),
                orb: mix(NIGHT.orb, DAY.orb, k), glow: mix(NIGHT.glow, DAY.glow, k) };

    ctx.clearRect(0, 0, W, H);

    // 天幕
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(P.top, 0.92));
    g.addColorStop(1, rgba(P.bot, 0.92));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 星（入夜时最亮，白天淡出）
    const starA = 1 - k;
    if (starA > 0.02) {
      for (const s of stars) {
        const tw = 0.45 + 0.55 * Math.sin(t * 0.0016 * s.sp + s.tw);
        ctx.fillStyle = `rgba(226,230,255,${(0.75 * tw * starA).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 月 / 日：同一个天体，位置与配色随相位过渡
    const ox = lerp(W * 0.80, W * 0.20, k);
    const oy = lerp(H * 0.20, H * 0.16, k);
    const orbR = lerp(46, 40, k);
    const halo = ctx.createRadialGradient(ox, oy, orbR * 0.4, ox, oy, orbR * 5.2);
    halo.addColorStop(0, rgba(P.glow, 0.34));
    halo.addColorStop(1, rgba(P.glow, 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(ox, oy, orbR * 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(P.orb, 0.95);
    ctx.beginPath(); ctx.arc(ox, oy, orbR, 0, Math.PI * 2); ctx.fill();
    // 月坑只在夜里可见
    if (starA > 0.05) {
      ctx.fillStyle = `rgba(120,124,150,${0.22 * starA})`;
      ctx.beginPath(); ctx.arc(ox - orbR * 0.3, oy - orbR * 0.2, orbR * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ox + orbR * 0.25, oy + orbR * 0.3, orbR * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ox + orbR * 0.1, oy - orbR * 0.45, orbR * 0.11, 0, Math.PI * 2); ctx.fill();
    }

    // 雾（夜里更浓，白天几乎散去）
    const fogA = lerp(0.11, 0.05, k);
    for (const f of fog) {
      const fx = f.x + Math.sin(t * 0.0002 * f.sp * 10 + f.ph) * 130 * f.dir;
      const fy = f.y + Math.cos(t * 0.00015 * f.sp * 10 + f.ph) * 26;
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, f.r);
      fg.addColorStop(0, rgba(mix([150, 150, 200], [210, 200, 220], k), fogA));
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(fx, fy, f.r, 0, Math.PI * 2); ctx.fill();
    }

    // 浮尘
    for (const m of motes) {
      const a = 0.20 + 0.25 * Math.sin(t * 0.001 + m.ph);
      ctx.fillStyle = rgba(P.orb, a * 0.5);
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
    }

    // 事件粒子（死亡灰烬 / 胜利礼花）
    for (const b of bits) {
      const lifeK = b.life / b.max;
      ctx.fillStyle = `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${(lifeK * 0.9).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.4 + lifeK * 0.6), 0, Math.PI * 2); ctx.fill();
    }

    // 全屏染色脉冲
    if (flashA > 0.001) {
      ctx.fillStyle = rgba(flashCol, flashA * 0.42);
      ctx.fillRect(0, 0, W, H);
    }
  }

  function step(dt) {
    t += dt;
    phaseT += (phaseTarget - phaseT) * 0.035;

    for (const m of motes) {
      m.y += m.vy; m.x += m.vx + Math.sin(t * 0.0008 + m.ph) * 0.08;
      if (m.y < -6) { m.y = H + 6; m.x = Math.random() * W; }
      if (m.x < -6) m.x = W + 6; else if (m.x > W + 6) m.x = -6;
    }

    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.x += b.vx; b.y += b.vy; b.vy += b.g; b.vx *= 0.99;
      if (--b.life <= 0) bits.splice(i, 1);
    }

    if (flashA > 0.001) flashA *= 0.90; else flashA = 0;
  }

  let raf = null, last = 0;
  function loop(now) {
    const dt = Math.min(50, now - last || 16);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  /* ---------- 对外特效 API ---------- */
  const FX = {
    setPhase(p) { phaseTarget = p === 'day' ? 1 : 0; document.documentElement.dataset.phase = p; },

    /* 在某点炸开一簇粒子 */
    burst(x, y, { color = [255, 93, 93], n = 26, spread = 3.4, gravity = 0.055, size = 2.6 } = {}) {
      if (REDUCE) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * spread;
        bits.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6,
          g: gravity, r: Math.random() * size + 0.8,
          life: 40 + Math.random() * 45 | 0, max: 85, c: color,
        });
      }
      if (bits.length > 400) bits.splice(0, bits.length - 400);
    },

    flash(color = [255, 93, 93], strength = 1) {
      if (REDUCE) return;
      flashCol = color; flashA = Math.min(1, strength);
    },

    /* 元素抖动（只抖局部，避免 body transform 影响 fixed 定位） */
    shake(el, cls = 'fx-shake') {
      if (REDUCE || !el) return;
      el.classList.remove(cls);
      void el.offsetWidth; // 强制重排以便重复触发
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), 520);
    },

    /* 取元素中心（视口坐标） */
    centerOf(el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
  };
  window.FX = FX;

  /* ============================================================
   * DOM 观察：把游戏状态变化翻译成特效，游戏侧零改动
   * ============================================================ */

  /* 1) 相位：#stDay 的文案含「夜晚」或「白天」
   * 仅在对局界面可见时采信；菜单/大厅一律走夜色（贴合"天黑请闭眼"的调性）。
   * 否则会读到 #game 里那份尚未开局的初始文案「☀️ 白天」。 */
  function readPhase() {
    const game = $('game');
    if (!game || game.classList.contains('hidden')) return 'night';
    const txt = $('stDay')?.textContent || '';
    if (txt.includes('白天')) return 'day';
    if (txt.includes('夜晚')) return 'night';
    return 'night';
  }
  function syncPhase() {
    const p = readPhase();
    if (p) FX.setPhase(p);
  }
  for (const id of ['stDay', 'phaseBadge']) {
    const el = $(id);
    if (el) new MutationObserver(syncPhase).observe(el, { childList: true, characterData: true, subtree: true });
  }
  // 进入 / 离开对局界面时也要重算（菜单 ⇄ 对局的昼夜切换）
  const gameEl = $('game');
  if (gameEl) new MutationObserver(syncPhase).observe(gameEl, { attributes: true, attributeFilter: ['class'] });
  syncPhase();

  /* 2) 过场遮罩：出现时来一发光爆，颜色跟随 veilInner 的类名 */
  const veil = $('veil'), veilInner = $('veilInner');
  if (veil) {
    new MutationObserver(() => {
      if (veil.classList.contains('hidden')) return;
      const c = veilInner?.className || '';
      const color = c.includes('wolf') ? [255, 93, 93] : c.includes('day') ? [255, 233, 168] : [245, 197, 66];
      FX.burst(innerWidth / 2, innerHeight / 2, { color, n: 34, spread: 5.5, gravity: 0.012, size: 2.2 });
      FX.flash(color, 0.5);
    }).observe(veil, { attributes: true, attributeFilter: ['class'] });
  }

  /* 3) 牌桌
   * 注意：paintHost() 每次都整体替换 #table 的 innerHTML，卡牌是全新元素。
   * 因此这里做两件事：
   *   a. 给"上一帧已经存在过"的卡打上 fx-seen，抑制它重复播放入场动画
   *      （原本每次重绘全桌都会重新 pop 一遍，观感很碎）；
   *   b. 对比死亡名单，新增死者放灰烬粒子，并在动画时长内补挂 fx-die，
   *      让它不被下一次重绘抹掉。 */
  const table = $('table');
  if (table) {
    let knownDead = null;          // null = 尚未建立基线
    const seen = new Set();        // 出现过的座位号
    const dying = new Map();       // id -> 死亡时刻，用于跨重绘续播动画

    const onTable = () => {
      const cards = [...table.querySelectorAll('.card')];
      const now = performance.now();

      for (const c of cards) {
        const id = c.dataset.id;
        if (seen.has(id)) c.classList.add('fx-seen'); else seen.add(id);
        // 死亡动画未播完就被重绘掉的话，在这里补回来
        const t0 = dying.get(id);
        if (t0 != null) {
          if (now - t0 < 650) c.classList.add('fx-die');
          else dying.delete(id);
        }
      }

      const dead = new Set(cards.filter((c) => c.classList.contains('dead')).map((c) => c.dataset.id));
      if (knownDead === null) { knownDead = dead; return; } // 首帧只建基线，不放特效

      for (const id of dead) {
        if (knownDead.has(id)) continue;
        const card = table.querySelector(`.card[data-id="${id}"]`);
        if (!card) continue;
        const { x, y } = FX.centerOf(card);
        FX.burst(x, y, { color: [255, 93, 93], n: 30, spread: 3.8 });
        FX.burst(x, y, { color: [160, 160, 190], n: 16, spread: 2.2, gravity: 0.03 });
        card.classList.add('fx-die');
        dying.set(id, now);
        FX.shake(table);
      }
      knownDead = dead;
    };

    new MutationObserver(onTable).observe(table, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
    });
    onTable();
  }

  /* 4) 日志：关键行给一点全屏情绪 */
  const log = $('log');
  if (log) {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains('win')) {
            FX.flash([89, 217, 141], 0.45);
          } else if (node.classList.contains('dead')) {
            FX.flash([255, 93, 93], 0.30);
          }
        }
      }
    }).observe(log, { childList: true });
  }

  /* 5) 结算弹窗：礼花 */
  const overlay = $('overlay');
  if (overlay) {
    new MutationObserver(() => {
      if (overlay.classList.contains('hidden')) return;
      const gold = [245, 197, 66], green = [89, 217, 141], violet = [155, 130, 255];
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          FX.burst(innerWidth * (0.25 + i * 0.25), innerHeight * 0.42,
            { color: [gold, green, violet][i], n: 40, spread: 6.5, gravity: 0.10, size: 3 });
        }, i * 170);
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- 启动 ---------- */
  addEventListener('resize', resize, { passive: true });
  resize();

  if (REDUCE) {
    draw(); // 静态一帧，不跑动画循环
  } else {
    raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
      else if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    });
  }
})();
