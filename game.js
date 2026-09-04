/* ============================================================
 * 网页狼人杀 · 单机 + 真人联机版
 * 规则：狼人 / 预言家 / 女巫 / 猎人 / 村民
 *
 * 架构：
 *  - 单机：本页即 0 号位玩家，其余座位为 AI。
 *  - 联机：房主页面 = 权威状态机（跑完整局），其他真人通过
 *    Trystero P2P（同一房间号）接入；身份/夜间行动/查验结果
 *    只定向发给本人；公开事件（发言/投票/死亡）广播给所有人。
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

const BOT_NAMES = ['小明', '小红', '阿强', '小美', '大壮', '静香', '老王', '阿豪', '丽丽', '铁柱', '翠花', '二狗', '小芳', '老张', '毛毛', '丫丫'];

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
    let html = `<div class="atitle">${title}</div>`;
    if (hint) html += `<div class="hint">${hint}</div>`;
    html += '<div class="optgrid" id="optWrap"></div>';
    elAction.innerHTML = html;
    const wrap = $('optWrap');
    opts.forEach((opt) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (opt.cls || 'ghost');
      b.textContent = opt.label;
      b.onclick = () => resolve(opt.value);
      wrap.appendChild(b);
    });
  });
}
function widgetText({ title, hint, placeholder }) {
  return new Promise((resolve) => {
    let html = `<div class="atitle">${title}</div>`;
    if (hint) html += `<div class="hint">${hint}</div>`;
    html += `<input type="text" id="chatInput" placeholder="${esc(placeholder || '说点什么…')}" maxlength="60">`;
    html += '<div class="optrow" style="margin-top:10px"><button class="btn primary" id="chatSend">发送</button>' +
            '<button class="btn ghost" id="chatSkip">跳过发言</button></div>';
    elAction.innerHTML = html;
    const inp = $('chatInput');
    const send = () => { const v = inp.value.trim(); resolve(v); };
    $('chatSend').onclick = send;
    $('chatSkip').onclick = () => resolve('');
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
    if (veil) veilSync(veil.text, veil.cls || '', 1800);
  } else {
    const p = G.players[seat];
    if (p && p.peerId && Net) sendTo(p.peerId, { kind: 'line', html, cls });
    if (veil && p && p.peerId && Net) sendTo(p.peerId, { kind: 'veil', text: veil.text, cls: veil.cls || '' });
  }
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
  if (!p || p.isBot) return Promise.resolve(null);
  if (!p.peerId || MODE === 'solo') {
    // 本地真人座位（房主自己 / 单机玩家）
    return kind === 'pick'
      ? widgetPick(spec)
      : widgetText(spec);
  }
  // 远端真人
  return new Promise((resolve) => {
    const askId = 'a' + (++askSeq);
    pendingAsks[askId] = {
      seat,
      resolve: (v) => { clearTimeout(pendingAsks[askId].timer); delete pendingAsks[askId]; resolve(v); },
      timer: setTimeout(() => {
        // 120 秒没操作 → 自动跳过（记为 null），避免卡局
        pendingAsks[askId].resolve(null);
        broadcast({ kind: 'line', html: `⏰ <b>${esc(p.name)}</b> 长时间未操作，本回合自动跳过。`, cls: 'sys' });
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
 * 夜晚
 * ============================================================ */
async function ambientVeil(text, cls, ms) {
  if (MODE === 'solo') { await veilSync(text, cls, ms); }
  else await sleep(Math.min(ms, 800));
}

/* 狼队选择击杀目标：真人各自投选 → 多数决（平票随机）；
 * 无真人狼时由 AI 随机。空选（跳过）→ AI 随机兜底。 */
async function wolvesDecide() {
  const wolves = alivePs().filter(p => p.role === 'wolf');
  const goodOnes = alivePs().filter(p => p.role !== 'wolf');
  if (!wolves.length || !goodOnes.length) return null;

  const humanWolves = wolves.filter(p => !p.isBot);
  if (!humanWolves.length) {
    await ambientVeil('🌑 狼人睁眼…', 'night', 1300);
    await sleep(600);
    return pick(goodOnes).id;
  }
  const picks = [];
  for (const w of humanWolves) {
    const v = await askSeat('pick', w.id, {
      title: '🐺 你是狼人，今晚杀谁？',
      hint: '狼队无法密聊：每名狼人悄悄投选一个目标，票多者成为今晚猎物（跳过则由 AI 兜底）。',
      opts: goodOnes.map(p => ({ label: p.name, value: p.id, cls: 'danger' })),
    });
    if (typeof v === 'number') picks.push(v);
  }
  if (!picks.length) return pick(goodOnes).id;
  const tally = {};
  picks.forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const maxV = Math.max(...Object.values(tally));
  const top = Object.keys(tally).filter(id => tally[id] === maxV);
  return +pick(top);
}

