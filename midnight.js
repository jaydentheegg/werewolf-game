/* Presentation only: consume the visible private view, never the host's game state. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const setup = $('setup'), game = $('game'), overlay = $('overlay');
  const invitation = $('invitation');
  const hero = document.querySelector('.midnight-hero');
  const menuItems = [...document.querySelectorAll('.game-menu-item')];
  const menuPanel = $('menuPanel');
  let menuIndex = 0;

  function reveal(mode, instant) {
    invitation.hidden = false;
    invitation.dataset.entry = mode;
    invitation.scrollIntoView({ behavior: (reduce || instant) ? 'instant' : 'smooth', block: 'start' });
    invitation.querySelector('.entry-item')?.focus({ preventScroll: true });
  }

  // MULTIPLAYER skips the solo list: the room (and its code) is the lobby.
  function land(mode, instant) {
    if (mode === 'multi' && typeof enterMultiplayer === 'function') { enterMultiplayer(); return; }
    reveal('solo', instant);
  }

  // The menu burns the page away and the next screen is what is left behind it.
  function enter(mode = 'solo', origin) {
    if (reduce || !window.MidnightBurn || window.MidnightBurn.busy) { land(mode, false); return; }
    window.MidnightBurn.play({
      x: origin && origin.x, y: origin && origin.y,
      cover: () => land(mode, true),
    });
  }
  $('castEnter').addEventListener('click', e => enter('solo', pointOf(e)));

  // Burn from wherever the player actually clicked, falling back to the
  // element's own centre for keyboard activation.
  function pointOf(event) {
    if (event && event.clientX) return { x: event.clientX, y: event.clientY };
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    if (!rect) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function focusMenu(index, moveFocus = false) {
    menuIndex = (index + menuItems.length) % menuItems.length;
    menuItems.forEach((item, i) => item.classList.toggle('is-active', i === menuIndex));
    const active = menuItems[menuIndex];
    if (moveFocus) active.focus();
    window.MidnightMotion?.menuFocus(menuItems, active);
  }

  function closeMenuPanel() {
    if (menuPanel.hidden) return;
    if (reduce || !window.MidnightMotion?.menuPanel(menuPanel, false)) {
      menuPanel.hidden = true;
    } else {
      setTimeout(() => { menuPanel.hidden = true; }, 250);
    }
    menuItems[menuIndex]?.focus({ preventScroll: true });
  }

  function openMenuPanel(kind) {
    const title = $('menuPanelTitle'), body = $('menuPanelBody');
    if (kind === 'how') {
      title.textContent = 'HOW TO PLAY';
      body.innerHTML = '<p>夜晚，特殊身份秘密行动；白天，所有幸存者轮流发言并投票放逐一人。</p><p>好人需要找出全部狼人；狼人需要隐藏身份，直到人数足以控制村庄。</p><p class="menu-panel-note">身份信息只显示给本人。不要把你的屏幕给别人看。</p>';
    } else if (kind === 'settings') {
      title.textContent = 'SETTINGS';
      const soundOn = $('soundToggle').getAttribute('aria-pressed') === 'true';
      body.innerHTML = `<button id="menuSoundControl" class="panel-choice" type="button">SOUND <span>${soundOn ? 'ON' : 'OFF'}</span></button><p>动画会自动尊重系统的“减少动态效果”设置。</p>`;
      $('menuSoundControl').addEventListener('click', () => {
        $('soundToggle').click();
        setTimeout(() => { $('menuSoundControl').querySelector('span').textContent = $('soundToggle').getAttribute('aria-pressed') === 'true' ? 'ON' : 'OFF'; }, 120);
      });
    } else {
      title.textContent = 'CREDITS';
      body.innerHTML = '<p>Concept & Direction — Jayden</p><p>Game Systems & Interface — Jayden × Codex</p><p>Original character artwork and village illustration were created specifically for MIDNIGHT.</p>';
    }
    menuPanel.hidden = false;
    window.MidnightMotion?.menuPanel(menuPanel, true);
    $('menuPanelClose').focus({ preventScroll: true });
  }

  menuItems.forEach((item, index) => {
    item.addEventListener('pointerenter', () => focusMenu(index));
    item.addEventListener('focus', () => focusMenu(index));
    item.addEventListener('click', event => {
      const action = item.dataset.menuAction;
      if (action === 'new' || action === 'multi') enter(action, pointOf(event));
      else openMenuPanel(action);
    });
  });
  $('menuPanelClose').addEventListener('click', closeMenuPanel);
  document.addEventListener('keydown', event => {
    if (setup.classList.contains('hidden')) return;
    if (!menuPanel.hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeMenuPanel(); }
      return;
    }
    if (!invitation.hidden) return;   // 邀请页自己接管上下键（entry.js）
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); focusMenu(menuIndex + 1, true); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusMenu(menuIndex - 1, true); }
    else if (event.key === 'Enter' && document.activeElement?.classList.contains('game-menu-item')) { event.preventDefault(); document.activeElement.click(); }
  });
  requestAnimationFrame(() => {
    focusMenu(0);
    window.MidnightMotion?.menuIntro(hero);
  });

  const castCards = [...document.querySelectorAll('.cast-card')];
  castCards.forEach(card => {
    const enlarge = () => window.MidnightMotion?.castHover(castCards, card, true);
    const restore = () => window.MidnightMotion?.castHover(castCards, card, false);
    card.tabIndex = 0;
    card.addEventListener('pointerenter', enlarge);
    card.addEventListener('pointerleave', restore);
    card.addEventListener('focus', enlarge);
    card.addEventListener('blur', restore);
  });

  document.querySelector('.midnight-brand').addEventListener('click', e => {
    // Do not navigate away from a running multiplayer match.
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: reduce ? 'instant' : 'smooth' });
  });

  if (!reduce && matchMedia('(pointer: fine)').matches) {
    let frame = 0, x = 0, y = 0;
    hero.addEventListener('pointermove', e => {
      const rect = hero.getBoundingClientRect();
      x = ((e.clientX - rect.left) / rect.width - .5) * 12;
      y = ((e.clientY - rect.top) / rect.height - .5) * 8;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        hero.style.setProperty('--hero-x', `${x}px`);
        hero.style.setProperty('--hero-y', `${y}px`);
        frame = 0;
      });
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      x = y = 0;
      hero.style.setProperty('--hero-x', '0px');
      hero.style.setProperty('--hero-y', '0px');
    });
  }

  // Sound is generated locally, opt-in and never needed to understand a turn.
  let audio = null, soundOn = false;
  function tone(freq = 174, duration = .35) {
    if (!soundOn || !audio || document.hidden || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(0, audio.currentTime);
    gain.gain.linearRampToValueAtTime(.035, audio.currentTime + .025);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  $('soundToggle').addEventListener('click', async () => {
    const button = $('soundToggle');
    try {
      if (!audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error('No audio support');
        audio = new Audio();
      }
      soundOn = !soundOn;
      if (soundOn) await audio.resume(); else await audio.suspend();
      button.setAttribute('aria-pressed', String(soundOn));
      button.setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效');
      button.textContent = soundOn ? '声音 ON' : '声音 OFF';
      tone(261.63);
    } catch (_) {
      soundOn = false;
      button.textContent = '声音不可用';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', '当前浏览器声音不可用');
    }
  });

  let currentScreen = '', chapterPhase = '';
  function syncScreen() {
    const screen = !game.classList.contains('hidden') ? 'game' : !setup.classList.contains('hidden') ? 'setup' : 'lobby';
    if (currentScreen === screen) return;
    currentScreen = screen;
    document.body.dataset.screen = screen;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (screen === 'setup') {
      invitation.hidden = true;
      chapterPhase = '';
    }
  }
  [setup, game, $('lobby')].forEach(el => new MutationObserver(syncScreen).observe(el, { attributes: true, attributeFilter: ['class'] }));
  syncScreen();

  function chapter() {
    const phase = document.documentElement.dataset.phase || 'night';
    const day = phase === 'day';
    const round = $('stRound').textContent.trim();
    $('chapterEyebrow').textContent = `${day ? 'THE TESTIMONIES' : 'THE SECRETS'} / ${round}`;
    $('chapterTitle').textContent = day ? '天亮了。谁在说谎？' : '夜色有耳。';
    $('chapterNote').textContent = day ? '每一句证词，都有分量。\n把你的一票，交给真相。' : '请保守你的秘密。\n黎明之前，故事尚未写完。';
    if (phase !== chapterPhase && currentScreen === 'game') tone(day ? 349.23 : 146.83, .7);
    chapterPhase = phase;
  }
  new MutationObserver(chapter).observe(document.documentElement, { attributes: true, attributeFilter: ['data-phase'] });
  new MutationObserver(chapter).observe($('stRound'), { childList: true });
  chapter();

  // On a phone a twelve-seat table is taller than the viewport. Bring a new
  // action into view once, without changing focus or reflowing the table.
  new MutationObserver(() => {
    if (currentScreen !== 'game' || !matchMedia('(max-width: 700px)').matches) return;
    const action = $('action');
    if (!action.querySelector('button, input')) return;
    const rect = action.getBoundingClientRect();
    if (rect.top > innerHeight - 100 || rect.bottom < 80) {
      action.scrollIntoView({ block: 'center', behavior: reduce ? 'instant' : 'smooth' });
    }
  }).observe($('action'), { childList: true });

  // A short chime when the result overlay opens.
  let resultVisible = false;
  new MutationObserver(() => {
    const visible = !overlay.classList.contains('hidden');
    if (visible === resultVisible) return;
    resultVisible = visible;
    if (visible) tone(392, .8);
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
})();
