/* ============================================================
 * ai.js · AI 接入层（经典脚本，和 net.js 同级）
 *
 * 只做三件事，不碰任何游戏状态：
 *   1. 探测同源的 /api/ai（npm start 起的本地服务），可用状态写到 window.wwAI
 *   2. wwAI.decide(task, view)：把某个 AI 座位的视角发给服务端，拿回它的决定
 *      —— 局面由 game.js 组装，拿回的决定也由 game.js 再按规则校验
 *   3. 开局清单里 BRAIN 抽屉的内容（状态文字 + 开关），它在单机 / 大厅之间搬家
 *
 * 直接双击 index.html（file://）或服务端没配好 Key 时：wwAI.online = false，
 * game.js 自动用经典规则 AI，游戏照常可玩。
 * ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KEY = 'midnight.ai';
  const served = location.protocol === 'http:' || location.protocol === 'https:';
  const FAIL_LIMIT = 3;       // 连续这么多次上游失败（超时 / 断网 / 5xx）就认为暂时掉线
  const COOLDOWN_MS = 30000;  // 掉线后先用规则 AI 顶这么久，再试着重连
  const MAX_INFLIGHT = 4;     // 同时最多几个请求：十一个 AI 同时投票也别把 API 限流打满

  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { prefs = {}; }
  function savePrefs() {
    try { localStorage.setItem(KEY, JSON.stringify({ enabled: AI.enabled, reveal: AI.reveal })); } catch (_) { /* 隐私模式等 */ }
  }

  let probing = null;
  const AI = {
    online: false,
    checking: false,
    model: '',
    mock: false,
    reason: served ? '' : '当前是直接打开的 index.html，连不上 AI 服务',
    enabled: prefs.enabled !== false,   // 玩家的开关：接入 AI / 经典规则
    reveal: prefs.reveal === true,      // 旁观心声（仅单机）
    failStreak: 0,
    pausedUntil: 0,
    get active() { return this.online && this.enabled && Date.now() >= this.pausedUntil; },
    whenReady() { return probing || Promise.resolve(); },
    probe,
    decide,
  };
  window.wwAI = AI;

  async function probe() {
    if (!served) { render(); return; }
    AI.checking = true;
    render();
    probing = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch('api/ai/status', { cache: 'no-store', signal: ctl.signal });
        const j = res.ok ? await res.json() : null;
        if (!j || !j.ok) throw new Error(res.status === 404 ? 'no-server' : 'bad-status');
        AI.online = !!j.ready;
        AI.model = j.model || '';
        AI.mock = !!j.mock;
        AI.reason = j.ready ? '' : (j.reason || '服务端未就绪');
      } catch (err) {
        AI.online = false;
        AI.reason = err && err.message === 'no-server'
          ? '这个页面不是由 npm start 的游戏服务打开的'
          : '连不上 AI 服务';
      } finally {
        clearTimeout(timer);
        AI.checking = false;
        AI.failStreak = 0;
        AI.pausedUntil = 0;
        render();
      }
    })();
    return probing;
  }

  /* 简单的并发闸门 */
  let inflight = 0;
  const queue = [];
  const acquire = () => (inflight < MAX_INFLIGHT
    ? (inflight++, Promise.resolve())
    : new Promise((resolve) => queue.push(resolve)));
  const release = () => { const next = queue.shift(); if (next) next(); else inflight--; };

  /* 返回 {thought, notes, ...决定}；任何失败都返回 null，由调用方退回规则 AI */
  async function decide(task, view, { timeoutMs = 60000 } = {}) {
    if (!AI.active) return null;
    await acquire();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      if (!AI.active) return null;   // 排队期间可能已经判定掉线
      const res = await fetch('api/ai/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, view }),
        signal: ctl.signal,
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok && j.decision) {
        AI.failStreak = 0;
        return j.decision;
      }
      // 422：模型答了但答得不合规——服务没问题，只是这一次退回规则 AI
      if (res.status === 422) { console.warn(`[ai] ${task}：${(j && j.error) || '决定不合规'}`); return null; }
      throw new Error((j && j.error) || `HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[ai] ${task} 思考失败：`, err && err.message);
      if (++AI.failStreak >= FAIL_LIMIT) {
        AI.pausedUntil = Date.now() + COOLDOWN_MS;
        AI.reason = `连续 ${AI.failStreak} 次思考失败（${(err && err.message) || '网络错误'}），${COOLDOWN_MS / 1000} 秒后重试`;
        render();
        setTimeout(render, COOLDOWN_MS + 50);
      }
      return null;
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  /* ---------- BRAIN 抽屉 ---------- */
  const paused = () => AI.online && Date.now() < AI.pausedUntil;

  function summary() {
    if (AI.checking) return '连接中…';
    if (!AI.online) return '经典规则';
    if (paused()) return '重连中…';
    if (!AI.enabled) return '经典规则';
    return AI.mock ? '模拟大脑' : 'CLAUDE';
  }

  function render() {
    document.querySelectorAll('.entry-val[data-val="brain"]').forEach((el) => { el.textContent = summary(); });
    const status = $('aiStatus');
    if (status) {
      if (AI.checking) {
        status.textContent = '正在寻找 AI 服务…';
      } else if (paused()) {
        status.textContent = `AI 暂时失联：${AI.reason}。这段时间 AI 座位先用经典规则。`;
      } else if (AI.online) {
        status.textContent = AI.mock
          ? '已接入离线模拟大脑（不调用 API，只用来调试流程）。'
          : `已接入 ${AI.model}。AI 玩家会读公开记录、记私人笔记、自己推理，再决定怎么发言、投票和夜里行动。`;
      } else {
        status.textContent = `AI 暂不可用：${AI.reason}。AI 座位会使用经典规则。` +
          (served ? '' : '在项目目录运行 npm start，然后打开 http://localhost:8787 即可接入。');
      }
    }
    document.querySelectorAll('[data-ai-mode]').forEach((b) => {
      const on = b.dataset.aiMode === 'on';
      const pressed = on ? AI.active : !AI.active;
      b.classList.toggle('is-on', pressed);
      b.setAttribute('aria-pressed', String(pressed));
      if (on) b.disabled = !AI.online;
    });
    const retry = $('aiRetry');
    if (retry) retry.hidden = !served || AI.online || AI.checking;
    const reveal = $('aiReveal');
    if (reveal) {
      reveal.checked = AI.reveal;
      reveal.disabled = !AI.active;
    }
  }

  document.querySelectorAll('[data-ai-mode]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      AI.enabled = b.dataset.aiMode === 'on';
      savePrefs();
      render();
    });
  });
  $('aiReveal')?.addEventListener('change', (e) => {
    AI.reveal = !!e.target.checked;
    savePrefs();
    render();
  });
  $('aiRetry')?.addEventListener('click', () => probe());

  probe();
})();
