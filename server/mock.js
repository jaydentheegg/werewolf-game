/* ============================================================
 * server/mock.js · 离线模拟大脑（npm run mock / AI_MOCK=1）
 *
 * 不调任何 API，用简单的启发式给出决定和一句「内心独白」。
 * 用途：没有 API Key 时也能把整条链路（浏览器 → 服务端 → 决策 → 回填）
 * 跑通、调样式、写测试。它不聪明，真正的思考交给 Claude。
 * ============================================================ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export async function mockDecide(task, view) {
  await sleep(250 + Math.random() * 650);   // 装作在想
  const o = view.options || {};
  const targets = Array.isArray(o.targets) ? o.targets : [];
  const nameOf = (id) => view.players.find((p) => p.id === id)?.name || `${id} 号`;
  const mates = new Set(view.mates || []);
  const checks = (view.secrets || []).filter((s) => s.k === 'check');
  const knownWolf = checks.find((c) => c.wolf && view.players.find((p) => p.id === c.id)?.alive);
  const suspicious = (list) => {
    if (view.me.role === 'wolf') return pick(list.filter((id) => !mates.has(id))) ?? pick(list);
    if (knownWolf && list.includes(knownWolf.id)) return knownWolf.id;
    return pick(list);
  };
  const notes = `（模拟）第 ${view.round} ${view.phase === 'day' ? '天' : '夜'}：暂无确定结论。`;

  switch (task) {
    case 'speak': {
      const t = suspicious(targets);
      const speech = knownWolf && view.me.role === 'seer'
        ? `我是预言家，昨晚验了${nameOf(knownWolf.id)}，是狼，今天出他。`
        : pick([`我先听一圈，${nameOf(t)}刚才有点怪。`, `我是好人，${nameOf(t)}的发言站不住。`, '信息太少，我先不乱踩。']);
      return { thought: `（模拟）我想把节奏带到${nameOf(t)}身上。`, speech, suspect: t ?? -1, notes };
    }
    case 'vote':
    case 'wolf_kill':
    case 'hunter_shoot': {
      const t = task === 'wolf_kill' && Array.isArray(o.proposals) && o.proposals[0]
        ? o.proposals[0].target
        : suspicious(targets);
      return { thought: `（模拟）选 ${nameOf(t)}。`, target: t ?? -1, notes };
    }
    case 'seer_check': {
      const unchecked = targets.filter((id) => !checks.some((c) => c.id === id));
      const t = pick(unchecked.length ? unchecked : targets);
      return { thought: `（模拟）今晚看看 ${nameOf(t)}。`, target: t, notes };
    }
    case 'witch': {
      const heal = !!o.canHeal && Math.random() < 0.6;
      const poison = o.canPoison && knownWolf && (o.poisonTargets || []).includes(knownWolf.id) ? knownWolf.id : -1;
      return { thought: heal ? '（模拟）先把人救下来。' : '（模拟）这瓶药先留着。', heal, poison, notes };
    }
    default:
      throw new Error(`unknown task ${task}`);
  }
}
