/* ============================================================
 * 网页狼人杀 · 单机 + 真人联机版
 * 规则：狼人 / 预言家 / 女巫 / 猎人 / 村民
 *
 * 架构：
 *  - 单机：本页即 0 号位玩家，其余座位为 AI。
 *  - 联机：房主页面 = 权威状态机（跑完整局），其他真人通过
 *    Trystero P2P（同一房间号）接入；身份/夜间行动/查验结果
 *    只定向发给本人；公开事件（发言/投票/死亡）广播给所有人。
 *  - AI 座位：服务端可用（npm start）时接入 Claude，每个 AI 带着
 *    性格、私人笔记和只属于它的信息自己推理；否则用经典规则 AI。
 *    不管哪种，决定都在这里按规则再校验一遍——本文件仍是唯一的规则权威。
 * ============================================================ */

'use strict';

/* ---------- 基础工具 ---------- */
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 角色定义 ---------- */
const ROLES = {
  wolf:     { name: '狼人',   camp: 'wolf', icon: '🐺', desc: '每晚杀一人' },
  seer:     { name: '预言家', camp: 'good', icon: '🔮', desc: '每晚验一人' },
  witch:    { name: '女巫',   camp: 'good', icon: '🧪', desc: '解药+毒药各一次' },
  hunter:   { name: '猎人',   camp: 'good', icon: '🏹', desc: '死时开枪' },
  villager: { name: '村民',   camp: 'good', icon: '👤', desc: '投票推理' },
};

const COMPOSITIONS = {
  6:  ['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager'],
  7:  ['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager'],
  8:  ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager'],
  9:  ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'],
  10: ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager', 'villager'],
  11: ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager', 'villager'],
  12: ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager', 'villager', 'villager'],
};

/* 自定义阵容（首页可调）。为 null 时沿用上面的默认表。
 * 由 compose.js 通过 setCustomComposition() 写入，其余逻辑一律走 compFor()。 */
let CUSTOM_COMP = null;
function compFor(n) {
  return (CUSTOM_COMP && CUSTOM_COMP.length === n) ? CUSTOM_COMP.slice() : COMPOSITIONS[n];
}
function setCustomComposition(arr) { CUSTOM_COMP = (arr && arr.length) ? arr.slice() : null; }

const BOT_NAMES = ['小明', '小红', '阿强', '小美', '大壮', '静香', '老王', '阿豪', '丽丽', '铁柱', '翠花', '二狗', '小芳', '老张', '毛毛', '丫丫'];
/* 接入 AI 时每个 AI 座位抽一种性格，让十一个人说话不是一个腔调 */
const BOT_PERSONAS = [
  '冷静理性，喜欢摆逻辑、算票型',
  '心直口快，怀疑谁就直说',
  '谨慎低调，话不多但句句有分量',
  '爱开玩笑，说话带点调侃',
  '老实憨厚，容易相信别人',
  '强势，喜欢带节奏、指挥大家投票',
  '多疑敏感，谁都不太信',
  '温和圆滑，喜欢打圆场',
  '新手心态，常把心里话说出来',
  '老练沉稳，擅长抓发言漏洞',
  '情绪化，被怀疑时会激烈反驳',
];

/* ---------- 界面引用 ---------- */
const elSetup = $('setup'), elLobby = $('lobby'), elGame = $('game');
const elTable = $('table'), elLog = $('log'), elAction = $('action');
const elBadge = $('phaseBadge'), elStDay = $('stDay'), elStRound = $('stRound'),
      elStAlive = $('stAlive'), elStRole = $('stRole');
const elVeil = $('veil'), elVeilInner = $('veilInner');
const elOverlay = $('overlay');

/* ---------- 屏幕切换 ---------- */
function showScreen(name) {
  elSetup.classList.toggle('hidden', name !== 'setup');
  elLobby.classList.toggle('hidden', name !== 'lobby');
  elGame.classList.toggle('hidden', name !== 'game');
}

/* ---------- 日志 / 遮罩（本地 DOM 操作） ---------- */
function addLog(html, cls = '') {
  const div = document.createElement('div');
  div.className = 'logline ' + cls;
  div.innerHTML = html;
  elLog.appendChild(div);
  $('logBox').scrollTop = $('logBox').scrollHeight;
}
async function logSlow(html, cls = '', ms = 450) { addLog(html, cls); await sleep(ms); }
function logHeader(text) {
  const html = '━━ ' + text + ' ━━';
  addLog(html, 'sys');
  if (mpHost()) broadcast({ kind: 'line', html, cls: 'sys' });
}

function veilShow(text, cls) {
  elVeilInner.textContent = text;
  elVeilInner.className = 'veilInner ' + cls;
  elVeil.classList.remove('hidden');
}
function veilHide() { elVeil.classList.add('hidden'); }
async function veilSync(text, cls = '', ms = 1400) {
  veilShow(text, cls);
  await sleep(ms);
  veilHide();
}
/* 客户端/异步遮罩：短暂显示后自动消失（用序号防止旧定时器提前隐藏） */
let veilGen = 0;
function veilFlash(text, cls = '', ms = 1600) {
  const g = ++veilGen;
  veilShow(text, cls);
  setTimeout(() => { if (g === veilGen) veilHide(); }, ms);
}

/* ============================================================
 * 网络状态（单机 / 联机房主 / 联机客户端）
 * ============================================================ */
const APP_ID = 'jaydenz-ww-harness-v1';
let Net = null;            // {room, send, sendTo, selfId, leave, hostPeerId}
let MODE = 'solo';         // 'solo' | 'host' | 'client'
const HOST_SEAT = 0;
let G = null;              // 仅房主 / 单机持有完整游戏状态
let MY = null;             // 客户端（或本人视角）信息：{seat, roleId, n}

/* ============================================================
 * 通用选择控件（房主本地 & 客户端共用，渲染进 #action）
 * opts: [{label, value, cls?}]，pick 返回选中 value；text 返回字符串
 * ============================================================ */
function widgetPick({ title, hint, opts }) {
  return new Promise((resolve) => {
    const isVote = /投票/.test(title);
    const isDay = (G && G.phase === 'day') || elStDay.textContent.includes('白天');
    elAction.className = 'action' + (isVote ? ' vote-action' : '');
    elGame.dataset.stage = isVote ? 'vote' : (isDay ? 'table' : 'night');
    let html = `<div class="atitle">${title}</div>`;
    if (hint) html += `<div class="hint">${hint}</div>`;
    if (isVote) html += '<div class="ballot-box" aria-hidden="true"><i></i><span>投票箱</span></div>';
    html += '<div class="optgrid" id="optWrap"></div>';
    elAction.innerHTML = html;
    const wrap = $('optWrap');
    opts.forEach((opt) => {
      const b = document.createElement('button');
      b.className = isVote ? 'vote-card' : 'btn ' + (opt.cls || 'ghost');
      if (isVote) {
        b.dataset.playerId = opt.value;
        b.setAttribute('aria-label', `投票给${opt.label}`);
        const source = elTable.querySelector(`.card[data-id="${opt.value}"] .avatar`);
        const portrait = document.createElement('span');
        portrait.className = 'vote-portrait';
        if (source) portrait.innerHTML = source.innerHTML;
        const name = document.createElement('span');
        name.className = 'vote-name';
        name.textContent = opt.label;
        b.append(portrait, name);
      } else {
        b.textContent = opt.label;
      }
      b.onclick = () => {
        if (!isVote) {
          elAction.innerHTML = '';
          elAction.className = 'action';
          resolve(opt.value);
          return;
        }
        if (elAction.classList.contains('vote-locked')) return;
        elAction.classList.add('vote-locked');
        const box = elAction.querySelector('.ballot-box');
        const cardRect = b.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        b.style.setProperty('--vote-x', `${boxRect.left + boxRect.width / 2 - cardRect.left - cardRect.width / 2}px`);
        b.style.setProperty('--vote-y', `${boxRect.top + boxRect.height / 2 - cardRect.top - cardRect.height / 2}px`);
        b.classList.add('casting');
        const finishVote = () => {
          // 动画期间面板可能已被收起（超时 cancel）或换成了新的询问，别把新面板一起清掉
          if (b.isConnected) {
            elAction.className = 'action';
            elAction.innerHTML = '';
            elGame.dataset.stage = 'table';
          }
          resolve(opt.value);
        };
        const animated = window.MidnightMotion?.castVote(b, box, finishVote);
        if (!animated) {
          const voteDelay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 60 : 880;
          setTimeout(finishVote, voteDelay);
        }
      };
      wrap.appendChild(b);
    });
    if (isVote) requestAnimationFrame(() => window.MidnightMotion?.voteTray(elAction));
  });
}
function widgetText({ title, hint, placeholder }) {
  return new Promise((resolve) => {
    elAction.className = 'action speech-action';
    elGame.dataset.stage = 'speech';
    let html = `<div class="atitle">${title}</div>`;
    if (hint) html += `<div class="hint">${hint}</div>`;
    html += `<input type="text" id="chatInput" placeholder="${esc(placeholder || '说点什么…')}" maxlength="60">`;
    html += '<div class="optrow" style="margin-top:10px"><button class="btn primary" id="chatSend">发送</button>' +
            '<button class="btn ghost" id="chatSkip">跳过发言</button></div>';
    elAction.innerHTML = html;
    const inp = $('chatInput');
    const finish = (value) => {
      elAction.innerHTML = '';
      elAction.className = 'action';
      resolve(value);
    };
    const send = () => finish(inp.value.trim());
    $('chatSend').onclick = send;
    $('chatSkip').onclick = () => finish('');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    inp.focus();
  });
}