/* 猎人挑目标（开枪），返回玩家或 null */
async function hunterAct(hunter) {
  const others = aliveOthers(hunter.id);
  if (!others.length) return null;
  if (hunter.isBot) {
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
    const target = await hunterAct(p);
    if (target) await publicDeathOf(target, 'gun');
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
    const target = await hunterAct(p);
    if (target && target.alive) {
      target.alive = false;
      G.nightDead.push(target);
    }
  }
}

async function nightPhase() {
  await pubVeil('🌙 天黑请闭眼…', 'night', 1600);
  logHeader(`夜晚（第 ${G.night} 夜）`);
  G.phase = 'night';
  G.nightDead = [];

  // ---- 狼人行动 ----
  const victim = byId(await wolvesDecide());

  // ---- 预言家行动 ----
  const seer = alivePs().find(p => p.role === 'seer');
  if (seer) {
    const targets = aliveOthers(seer.id);
    if (targets.length) {
      if (seer.isBot) {
        await ambientVeil('🔮 预言家睁眼…', 'night', 1100);
        const t = pick(targets);
        seer.botSeerSuspect = t.role === 'wolf' ? t.id : null;
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
          privTo(seer.id,
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
    if (witch.isBot) {
      await ambientVeil('🧪 女巫睁眼…', 'night', 1100);
      const canHeal = witch.witch.heal && (victim.id !== witch.id || G.night === 1);
      if (canHeal && Math.random() < 0.55) { witch.witch.heal = false; saved = true; }
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
            { label: victim.id === witch.id ? '💊 救自己' : `💊 救 ${esc(victim.name)}`, value: true, cls: 'ok' },
            { label: '不救', value: false, cls: 'ghost' },
          ],
        });
      }
      if (healChoice === true) {
        witch.witch.heal = false; saved = true;
        privTo(witch.id, '🧪 你使用了解药，救下了他。', 'night');
      }
      // --- 毒药 ---
      if (witch.witch.poison) {
        const targets = aliveOthers(witch.id).filter(p => p.id !== victim.id);
        const pv = await askSeat('pick', witch.id, {
          title: '🧪 是否使用毒药？（可跳过）',
          hint: '选择要毒杀的目标：',
          opts: [{ label: '☠️ 不使用毒药', value: null, cls: 'ghost' }].concat(
            targets.map(p => ({ label: esc(p.name), value: p.id, cls: 'danger' }))
          ),
        });
        if (typeof pv === 'number') {
          witch.witch.poison = false;
          poisoned = byId(pv);
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
  for (const p of alivePs()) {
    if (G.over) break;
    paintHost(p.id);
    let text = null;
    if (p.isBot) {
      text = botSpeechLine(p);
      await pubLogSlow(`<span class="who">${esc(p.name)}</span>：${esc(text)}`, 'day', 380);
    } else {
      const v = await askSeat('text', p.id, {
        title: '🗣️ 轮到你发言',
        hint: '可以说明身份 / 指出怀疑对象 / 带节奏，也可以直接跳过。',
        placeholder: '例：我是预言家，昨晚查了小明确实是狼…',
      });
      text = v;
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

  // ---- 投票 ----
  await pubVeil('🗳️ 投票时间！', 'day', 1100);

  const tally = {};
  for (const p of alivePs()) {
    let toId = null;
    if (p.isBot) {
      const t = botVoteTarget(p);
      toId = t ? t.id : null;
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
  }

  await sleep(400);
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    const summary = entries.map(([id, c]) => `${esc(G.players.find(p => p.id === +id).name)} ${c}票`).join('，');
    pubLog(`<span class="who">📊 计票结果</span>：${summary}`, 'day');
  }

  let exiled = null;
  if (!entries.length || entries[0][1] === 0) {
    await pubLogSlow('⚖️ 无人投票，今天无人被放逐。', 'day', 900);
  } else {
    const maxV = entries[0][1];
    const leaders = entries.filter(e => e[1] === maxV).map(e => G.players.find(p => p.id === +e[0]));
    if (leaders.length > 1) {
      await pubLogSlow('⚖️ 平票，今天无人被放逐。', 'day', 900);
    } else {
      exiled = leaders[0];
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
  const comp = COMPOSITIONS[n];
  const counts = {};
  comp.forEach(r => counts[r] = (counts[r] || 0) + 1);
  $('rolePreview').innerHTML =
    Object.entries(counts).map(([r, c]) =>
      `<span>${ROLES[r].icon} ${ROLES[r].name} ×${c}</span>`).join('');
}

/* humans: [{peerId|null, name}]，peerId=null 表示房主本人 */
function dealGame(n, humans) {
  const roles = shuffle(COMPOSITIONS[n]);
  const takenNames = humans.map(h => h.name);
  const pool = shuffle(BOT_NAMES.filter(x => !takenNames.includes(x)));
  G = {
    n, mode: MODE,
    players: [], phase: 'night', night: 1, over: false, nightDead: [],
    mpHumanCount: humans.length,
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
  const name = $('nameInp').value.trim();
  dealGame(n, [{ peerId: null, name: '你' }]);
  if (name && n > 0) G.players[0].name = '你'; // 单机固定用"你"
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

  // 本地（房主）结算弹窗
  showOverlayLocal(winnerCamp, rolesHtml);
  // 通知客户端结算
  if (mpHost()) broadcast({ kind: 'over', winnerCamp, rolesHtml });
}

function showOverlayLocal(winnerCamp, rolesHtml) {
  const human = G.players[HOST_SEAT];
  const myRole = ROLES[human.role];
  const myCamp = myRole.camp;
  const winColor = winnerCamp === 'good' ? 'var(--good)' : (winnerCamp === 'wolf' ? 'var(--wolf)' : 'var(--text)');
  const title = winnerCamp === 'good' ? '🏆 好人阵营胜利！' : (winnerCamp === 'wolf' ? '🐺 狼人阵营胜利！' : '🌫️ 游戏结束');
  const youWon = winnerCamp === myCamp;
  $('ovTitle').textContent = title;
  $('ovTitle').style.color = winColor;
  $('ovText').innerHTML = youWon
    ? `🎉 你扮演的「${myRole.icon} ${myRole.name}」随阵营一起获胜！`
    : `😢 你扮演的「${myRole.icon} ${myRole.name}」未能获胜…`;
  $('ovRoles').innerHTML = rolesHtml;
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

function clientAsk(msg) {
  const spec = msg.spec;
  if (msg.kind2 === 'pick') {
    widgetPick({ title: spec.title, hint: spec.hint, opts: spec.opts }).then((v) => {
      sendTo(Net.hostPeerId, { kind: 'answer', askId: msg.askId, value: v });
    });
  } else {
    widgetText({ title: spec.title, hint: spec.hint, placeholder: spec.placeholder }).then((v) => {
      sendTo(Net.hostPeerId, { kind: 'answer', askId: msg.askId, value: v });
    });
  }
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
    if (humans > parseInt(cntSel.value, 10)) cntSel.value = String(Math.min(humans, 12));
    if (humans < 2) {
      startBtn.disabled = true;
      status.textContent = '需要至少 2 名真人才能开局（当前 1 人：你自己）';
    } else if (humansReady < humans) {
      startBtn.disabled = true;
      status.textContent = `等待玩家准备…（${humansReady}/${humans} 已准备）`;
    } else {
      startBtn.disabled = false;
      const bots = parseInt(cntSel.value, 10) - humans;
      status.textContent = `全部就绪！将开局 ${parseInt(cntSel.value, 10)} 人局（AI 补位 ${Math.max(bots, 0)} 人）`;
    }
  } else {
    $('mpReadyBtn').disabled = myReady;
    $('mpReadyBtn').textContent = myReady ? '✅ 已准备' : '🙋 准备';
    status.textContent = roster.length >= 2 ? `已加入 ${roster.length} 人，等待房主开始…` : '等待其他人加入…';
  }
}

async function enterLobby() {
  showScreen('lobby');
  const isHost = MODE === 'host';
  $('lobbyTitle').textContent = isHost ? '🌐 房间大厅（你是房主）' : '🌐 房间大厅';
  $('hostCodeWrap').classList.toggle('hidden', !isHost);
  $('clientWait').classList.toggle('hidden', isHost);
  $('hostCntWrap').classList.toggle('hidden', !isHost);
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
      if (greeted.has(peerId)) return;
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
    } else if (m.kind === 'answer') {
      const a = pendingAsks[m.askId];
      if (a && a.seat !== HOST_SEAT) a.resolve(m.value);
    }
  };
  pubLobbyLog(`🎉 ${hostName} 创建了房间`);
  $('roomCodeTxt').textContent = code;
  enterLobby();
}

function pubLobbyLog(text) {
  addLog(`<span class="who">大厅</span>：${esc(text)}`, 'sys');
  if (MODE === 'host') broadcast({ kind: 'line', html: `<span class="who">大厅</span>：${esc(text)}`, cls: 'sys' });
}

/* ---- 加入房间（客户端） ---- */
async function joinRoom(code) {
  if (!(await netReadyWait())) { alert('联机模块加载失败：请确认能联网后刷新页面重试（单机不受影响）。'); return; }
  hostName = nickName();
  const c = normCode(code);
  if (c.length < 3) { alert('房间号格式不对，请重新输入。'); return; }
  let room;
  try { room = netJoinRoom('ww-' + c); } catch (e) { alert('加入房间失败：' + e.message); return; }

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
      $('mpStatus').textContent = '⏳ 找不到房主，房间号可能错误…';
      return;
    }
    broadcast({ kind: 'hello', name: hostName });
  };

  roomNet.onMessage = (data, { peerId }) => {
    if (MODE !== 'client') return;
    if (!data || typeof data !== 'object') return;
    const m = data;
    if (m.kind === 'welcome') {
      Net.hostPeerId = peerId;
      enterLobby();
      $('mpStatus').textContent = '已连接房主，请点“准备”。';
      myReady = false;
    } else if (m.kind === 'roster') {
      // 只有房主会广播名单；若房主身份尚未确认，顺势认领
      if (!Net.hostPeerId) Net.hostPeerId = peerId;
      roster = m.list;
      renderRoster();
    } else if (m.kind === 'busy') {
      if (m.text) alert(m.text);
      leaveNetRoom();
      showScreen('setup');
    } else if (peerId === Net.hostPeerId) {
      if (m.kind === 'line') addLog(m.html, m.cls);
      else if (m.kind === 'veil') veilFlash(m.text, m.cls);
      else if (m.kind === 'view') { if (MY) clientPaint(m.v); }
      else if (m.kind === 'start') clientStart(m);
      else if (m.kind === 'ask') clientAsk(m);
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
  $('lobbyTitle').textContent = '🌐 连接中…';
  $('hostCodeWrap').classList.add('hidden');
  $('clientWait').classList.remove('hidden');
  $('hostCntWrap').classList.add('hidden');
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
  if (!MY) return;
  const myRole = ROLES[MY.roleId];
  const youWon = m.winnerCamp === myRole.camp;
  $('ovText').innerHTML = youWon
    ? `🎉 你扮演的「${myRole.icon} ${myRole.name}」随阵营一起获胜！`
    : `😢 你扮演的「${myRole.icon} ${myRole.name}」未能获胜…`;
  $('ovRoles').innerHTML = m.rolesHtml;
  $('stRole').textContent = '本局你为 ' + myRole.icon + ' ' + myRole.name;
  elOverlay.classList.remove('hidden');
}

function peerLeaveInGame(peerId) {
  const p = G.players.find(x => x.peerId === peerId);
  flushSeatAsks(p ? p.id : -1);
  if (!p) return;
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

$('btnCreate').onclick = async () => {
  if (Net) leaveNetRoom();
  if (G && !G.over) { location.reload(); return; }
  await createRoom();
};
$('btnJoin').onclick = () => {
  $('joinRow').classList.toggle('hidden');
  if (!$('joinRow').classList.contains('hidden')) $('joinCodeInp').focus();
};
$('joinBtn').onclick = async () => {
  if (Net) leaveNetRoom();
  if (G && !G.over) { location.reload(); return; }
  await joinRoom($('joinCodeInp').value);
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
