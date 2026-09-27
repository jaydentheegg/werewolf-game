/* ============================================================
 * server/index.js · 本地游戏服务
 *
 *   npm start          → http://127.0.0.1:8787 ，AI 玩家由 Claude 驱动
 *   npm run mock       → 同上，但用离线模拟大脑（不需要 API Key）
 *
 * 职责只有两件：
 *   1. 托管静态页面（index.html / *.css / *.js / assets）
 *   2. /api/ai/*：替浏览器保管 API Key、调用 Claude，给 AI 座位出主意
 * 游戏规则与状态仍全部在浏览器的 game.js 里；这里没有任何对局状态。
 * ============================================================ */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrain, explain, TASKS } from './brain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* 没有 .env 就用环境变量 */ }

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
    return sendJson(res, 200, { ok: true, ...(await brain.status()) });
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
  else console.log(`  AI 玩家：暂不可用 —— ${st.reason}\n  （游戏照常可玩，AI 座位会退回经典规则；配置好后刷新页面即可）\n`);
});