/* ============================================================
 * 房主 / 单机的输出封装：
 *  - pubLog / pubVeil    公开 → 本地 + 广播给所有客户端
 *  - privTo(seat,...)    私密 → 只发给该座位（本地座位则写本地）
 * ============================================================ */
function mpHost() { return MODE === 'host'; }

function pubLog(html, cls = '') {
  addLog(html, cls);
  if (mpHost()) broadcast({ kind: 'line', html, cls });
}
async function pubLogSlow(html, cls = '', ms = 450) { pubLog(html, cls); await sleep(ms); }

function pubVeil(text, cls = '', ms = 1400) {
  veilShow(text, cls);
  if (mpHost()) broadcast({ kind: 'veil', text, cls });
  return sleep(ms).then(() => { veilHide(); });
}

function privTo(seat, html, cls = '', veil = null) {
  if (seat === HOST_SEAT || MODE === 'solo') {
    addLog(html, cls);
    // 本地遮罩要让调用方 await：不等的话，紧接着的下一张遮罩会在同一帧把它盖掉
    if (veil) return veilSync(veil.text, veil.cls || '', 1800);
  } else {
    const p = G.players[seat];
    if (p && p.peerId && Net) sendTo(p.peerId, { kind: 'line', html, cls });
    if (veil && p && p.peerId && Net) sendTo(p.peerId, { kind: 'veil', text: veil.text, cls: veil.cls || '' });
  }
  return Promise.resolve();
}

/* ============================================================
 * 网络封装（Trystero）
 * ============================================================ */
function trystero() { return window.wwNet || null; }

async function netReadyWait(timeoutMs = 7000) {
  const t0 = Date.now();
  while (!trystero()) {
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(250);
  }
  return true;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[rnd(CODE_CHARS.length)];
  return s;
}

let roomNet = null;   // 本页所在房间的 action 句柄

/* ---------------- 消息收发 ---------------- */
function netJoinRoom(roomId) {
  const { joinRoom } = trystero();
  const room = joinRoom({ appId: APP_ID }, roomId);
  const act = room.makeAction('wmsg');
  roomNet = act;
  return room;
}

/* send 到单个 peer / 广播给房内所有人 */
function sendTo(peerId, msg) { if (roomNet && Net) roomNet.send(msg, { target: peerId }); }
function broadcast(msg) { if (roomNet && Net) roomNet.send(msg); }

/* ---------------- 房间号工具 ---------------- */
function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/* ============================================================
 * 座位 / 行动路由
 * ============================================================ */
const byId = (id) => G.players[id];
function alivePs() { return G.players.filter(p => p.alive); }
function aliveOthers(excludeId) { return G.players.filter(p => p.alive && p.id !== excludeId); }

/* 询问某座位的玩家做出选择（kind: 'pick' 或 'text'）
 * spec: {title, hint, opts?, placeholder?}
 * 本地座位 → 弹本地控件；远端真人 → 发送 ask 并等待 answer */
let askSeq = 0;
const pendingAsks = {};   // askId -> {resolve, timer}
function flushSeatAsks(seat) {
  for (const id of Object.keys(pendingAsks)) {
    if (pendingAsks[id].seat === seat) {
      clearTimeout(pendingAsks[id].timer);
      pendingAsks[id].resolve(null);
      delete pendingAsks[id];
    }
  }
}

function askSeat(kind, seat, spec) {
  const p = G.players[seat];
  // gone = 已掉线：直接跳过，别每轮都空等 120 秒超时
  if (!p || p.isBot || p.gone) return Promise.resolve(null);
  if (!p.peerId || MODE === 'solo') {
    // 本地真人座位（房主自己 / 单机玩家）
    return kind === 'pick'
      ? widgetPick(spec)
      : widgetText(spec);
  }
  // 远端真人
  return new Promise((resolve) => {
    const askId = 'a' + (++askSeq);
    const allowed = kind === 'pick' ? spec.opts.map(o => o.value) : null;
    pendingAsks[askId] = {
      seat,
      peerId: p.peerId,
      // 远端回答不可信：pick 只收给出的选项，text 只收截断后的字符串
      clean: (v) => kind === 'pick'
        ? (allowed.includes(v) ? v : null)
        : (typeof v === 'string' ? v.trim().slice(0, 60) : ''),
      resolve: (v) => { clearTimeout(pendingAsks[askId].timer); delete pendingAsks[askId]; resolve(v); },
      timer: setTimeout(() => {
        // 120 秒没操作 → 自动跳过（记为 null），避免卡局；并让对方收起过期的操作面板
        pendingAsks[askId].resolve(null);
        sendTo(p.peerId, { kind: 'cancel', askId });
        pubLog(`⏰ <b>${esc(p.name)}</b> 长时间未操作，本回合自动跳过。`, 'sys');
      }, 120000),
    };
    sendTo(p.peerId, { kind: 'ask', askId, kind2: kind, spec });
  });
}

/* ============================================================
 * 私有化视图构建（房主为每个座位算一份"能看到的"牌桌）
 * ============================================================ */
function buildCard(p, seatId) {
  const me = G.players[seatId];
  const isMe = p.id === seatId;
  const dead = !p.alive;
  let avatar = ROLES[p.role].icon, meta = '', tags = '';

  if (isMe) {
    meta = `<b>${ROLES[p.role].icon} ${ROLES[p.role].name}</b>`;
    tags = '<span class="tag hint">👑 你</span>';
  } else if (dead) {
    meta = `<b>${ROLES[p.role].icon} ${ROLES[p.role].name}</b>`;
  } else {
    // 活着且不是自己：默认隐藏身份
    avatar = '🙈';
    const meWolfMate = me && me.role === 'wolf' && p.role === 'wolf';
    if (meWolfMate) {
      avatar = ROLES[p.role].icon;
      tags = '<span class="tag wolf">狼队</span>';
    }
  }
  // 预言家视角：只对"本人"显示查验标记
  if (me && me.role === 'seer' && p.seerMark && !isMe && !dead) {
    tags += p.seerMark === 'wolf'
      ? '<span class="tag wolf">🔍 验:狼</span>'
      : '<span class="tag good">🔍 验:好</span>';
  }
  const cls = ['card'];
  if (isMe) cls.push('human');
  if (dead) cls.push('dead');
  return `<div class="${cls.join(' ')}" data-id="${p.id}">
    <div class="avatar">${avatar}</div>
    <div class="nm">${esc(p.name)}</div>
    <div class="meta">${meta}</div>
    ${tags}
  </div>`;
}

/* 构建某个座位的私有视图 */
function buildView(seatId) {
  const alive = alivePs().length;
  const isNight = G.phase === 'night';
  return {
    phase: G.phase,
    night: G.night,
    nightTxt: G.night === 0 ? '尚未入夜' : (isNight ? `第 ${G.night} 夜` : `第 ${G.night} 天`),
    dayTxt: isNight ? '🌙 夜晚' : '☀️ 白天',
    alive,
    players: G.players.map(p => ({ html: buildCard(p, seatId) })),
  };
}

/* 本地牌桌/状态渲染（房主 & 单机） */
function paintHost(speakingId = null) {
  const v = buildView(HOST_SEAT);
  elStDay.textContent = v.dayTxt;
  elStRound.textContent = v.nightTxt;
  elStAlive.textContent = `存活 ${v.alive} 人`;
  elBadge.textContent = v.dayTxt;
  elTable.innerHTML = v.players.map(x => x.html).join('');
  elGame.dataset.stage = speakingId == null ? (G.phase === 'night' ? 'night' : 'table') : 'speech';
  if (speakingId != null) {
    const c = elTable.querySelector(`[data-id="${speakingId}"]`);
    if (c) c.classList.add('playing');
  }
}

