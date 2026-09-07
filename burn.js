/* ============================================================
 * burn.js · 纸张燃烧转场
 *
 * A sheet of dark paper covers the screen, then burns away from a
 * seed point: a white-hot front eats outward along a noise-warped
 * edge, leaving a scorched rim and drifting sparks behind it.
 *
 * Presentation only. Never reads or mutates game state — the caller
 * swaps the page underneath on the `cover` callback and the burn
 * simply uncovers whatever is now there.
 * ============================================================ */
(() => {
  'use strict';

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const FW = 200, FH = 120;   // burn-field resolution, stretched to the viewport
  const COVER_MS = 260;       // paper draws over the screen
  const BURN_MS = 1250;       // paper burns away
  const EMBER = 0.045;        // width of the glowing front
  const CHAR = 0.17;          // width of the scorch behind it
  const PAPER = [26, 22, 19]; // the sheet itself: near-black, faintly warm

  let layer = null, canvas = null, ctx = null;
  let paperCv = null, paperCtx = null, paperImg = null;
  let emberCv = null, emberCtx = null, emberImg = null;
  let grain = null, running = false;

  /* ---------- value noise, so the burn front is ragged not circular ---------- */
  function hash(x, y) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y) {
    let sum = 0, amp = 0.5, f = 1;
    for (let i = 0; i < 4; i++) { sum += noise(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
    return sum;
  }

  function build() {
    if (layer) return;
    layer = document.createElement('div');
    layer.className = 'burn-layer';
    layer.setAttribute('aria-hidden', 'true');
    canvas = document.createElement('canvas');
    layer.appendChild(canvas);
    document.body.appendChild(layer);
    ctx = canvas.getContext('2d');

    paperCv = document.createElement('canvas'); paperCv.width = FW; paperCv.height = FH;
    paperCtx = paperCv.getContext('2d');
    paperImg = paperCtx.createImageData(FW, FH);

    emberCv = document.createElement('canvas'); emberCv.width = FW; emberCv.height = FH;
    emberCtx = emberCv.getContext('2d');
    emberImg = emberCtx.createImageData(FW, FH);

    // Paper grain is fixed for the life of the page; recomputing it per frame
    // would cost more than the burn itself.
    grain = new Int8Array(FW * FH);
    for (let i = 0; i < grain.length; i++) {
      grain[i] = (fbm((i % FW) / 2.5, Math.floor(i / FW) / 2.5) - 0.5) * 22;
    }
  }

  /* Distance from the seed, with noise *scaling* that distance rather than
   * being added to it. Added noise would let patches far from the click fall
   * under the threshold first and the sheet would burn in scattered holes;
   * scaling keeps the value 0 at the seed, so the front stays a single
   * connected edge that is merely ragged. Y is divided by the viewport aspect
   * so the front is round on screen rather than round in field space. */
  function buildField(ox, oy, aspect) {
    const data = new Float32Array(FW * FH);
    let max = 0;
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const dx = x / FW - ox;
        const dy = (y / FH - oy) / aspect;
        const warp = 0.72 + fbm(x / 13, y / 13) * 0.95 + fbm(x / 4.5, y / 4.5) * 0.22;
        const v = Math.hypot(dx, dy) * warp;
        data[y * FW + x] = v;
        if (v > max) max = v;
      }
    }
    return { data, max };
  }

  function play(options) {
    const opts = options || {};
    const cover = typeof opts.cover === 'function' ? opts.cover : () => {};
    const done = typeof opts.done === 'function' ? opts.done : () => {};

    if (reduce || !document.body) { cover(); done(); return; }
    if (running) { cover(); done(); return; }
    running = true;

    // A zero-sized viewport (a collapsed or hidden window) would give the
    // canvas a 0 dimension and throw on the first draw. Nothing to burn.
    const w = innerWidth, h = innerHeight;
    if (!w || !h) { cover(); done(); running = false; return; }

    build();
    canvas.width = w; canvas.height = h;
    const ox = opts.x != null ? opts.x / w : 0.5;
    const oy = opts.y != null ? opts.y / h : 0.5;
    const field = buildField(ox, oy, w / h);

    const start = -0.02;   // the field is 0 at the seed, so this is just shy of it
    const end = field.max + CHAR;

    const sparks = [];
    const pd = paperImg.data, ed = emberImg.data, fd = field.data;

    layer.classList.add('is-on');
    layer.style.opacity = '0';

    let covered = false;
    const began = performance.now();

    function frame(now) {
      const elapsed = now - began;

      if (elapsed < COVER_MS) {
        // Fade the sheet over the screen. Both pages behind it are near-black,
        // so this reads as the page itself catching rather than a flash.
        layer.style.opacity = String(elapsed / COVER_MS);
        drawField(start, 0);
        requestAnimationFrame(frame);
        return;
      }

      if (!covered) {
        covered = true;
        layer.style.opacity = '1';
        cover();
      }

      const p = Math.min(1, (elapsed - COVER_MS) / BURN_MS);
      const t = start + (end - start) * (p * p * (3 - 2 * p));
      drawField(t, p);

      if (p >= 1) {
        layer.classList.remove('is-on');
        layer.style.opacity = '0';
        ctx.clearRect(0, 0, w, h);
        running = false;
        done();
        return;
      }
      requestAnimationFrame(frame);
    }

    function drawField(t, progress) {
      for (let i = 0; i < fd.length; i++) {
        const o = i * 4;
        const edge = fd[i] - t;
        if (edge < 0) {                       // burnt through
          pd[o + 3] = 0; ed[o + 3] = 0;
        } else if (edge < EMBER) {            // the hot front
          const k = edge / EMBER;
          pd[o] = 255; pd[o + 1] = 232 - 170 * k; pd[o + 2] = 172 - 158 * k; pd[o + 3] = 255;
          ed[o] = 255; ed[o + 1] = 186 - 116 * k; ed[o + 2] = 92 - 78 * k; ed[o + 3] = 255 * (1 - k);
        } else if (edge < CHAR) {             // scorch fading back into the sheet
          const k = (edge - EMBER) / (CHAR - EMBER);
          const g = grain[i];
          pd[o] = 46 + (PAPER[0] - 46) * k + g;
          pd[o + 1] = 26 + (PAPER[1] - 26) * k + g;
          pd[o + 2] = 16 + (PAPER[2] - 16) * k + g;
          pd[o + 3] = 255; ed[o + 3] = 0;
        } else {                              // untouched paper
          const g = grain[i];
          pd[o] = PAPER[0] + g; pd[o + 1] = PAPER[1] + g; pd[o + 2] = PAPER[2] + g;
          pd[o + 3] = 255; ed[o + 3] = 0;
        }
      }
      paperCtx.putImageData(paperImg, 0, 0);
      emberCtx.putImageData(emberImg, 0, 0);

      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(paperCv, 0, 0, w, h);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = 'blur(' + Math.max(6, Math.round(w / 70)) + 'px)';
      ctx.drawImage(emberCv, 0, 0, w, h);
      ctx.filter = 'none';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(emberCv, 0, 0, w, h);
      ctx.restore();

      if (progress > 0 && progress < 0.96) spawnSparks(t, w, h);
      drawSparks(w, h);
    }

    function spawnSparks(t, w, h) {
      // Sample the field for pixels sitting on the front and lift embers off them.
      for (let tries = 0; tries < 26 && sparks.length < 90; tries++) {
        const i = (Math.random() * fd.length) | 0;
        const edge = fd[i] - t;
        if (edge < 0 || edge > EMBER) continue;
        if (Math.random() > 0.22) continue;
        sparks.push({
          x: (i % FW) / FW * w,
          y: ((i / FW) | 0) / FH * h,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -0.35 - Math.random() * 0.9,
          life: 1,
          decay: 0.008 + Math.random() * 0.014,
          size: 0.7 + Math.random() * 1.6,
        });
      }
    }

    function drawSparks(w, h) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx; s.y += s.vy;
        s.vy -= 0.006;                 // embers keep rising as they cool
        s.vx += (Math.random() - 0.5) * 0.08;
        s.life -= s.decay;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = s.life > 0.55 ? '#ffd9a0' : '#ff8a3c';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  window.MidnightBurn = { play, get busy() { return running; } };
})();
