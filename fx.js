/* ============================================================
 * fx.js —— 视觉/动效层（纯附加）
 *
 * 设计原则：game.js 一行未改。本文件只做三件事：
 *   1. 画布氛围（午夜村庄 / 破晓）与昼夜墨迹-像素转场
 *   2. 把 game.js 输出的 emoji 就地替换成原创 SVG 符号
 *   3. 监听 DOM 变化，把游戏状态翻译成电影化反馈
 *
 * 观察点：#stDay/#game 相位 · #veil 过场 · #table 死亡与排布
 *        · #log 关键事件与身份揭示 · #overlay 结算 · #action 可选目标
 * ============================================================ */
(() => {
  'use strict';

  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  /* 角色表：与 game.js 的 ROLES 对应（只读镜像，不改动游戏） */
  const ROLE_BY_ICON = {
    '🐺': 'wolf', '🔮': 'seer', '🧪': 'witch', '🏹': 'hunter', '👤': 'villager', '🙈': 'unknown',
  };
  const ROLE_BY_NAME = {
    '狼人': 'wolf', '预言家': 'seer', '女巫': 'witch', '猎人': 'hunter', '村民': 'villager',
  };
  const ROLE_META = {
    wolf:     { name: '狼人',   camp: 'wolf', campName: 'Wolf',    desc: '每晚睁眼，带走一个人' },
    seer:     { name: '预言家', camp: 'good', campName: 'Village', desc: '每晚查验一人的善恶' },
    witch:    { name: '女巫',   camp: 'good', campName: 'Village', desc: '一瓶解药，一瓶毒药' },
    hunter:   { name: '猎人',   camp: 'good', campName: 'Village', desc: '倒下时，可以开枪带走一人' },
    villager: { name: '村民',   camp: 'good', campName: 'Village', desc: '没有能力，只有推理与投票' },
    unknown:  { name: '未知',   camp: 'good', campName: 'Unknown', desc: '' },
  };

  /* 音效接口：按要求默认关闭，且不做任何自动播放 */
  const sound = { enabled: false, play() { /* 预留：enabled 为 true 时才会发声 */ } };

  /* ============================================================
   * 一、氛围画布
   * ============================================================ */
  const cv = document.createElement('canvas');
  cv.id = 'fxCanvas';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');

  let W = 0, H = 0, DPR = 1, t = 0;
  let stars = [], fog = [], motes = [], bits = [], trees = [], cells = [];

  const NIGHT = {
    top: [7, 7, 10], bot: [15, 16, 24], horizon: [24, 26, 38],
    orb: [232, 226, 214], glow: [120, 130, 170], tree: [3, 3, 5],
  };
  const DAY = {
    top: [214, 209, 197], bot: [190, 184, 170], horizon: [206, 198, 182],
    orb: [212, 98, 42], glow: [212, 130, 70], tree: [66, 62, 58],
  };

  let phaseTarget = 0;         // 0 夜 1 昼
  let phaseT = 0;              // 已完成的相位（转场结束后等于 target）
  let trans = null;            // {from, to, p} 墨迹+像素溶解
  let flashA = 0, flashCol = [192, 52, 47];
  let shakeT = 0;

  const lerp = (a, b, k) => a + (b - a) * k;
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  /* 离屏缓存：天空（渐变 + 森林 + 月/日）不必每帧重算，
   * 只在相位量化值变化或尺寸变化时重绘一次。 */
  const sky = document.createElement('canvas');
  const sctx = sky.getContext('2d');
  let skyKey = null;

  function skyFor(k) {
    const key = Math.round(k * 40);
    if (skyKey === key) return sky;
    skyKey = key;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sky.width, sky.height);
    sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    paintSkyTo(sctx, key / 40);
    return sky;
  }
  /* 转场时"目标相位"的整幅天空，只在转场开始时渲染一次 */
  const skyTo = document.createElement('canvas');
  const tctx = skyTo.getContext('2d');
  /* 合成用暂存层：靠 destination-in 做溶解遮罩，
   * 比"每个格子一次 drawImage"便宜一个数量级 */
  const scratch = document.createElement('canvas');
  const xctx = scratch.getContext('2d');
  function renderSkyTo(k) {
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, skyTo.width, skyTo.height);
    tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    paintSkyTo(tctx, k);
  }

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth | 0; H = innerHeight | 0;
    /* 视口为 0（面板隐藏 / 尚未布局）时不要把画布设成 0×0：
     * 之后 drawImage 会抛 InvalidStateError，并在 rAF 回调里终止整个循环。 */
    if (W <= 0 || H <= 0) return;
    for (const c of [cv, sky, skyTo, scratch]) { c.width = W * DPR; c.height = H * DPR; }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    skyKey = null;
    seed();
    if (trans) renderSkyTo(trans.to);
    if (REDUCE) draw();
  }

  /* 确定性伪随机：同一尺寸下重绘结果稳定 */
  let sd = 20260904;
  const rnd = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;

  function seed() {
    sd = 20260904;
    stars = Array.from({ length: Math.min(90, Math.max(34, (W * H) / 22000 | 0)) }, () => ({
      x: rnd() * W, y: rnd() * H * 0.62, r: rnd() * 1.05 + 0.3,
      tw: rnd() * Math.PI * 2, sp: 0.35 + rnd() * 0.9,
    }));
    fog = Array.from({ length: 4 }, (_, i) => ({
      x: rnd() * W, y: H * (0.62 + rnd() * 0.32), r: 220 + rnd() * 300,
      sp: 0.05 + rnd() * 0.08, ph: (i / 4) * Math.PI * 2, dir: i % 2 ? 1 : -1,
    }));
    /* 克制的浮尘，不做满屏粒子 */
    motes = Array.from({ length: 18 }, () => ({
      x: rnd() * W, y: rnd() * H, r: rnd() * 1.1 + 0.4,
      vy: -(0.05 + rnd() * 0.14), vx: (rnd() - 0.5) * 0.08, ph: rnd() * Math.PI * 2,
    }));
    /* 抽象森林：远近两层杉木剪影 */
    trees = [];
    for (const layer of [{ n: 26, base: 0.99, h: 0.20, a: 0.55 }, { n: 18, base: 1.04, h: 0.30, a: 1 }]) {
      for (let i = 0; i < layer.n; i++) {
        trees.push({
          x: (i / layer.n) * (W + 120) - 60 + (rnd() - 0.5) * 40,
          base: H * layer.base,
          h: H * layer.h * (0.62 + rnd() * 0.7),
          w: 26 + rnd() * 34,
          a: layer.a,
        });
      }
    }
    /* 像素溶解网格 */
    const cs = 26;
    cells = [];
    for (let y = 0; y < H + cs; y += cs) {
      for (let x = 0; x < W + cs; x += cs) {
        cells.push({ x, y, s: cs, th: rnd() });
      }
    }
  }

  function palette(k) {
    return {
      top: mix(NIGHT.top, DAY.top, k), bot: mix(NIGHT.bot, DAY.bot, k),
      horizon: mix(NIGHT.horizon, DAY.horizon, k),
      orb: mix(NIGHT.orb, DAY.orb, k), glow: mix(NIGHT.glow, DAY.glow, k),
      tree: mix(NIGHT.tree, DAY.tree, k),
    };
  }

  /* 静态底：渐变天幕 + 月/日 + 森林剪影 —— 进离屏缓存，不必每帧重算 */
  function paintSkyTo(c, k) {
    const P = palette(k);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(P.top, 1));
    g.addColorStop(0.72, rgba(P.bot, 1));
    g.addColorStop(1, rgba(P.horizon, 1));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    const ox = lerp(W * 0.66, W * 0.20, k);   // 避开右侧卷宗栏
    const oy = lerp(H * 0.15, H * 0.20, k);
    const orbR = lerp(44, 34, k);
    const halo = c.createRadialGradient(ox, oy, orbR * 0.5, ox, oy, orbR * 6);
    halo.addColorStop(0, rgba(P.glow, 0.28));
    halo.addColorStop(1, rgba(P.glow, 0));
    c.fillStyle = halo;
    c.beginPath(); c.arc(ox, oy, orbR * 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba(P.orb, 0.96);
    c.beginPath(); c.arc(ox, oy, orbR, 0, Math.PI * 2); c.fill();
    const nightA = 1 - k;
    if (nightA > 0.06) {                       // 月牙缺口
      c.fillStyle = rgba(P.top, 0.9 * nightA);
      c.beginPath(); c.arc(ox + orbR * 0.42, oy - orbR * 0.26, orbR * 0.92, 0, Math.PI * 2); c.fill();
    }

    for (const tr of trees) {                  // 抽象森林
      c.fillStyle = rgba(P.tree, tr.a * lerp(1, 0.18, k));   // 白天森林退到很淡，避免干扰正文
      c.beginPath();
      c.moveTo(tr.x, tr.base);
      c.lineTo(tr.x + tr.w / 2, tr.base - tr.h);
      c.lineTo(tr.x + tr.w, tr.base);
      c.closePath(); c.fill();
    }
  }

  /* 活体层：星光闪烁与雾气漂移，每帧画在缓存之上（成本很低） */
  function paintLive(k) {
    const P = palette(k);
    const nightA = 1 - k;
    if (nightA > 0.03) {
      for (const s of stars) {
        const tw = 0.4 + 0.6 * Math.sin(t * 0.0014 * s.sp + s.tw);
        ctx.fillStyle = `rgba(228,224,238,${(0.6 * tw * nightA).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    const fogA = lerp(0.10, 0.16, k);
    for (const f of fog) {
      const fx = f.x + Math.sin(t * 0.00018 * f.sp * 10 + f.ph) * 120 * f.dir;
      const fy = f.y + Math.cos(t * 0.00013 * f.sp * 10 + f.ph) * 22;
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, f.r);
      fg.addColorStop(0, rgba(mix([120, 126, 156], [226, 220, 206], k), fogA));
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(fx, fy, f.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function draw() {
    if (W <= 0 || H <= 0 || cv.width === 0 || sky.width === 0) return;   // 尺寸未就绪，跳过这一帧
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shakeT > 0) {
      const s = shakeT * 7;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    if (trans) {
      /* 旧天空打底 */
      ctx.drawImage(skyFor(trans.from), 0, 0, W, H);
      const p = trans.p;
      const inkR = p * Math.hypot(W, H) * 0.62;
      const cx = W * 0.5, cy = H * 0.46;
      /* 新天空 → 暂存层，再用 destination-in 按"像素格 + 中心墨迹"裁形，最后整幅贴回。
       * 关键：上千个格子只是同一条路径里的子路径，一次 fill 完成，
       * 不是上千次 drawImage，也不是昂贵的 clip()。 */
      xctx.setTransform(1, 0, 0, 1, 0, 0);
      xctx.clearRect(0, 0, scratch.width, scratch.height);
      xctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      xctx.globalCompositeOperation = 'source-over';
      xctx.drawImage(skyTo, 0, 0, W, H);
      xctx.globalCompositeOperation = 'destination-in';
      xctx.fillStyle = '#000';
      xctx.beginPath();
      for (const c of cells) if (c.th < p * 1.18) xctx.rect(c.x, c.y, c.s + 0.7, c.s + 0.7);
      xctx.arc(cx, cy, Math.max(0, inkR), 0, Math.PI * 2);
      xctx.fill();
      xctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(scratch, 0, 0, W, H);
      /* 溶解边缘的红线 */
      ctx.strokeStyle = `rgba(192,52,47,${(0.5 * Math.sin(p * Math.PI)).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(0, inkR), 0, Math.PI * 2); ctx.stroke();
      paintLive(trans.from + (trans.to - trans.from) * p);
    } else {
      ctx.drawImage(skyFor(phaseT), 0, 0, W, H);
      paintLive(phaseT);
    }

    /* 浮尘 */
    const P = palette(phaseT);
    for (const m of motes) {
      const a = 0.16 + 0.2 * Math.sin(t * 0.0009 + m.ph);
      ctx.fillStyle = rgba(P.orb, a * 0.42);
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
    }

    /* 事件粒子 */
    for (const b of bits) {
      const k = b.life / b.max;
      ctx.fillStyle = `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${(k * 0.85).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.35 + k * 0.65), 0, Math.PI * 2); ctx.fill();
    }

    if (flashA > 0.002) {
      ctx.fillStyle = rgba(flashCol, flashA * 0.34);
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function step(dt) {
    t += dt;
    if (trans) {
      /* 用挂钟而非逐帧累加：标签页被切走 / rAF 被节流时，
         回来后能立刻补齐进度，不会永远冻在半溶解状态 */
      trans.p = (performance.now() - trans.t0) / 900;   // 主转场 ≈900ms
      if (trans.p >= 1) { trans.p = 1; phaseT = trans.to; trans = null; skyKey = null; }
    } else if (Math.abs(phaseTarget - phaseT) > 0.001) {
      phaseT += (phaseTarget - phaseT) * 0.05;
    }
    for (const m of motes) {
      m.y += m.vy; m.x += m.vx + Math.sin(t * 0.0007 + m.ph) * 0.05;
      if (m.y < -6) { m.y = H + 6; m.x = Math.random() * W; }
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.x += b.vx; b.y += b.vy; b.vy += b.g; b.vx *= 0.985;
      if (--b.life <= 0) bits.splice(i, 1);
    }
    flashA = flashA > 0.002 ? flashA * 0.9 : 0;
    shakeT = shakeT > 0.01 ? shakeT * 0.86 : 0;
  }

  let raf = null, last = 0;
  function loop(now) {
    const dt = Math.min(50, now - last || 16);
    last = now;
    try { step(dt); draw(); } catch (e) { /* 单帧异常不应终止整个循环 */ }
    raf = requestAnimationFrame(loop);
  }

  /* ============================================================
   * 二、对外特效 API
   * ============================================================ */
  const FX = {
    sound,
    setPhase(p, cinematic) {
      const nt = p === 'day' ? 1 : 0;
      if (nt === phaseTarget && root.dataset.phase) return;
      const prev = phaseTarget;
      phaseTarget = nt;
      root.dataset.phase = p;
      if (cinematic && !REDUCE && prev !== nt) { trans = { from: prev, to: nt, p: 0, t0: performance.now() }; renderSkyTo(nt); }
      else phaseT = nt;
    },
    burst(x, y, { color = [192, 52, 47], n = 24, spread = 3.2, gravity = 0.05, size = 2.3 } = {}) {
      if (REDUCE) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * spread;
        bits.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.5, g: gravity,
          r: Math.random() * size + 0.7, life: 34 + Math.random() * 38 | 0, max: 72, c: color,
        });
      }
      if (bits.length > 320) bits.splice(0, bits.length - 320);
    },
    flash(color = [192, 52, 47], strength = 1) { if (!REDUCE) { flashCol = color; flashA = Math.min(1, strength); } },
    shake(amount = 1) { if (!REDUCE) shakeT = Math.min(1, amount); },
    centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  };
  window.FX = FX;

  /* ============================================================
   * 三、把 emoji 换成原创符号
   * ============================================================ */
  function sigilSVG(role, cls) {
    return `<svg class="sigil ${cls || ''}" viewBox="0 0 32 32" aria-hidden="true"><use href="#sig-${role}"/></svg>`;
  }
  /* 卡面头像：game.js 写入的是 emoji 文本 */
  function swapAvatars(scope) {
    scope.querySelectorAll('.avatar').forEach((el) => {
      if (el.querySelector('.sigil')) return;
      const role = ROLE_BY_ICON[(el.textContent || '').trim()];
      if (role) el.innerHTML = sigilSVG(role);
    });
  }
  /* 角色配置：把 "🐺 狼人 ×3" 胶囊换成徽章 */
  function upgradeRolePreview() {
    const rp = $('rolePreview');
    if (!rp || rp.dataset.fx === String(rp.children.length) + rp.textContent.length) return;
    let changed = false;
    rp.querySelectorAll('span:not(.rp-badge)').forEach((sp) => {
      const txt = (sp.textContent || '').trim();
      const m = txt.match(/^(\S+)\s*(\S+?)\s*×(\d+)$/);
      if (!m) return;
      const role = ROLE_BY_ICON[m[1]] || ROLE_BY_NAME[m[2]];
      if (!role) return;
      sp.className = 'rp-badge';
      sp.dataset.role = role;
      sp.innerHTML = `${sigilSVG(role)}<span>${m[2]}</span><span class="rp-x">×${m[3]}</span>`;
      changed = true;
    });
    if (changed) rp.dataset.fx = String(rp.children.length) + rp.textContent.length;
  }

  /* ============================================================
   * 四、相位（含电影式墨迹转场）
   * ============================================================ */
  /* 由过场标题卡给出的权威相位。#stDay 是滞后的（game.js 在某些分支里
   * 改了 G.phase 却没马上重绘），只靠它会出现"已经天黑、背景还亮着"。
   * 只认这三张真正的相位边界卡；预言家查验结果那种私有遮罩虽然也带
   * cls="day"，但它发生在夜里，必须排除。 */
  let veilPhase = null;
  function phaseFromVeilText(txt) {
    if (!txt) return null;
    if (txt.includes('天黑')) return 'night';
    if (txt.includes('天亮') || txt.includes('投票时间')) return 'day';
    return null;
  }

  function readPhase() {
    const game = $('game');
    if (!game || game.classList.contains('hidden')) return 'night';  // 菜单/大厅恒为夜
    /* 结算即终局：必须收回夜色。否则白天结束的那局会把根色板永远停在骨白，
     * 结算遮罩盖不到的地方（顶栏一带）就会露出一条白底。 */
    const ov = $('overlay');
    if (ov && !ov.classList.contains('hidden')) return 'night';
    if (veilPhase) return veilPhase;                                 // 权威信号优先
    const txt = $('stDay')?.textContent || '';
    if (txt.includes('白天')) return 'day';
    return 'night';
  }
  let lastPhase = null, syncTimer = 0;
  function applyPhase() {
    const p = readPhase();
    if (p === lastPhase) return;
    const cinematic = lastPhase !== null;    // 首次进入不放转场
    lastPhase = p;
    FX.setPhase(p, cinematic);
  }
  /* 防抖：#game 由 hidden 变可见的那一刻，#stDay 还残留着 HTML 里的初始
   * 「☀️ 白天」，紧接着才被 paintHost 改成真实相位。不防抖会白白放两次转场。 */
  function syncPhase() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(applyPhase, 120);
  }
  ['stDay', 'phaseBadge'].forEach((id) => {
    const el = $(id);
    if (el) new MutationObserver(syncPhase).observe(el, { childList: true, characterData: true, subtree: true });
  });
  const gameEl = $('game');
  if (gameEl) new MutationObserver(() => {
    if (gameEl.classList.contains('hidden')) {
      veilPhase = null;
      idShown = false;
      hideIdCard();
    }  // 回到菜单：重置相位与身份卡
    syncPhase();
  }).observe(gameEl, { attributes: true, attributeFilter: ['class'] });
  applyPhase();

  /* ============================================================
   * 五、过场遮罩
   * ============================================================ */
  /* —— 角色行动圣像徽章 ——
   * 运动语言参考 santionispirits.com：三层同心圆环分速旋转 + 主体经遮罩揭示，
   * 触发式播放一次。这里用原生 SVG + CSS 复刻，图形全部是本项目自有的 sigil。
   * 只在"某个角色正在行动"的时刻出现，普通阶段卡不放。 */
  const ACTING = [
    { re: /狼人睁眼|你是狼人/, role: 'wolf'   },
    { re: /预言家睁眼|查到了/, role: 'seer'   },
    { re: /女巫睁眼/,          role: 'witch'  },
    /* 猎人在当前 game.js 里没有全屏遮罩时刻（只有日志行和 #action 标题），
     * 这条规则因此暂时不会命中；保留是为了将来若加了猎人过场即可自动生效。 */
    { re: /猎人睁眼|发动猎人技能/, role: 'hunter' },
  ];
  function roleFromActingText(txt) {
    if (!txt) return null;
    const hit = ACTING.find((a) => a.re.test(txt));
    return hit ? hit.role : null;
  }

  function medallionEl(role) {
    const wrap = document.createElement('div');
    wrap.className = 'medallion';
    wrap.dataset.role = role;
    /* 光芒：绕圈的放射细线，长短交替 */
    let rays = '';
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r1 = 74, r2 = i % 3 === 0 ? 86 : 80;
      rays += `<line x1="${(100 + Math.cos(a) * r1).toFixed(1)}" y1="${(100 + Math.sin(a) * r1).toFixed(1)}"` +
              ` x2="${(100 + Math.cos(a) * r2).toFixed(1)}" y2="${(100 + Math.sin(a) * r2).toFixed(1)}"/>`;
    }
    wrap.innerHTML =
      `<svg viewBox="0 0 200 200" aria-hidden="true">
         <g class="med-outer"><circle class="med-ring" pathLength="100" cx="100" cy="100" r="92"/></g>
         <g class="med-rays">${rays}</g>
         <g class="med-mid"><circle class="med-ring" pathLength="100" cx="100" cy="100" r="66"/></g>
         <g class="med-inner"><circle class="med-ring med-ring--dash" pathLength="100" cx="100" cy="100" r="52"/></g>
         <g class="med-figure"><use href="#sig-${role}" width="32" height="32" transform="translate(68 68) scale(2)"/></g>
       </svg>`;
    return wrap;
  }

  function clearMedallion() {
    veil?.querySelector('.medallion')?.remove();
  }
  function showMedallion(role) {
    if (!veil) return;
    clearMedallion();
    const el = medallionEl(role);
    veil.insertBefore(el, veil.firstChild);
  }

  const veil = $('veil'), veilInner = $('veilInner');
  if (veil) {
    new MutationObserver(() => {
      if (veil.classList.contains('hidden')) { clearMedallion(); return; }
      const txt = veilInner?.textContent || '';
      const p = phaseFromVeilText(txt);
      if (p && p !== veilPhase) { veilPhase = p; syncPhase(); }

      const role = roleFromActingText(txt);
      if (role) showMedallion(role); else clearMedallion();

      const c = veilInner?.className || '';
      const isWolf = c.includes('wolf');
      const color = isWolf ? [192, 52, 47] : c.includes('day') ? [212, 130, 70] : [184, 145, 80];
      FX.flash(color, isWolf ? 0.55 : 0.34);
      if (isWolf) FX.shake(0.5);
    }).observe(veil, { attributes: true, attributeFilter: ['class'] });
  }

  /* ============================================================
   * 六、牌桌：环形排布 / 符号 / 死亡 / 可选目标
   *
   * 重要：classList.add()/toggle() 无论内容是否变化都会重写 class 属性，
   * 因此每次都会产生一条 MutationRecord。若在观察器回调里无条件写入，
   * 观察器会不断自我触发、永不收敛（回调是异步微任务，同步的重入标志挡不住）。
   * 下面所有写入都必须"先比较、变了才写"。
   * ============================================================ */
  const setCls = (el, name, on) => {
    if (el.classList.contains(name) === !!on) return;   // 无变化 → 不写 → 不触发观察器
    el.classList.toggle(name, !!on);
  };
  const setVar = (el, name, val) => {
    if (el.style.getPropertyValue(name) === String(val)) return;
    el.style.setProperty(name, val);
  };
  const table = $('table');
  if (table) {
    let knownDead = null;
    const seen = new Set();
    const dying = new Map();
    let applying = false;          // 防止自身写入触发的递归观察

    const onTable = () => {
      if (applying) return;
      applying = true;
      try {
        const cards = [...table.querySelectorAll('.card')];
        const now = performance.now();
        const n = cards.length || 1;

        cards.forEach((c, i) => {
          const id = c.dataset.id;
          /* 环形坐标（CSS 在 ≥1024px 时才使用） */
          setVar(c, '--i', i);
          setVar(c, '--n', n);
          if (seen.has(id)) setCls(c, 'fx-seen', true); else seen.add(id);
          const t0 = dying.get(id);
          if (t0 != null) {
            if (now - t0 < 640) setCls(c, 'fx-die', true);
            else dying.delete(id);
          }
        });
        swapAvatars(table);

        const dead = new Set(cards.filter((c) => c.classList.contains('dead')).map((c) => c.dataset.id));
        if (knownDead === null) { knownDead = dead; return; }

        for (const id of dead) {
          if (knownDead.has(id)) continue;
          const card = table.querySelector(`.card[data-id="${id}"]`);
          if (!card) continue;
          const { x, y } = FX.centerOf(card);
          FX.burst(x, y, { color: [142, 20, 32], n: 26, spread: 3.4 });
          FX.burst(x, y, { color: [120, 118, 112], n: 14, spread: 2, gravity: 0.028 });
          FX.shake(0.6);
          setCls(card, 'fx-die', true);
          dying.set(id, now);
        }
        knownDead = dead;
      } finally { applying = false; }
    };

    new MutationObserver(onTable).observe(table, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
    });
    onTable();

    /* 可选目标：把 #action 里按钮提到的名字标到卡上 */
    const action = $('action');
    if (action) {
      const markTargets = () => {
        const names = [...action.querySelectorAll('button')]
          .map((b) => (b.textContent || '').trim()).filter(Boolean);
        table.querySelectorAll('.card').forEach((c) => {
          const nm = c.querySelector('.nm')?.textContent?.trim();
          const hit = !!nm && names.some((t) => t.includes(nm));
          setCls(c, 'fx-target', hit && !c.classList.contains('dead'));
        });
        hideIdCard();   // 轮到玩家操作时，身份卡必须让位
      };
      new MutationObserver(markTargets).observe(action, { childList: true, subtree: true });
    }
  }

  /* ============================================================
   * 七、日志：关键事件 + 身份揭示卡
   * ============================================================ */
  /* 身份揭示卡。
   * 关闭必须绝对可靠：只把监听挂在卡片自身上是不够的——一旦有任何元素
   * 压在它上面，点击就再也到不了这张卡。因此改为在 document 捕获阶段
   * 收 pointerdown，并同时支持键盘，且卡片一旦关闭就不再因重复日志重开。 */
  const idStage = $('identityOverlay');
  const idCard = $('identityCard');
  const idContinue = $('identityContinue');
  let idTimer = 0, idShown = false, idOpen = false, idPrevFocus = null;

  function hideIdCard() {
    if (!idStage) return;
    clearTimeout(idTimer);
    idTimer = 0;
    idOpen = false;
    idStage.classList.add('hidden');
    idStage.setAttribute('aria-hidden', 'true');
    const restore = idPrevFocus;
    idPrevFocus = null;
    if (restore && document.contains(restore) && typeof restore.focus === 'function') {
      try { restore.focus({ preventScroll: true }); } catch (_) { /* 非关键：旧浏览器可能不支持选项 */ }
    }
  }
  function onIdKey(e) {
    if (!idOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    hideIdCard();
  }

  function showIdCard(role) {
    const meta = ROLE_META[role];
    if (!meta || !idStage || !idCard || idOpen || idShown) return;
    idShown = true;
    idOpen = true;
    idPrevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    idCard.dataset.camp = meta.camp;
    $('identitySigil').innerHTML = sigilSVG(role);
    $('identityName').textContent = meta.name;
    $('identityCamp').textContent = meta.campName;
    $('identityDesc').textContent = meta.desc;
    idStage.classList.remove('hidden');
    idStage.setAttribute('aria-hidden', 'false');

    /* 先装上自动关闭，再调用任何非关键特效；即使特效异常也不会卡死。 */
    idTimer = setTimeout(hideIdCard, REDUCE ? 900 : 4000);
    requestAnimationFrame(() => {
      if (idOpen) try { idContinue?.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    });
    try { FX.flash(meta.camp === 'wolf' ? [142, 20, 32] : [184, 145, 80], 0.4); } catch (_) { /* 视觉失败不影响继续 */ }
  }

  /* 事件只绑定一次。遮罩、卡片和真实按钮都走同一个幂等关闭函数。 */
  if (idStage) {
    idStage.addEventListener('pointerdown', hideIdCard);
    idStage.addEventListener('click', hideIdCard);   // Pointer Events 不可用时的兼容兜底
  }
  if (idContinue) idContinue.addEventListener('click', hideIdCard);
  document.addEventListener('keydown', onIdKey, true);

  const log = $('log');
  if (log) {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const txt = node.textContent || '';

          if (node.classList.contains('win')) FX.flash([184, 145, 80], 0.45);
          else if (node.classList.contains('dead')) { FX.flash([142, 20, 32], 0.3); }

          /* 身份揭示：game.js 会写「你的身份是：<b>🧪 女巫</b>（…）」 */
          if (txt.includes('你的身份是')) {
            const b = node.querySelector('b');
            const raw = (b?.textContent || txt).trim();
            const icon = raw.match(/[\u{1F300}-\u{1FAFF}]/u)?.[0];
            const role = ROLE_BY_ICON[icon] ||
              ROLE_BY_NAME[Object.keys(ROLE_BY_NAME).find((k) => raw.includes(k)) || ''];
            if (role && role !== 'unknown') showIdCard(role);
          }
        }
      }
    }).observe(log, { childList: true });
  }

  /* ============================================================
   * 八、结算：好人 / 狼人两套构图
   * ============================================================ */
  const overlay = $('overlay');
  if (overlay) {
    new MutationObserver(() => {
      syncPhase();                       // 结算开/关都要重算相位
      if (overlay.classList.contains('hidden')) {
        setCls(overlay, 'fx-win-wolf', false);
        setCls(overlay, 'fx-win-good', false);
        return;
      }
      hideIdCard();
      const title = $('ovTitle')?.textContent || '';
      const wolfWin = title.includes('狼人阵营');
      setCls(overlay, 'fx-win-wolf', wolfWin);
      setCls(overlay, 'fx-win-good', !wolfWin && title.includes('好人阵营'));
      const color = wolfWin ? [142, 20, 32] : [127, 159, 110];
      FX.flash(color, 0.5);
      if (!REDUCE) {
        for (let i = 0; i < 3; i++) {
          setTimeout(() => FX.burst(innerWidth * (0.28 + i * 0.22), innerHeight * 0.4,
            { color, n: 30, spread: 5.2, gravity: 0.09, size: 2.6 }), i * 150);
        }
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  /* ============================================================
   * 九、大厅名单与角色配置里的符号
   * ============================================================ */
  const rp = $('rolePreview');
  if (rp) { new MutationObserver(upgradeRolePreview).observe(rp, { childList: true }); upgradeRolePreview(); }

  /* 仪式圆盘刻度（一次性生成，纯装饰） */
  const ticks = document.querySelector('.disc-ticks');
  if (ticks) {
    let d = '';
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, r1 = 168, r2 = i % 4 === 0 ? 156 : 162;
      d += `<line x1="${200 + Math.cos(a) * r1}" y1="${200 + Math.sin(a) * r1}" x2="${200 + Math.cos(a) * r2}" y2="${200 + Math.sin(a) * r2}"/>`;
    }
    ticks.innerHTML = d;
  }

  /* ============================================================
   * 十、启动
   * ============================================================ */
  addEventListener('resize', resize, { passive: true });
  resize();

  if (REDUCE) {
    draw();
  } else {
    draw();                    // 先同步画一帧，避免"画布还没画、露出根背景"的空窗
    raf = requestAnimationFrame(loop);
    /* rAF 被暂停（切标签页 / 窗口失焦 / 节流）时画面会冻在半溶解帧，
     * 回来后必须立刻补齐：结束过期转场并重画。 */
    const revive = () => {
      if (W <= 0 || H <= 0 || cv.width === 0) resize();      // 隐藏期间尺寸可能归零
      if (W <= 0 || H <= 0) return;
      if (trans && performance.now() - trans.t0 >= 900) { phaseT = trans.to; trans = null; skyKey = null; }
      try { step(16); draw(); } catch (e) {}
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
      else revive();
    });
    addEventListener('focus', revive);
    addEventListener('pageshow', revive);
  }
})();