/* 联机：向每个客户端推送各自的私有视图（含本地重绘） */
function syncViews() {
  paintHost();
  if (!mpHost()) return;
  for (const p of G.players) {
    if (!p.isBot && p.peerId) {
      const v = buildView(p.id);
      sendTo(p.peerId, { kind: 'view', v });
    }
  }
}

/* ============================================================
 * Bot 行为（只在房主端运行）
 * ============================================================ */
const SPEECH_GOOD = [
  '我昨晚没什么信息，先听大家说。',
  '我是一张平民牌，先不乱投。',
  '我怀疑{x}，发言太奇怪了。',
  '我觉得先别急着投票，再分析分析。',
  '{x} 刚才怎么不说话了？可疑。',
  '反正我是好人，大家别误伤我。',
];
const SPEECH_WOLF = [
  '我是好人！别投我，我怀疑{x}。',
  '大家冷静点，我觉得{x}比较像狼。',
  '我跟个票，先看看谁在带节奏。',
  '别被带偏了，我真的是好人。',
  '{x} 一直在带节奏，我怀疑他。',
];
const SPEECH_SEER = [
  '我有线索，{x} 不太干净。',
  '我是神职，大家听我说。',
];

function botSpeechLine(p) {
  if (p.role === 'wolf') {
    const goodT = aliveOthers(p.id).filter(o => o.role !== 'wolf');
    if (!goodT.length) return '……';
    const t = pick(goodT);
    p.botAccuse = t.id;
    return pick(SPEECH_WOLF).replace('{x}', t.name);
  }
  if (p.role === 'seer' && p.botSeerSuspect != null) {
    const s = G.players.find(o => o.id === p.botSeerSuspect);
    if (s && s.alive) { p.botAccuse = s.id; return pick(SPEECH_SEER).replace('{x}', s.name); }
  }
  const others = aliveOthers(p.id);
  const t = pick(others);
  if (Math.random() < 0.4) p.botAccuse = t.id;
  return pick(SPEECH_GOOD).replace('{x}', t.name);
}

function botVoteTarget(p) {
  const others = aliveOthers(p.id);
  if (!others.length) return null;
  if (p.role === 'wolf') {
    const cands = others.filter(o => o.role !== 'wolf');
    if (cands.length) {
      const acc = cands.find(o => o.id === p.botAccuse);
      return acc || pick(cands);
    }
    return pick(others);
  }
  const acc = G.players.find(o => o.id === p.botAccuse);
  if (acc && acc.alive && acc.id !== p.id) return acc;
  return pick(others);
}

/* ============================================================
 * AI 大脑（Claude，经 ai.js → 服务端）——只在房主 / 单机端运行
 * 每个座位带着：persona 性格、notes 私人笔记（每次决策后由它自己改写）、
 * secrets 只属于它的信息（查验结果、刀口、用药）、minds 心声记录（终局回放用）。
 * 决策时只把「它能看到的」打包成 view：公开记录 G.events + 自己的 secrets + 笔记；
 * 活人的身份一律不给。拿回来的决定在调用处按规则再校验，失败 / 超时就退回上面的经典规则。
 * ============================================================ */
const TASK_LABEL = { speak: '发言', vote: '投票', wolf_kill: '夜袭', seer_check: '查验', witch: '用药', hunter_shoot: '开枪' };

function aiOn() { return MODE !== 'client' && !!(window.wwAI && window.wwAI.active); }

/* 公开记录 / 私密记录（r = 第几夜 / 天） */
function pubEvent(e) { G.events.push(Object.assign({ r: G.night }, e)); }
function secretTo(p, e) { if (p) p.secrets.push(Object.assign({ r: G.night }, e)); }

function botView(p, options) {
  return {
    me: { id: p.id, name: p.name, role: p.role, persona: p.persona },
    mates: p.role === 'wolf' ? G.players.filter(o => o.role === 'wolf' && o.id !== p.id).map(o => o.id) : [],
    round: G.night,
    phase: G.phase,
    // 死者身份是公开的（牌桌上也翻开了），活人的身份不给
    players: G.players.map(o => ({ id: o.id, name: o.name, alive: o.alive, role: o.alive ? null : o.role })),
    events: G.events,
    secrets: p.secrets,
    notes: p.notes,
    options,
  };
}

/* 让某个 AI 座位想一件事。返回校验前的决定，或 null（没接 AI / 失败） */
async function botThink(p, task, options) {
  if (!aiOn()) return null;
  const d = await window.wwAI.decide(task, botView(p, options));
  if (!G || G.over) return null;
  if (!d) { aiLostNotice(); return null; }
  if (G.aiLost) {
    G.aiLost = false;
    pubLog('🧠 AI 大脑重新连上了。', 'sys');
  }
  if (typeof d.notes === 'string' && d.notes) p.notes = d.notes;
  if (typeof d.thought === 'string' && d.thought) {
    p.minds.push({ r: G.night, phase: G.phase, task, thought: d.thought });
    // 旁观心声：只在单机、玩家自己打开时写进纪事（会剧透）
    if (MODE === 'solo' && window.wwAI.reveal) {
      addLog(`<span class="who">💭 ${esc(p.name)} · ${TASK_LABEL[task]}</span>${esc(d.thought)}`, 'mind');
    }
  }
  return d;
}

/* ai.js 判定掉线（连续失败）后会暂停一小段时间再重试；这期间 AI 座位用经典规则顶上 */
function aiLostNotice() {
  if (!G.aiStart || G.aiLost || aiOn()) return;
  G.aiLost = true;
  pubLog('⚠️ AI 大脑暂时失联，AI 玩家先用经典规则顶上，稍后会自动重连。', 'sys');
}

/* AI 正在想：牌桌上给它的卡加 thinking 标记（客户端也同步）。
 * 只用在公开场合（白天发言）——夜里谁在想事情本身就是身份信息。 */
function markThinking(id, on) {
  const card = elTable.querySelector(`.card[data-id="${id}"]`);
  if (card) card.classList.toggle('thinking', on);
  if (mpHost()) broadcast({ kind: 'thinking', id, on });
}
/* 本页导演面板上的等待提示（无按钮，不会被当成可操作面板） */
function aiWaitShow(html) {
  if (elAction.querySelector('button, input')) return;
  elAction.className = 'action ai-wait-action';
  elAction.innerHTML = `<div class="ai-wait"><i aria-hidden="true"></i><span>${html}</span></div>`;
}
function aiWaitHide() {
  if (!elAction.querySelector('.ai-wait')) return;
  elAction.innerHTML = '';
  elAction.className = 'action';
}

/* 终局回放：每个 AI 一路上的内心独白 + 最后的笔记（HTML 已转义，可直接发给客户端） */
function buildMindsHtml() {
  const bots = G.players.filter(p => p.isBot && p.minds.length);
  if (!bots.length) return '';
  return bots.map(p => {
    const camp = p.role === 'wolf' ? 'wolf' : 'good';
    const items = p.minds.map(m =>
      `<li><em>第 ${m.r} ${m.phase === 'day' ? '天' : '夜'} · ${TASK_LABEL[m.task] || ''}</em>${esc(m.thought)}</li>`).join('');
    const notes = p.notes ? `<p class="mind-notes">最后的笔记：${esc(p.notes)}</p>` : '';
    return `<details class="mind-card" data-camp="${camp}"><summary><b>${esc(p.name)}</b>` +
      `<span class="mind-role">${ROLES[p.role].icon} ${ROLES[p.role].name}</span>` +
      `<span class="mind-count">${p.minds.length} 段心声</span></summary><ol>${items}</ol>${notes}</details>`;
  }).join('');
}

/* ============================================================
 * 夜晚
 * ============================================================ */
async function ambientVeil(text, cls, ms) {
  if (MODE === 'solo') { await veilSync(text, cls, ms); }
  else await sleep(Math.min(ms, 800));
}
/* 同上，但遮罩要撑到 AI 想完为止（至少 ms） */
async function ambientVeilWhile(text, cls, ms, work) {
  if (MODE === 'solo') {
    veilShow(text, cls);
    await Promise.all([sleep(ms), work]);
    veilHide();
  } else {
    await Promise.all([sleep(Math.min(ms, 800)), work]);
  }
}

/* 狼队选择击杀目标：
 *  - 接入 AI 时，AI 狼人先「商量」：按座位依次提议，后开口的能看到前面队友的提议和理由；
 *  - 真人狼人随后各自投选（能看到 AI 队友的提议），真人的票说了算，多数决、平票随机；
 *  - 没有真人狼：AI 提议多数决；都没有就随机。空选（跳过）→ 随机兜底。 */
