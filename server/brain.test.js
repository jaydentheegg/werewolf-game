/* npm test —— 不需要 API Key：Claude 那一侧用本地假服务顶替 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createBrain, normalizeDecision, renderView, sanitizeView } from './brain.js';

const players = [
  { id: 0, name: '你', alive: true, role: null },
  { id: 1, name: '小明', alive: true, role: null },
  { id: 2, name: '阿强', alive: true, role: null },
  { id: 3, name: '小美', alive: false, role: 'seer' },
];
const wolfView = {
  me: { id: 1, name: '小明', role: 'wolf', persona: '心直口快' },
  mates: [2],
  round: 2,
  phase: 'day',
  players,
  events: [
    { r: 1, k: 'dawn', dead: [3] },
    { r: 1, k: 'speech', id: 0, text: '我怀疑阿强' },
    { r: 1, k: 'votes', votes: [[0, 2], [1, 0], [2, 0]] },
    { r: 1, k: 'tie' },
  ],
  secrets: [{ r: 1, k: 'kill', id: 3 }],
  notes: '你一直在踩阿强',
  options: { targets: [0, 2] },
};

test('局面渲染：自己的身份、队友、公开记录、私密信息、笔记都在，活人身份不泄露', () => {
  const text = renderView('vote', sanitizeView(wolfView));
  assert.match(text, /你是「小明」（座位 1），身份：狼人/);
  assert.match(text, /你的狼队友：阿强（座位 2）/);
  assert.match(text, /心直口快/);
  assert.match(text, /第 1 夜过后：昨夜死亡 —— 小美/);
  assert.match(text, /你 发言：我怀疑阿强/);
  assert.match(text, /投票明细：你→阿强，小明→你，阿强→你/);
  assert.match(text, /第 1 夜狼队决定击杀 小美/);
  assert.match(text, /你一直在踩阿强/);
  assert.match(text, /3：小美 · 已出局，身份公开：预言家/);
  assert.match(text, /0：你 · 存活/);
  assert.doesNotMatch(text, /0：你 · 存活.*身份/);
});

test('非狼人看不到队友一栏', () => {
  const text = renderView('vote', sanitizeView({ ...wolfView, me: { id: 0, name: '你', role: 'villager' }, mates: [] }));
  assert.doesNotMatch(text, /狼队友/);
});

test('决定校验：只接受给出的目标', () => {
  const v = sanitizeView(wolfView);
  assert.equal(normalizeDecision('vote', { thought: 't', target: 2, notes: 'n' }, v).target, 2);
  assert.throws(() => normalizeDecision('vote', { thought: 't', target: 3, notes: 'n' }, v));
  assert.throws(() => normalizeDecision('vote', { thought: 't', target: -1, notes: 'n' }, v));
  assert.throws(() => normalizeDecision('hunter_shoot', { thought: 't', target: 1, notes: 'n' }, v));
  const speak = normalizeDecision('speak', { thought: 't', speech: '“我是好人”', suspect: 9, notes: 'n' }, v);
  assert.equal(speak.speech, '我是好人');
  assert.equal(speak.suspect, -1);
});

test('女巫：没药时不许用，毒药只能毒给出的人', () => {
  const base = sanitizeView({ ...wolfView, options: { victim: 0, canHeal: false, canPoison: true, poisonTargets: [2] } });
  const d = normalizeDecision('witch', { thought: 't', heal: true, poison: 2, notes: 'n' }, base);
  assert.deepEqual([d.heal, d.poison], [false, 2]);
  assert.throws(() => normalizeDecision('witch', { thought: 't', heal: false, poison: 1, notes: 'n' }, base));
  const noPoison = sanitizeView({ ...wolfView, options: { victim: 0, canHeal: true, canPoison: false } });
  assert.equal(normalizeDecision('witch', { thought: 't', heal: true, poison: 2, notes: 'n' }, noPoison).poison, -1);
});

test('输入整形：超长名字 / 笔记被截断，非法身份归零', () => {
  const v = sanitizeView({
    me: { id: 1, name: 'x'.repeat(50), role: 'dragon' },
    players: [{ id: 1, name: 'y'.repeat(50), alive: true, role: 'king' }],
    notes: 'z'.repeat(2000),
  });
  assert.equal(v.me.role, 'villager');
  assert.equal(v.players[0].role, null);
  assert.ok(Array.from(v.me.name).length <= 13);
  assert.ok(Array.from(v.notes).length <= 401);
});

test('mock 大脑能给出合法决定', async () => {
  const brain = createBrain({ mock: true });
  assert.equal((await brain.status()).ready, true);
  const d = await brain.decide('vote', wolfView);
  assert.ok([0, 2].includes(d.target));
});

/* ---------- 假 Claude API：检查真正发出去的请求 ---------- */
function fakeApi(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      seen.push(entry);
      const [status, payload] = handler(entry, seen.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    seen,
    client: new Anthropic({ apiKey: 'test-key', baseURL: `http://127.0.0.1:${server.address().port}`, maxRetries: 0 }),
    close: () => server.close(),
  })));
}
const message = (text, stop = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: stop,
  content: text == null ? [] : [{ type: 'text', text }],
  usage: { input_tokens: 10, output_tokens: 10 },
});
const badRequest = { type: 'error', error: { type: 'invalid_request_error', message: 'unsupported' } };

