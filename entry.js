/* ============================================================
 * entry.js · 开局清单（单机邀请页 #invitation / 联机大厅 #lobbyEntry）
 *
 * 纯表现层：把 game.js / compose.js 已有的控件搬进「封面同款」的
 * 大写清单里，读它们的 DOM 渲染右侧摘要，自己不保存任何游戏状态。
 *   · 选中行 = 白色笔触（和 .game-menu-item 同一套语言）
 *   · 点一行 = 展开抽屉，真正的输入框 / 步进器在抽屉里
 *   · 昵称与角色配置只有一份 DOM，在两块菜单之间搬家（id 绑定不变）
 * ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const invitation = $('invitation');
  const lobby = $('lobby');
  const lobbyEntry = $('lobbyEntry');
  const menus = [$('soloMenu'), $('mpMenu')].filter(Boolean);
  if (!invitation || !lobbyEntry || !menus.length) return;

  /* ---------- 行的选中态 ---------- */
  const rowsOf = (menu) => [...menu.querySelectorAll('.entry-row')];
  const itemOf = (row) => row.querySelector('.entry-item:not(.hidden)') || row.querySelector('.entry-item');
  const visibleRows = (menu) => rowsOf(menu).filter(r => !r.classList.contains('hidden') && itemOf(r));

  function setActive(row) {
    const menu = row.closest('.entry-menu');
    rowsOf(menu).forEach(r => r.classList.toggle('is-active', r === row));
  }

  /* ---------- 抽屉 ---------- */
  function setOpen(row, open) {
    const drawer = row.querySelector('.entry-drawer');
    const item = itemOf(row);
    if (!drawer) return;
    if (open) {
      // 一次只开一个，免得清单被撑成一堵墙
      rowsOf(row.closest('.entry-menu')).forEach(r => { if (r !== row) setOpen(r, false); });
    }
    drawer.hidden = !open;
    row.classList.toggle('is-open', open);
    item?.setAttribute('aria-expanded', String(open));
    if (open) {
      setActive(row);
      const first = drawer.querySelector('input, .entry-chip:not(:disabled), button');
      if (first && !reduce) setTimeout(() => first.focus({ preventScroll: true }), 40);
    }
  }

  function wire(menu) {
    rowsOf(menu).forEach(row => {
      row.querySelectorAll('.entry-item').forEach(item => {
        item.addEventListener('pointerenter', () => setActive(row));
        item.addEventListener('focus', () => setActive(row));
        item.addEventListener('click', () => {
          setActive(row);
          // 终结项（开局 / 准备）由 game.js 自己的 onclick 处理
          if (row.querySelector('.entry-drawer')) setOpen(row, row.querySelector('.entry-drawer').hidden);
        });
      });
    });
  }
  menus.forEach(wire);

  /* ---------- 键盘：上下选行，Esc 收起抽屉 ---------- */
  function activeMenu() {
    if (!lobby.classList.contains('hidden')) return $('mpMenu');
    return invitation.hidden ? null : $('soloMenu');
  }
  document.addEventListener('keydown', (event) => {
    const menu = activeMenu();
    if (!menu) return;
    if (event.key === 'Escape') {
      const open = menu.querySelector('.entry-row.is-open');
      if (open) { event.preventDefault(); setOpen(open, false); itemOf(open)?.focus(); }
      return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = visibleRows(menu);
    if (!rows.length) return;
    event.preventDefault();
    const here = rows.findIndex(r => r.classList.contains('is-active'));
    const next = rows[((here < 0 ? 0 : here + (event.key === 'ArrowDown' ? 1 : -1)) + rows.length) % rows.length];
    setActive(next);
    itemOf(next)?.focus();
  });

  /* ---------- 共享控件搬家（昵称 / 角色配置） ---------- */
  function adopt(screen) {
    screen.querySelectorAll('.entry-slot').forEach(slot => {
      const part = document.querySelector(`.entry-part[data-part="${slot.dataset.slot}"]`);
      if (part && part.parentElement !== slot) slot.appendChild(part);
    });
  }

  /* ---------- 人数：把 <select> 的选项摊成一排筹码 ---------- */
  const chipBoxes = [...document.querySelectorAll('.entry-chips')];
  function buildChips(box) {
    const sel = $(box.dataset.chips);
    if (!sel) return;
    box.replaceChildren(...[...sel.options].map(opt => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'entry-chip';
      b.dataset.value = opt.value;
      b.textContent = opt.value;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change'));   // game.js / compose.js 的既有监听
        refresh();
      });
      return b;
    }));
  }
  function syncChips(box) {
    const sel = $(box.dataset.chips);
    if (!sel) return;
    [...box.children].forEach(b => {
      const opt = [...sel.options].find(o => o.value === b.dataset.value);
      b.disabled = !!(opt && opt.disabled);
      b.classList.toggle('is-on', sel.value === b.dataset.value);
      b.setAttribute('aria-pressed', String(sel.value === b.dataset.value));
    });
  }
  chipBoxes.forEach(buildChips);
  menus.forEach(m => m.classList.add('entry-ready'));

  /* ---------- 右侧摘要 ---------- */
  function seatText(sel) { return sel ? `${parseInt(sel.value, 10) || 8} 人` : '—'; }
  function roleText() {
    const rows = [...document.querySelectorAll('#compEditor .comp-row')];
    if (!rows.length) return '—';
    let wolf = 0, good = 0;
    rows.forEach(r => {
      const n = parseInt(r.querySelector('.comp-num')?.textContent, 10) || 0;
      if (r.dataset.role === 'wolf') wolf += n; else good += n;
    });
    return `狼 ${wolf} · 好人 ${good}`;
  }
  function setVal(key, text) {
    document.querySelectorAll(`.entry-val[data-val="${key}"]`).forEach(el => { el.textContent = text; });
  }
  function refresh() {
    const inLobby = !lobby.classList.contains('hidden');
    setVal('name', $('nameInp')?.value.trim() || '未署名');
    setVal('count', seatText(inLobby ? $('mpCountSel') : $('countSel')));
    setVal('roles', roleText());
    setVal('code', ($('roomCodeTxt')?.textContent || '').trim() || '——');
    const seats = [...document.querySelectorAll('#mpRoster .roster-row')].length;
    setVal('roster', seats ? `${seats} 人` : '—');
    chipBoxes.forEach(syncChips);
  }

  /* ---------- 屏幕切换：搬家 + 重算摘要 ---------- */
  function syncHome() {
    adopt(lobby.classList.contains('hidden') ? invitation : lobbyEntry);
    refresh();
  }
  new MutationObserver(syncHome).observe(lobby, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(syncHome).observe(invitation, { attributes: true, attributeFilter: ['hidden'] });

  /* game.js / compose.js 改了 DOM 就跟着刷新摘要 */
  const watch = (el, opts) => { if (el) new MutationObserver(refresh).observe(el, opts); };
  watch($('compEditor'), { childList: true, subtree: true, characterData: true });
  watch($('roomCodeTxt'), { childList: true, characterData: true });
  watch($('mpRoster'), { childList: true, subtree: true });
  watch($('mpStatus'), { childList: true, characterData: true });
  ['countSel', 'mpCountSel'].forEach(id => $(id)?.addEventListener('change', refresh));

  /* ---------- 昵称 ---------- */
  const nameInp = $('nameInp');
  nameInp?.addEventListener('input', refresh);
  nameInp?.addEventListener('change', () => {
    // 大厅里改名要同步给房间；单机时 game.js 自己会忽略
    if (typeof setNickname === 'function') setNickname(nameInp.value);
  });

  /* ---------- 房间号：复制 ---------- */
  $('codeCopy')?.addEventListener('click', async (event) => {
    const code = ($('roomCodeTxt')?.textContent || '').trim();
    if (!code) return;
    const button = event.currentTarget;
    try { await navigator.clipboard.writeText(code); button.textContent = '已复制 ✓'; }
    catch (_) { button.textContent = '请手动复制'; }
    setTimeout(() => { button.textContent = '复制房间号'; }, 1600);
  });

  /* ---------- 返回主菜单 ---------- */
  document.querySelector('[data-back="setup"]')?.addEventListener('click', () => {
    invitation.hidden = true;
    window.scrollTo({ top: 0, behavior: reduce ? 'instant' : 'smooth' });
  });

  syncHome();
})();