async function wolvesDecide() {
  const wolves = alivePs().filter(p => p.role === 'wolf');
  const goodOnes = alivePs().filter(p => p.role !== 'wolf');
  if (!wolves.length || !goodOnes.length) return null;
  const targets = goodOnes.map(p => p.id);

  const humanWolves = wolves.filter(p => !p.isBot);
  const botWolves = wolves.filter(p => p.isBot);
  const proposals = [];
  let veiled = false;
  if (botWolves.length && aiOn()) {
    veiled = true;
    await ambientVeilWhile('🌑 狼人睁眼…', 'night', 1300, (async () => {
      for (const w of botWolves) {
        const d = await botThink(w, 'wolf_kill', { targets, proposals: proposals.slice() });
        if (d && targets.includes(d.target)) proposals.push({ id: w.id, target: d.target, reason: d.thought });
      }
    })());
  }

  if (!humanWolves.length && !proposals.length) {
    if (!veiled) await ambientVeil('🌑 狼人睁眼…', 'night', 1300);
    await sleep(600);
    return pick(goodOnes).id;
  }
  const advice = proposals.length
    ? 'AI 队友的提议：' + proposals.map(pr => {
        const why = pr.reason ? `（${esc(Array.from(pr.reason).slice(0, 40).join(''))}）` : '';
        return `<b>${esc(byId(pr.id).name)}</b> 想刀 <b>${esc(byId(pr.target).name)}</b>${why}`;
      }).join('；') + '。你的选择说了算（多名真人狼人时票多者胜）。'
    : '狼队无法密聊：每名狼人悄悄投选一个目标，票多者成为今晚猎物（跳过则由 AI 兜底）。';
  const picks = [];
  for (const w of humanWolves) {
    const v = await askSeat('pick', w.id, {
      title: '🐺 你是狼人，今晚杀谁？',
      hint: advice,
      opts: goodOnes.map(p => ({ label: p.name, value: p.id, cls: 'danger' })),
    });
    if (typeof v === 'number') picks.push(v);
  }
  const pool = picks.length ? picks : proposals.map(pr => pr.target);
  if (!pool.length) return pick(goodOnes).id;
  const tally = {};
  pool.forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const maxV = Math.max(...Object.values(tally));
  const top = Object.keys(tally).filter(id => tally[id] === maxV);
  return +pick(top);
}

/* 猎人挑目标（开枪），返回玩家或 null */
async function hunterAct(hunter, cause) {
  const others = aliveOthers(hunter.id);
  if (!others.length) return null;
  if (hunter.isBot) {
    const ids = others.map(o => o.id);
    const d = await botThink(hunter, 'hunter_shoot', { cause, targets: ids });
    if (d && ids.includes(d.target)) return byId(d.target);
    await sleep(700);
    let t = others.find(o => o.id === hunter.botAccuse);
    if (t && t.alive) return t;
    return pick(others);
  }
  const v = await askSeat('pick', hunter.id, {
    title: '🏹 你发动猎人技能！',
    hint: '选择你要开枪带走的一名玩家：',
    opts: others.map(p => ({ label: p.name, value: p.id, cls: 'danger' })),
  });
  return typeof v === 'number' ? byId(v) : null;
}

/* 白天公开死亡（投票放逐 / 白天开枪） */
async function publicDeathOf(p, cause) {
  if (!p || !p.alive) return;
  p.alive = false;
  const how = cause === 'vote' ? '被投票放逐' : '被猎人开枪带走';
  await pubLogSlow(`☠️ <b>${esc(p.name)}</b>（${ROLES[p.role].icon} ${ROLES[p.role].name}）${how}！`, 'dead', 500);
  if (p.role === 'hunter' && cause === 'vote') {
    await pubLogSlow(`🏹 <b>${esc(p.name)}</b> 是猎人，临死前开枪！`, 'day', 600);
    const target = await hunterAct(p, 'vote');
    if (target && target.alive) {
      pubEvent({ k: 'shot', by: p.id, id: target.id });
      await publicDeathOf(target, 'gun');
    }
  }
  syncViews();
}

/* 夜晚死亡：静默入账，天亮统一公布 */
async function nightDeathOf(p, cause) {
  if (!p || !p.alive) return;
  p.alive = false;
  G.nightDead.push(p);
  if (p.role === 'hunter' && cause !== 'poison') {
    await pubLogSlow(`🏹 黑夜中传来一声枪响！<b>${esc(p.name)}</b> 临死前开枪……`, 'day', 700);
    const target = await hunterAct(p, cause);
    if (target && target.alive) {
      target.alive = false;
      G.nightDead.push(target);
      pubEvent({ k: 'shot', by: p.id, id: target.id, night: true });
    }
  }
}

async function nightPhase() {
  await pubVeil('🌙 天黑请闭眼…', 'night', 1600);
  logHeader(`夜晚（第 ${G.night} 夜）`);
  G.phase = 'night';
  G.nightDead = [];
  syncViews();   // 与 dayPhase 对称：入夜后立刻重绘，否则状态条会一直停在「白天」

  // AI 预言家和狼人各想各的：先把它的查验思考发出去，轮到它时再取结果，省掉一轮等待
  const seer = alivePs().find(p => p.role === 'seer');
  const seerTargetIds = seer ? aliveOthers(seer.id).map(p => p.id) : [];
  const seerThinking = seer && seer.isBot && seerTargetIds.length && aiOn()
    ? botThink(seer, 'seer_check', { targets: seerTargetIds })
    : null;

  // ---- 狼人行动 ----
  const victim = byId(await wolvesDecide());
  if (victim) alivePs().filter(p => p.role === 'wolf').forEach(w => secretTo(w, { k: 'kill', id: victim.id }));

  // ---- 预言家行动 ----
  if (seer) {
    const targets = aliveOthers(seer.id);
    if (targets.length) {
      if (seer.isBot) {
        let t = null;
        if (seerThinking) {
          await ambientVeilWhile('🔮 预言家睁眼…', 'night', 1100, seerThinking);
          const d = await seerThinking;
          if (d && seerTargetIds.includes(d.target)) t = byId(d.target);
        } else {
          await ambientVeil('🔮 预言家睁眼…', 'night', 1100);
        }
        if (!t) t = pick(targets);
        seer.botSeerSuspect = t.role === 'wolf' ? t.id : null;
        secretTo(seer, { k: 'check', id: t.id, wolf: t.role === 'wolf' });
        await sleep(500);
      } else {
        const tId = await askSeat('pick', seer.id, {
          title: '🔮 你是预言家，今晚查验谁？',
          hint: '选择一名玩家查看其身份：',
          opts: targets.map(p => ({ label: p.name, value: p.id })),
        });
        const t = byId(tId);
        if (t && t.alive && t.id !== seer.id) {
          const isWolf = t.role === 'wolf';
          t.seerMark = isWolf ? 'wolf' : 'good';
          secretTo(seer, { k: 'check', id: t.id, wolf: isWolf });
          await privTo(seer.id,
            `<span class="who">🔮 你</span> 查验了 ${esc(t.name)}：<b>${isWolf ? '🐺 狼人' : '✅ 好人'}</b>`,
            'night',
            { text: isWolf ? '🔮 查到了：🐺 狼人！' : '🔮 查到了：✅ 好人', cls: isWolf ? 'wolf' : 'day' });
          if (mpHost() && !seer.isBot && seer.peerId) syncViews(); // 更新预言家本人的标记视图
        }
      }
    }
  }

  // ---- 女巫行动 ----
  const witch = alivePs().find(p => p.role === 'witch');
  let saved = false, poisoned = null;
  if (witch && victim) {
    secretTo(witch, { k: 'attacked', id: victim.id });
    if (witch.isBot) {
      const canHeal = witch.witch.heal && (victim.id !== witch.id || G.night === 1);
      const poisonIds = aliveOthers(witch.id).filter(p => p.id !== victim.id).map(p => p.id);
      const canPoison = witch.witch.poison && poisonIds.length > 0;
      const thinking = aiOn()
        ? botThink(witch, 'witch', {
            victim: victim.id, canHeal, healUsed: !witch.witch.heal, canPoison, poisonTargets: poisonIds,
          })
        : null;
      if (thinking) await ambientVeilWhile('🧪 女巫睁眼…', 'night', 1100, thinking);
      else await ambientVeil('🧪 女巫睁眼…', 'night', 1100);
      const d = thinking ? await thinking : null;
      if (d) {
        if (d.heal === true && canHeal) { witch.witch.heal = false; saved = true; }
        if (canPoison && poisonIds.includes(d.poison)) { witch.witch.poison = false; poisoned = byId(d.poison); }
      } else if (canHeal && Math.random() < 0.55) {
        witch.witch.heal = false; saved = true;
      }
      if (saved) secretTo(witch, { k: 'heal', id: victim.id });
      if (poisoned) secretTo(witch, { k: 'poison', id: poisoned.id });
      await sleep(500);
    } else {
      // --- 解药 ---
      const selfNight1 = victim.id === witch.id && G.night === 1;
      let healChoice = false;
      if (!witch.witch.heal) {
        privTo(witch.id, '🧪 你的解药已经用完了……', 'night');
      } else if (victim.id === witch.id && !selfNight1) {
        privTo(witch.id, '🧪 被袭击的是你自己，但只有首夜才能自救……', 'night');
      } else {
        healChoice = await askSeat('pick', witch.id, {
          title: '🧪 你是女巫，今晚有人被袭击了',
          hint: `被袭击的是：<b>${esc(victim.name)}</b>。是否使用解药？（跳过 = 不使用）`,
          opts: [
            // label 由 widgetPick 用 textContent 写入，这里不能再 esc()，否则名字里的 & < 会显示成实体
            { label: victim.id === witch.id ? '💊 救自己' : `💊 救 ${victim.name}`, value: true, cls: 'ok' },
            { label: '不救', value: false, cls: 'ghost' },
          ],
        });
      }
      if (healChoice === true) {
        witch.witch.heal = false; saved = true;
        secretTo(witch, { k: 'heal', id: victim.id });
        privTo(witch.id, '🧪 你使用了解药，救下了他。', 'night');
      }
      // --- 毒药 ---
      if (witch.witch.poison) {
        const targets = aliveOthers(witch.id).filter(p => p.id !== victim.id);
        const pv = await askSeat('pick', witch.id, {
          title: '🧪 是否使用毒药？（可跳过）',
          hint: '选择要毒杀的目标：',
          opts: [{ label: '☠️ 不使用毒药', value: null, cls: 'ghost' }].concat(
            targets.map(p => ({ label: p.name, value: p.id, cls: 'danger' }))
          ),
        });
        if (typeof pv === 'number') {
          witch.witch.poison = false;
          poisoned = byId(pv);
          secretTo(witch, { k: 'poison', id: poisoned.id });
          privTo(witch.id, `🧪 你对 ${esc(poisoned.name)} 下了毒。`, 'night');
        }
      }
    }
  }

  // ---- 结算夜晚 ----
  if (victim && !saved && victim.alive) await nightDeathOf(victim, 'wolf');
  if (poisoned && poisoned.alive) await nightDeathOf(poisoned, 'poison');
  G.phase = 'day';
  syncViews();
  if (checkWin()) { G.over = true; return; }
}

