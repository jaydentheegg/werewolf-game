/* ============================================================
 * server/index.js · 本地游戏服务
 *
 *   npm start          → http://127.0.0.1:8787 ，AI 玩家由 Claude 驱动
 *   npm run mock       → 同上，但用离线模拟大脑（不需要 API Key）
 *
 * 职责只有两件：
 *   1. 托管静态页面（index.html / *.css / *.js / assets）
 *   2. /api/ai/*：替浏览器保管 API Key（可以在页面的 BRAIN 一栏填）、调用 Claude，给 AI 座位出主意
 * 游戏规则与状态仍全部在浏览器的 game.js 里；这里没有任何对局状态。
 * ============================================================ */
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrain, explain, TASKS } from './brain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.AI_ENV_FILE || path.join(ROOT, '.env');   // AI_ENV_FILE 只给测试用
// 先记下终端里本来就有的 Key：.env 不会覆盖它，后面要靠它分辨 Key 从哪来
const SHELL_KEY = process.env.ANTHROPIC_API_KEY || '';
try { process.loadEnvFile(ENV_FILE); } catch { /* 没有 .env 就用环境变量 */ }

const args = new Set(process.argv.slice(2));
const PORT = parseInt(process.env.PORT, 10) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const MOCK = args.has('--mock') || /^(1|true|yes)$/i.test(process.env.AI_MOCK || '');
const MODEL = process.env.AI_MODEL || 'claude-opus-5';
const EFFORT = process.env.AI_EFFORT || 'low';

const brain = createBrain({
  model: MODEL,
  effort: EFFORT,
  mock: MOCK,
  timeoutMs: (parseInt(process.env.AI_TIMEOUT, 10) || 45) * 1000,
  log: (msg) => console.log(`[ai] ${msg}`),
});

/* ---------- API Key ----------
 * 玩家可以在页面上填 Key：它只到这台电脑上的服务为止，永远不会回传给浏览器；
 * 勾选「记住」就写进 .env（已在 .gitignore 里）。来源：
 *   env  —— 启动服务的终端环境变量（页面上删不掉，只能在终端里改）
 *   file —— .env 文件（包括页面上勾了「记住」的）
 *   page —— 页面上填的、没勾「记住」，只在这次运行里有效 */
const KEY_LINE = /^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=/;
const keyState = { source: null, hint: null };

function maskKey(k) { return k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : '…'; }
function syncKeyFromEnv() {
  const k = process.env.ANTHROPIC_API_KEY || '';
  keyState.source = k ? (k === SHELL_KEY ? 'env' : 'file') : null;
  keyState.hint = k ? maskKey(k) : null;
}
syncKeyFromEnv();

/* 改写 .env 里的 ANTHROPIC_API_KEY 一行（key 为空 = 删掉），其他行和顺序原样保留 */
async function writeFileKey(key) {
  let lines = [];
  try { lines = (await readFile(ENV_FILE, 'utf8')).split(/\r?\n/); } catch { /* 还没有 .env */ }
  const out = [];
  let written = false;
  for (const line of lines) {
    if (!KEY_LINE.test(line)) { out.push(line); continue; }
    if (key && !written) out.push(`ANTHROPIC_API_KEY=${key}`);
    written = true;
  }
  if (key && !written) out.push(`ANTHROPIC_API_KEY=${key}`);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  await writeFile(ENV_FILE, out.length ? out.join('\n') + '\n' : '', { mode: 0o600 });
}

/* 只有坐在这台电脑前的人才能换 Key（HOST=0.0.0.0 时局域网里的人可以玩，但改不了 Key） */
function localClient(req) {
  return /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
}
function keyInfo(req) {
  return { source: keyState.source, hint: keyState.hint, editable: !MOCK && localClient(req) };
}

/* ---------- 静态文件 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
// 只把游戏本身暴露出去：服务端代码、依赖、配置、点文件一律不给
const PRIVATE_DIRS = new Set(['server', 'node_modules']);

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad Request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const parts = rel.split('/').filter(Boolean);
  const ext = path.extname(rel).toLowerCase();
  if (!MIME[ext] || parts.some((p) => p.startsWith('.') || p === '..') || PRIVATE_DIRS.has(parts[0])) {
    return send(res, 404, 'Not Found');
  }
  const file = path.join(ROOT, ...parts);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not Found');
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext],
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, 'Not Found');
  }
}

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}
function sendJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('bad json'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

/* ---------- 访问控制 ----------
 * API 会花你的 Claude 额度，所以只给「本页面」用：
 *  - 默认只监听 127.0.0.1；此时 Host 头必须是本机名（挡 DNS rebinding）
 *  - 不发任何 CORS 头 + 强制 application/json → 别的网站没法跨域调用 */
