/* ============================================================
 * compose.js —— 首页「自定义阵营人数」
 *
 * 只负责收集配置并调用 game.js 暴露的 setCustomComposition()，
 * 不参与任何对局逻辑。校验规则来自 game.js 的真实实现：
 *   · 预言家 / 女巫 用 find() 取第一个行动 → 最多各 1 名，多了也轮不到
 *   · 猎人是逐人判定 → 可以配多名
 *   · 狼人数 >= 好人数 时 game.js 直接判狼人胜利 → 开局即结束，必须拦住
 * ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* max=null 表示不设上限（由总人数兜底） */
  const ROLE_DEFS = [
    { key: 'wolf',     name: '狼人',   camp: 'wolf', min: 1, max: null, note: '' },
    { key: 'seer',     name: '预言家', camp: 'good', min: 0, max: 1,    note: '每晚仅一人行动' },
    { key: 'witch',    name: '女巫',   camp: 'good', min: 0, max: 1,    note: '每晚仅一人行动' },
    { key: 'hunter',   name: '猎人',   camp: 'good', min: 0, max: null, note: '' },
    { key: 'villager', name: '村民',   camp: 'good', min: 0, max: null, note: '' },
  ];

  const editor = $('compEditor');
  const toggle = $('compToggle');
  const rowsWrap = editor?.querySelector('.comp-rows');
  const tally = $('compTally');
  const warn = $('compWarn');
  const reset = $('compReset');
  const countSel = $('countSel');
  const mpCountSel = $('mpCountSel');
  const lobby = $('lobby');
  if (!editor || !toggle || !rowsWrap || !countSel) return;

  /* 同一个编辑器服务两块菜单：大厅里以 #mpCountSel 为准，否则看首页 */
  function activeCountSel() {
    return (mpCountSel && lobby && !lobby.classList.contains('hidden')) ? mpCountSel : countSel;
  }

  /* 当前配置：{wolf:3, seer:1, ...} */
  let counts = null;
  let custom = false;          // 用户是否已经手动调过

  const total = () => ROLE_DEFS.reduce((s, d) => s + (counts[d.key] || 0), 0);
  const campCount = (camp) =>
    ROLE_DEFS.filter((d) => d.camp === camp).reduce((s, d) => s + (counts[d.key] || 0), 0);

  /* 从 game.js 的默认表推导初值（不复制一份表，避免两处走样） */
  function defaultsFor(n) {
    const comp = (typeof COMPOSITIONS !== 'undefined' && COMPOSITIONS[n]) || [];
    const c = {};
    ROLE_DEFS.forEach((d) => (c[d.key] = 0));
    comp.forEach((r) => (c[r] = (c[r] || 0) + 1));
    return c;
  }

  function seatCount() { return parseInt(activeCountSel().value, 10) || 8; }

  /* 校验：返回错误文案，null 表示通过 */
  function validate() {
    const n = seatCount();
    const t = total();
    if (t !== n) return `已配 ${t} 人，需要正好 ${n} 人`;
    if (counts.wolf < 1) return '至少要有 1 名狼人';
    const good = campCount('good');
    if (good < 1) return '至少要有 1 名好人';
    if (counts.wolf >= good) return `狼人（${counts.wolf}）不能多于或等于好人（${good}），否则开局即判狼人胜利`;
    return null;
  }

  /* 把 counts 展开成 game.js 需要的角色数组 */
  function toArray() {
    const arr = [];
    ROLE_DEFS.forEach((d) => { for (let i = 0; i < counts[d.key]; i++) arr.push(d.key); });
    return arr;
  }

  /* 应用到游戏：只有配置合法且用户确实改过时才覆盖默认表 */
  function apply() {
    const err = validate();
    const ok = !err;
    if (typeof setCustomComposition === 'function') {
      setCustomComposition(ok && custom ? toArray() : null);
    }
    // 让 game.js 自己重画上方的角色徽章，保证预览与实际发牌同源
    if (typeof showRolePreview === 'function') showRolePreview(seatCount());

    warn.textContent = err || '';
    warn.hidden = !err;
    const n = seatCount();
    tally.innerHTML = `已配 <b>${total()}</b> / ${n} 人 · 狼 ${counts.wolf} · 好人 ${campCount('good')}`;
    tally.classList.toggle('is-bad', !ok);

    /* 配置非法时禁用开局，避免开出一局立刻结束的牌 */
    $('startBtn').disabled = !ok;
    // 联机开局键的开关权在 game.js（还要看人数与准备状态），这里只留个否决标记
    const mpStart = $('mpStartBtn');
    if (mpStart) {
      mpStart.dataset.compBad = ok ? '' : '1';
      if (!ok) mpStart.disabled = true;
      else if (typeof updateLobbyControls === 'function') updateLobbyControls();
    }
    render();
  }

  function step(key, delta) {
    const d = ROLE_DEFS.find((x) => x.key === key);
    const next = (counts[key] || 0) + delta;
    if (next < d.min) return;
    if (d.max != null && next > d.max) return;
    if (next > seatCount()) return;
    counts[key] = next;
    custom = true;
    apply();
  }

  function render() {
    const n = seatCount();
    rowsWrap.innerHTML = '';
    for (const d of ROLE_DEFS) {
      const v = counts[d.key] || 0;
      const row = document.createElement('div');
      row.className = 'comp-row';
      row.dataset.role = d.key;
      row.innerHTML =
        `<svg class="sigil" viewBox="0 0 32 32" aria-hidden="true"><use href="#sig-${d.key}"/></svg>
         <span class="comp-name">${d.name}${d.note ? `<i class="comp-note">${d.note}</i>` : ''}</span>
         <span class="comp-stepper">
           <button type="button" class="comp-btn" data-act="dec" aria-label="减少${d.name}">−</button>
           <output class="comp-num">${v}</output>
           <button type="button" class="comp-btn" data-act="inc" aria-label="增加${d.name}">＋</button>
         </span>`;
      const [dec, inc] = row.querySelectorAll('.comp-btn');
      dec.disabled = v <= d.min;
      inc.disabled = (d.max != null && v >= d.max) || v >= n;
      dec.onclick = () => step(d.key, -1);
      inc.onclick = () => step(d.key, +1);
      rowsWrap.appendChild(row);
    }
  }

  function resetToDefault() {
    counts = defaultsFor(seatCount());
    custom = false;
    apply();
  }

  /* 人数变化时：未自定义就跟随默认；已自定义则保留但重新校验 */
  const onSeatChange = () => {
    if (!custom) resetToDefault();
    else apply();
  };
  countSel.addEventListener('change', onSeatChange);
  mpCountSel?.addEventListener('change', onSeatChange);
  /* 首页 ↔ 大厅切换时人数基准换了一个 select，要按新基准重新校验 */
  if (lobby) new MutationObserver(onSeatChange).observe(lobby, { attributes: true, attributeFilter: ['class'] });

  toggle.addEventListener('click', () => {
    const open = editor.hasAttribute('hidden');
    editor.toggleAttribute('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '收起自定义' : '自定义阵营人数';
  });

  reset.addEventListener('click', resetToDefault);

  resetToDefault();
})();