/* ============================================================
 * 白天
 * ============================================================ */
async function dayPhase() {
  await pubVeil('☀️ 天亮了…', 'day', 1400);

  pubEvent({ k: 'dawn', dead: G.nightDead.map(p => p.id) });
  if (G.nightDead.length === 0) {
    await pubLogSlow('🌅 昨夜是平安夜，没有人死去。', 'day', 700);
  } else {
    const names = G.nightDead.map(p => `${esc(p.name)}（${ROLES[p.role].icon} ${ROLES[p.role].name}）`).join('、');
    await pubLogSlow(`☠️ 昨夜死者：${names}`, 'dead', 700);
  }

  logHeader(`白天（第 ${G.night} 天）`);
  G.phase = 'day';
  syncViews();
  if (G.over) return;

  // ---- 轮流发言 ----
  await pubLogSlow('🗣️ 存活玩家开始轮流发言……', 'day', 400);
  const speakers = alivePs();
  for (const [i, p] of speakers.entries()) {
    if (G.over) break;
    paintHost(p.id);
    if (mpHost()) broadcast({ kind: 'speaker', id: p.id });
    let text = null;
    if (p.isBot) {
      let d = null;
      if (aiOn()) {
        // 发言者本来就是公开的，这里可以大方地亮出「正在思考」
        markThinking(p.id, true);
        aiWaitShow(`<b>${esc(p.name)}</b> 正在思考要说什么…`);
        d = await botThink(p, 'speak', {
          order: i + 1, total: speakers.length, targets: aliveOthers(p.id).map(o => o.id),
        });
        aiWaitHide();
        markThinking(p.id, false);
      }
      if (d && d.speech) {
        text = d.speech;
        if (aliveOthers(p.id).some(o => o.id === d.suspect)) p.botAccuse = d.suspect;
      } else {
        text = botSpeechLine(p);
      }
      pubEvent({ k: 'speech', id: p.id, text });
      await pubLogSlow(`<span class="who">${esc(p.name)}</span>：${esc(text)}`, 'day', d ? 900 : 380);
    } else {
      const v = await askSeat('text', p.id, {
        title: '🗣️ 轮到你发言',
        hint: '可以说明身份 / 指出怀疑对象 / 带节奏，也可以直接跳过。',
        placeholder: '例：我是预言家，小明是狼',
      });
      text = v;
      pubEvent({ k: 'speech', id: p.id, text: text || '' });
      if (text) {
        pubLog(`<span class="who">👑 ${esc(p.name)}</span>：${esc(text)}`, 'day');
        const hit = aliveOthers(p.id).find(o => text.includes(o.name));
        if (hit) { p.botAccuse = hit.id; pubLog(`<span class="who">系统</span>：${esc(p.name)} 把矛头指向了 ${esc(hit.name)}。`, 'sys'); }
      } else {
        pubLog(`<span class="who">👑 ${esc(p.name)}</span>：我选择保持沉默。`, 'day');
      }
    }
  }
  paintHost();
  if (mpHost()) broadcast({ kind: 'speaker', id: null });

  // ---- 投票 ----
  await pubVeil('🗳️ 投票时间！', 'day', 1100);
  elGame.dataset.stage = 'vote';
  if (mpHost()) broadcast({ kind: 'stage', stage: 'vote' });

  // AI 的票是同时想的：先把所有 AI 的投票思考一起发出去，真人投票时它们也在权衡
  const voters = alivePs();
  const botBallots = new Map();
  if (aiOn()) {
    for (const p of voters) {
      if (p.isBot) botBallots.set(p.id, botThink(p, 'vote', { targets: aliveOthers(p.id).map(o => o.id) }));
    }
  }
  const pending = new Set(botBallots.keys());
  botBallots.forEach((pr, id) => pr.then(() => pending.delete(id)));

  const tally = {};
  const ballots = [];
  for (const p of voters) {
    let toId = null;
    if (p.isBot) {
      let d = null;
      if (botBallots.has(p.id)) {
        if (pending.size) aiWaitShow('AI 玩家还在权衡手里的这一票…');
        d = await botBallots.get(p.id);
      }
      if (d && aliveOthers(p.id).some(o => o.id === d.target)) {
        toId = d.target;
      } else {
        const t = botVoteTarget(p);
        toId = t ? t.id : null;
      }
    } else {
      const targets = aliveOthers(p.id);
      const v = await askSeat('pick', p.id, {
        title: '🗳️ 请投票放逐一名玩家',
        hint: '票数最高者将被放逐（平票则无人出局）。',
        opts: targets.map(o => ({ label: o.name, value: o.id, cls: 'danger' })),
      });
      if (typeof v === 'number') toId = v;
    }
    if (toId != null) tally[toId] = (tally[toId] || 0) + 1;
    ballots.push([p.id, toId == null ? -1 : toId]);
  }
  aiWaitHide();
  if (G.over) return;

  await sleep(400);
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    const summary = entries.map(([id, c]) => `${esc(G.players.find(p => p.id === +id).name)} ${c}票`).join('，');
    pubLog(`<span class="who">📊 计票结果</span>：${summary}`, 'day');
    // 票型公开：谁投了谁，AI 和真人都靠它盘逻辑
    const detail = ballots.map(([a, b]) => `${esc(byId(a).name)}→${b >= 0 ? esc(byId(b).name) : '弃票'}`).join('，');
    pubLog(`<span class="who">🗳️ 票型</span>：${detail}`, 'sys');
  }
  pubEvent({ k: 'votes', votes: ballots });

  let exiled = null;
  if (!entries.length || entries[0][1] === 0) {
    pubEvent({ k: 'novote' });
    await pubLogSlow('⚖️ 无人投票，今天无人被放逐。', 'day', 900);
  } else {
    const maxV = entries[0][1];
    const leaders = entries.filter(e => e[1] === maxV).map(e => G.players.find(p => p.id === +e[0]));
    if (leaders.length > 1) {
      pubEvent({ k: 'tie' });
      await pubLogSlow('⚖️ 平票，今天无人被放逐。', 'day', 900);
    } else {
      exiled = leaders[0];
      pubEvent({ k: 'exile', id: exiled.id });
      await pubLogSlow(`⚖️ ${esc(exiled.name)} 得票最高，被放逐！`, 'day', 500);
      await publicDeathOf(exiled, 'vote');
      if (checkWin()) { G.over = true; return; }
    }
  }
  if (!G.over) paintHost();
  await sleep(600);
}

