// 通过 CDP 在真实 Chrome 里跑 Worker 自测页并抓取 <pre> 文本
try {
const appPort = process.env.APP_PORT || '5199';
const cdpPort = process.env.CDP_PORT || '9333';
const base = `http://localhost:${cdpPort}`;
const http = await import('node:http');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(base + path, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

function put(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method: 'PUT' }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end();
  });
}

await put(`/json/new?http://localhost:${appPort}/selftest.html`).catch((e) => console.error('put err', e.message));
await new Promise((r) => setTimeout(r, 1500));
const targets = await get('/json/list');
const target = targets.find((t) => t.url.includes('selftest'));
if (!target) { console.error('target not found'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
}

await send('Page.enable');
await send('Runtime.enable');

// 轮询 <pre> 直到出现 ALL PASS / FAIL
const deadline = Date.now() + 15000;
let result = '';
while (Date.now() < deadline) {
  const r = await send('Runtime.evaluate', {
    expression: 'document.getElementById("out").textContent',
    returnByValue: true,
  });
  result = r.result.value || '';
  if (/ALL PASS|SELFTEST_FAIL|WORKER ERROR|PAGE ERROR/.test(result)) break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log(result);
process.exit(result.includes('ALL PASS') ? 0 : 2);
} catch (e) {
  console.error('SCRIPT ERROR:', e.stack || e.message);
  process.exit(3);
}