test('Claude 请求：自适应思考 + effort + 结构化输出 + refusal fallback，结果被解析和校验', async () => {
  const api = await fakeApi(() => [200, message(JSON.stringify({ thought: '先刀你', target: 2, notes: '笔记' }))]);
  try {
    const brain = createBrain({ client: api.client, model: 'claude-opus-5', effort: 'low' });
    const d = await brain.decide('vote', wolfView);
    assert.deepEqual(d, { thought: '先刀你', notes: '笔记', target: 2 });
    const req = api.seen[0];
    assert.equal(req.url, '/v1/messages?beta=true');
    assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(req.body.model, 'claude-opus-5');
    assert.equal(req.body.fallbacks, 'default');
    assert.deepEqual(req.body.thinking, { type: 'adaptive' });
    assert.equal(req.body.output_config.effort, 'low');
    assert.equal(req.body.output_config.format.type, 'json_schema');
    assert.deepEqual(req.body.output_config.format.schema.required, ['thought', 'target', 'notes']);
    assert.equal(req.body.system[0].cache_control.type, 'ephemeral');
    assert.match(req.body.messages[0].content, /你是「小明」/);
  } finally { api.close(); }
});

test('模型给出非法目标 / 拒答 → 抛错（game.js 会退回规则 AI）', async () => {
  const api = await fakeApi((_, n) => (n === 1
    ? [200, message(JSON.stringify({ thought: 't', target: 3, notes: 'n' }))]
    : [200, message(null, 'refusal')]));
  try {
    const brain = createBrain({ client: api.client });
    await assert.rejects(brain.decide('vote', wolfView), /illegal target/);
    await assert.rejects(brain.decide('vote', wolfView), /refused/);
  } finally { api.close(); }
});

test('网关 / 老模型拒收高级参数 → 自动降级成朴素请求重试', async () => {
  const api = await fakeApi((_, n) => (n === 1
    ? [400, badRequest]
    : [200, message(JSON.stringify({ thought: 't', target: 0, notes: 'n' }))]));
  try {
    const brain = createBrain({ client: api.client, log: () => {} });
    assert.equal((await brain.decide('vote', wolfView)).target, 0);
    const retry = api.seen[1].body;
    assert.equal(retry.thinking, undefined);
    assert.equal(retry.fallbacks, undefined);
    assert.equal(retry.output_config.format.type, 'json_schema');
  } finally { api.close(); }
});

test('Haiku 不带 thinking / effort / fallbacks', async () => {
  const api = await fakeApi(() => [200, message(JSON.stringify({ thought: 't', target: 0, notes: 'n' }))]);
  try {
    await createBrain({ client: api.client, model: 'claude-haiku-4-5' }).decide('vote', wolfView);
    const body = api.seen[0].body;
    assert.equal(body.thinking, undefined);
    assert.equal(body.fallbacks, undefined);
    assert.equal(body.output_config.effort, undefined);
  } finally { api.close(); }
});

test('status：Key 无效时报不可用，模型存在时报可用', async () => {
  const api = await fakeApi((req, n) => (n === 1
    ? [401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }]
    : [200, { type: 'model', id: 'claude-opus-5', display_name: 'Claude Opus 5', created_at: '2026-01-01T00:00:00Z' }]));
  try {
    const bad = await createBrain({ client: api.client }).status();
    assert.equal(bad.ready, false);
    assert.match(bad.reason, /API Key/);
    const good = await createBrain({ client: api.client }).status();
    assert.equal(good.ready, true);
    assert.equal(api.seen[1].url, '/v1/models/claude-opus-5');
  } finally { api.close(); }
});

/* ---------- 真正起一个游戏服务（mock 大脑） ---------- */
test('游戏服务：托管页面、只给游戏文件、API 只收同源 JSON', async (t) => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const entry = fileURLToPath(new URL('./index.js', import.meta.url));
  const child = spawn(process.execPath, [entry, '--mock'], { env: { ...process.env, PORT: String(port) }, stdio: 'pipe' });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (c) => { if (String(c).includes('打开')) resolve(); });
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const get = (p) => fetch(base + p);

  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/ai.js')).status, 200);
  for (const p of ['/server/brain.js', '/package.json', '/.env', '/node_modules/@anthropic-ai/sdk/package.json', '/CLAUDE.md']) {
    assert.equal((await get(p)).status, 404, p);
  }
  const st = await (await get('/api/ai/status')).json();
  assert.equal(st.ready, true);
  // fetch 会吞掉自定义 Host 头，DNS rebinding 这一条用原生 http 模拟
  const rebind = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/ai/status', headers: { Host: 'evil.example' } },
      (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(rebind, 403);

  const post = (body, headers = {}) => fetch(base + '/api/ai/decide', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const ok = await (await post({ task: 'vote', view: wolfView })).json();
  assert.equal(ok.ok, true);
  assert.ok([0, 2].includes(ok.decision.target));
  assert.equal((await post({ task: 'rm -rf', view: wolfView })).status, 400);
  assert.equal((await post({ task: 'vote', view: wolfView }, { Origin: 'https://evil.example' })).status, 403);
  const plain = await fetch(base + '/api/ai/decide', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(plain.status, 415);
});