/* ============================================================
 * 开局 / 胜负
 * ============================================================ */
function showRolePreview(n) {
  const comp = compFor(n);
  const counts = {};
  comp.forEach(r => counts[r] = (counts[r] || 0) + 1);
  $('rolePreview').innerHTML =
    Object.entries(counts).map(([r, c]) =>
      `<span>${ROLES[r].icon} ${ROLES[r].name} ×${c}</span>`).join('');
}

/* humans: [{peerId|null, name}]，peerId=null 表示房主本人 */
function dealGame(n, humans) {
  const roles = shuffle(compFor(n));
  const takenNames = humans.map(h => h.name);
  const pool = shuffle(BOT_NAMES.filter(x => !takenNames.includes(x)));
  const personas = shuffle(BOT_PERSONAS);
  G = {
    n, mode: MODE,
    players: [], phase: 'night', night: 1, over: false, nightDead: [],
    mpHumanCount: humans.length,
    events: [],          // 公开记录（AI 推理用）
    aiStart: false, aiLost: false,
  };
  for (let i = 0; i < n; i++) {
    const isHuman = i < humans.length;
    const peerId = isHuman ? humans[i].peerId : null;
    G.players.push({
      id: i,
      name: isHuman ? humans[i].name : pool.pop() || ('AI' + i),
      role: roles[i],
      alive: true,
      isBot: !isHuman,
      peerId,
      witch: { heal: true, poison: true },
      botSeerSuspect: null,
      botAccuse: null,
      persona: isHuman ? '' : (personas[i % personas.length] || ''),
      notes: '',
      secrets: [],
      minds: [],
    });
  }
}

/* 给某个人类座位播报身份（本地写日志；远端发私有消息） */
function introSeat(seat) {
  const p = G.players[seat];
  const r = ROLES[p.role];
  let html = `你的身份是：<b>${r.icon} ${r.name}</b>（${r.desc}）`;
  let extra = '';
  if (p.role === 'wolf') {
    const mates = G.players.filter(o => o.role === 'wolf' && o.id !== seat);
    extra = mates.length ? `，你的狼队友是 <b>${mates.map(m => esc(m.name)).join('、')}</b>` : '';
  }
  privTo(seat, `<span class="who">系统</span>：${html}${extra}`, 'sys');
}

function startLocalGame(n) {
  MODE = 'solo';
  Net = null;
  roomNet = null;
  // 邀请页的 NAME 行填了就用它，没填才叫"你"
  const name = $('nameInp').value.trim().slice(0, 12);
  dealGame(n, [{ peerId: null, name: name || '你' }]);
  beginPlay(n);
}

/* 联机房主开始 */
function startHostGame() {
  const entries = roster.slice();
  const n = parseInt($('mpCountSel').value, 10);
  dealGame(n, [{ peerId: null, name: hostName }].concat(
    entries.filter(e => !e.isHost).map(e => ({ peerId: e.peerId, name: e.name }))
  ));
  beginPlay(n);
  // 通知客户端开局（含各自座位与身份）
  for (const p of G.players) {
    if (!p.isBot && p.peerId) {
      const mates = G.players.filter(o => o.role === 'wolf' && o.id !== p.id).map(m => m.name);
      sendTo(p.peerId, { kind: 'start', meSeat: p.id, n, roleId: p.role, mateNames: mates, hostName });
    }
  }
  syncViews();
}

async function beginPlay(n) {
  showScreen('game');
  elOverlay.classList.add('hidden');
  elLog.innerHTML = '';
  $('stRole').textContent = '';
  paintHost();

  pubLog(`<span class="who">系统</span>：${n} 人局开始。`, 'sys');
  // 首页刚打开就开局时，AI 服务的探测可能还没回来——等它一下（最多几秒）
  if (window.wwAI) await window.wwAI.whenReady();
  G.aiStart = aiOn();
  if (G.aiStart) {
    const brain = window.wwAI.mock ? '离线模拟大脑' : esc(window.wwAI.model);
    pubLog(`<span class="who">系统</span>：🧠 本局 AI 玩家接入了 ${brain}——它们会自己记笔记、推理、发言和投票。`, 'sys');
  }
  for (let i = 0; i < G.mpHumanCount; i++) introSeat(i);
  await sleep(800);
  if (!G.over) await mainLoop();
}

/* 主循环（房主 / 单机权威） */
async function mainLoop() {
  while (!G.over) {
    if (alivePs().length <= 1) { checkWin(); break; }
    G.phase = 'night';
    await nightPhase();
    if (G.over) break;
    G.phase = 'day';
    await dayPhase();
    if (G.over) break;
    G.night++;
  }
}

/* 胜负判定 & 结算 */
function checkWin() {
  const aliveWolves = G.players.filter(p => p.alive && p.role === 'wolf').length;
  const aliveGood = G.players.filter(p => p.alive && p.role !== 'wolf').length;
  if (aliveWolves === 0) { endGame('good'); return true; }
  if (aliveWolves >= aliveGood) { endGame('wolf'); return true; }
  return false;
}

async function endGame(winnerCamp) {
  if (G.over) return;
  G.over = true;
  await sleep(700);
  paintHost();
  veilHide();

  const rolesHtml = G.players.map(p => {
    const c = p.role === 'wolf' ? 'w' : 'g';
    const dead = p.alive ? '' : ' ☠️';
    return `<span class="${c}">${esc(p.name)} · ${ROLES[p.role].icon} ${ROLES[p.role].name}${dead}</span>`;
  }).join('');

  const mindsHtml = buildMindsHtml();
  // 本地（房主）结算弹窗
  showOverlayLocal(winnerCamp, rolesHtml, mindsHtml);
  // 通知客户端结算（终局了，AI 的心声可以公开）
  if (mpHost()) broadcast({ kind: 'over', winnerCamp, rolesHtml, mindsHtml });
}

/* 结算页的「AI 心声回放」：没有接入 AI 的对局不显示 */
function showMinds(html) {
  const box = $('aiMinds');
  if (!box) return;
  $('aiMindsList').innerHTML = html || '';
  box.classList.toggle('hidden', !html);
}

function showOverlayLocal(winnerCamp, rolesHtml, mindsHtml) {
  const human = G.players[HOST_SEAT];
  const myRole = ROLES[human.role];
  const winColor = winnerCamp === 'good' ? 'var(--good)' : (winnerCamp === 'wolf' ? 'var(--wolf)' : 'var(--text)');
  const title = winnerCamp === 'good' ? '🏆 好人阵营胜利！' : (winnerCamp === 'wolf' ? '🐺 狼人阵营胜利！' : '🌫️ 游戏结束');
  $('ovTitle').textContent = title;
  $('ovTitle').style.color = winColor;
  $('ovText').innerHTML = '';
  $('ovRoles').innerHTML = rolesHtml;
  showMinds(mindsHtml);
  $('stRole').textContent = '本局你为 ' + myRole.icon + ' ' + myRole.name;
  elOverlay.classList.remove('hidden');
}

/* ============================================================
 * 客户端（联机加入者）逻辑：只渲染房主推送的视图并回传操作
 * ============================================================ */
function clientPaint(v) {
  elStDay.textContent = v.dayTxt;
  elStRound.textContent = v.nightTxt;
  elStAlive.textContent = `存活 ${v.alive} 人`;
  elBadge.textContent = v.dayTxt;
  elTable.innerHTML = v.players.map(x => x.html).join('');
  if (v.phase === 'night') elGame.dataset.stage = 'night';
}

function clientThinking(id, on) {
  if (typeof id !== 'number') return;
  const card = elTable.querySelector(`.card[data-id="${id}"]`);
  if (card) card.classList.toggle('thinking', !!on);
}

function clientSpeaker(id) {
  elTable.querySelectorAll('.card.playing').forEach(card => card.classList.remove('playing'));
  elGame.dataset.stage = id == null ? 'table' : 'speech';
  if (id == null) return;
  const card = elTable.querySelector(`[data-id="${id}"]`);
  if (card) card.classList.add('playing');
}