const LOOPBACK = /^(127\.0\.0\.1|localhost|::1)$/;
function hostAllowed(req) {
  if (!LOOPBACK.test(HOST)) return true;
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return LOOPBACK.test(host);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/* ---------- API ---------- */
async function handleApi(req, res, pathname) {
  if (!hostAllowed(req) || !sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });

  if (pathname === '/api/ai/status' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, ...(await brain.status()), key: keyInfo(req) });
  }

  if (pathname === '/api/ai/key' && (req.method === 'POST' || req.method === 'DELETE')) {
    if (MOCK) return sendJson(res, 409, { ok: false, error: '模拟大脑不需要 API Key' });
    if (!localClient(req)) return sendJson(res, 403, { ok: false, error: '只能在运行游戏服务的那台电脑上填写 API Key' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return sendJson(res, 415, { ok: false, error: 'json only' });
    }
    let body;
    try { body = await readJson(req, 4096); } catch (err) { return sendJson(res, err.code || 400, { ok: false, error: err.message }); }

    if (req.method === 'DELETE') {
      if (keyState.source === 'env') {
        return sendJson(res, 409, { ok: false, error: '这把 Key 来自启动服务时的环境变量，请在终端里修改' });
      }
      if (keyState.source === 'file') {
        try { await writeFileKey(''); } catch (err) { return sendJson(res, 500, { ok: false, error: `改写 .env 失败：${err.code || err.message}` }); }
        if (SHELL_KEY) process.env.ANTHROPIC_API_KEY = SHELL_KEY; else delete process.env.ANTHROPIC_API_KEY;
      }
      brain.resetKey();
      syncKeyFromEnv();
      console.log('[ai] 已按页面要求移除 API Key');
      return sendJson(res, 200, { ok: true, ...(await brain.status()), key: keyInfo(req) });
    }

    // Key 只允许可见 ASCII、不带空白：顺带杜绝往 .env 里注入换行
    const key = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!/^[\x21-\x7e]{20,400}$/.test(key)) return sendJson(res, 400, { ok: false, error: 'Key 的格式不对，请粘贴完整的 API Key' });
    const st = await brain.useKey(key);
    if (!st.ready) return sendJson(res, 400, { ok: false, error: st.reason || '这把 Key 用不了' });
    let warning = '';
    keyState.source = 'page';
    if (body.remember) {
      try { await writeFileKey(key); keyState.source = 'file'; }
      catch (err) { warning = `Key 已生效，但保存到 .env 失败（${err.code || err.message}），重启服务后需要重新填写`; }
    }
    keyState.hint = maskKey(key);
    console.log(`[ai] 已换上页面填写的 API Key（${keyState.hint}）${keyState.source === 'file' ? '，并保存到 .env' : ''}`);
    return sendJson(res, 200, { ok: true, ...st, key: keyInfo(req), warning });
  }

  if (pathname === '/api/ai/decide' && req.method === 'POST') {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return sendJson(res, 415, { ok: false, error: 'json only' });
    }
    let body;
    try { body = await readJson(req); } catch (err) { return sendJson(res, err.code || 400, { ok: false, error: err.message }); }
    const { task, view } = body || {};
    if (!TASKS.includes(task)) return sendJson(res, 400, { ok: false, error: 'unknown task' });
    const who = String(view?.me?.name || '?').slice(0, 12);
    const t0 = Date.now();
    try {
      const decision = await brain.decide(task, view);
      console.log(`[ai] ${who} · ${task} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return sendJson(res, 200, { ok: true, decision });
    } catch (err) {
      console.warn(`[ai] ${who} · ${task} 失败：${explain(err)}`);
      // 422 = 模型答得不合规（这一次退回规则 AI）；502 = 上游出错（浏览器会计入掉线判定）
      return sendJson(res, err.invalid ? 422 : 502, { ok: false, error: explain(err) });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { return send(res, 400, 'Bad Request'); }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'Internal Server Error');
  }
});

server.listen(PORT, HOST, async () => {
  const shown = LOOPBACK.test(HOST) ? 'localhost' : HOST;
  console.log(`\n  MIDNIGHT · 天黑，请闭眼`);
  console.log(`  打开 → http://${shown}:${PORT}/\n`);
  const st = await brain.status();
  if (st.ready) console.log(`  AI 玩家：${st.mock ? '离线模拟大脑（--mock）' : `Claude · ${st.model}（effort=${EFFORT}）`}\n`);
  else console.log(`  AI 玩家：暂不可用 —— ${st.reason}\n  （游戏照常可玩，AI 座位会退回经典规则；可以在页面开局清单的 BRAIN 一栏直接填 API Key）\n`);
});