async function clientStart(msg) {
  MY = { seat: msg.meSeat, roleId: msg.roleId, n: msg.n };
  showScreen('game');
  elOverlay.classList.add('hidden');
  elLog.innerHTML = '';
  $('stRole').textContent = '';
  const r = ROLES[msg.roleId];
  let html = `你的身份是：<b>${r.icon} ${r.name}</b>（${r.desc}）`;
  if (msg.roleId === 'wolf' && msg.mateNames.length) {
    html += `，你的狼队友是 <b>${msg.mateNames.map(esc).join('、')}</b>`;
  }
  addLog(`<span class="who">系统</span>：${msg.n} 人局开始。`, 'sys');
  addLog(`<span class="who">系统</span>：${html}`, 'sys');
}

let clientAskId = null;   // 客户端当前显示的是哪一次询问（房主超时后会发 cancel 收起它）
function clientAsk(msg) {
  const spec = msg.spec;
  clientAskId = msg.askId;
  const answer = (v) => {
    if (clientAskId === msg.askId) clientAskId = null;
    if (Net) sendTo(Net.hostPeerId, { kind: 'answer', askId: msg.askId, value: v });
  };
  if (msg.kind2 === 'pick') {
    widgetPick({ title: spec.title, hint: spec.hint, opts: spec.opts }).then(answer);
  } else {
    widgetText({ title: spec.title, hint: spec.hint, placeholder: spec.placeholder }).then(answer);
  }
}
function clientCancel(askId) {
  if (askId !== clientAskId) return;
  clientAskId = null;
  elAction.innerHTML = '';
  elAction.className = 'action';
}

/* ============================================================
 * 大厅（创建/加入房间）
 * ============================================================ */
let hostName = '你';
let roster = [];          // 房主端维护：{peerId,name,isHost,ready}
let greeted = new Set();  // 房主端：已打过招呼的 peer
let myReady = false;

function renderRoster() {
  const list = roster.map((e) => {
    const tag = e.isHost
      ? '<span class="rtag host">👑 房主</span>'
      : (e.ready ? '<span class="rtag ready">✓ 已准备</span>' : '<span class="rtag wait">… 准备中</span>');
    return `<div class="roster-row"><span class="ricon">${e.isHost ? '👑' : '🎭'}</span>` +
           `<span class="rname">${esc(e.name)}</span>${tag}</div>`;
  }).join('');
  $('mpRoster').innerHTML = list || '<div class="roster-empty">还没有人加入</div>';
  updateLobbyControls();
  // 房主把最新名单广播给所有人
  if (MODE === 'host') broadcast({ kind: 'roster', list: roster });
}

function updateLobbyControls() {
  if (MODE !== 'host' && MODE !== 'client') return;
  const humans = roster.length;
  const humansReady = roster.filter(e => e.isHost || e.ready).length;
  const startBtn = $('mpStartBtn');
  const status = $('mpStatus');
  const cntSel = $('mpCountSel');

  if (MODE === 'host') {
    // 可选总人数不得小于当前真人数量
    let anyDisabled = false;
    for (const opt of cntSel.options) {
      const val = parseInt(opt.value, 10);
      opt.disabled = val < humans;
      if (val === humans) anyDisabled = true;
    }
    if (humans > parseInt(cntSel.value, 10)) {
      cntSel.value = String(Math.min(humans, 12));
      // 程序改值不会触发 change：手动派发，让 compose.js 按新人数重新校验阵容
      // （否则自定义阵容长度对不上，compFor() 会悄悄退回默认表）
      cntSel.dispatchEvent(new Event('change'));
    }
    if (humans < 2) {
      startBtn.disabled = true;
      status.textContent = '需要至少 2 名真人才能开局（当前 1 人：你自己）';
    } else if (humansReady < humans) {
      startBtn.disabled = true;
      status.textContent = `等待玩家准备…（${humansReady}/${humans} 已准备）`;
    } else if (startBtn.dataset.compBad === '1') {
      startBtn.disabled = true;
      status.textContent = '角色配置不合法，调整后才能开局';
    } else {
      startBtn.disabled = false;
      const bots = parseInt(cntSel.value, 10) - humans;
      status.textContent = `全部就绪！将开局 ${parseInt(cntSel.value, 10)} 人局（AI 补位 ${Math.max(bots, 0)} 人）`;
    }
  } else {
    $('mpReadyBtn').disabled = myReady;
    setEntryLabel($('mpReadyBtn'), myReady ? 'READY ✓' : 'READY', myReady ? '已准备' : '点此准备');
    status.textContent = roster.length >= 2 ? `已加入 ${roster.length} 人，等待房主开始…` : '等待其他人加入…';
  }
}

async function enterLobby() {
  showScreen('lobby');
  const isHost = MODE === 'host';
  $('lobbyTitle').textContent = isHost ? '房间大厅（你是房主）' : '房间大厅';
  // 房间号对房主和客人都要可见——客人也得能把它转给别人
  $('hostCodeWrap').classList.remove('hidden');
  $('clientWait').classList.toggle('hidden', isHost);
  $('hostCntWrap').classList.toggle('hidden', !isHost);
  $('mpRolesRow').classList.toggle('hidden', !isHost);
  $('mpBrainRow').classList.toggle('hidden', !isHost);   // AI 座位只在房主页面上思考
  $('mpStartBtn').classList.toggle('hidden', !isHost);
  $('mpReadyBtn').classList.toggle('hidden', isHost);
  $('mpStatus').textContent = isHost ? '等待玩家加入…' : '连接中…';
  renderRoster();
  updateLobbyControls();
}

function nickName() {
  const v = $('nameInp').value.trim();
  return v || ('玩家' + (100 + rnd(900)));
}

/* ---- 创建房间（房主） ---- */
async function createRoom() {
  if (!(await netReadyWait())) { alert('联机模块加载失败：请确认能联网后刷新页面重试（单机不受影响）。'); return; }
  hostName = nickName();
  const code = genCode();
  let room;
  try { room = netJoinRoom('ww-' + code); } catch (e) { alert('创建房间失败：' + e.message); return; }

  Net = {
    room,
    selfId: trystero().selfId,
    hostPeerId: null,
    leave() { try { room.leave(); } catch (e) {} },
  };
  MODE = 'host';
  roster = [{ peerId: null, name: hostName, isHost: true, ready: true }];
  greeted = new Set();

  room.onPeerJoin = (peerId) => {
    // 游戏已开始：拒绝新玩家
    if (G && !G.over) {
      sendTo(peerId, { kind: 'busy', text: '本局已在进行中，无法加入。' });
      return;
    }
    pubLobbyLog(`🔔 ${peerId.slice(0, 6)} 已连接…`);
  };
  room.onPeerLeave = (peerId) => {
    if (G && !G.over) { peerLeaveInGame(peerId); return; }
    const i = roster.findIndex(e => e.peerId === peerId);
    if (i >= 0) {
      pubLobbyLog(`📴 ${roster[i].name} 离开了房间`);
      roster.splice(i, 1);
      renderRoster();
    }
    greeted.delete(peerId);
  };

  roomNet.onMessage = (data, { peerId }) => {
    if (MODE !== 'host') return;
    if (!data || typeof data !== 'object') return;
    const m = data;
    if (m.kind === 'hello') {
      if (G && !G.over) { sendTo(peerId, { kind: 'busy', text: '本局已在进行中，无法加入。' }); return; }
      if (greeted.has(peerId)) {
        // 已入座的人又来打招呼（没收到 welcome）：补发一次，不重复入座
        const i = roster.findIndex(e => e.peerId === peerId);
        if (i >= 0) {
          sendTo(peerId, { kind: 'welcome', order: i + 1, hostName });
          sendTo(peerId, { kind: 'roster', list: roster });
        }
        return;
      }
      greeted.add(peerId);
      const name = (m.name || '玩家').toString().slice(0, 12);
      if (roster.length >= 12) { sendTo(peerId, { kind: 'busy', text: '房间已满（最多 12 人）。' }); return; }
      roster.push({ peerId, name, isHost: false, ready: false });
      pubLobbyLog(`🎉 ${name} 加入了房间`);
      sendTo(peerId, { kind: 'welcome', order: roster.length, hostName });
      renderRoster();
    } else if (m.kind === 'ready') {
      const e = roster.find(x => x.peerId === peerId);
      if (e) { e.ready = !!m.ready; renderRoster(); }
    } else if (m.kind === 'rename') {
      const e = roster.find(x => x.peerId === peerId);
      const name = String(m.name || '').trim().slice(0, 12);
      if (e && name) { e.name = name; renderRoster(); }
    } else if (m.kind === 'answer') {
      // 只认被问的那个人；答案不在选项里就按跳过处理（否则一个坏值就能让房主主循环抛错卡死）
      const a = pendingAsks[m.askId];
      if (a && a.seat !== HOST_SEAT && a.peerId === peerId) a.resolve(a.clean(m.value));
    }
  };
  pubLobbyLog(`🎉 ${hostName} 创建了房间`);
  $('roomCodeTxt').textContent = code;
  enterLobby();
}

/* 菜单项是「大写主标 + 中文副标」两段结构，直接写 textContent 会把它抹平 */
function setEntryLabel(btn, key, note) {
  if (!btn) return;
  const k = btn.querySelector('.entry-key');
  const n = btn.querySelector('small');
  if (k) k.textContent = key; else btn.textContent = key;
  if (n && note != null) n.textContent = note;
}

/* 大厅里改昵称：房主直接改名单，客人通知房主 */
function setNickname(name) {
  const v = String(name || '').trim().slice(0, 12);
  if (!v) return;
  hostName = v;
  if (MODE === 'host') {
    if (roster[0]) roster[0].name = v;
    renderRoster();
  } else if (MODE === 'client' && Net) {
    broadcast({ kind: 'rename', name: v });
  }
}

/* 开场菜单的 MULTIPLAYER：直接建房进大厅，房间号在大厅里发给朋友 */
async function enterMultiplayer() {
  if (Net) leaveNetRoom();
  if (G && !G.over) { location.reload(); return; }
  if (!$('nameInp').value.trim()) $('nameInp').value = nickName();
  await createRoom();
}

function pubLobbyLog(text) {
  addLog(`<span class="who">大厅</span>：${esc(text)}`, 'sys');
  if (MODE === 'host') broadcast({ kind: 'line', html: `<span class="who">大厅</span>：${esc(text)}`, cls: 'sys' });
}

/* ---- 加入房间（客户端） ---- */
async function joinRoom(code) {
  const c = normCode(code);
  if (c.length < 3) { alert('房间号格式不对，请重新输入。'); return; }
  if (!(await netReadyWait())) { alert('联机模块加载失败：请确认能联网后刷新页面重试（单机不受影响）。'); return; }
  // 校验都过了才离开当前房间——先离开再报错，房主会留在一个已经失效的"僵尸大厅"里
  if (Net) leaveNetRoom();
  hostName = nickName();
  let room;
  try { room = netJoinRoom('ww-' + c); } catch (e) { alert('加入房间失败：' + e.message); showScreen('setup'); return; }

  Net = {
    room,
    selfId: trystero().selfId,
    hostPeerId: null,
    leave() { try { room.leave(); } catch (e) {} },
  };
  MODE = 'client';
  myReady = false;
  let helloSeq = 0;

  const sayHello = () => {
    helloSeq++;
    if (helloSeq > 10) {
      clearInterval(Net._helloTimer);
      $('mpStatus').textContent = '⏳ 暂时找不到房主（房间号可能有误），房主上线后会自动连上…';
      return;
    }
    broadcast({ kind: 'hello', name: hostName });
  };

  // 定时广播在连接建立前会直接丢失；谁连上来就当面再打一次招呼，
  // 否则 P2P 连接慢于 ~15 秒时永远等不到 welcome
  room.onPeerJoin = (peerId) => {
    if (Net && Net.room === room && !Net.hostPeerId) sendTo(peerId, { kind: 'hello', name: hostName });
  };

  roomNet.onMessage = (data, { peerId }) => {
    if (MODE !== 'client') return;
    if (!data || typeof data !== 'object') return;
    const m = data;
    // 房主以第一个 welcome 为准；之后只认它发来的消息，别人没法冒充房主往页面里写 HTML
    const fromHost = peerId === Net.hostPeerId;
    if (m.kind === 'welcome') {
      if (Net.hostPeerId && !fromHost) return;
      Net.hostPeerId = peerId;
      enterLobby();
      $('mpStatus').textContent = '已连接房主，请点“准备”。';
      myReady = false;
    } else if (m.kind === 'busy') {
      if (Net.hostPeerId && !fromHost) return;
      if (m.text) alert(m.text);
      leaveNetRoom();
      showScreen('setup');
    } else if (fromHost) {
      if (m.kind === 'roster') { roster = m.list; renderRoster(); }
      else if (m.kind === 'line') addLog(m.html, m.cls);
      else if (m.kind === 'veil') veilFlash(m.text, m.cls);
      else if (m.kind === 'view') { if (MY) clientPaint(m.v); }
      else if (m.kind === 'speaker') clientSpeaker(m.id);
      else if (m.kind === 'thinking') clientThinking(m.id, m.on);
      else if (m.kind === 'stage') elGame.dataset.stage = m.stage || 'table';
      else if (m.kind === 'start') clientStart(m);
      else if (m.kind === 'ask') clientAsk(m);
      else if (m.kind === 'cancel') clientCancel(m.askId);
      else if (m.kind === 'over') showOverlayClient(m);
    }
  };

  room.onPeerLeave = (peerId) => {
    if (peerId === Net.hostPeerId) {
      addLog(`<span class="who">系统</span>：房主离开了房间，游戏结束。`, 'dead');
      leaveNetRoom();
      showScreen('setup');
    }
  };

  showScreen('lobby');
  $('lobbyTitle').textContent = '连接中…';
  $('roomCodeTxt').textContent = c;   // 客人也显示房间号
  $('hostCodeWrap').classList.remove('hidden');
  $('clientWait').classList.remove('hidden');
  $('hostCntWrap').classList.add('hidden');
  $('mpRolesRow').classList.add('hidden');
  $('mpBrainRow').classList.add('hidden');
  $('mpStartBtn').classList.add('hidden');
  $('mpReadyBtn').classList.remove('hidden');
  $('mpStatus').textContent = '正在寻找房主…';
  $('mpRoster').innerHTML = '<div class="roster-empty">连接中…</div>';
  sayHello();
  const timer = setInterval(() => { if (!Net.hostPeerId) sayHello(); else clearInterval(timer); }, 1500);
  Net._helloTimer = timer;
}

function showOverlayClient(m) {
  const winColor = m.winnerCamp === 'good' ? 'var(--good)' : (m.winnerCamp === 'wolf' ? 'var(--wolf)' : 'var(--text)');
  const title = m.winnerCamp === 'good' ? '🏆 好人阵营胜利！' : (m.winnerCamp === 'wolf' ? '🐺 狼人阵营胜利！' : '🌫️ 游戏结束');
  $('ovTitle').textContent = title;
  $('ovTitle').style.color = winColor;
  $('ovText').innerHTML = '';
  if (!MY) return;
  const myRole = ROLES[MY.roleId];
  $('ovRoles').innerHTML = m.rolesHtml;
  showMinds(typeof m.mindsHtml === 'string' ? m.mindsHtml : '');
  $('stRole').textContent = '本局你为 ' + myRole.icon + ' ' + myRole.name;
  elOverlay.classList.remove('hidden');
}

function peerLeaveInGame(peerId) {
  const p = G.players.find(x => x.peerId === peerId);
  if (!p) return;
  p.gone = true;   // 之后轮到他时 askSeat 直接跳过
  pubEvent({ k: 'gone', id: p.id });
  flushSeatAsks(p.id);
  pubLog(`📴 <b>${esc(p.name)}</b> 掉线了（本局将自动跳过其所有操作）。`, 'sys');
  syncViews();
}

function leaveNetRoom() {
  if (Net && Net.leave) Net.leave();
  if (Net && Net._helloTimer) clearInterval(Net._helloTimer);
  Net = null;
  roomNet = null;
  MODE = 'solo';
  G = null;
  MY = null;
}

/* ============================================================
 * 事件绑定 & 初始化
 * ============================================================ */
$('startBtn').onclick = () => {
  if (Net) leaveNetRoom();
  const n = parseInt($('countSel').value, 10);
  startLocalGame(n);
};
$('againBtn').onclick = () => { location.reload(); };
$('countSel').onchange = () => showRolePreview(parseInt($('countSel').value, 10));
$('mpCountSel').onchange = () => updateLobbyControls();

$('joinBtn').onclick = async () => {
  if (!Net && G && !G.over) { location.reload(); return; }
  await joinRoom($('joinCodeInp').value);   // 离开当前房间放在 joinRoom 的校验之后
};

$('mpStartBtn').onclick = () => {
  if (MODE !== 'host') return;
  startHostGame();
};
$('mpReadyBtn').onclick = () => {
  if (MODE !== 'client') return;
  myReady = !myReady;
  broadcast({ kind: 'ready', ready: myReady });
  updateLobbyControls();
};
$('mpLeaveBtn').onclick = () => {
  if (Net) leaveNetRoom();
  showScreen('setup');
  $('phaseBadge').textContent = '准备中';
};

showRolePreview(8);
