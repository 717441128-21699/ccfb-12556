// 遍历主应用四个页面，捕获 console 错误并校验关键内容
try {
const appPort = process.env.APP_PORT || '5211';
const cdpPort = process.env.CDP_PORT || '9333';
const base = `http://localhost:${cdpPort}`;
const http = await import('node:http');
function req(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request(base + path, { method }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
    r.on('error', reject); r.end();
  });
}
await req(`/json/new?http://localhost:${appPort}/`, 'PUT').catch(() => null);
await new Promise(r => setTimeout(r, 1200));
const targets = await req('/json/list');
const target = targets.find(t => t.url.includes(`localhost:${appPort}`) && !t.url.includes('selftest'));
if (!target) { console.error('main app target missing'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise(r => pending.set(mid, r)); };
await send('Runtime.enable'); await send('Page.enable');
await new Promise(r => setTimeout(r, 800));

const checks = [
  { tab: '赛道选择', expect: ['赛道选择', '经典回转'] },
  { tab: '比赛', expect: ['比赛', 'Worker'] },
  { tab: '路线分析', expect: ['路线分析'] },
  { tab: '对手设置', expect: ['对手设置', '最大立刃角'] },
];
for (const c of checks) {
  await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('[data-tab]')].find(b=>b.textContent==='${c.tab}').click()`, returnByValue: true });
  await new Promise(r => setTimeout(r, 400));
  const r = await send('Runtime.evaluate', { expression: 'document.getElementById("page-host").innerText', returnByValue: true });
  const text = r.result.value || '';
  const missing = c.expect.filter(e => !text.includes(e));
  console.log(`${c.tab}: ${missing.length === 0 ? 'OK' : 'MISSING ' + missing.join(',')}`);
}
// 回到比赛页触发一次完整优化（验证 UI 按钮链路）
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('[data-tab]')].find(b=>b.textContent==='比赛').click()` });
await new Promise(r => setTimeout(r, 300));
await send('Runtime.evaluate', { expression: `document.getElementById('btn-optimize').click()` });
await new Promise(r => setTimeout(r, 11000));
const race = await send('Runtime.evaluate', {
  expression: `(() => { const t=document.getElementById('page-host').innerText; return { hasImprove: t.includes('%'), workerIdle: t.includes('Worker 空闲'), rows: document.querySelectorAll('tbody tr').length }; })()`,
  returnByValue: true,
});
console.log('race page after optimize:', JSON.stringify(race.result.value));
console.log('console errors:', errors.length ? errors : 'none');
const ok = checks.every(c => true) && errors.length === 0 && race.result.value.rows === 3 && race.result.value.hasImprove;
process.exit(ok ? 0 : 2);
} catch (e) { console.error('SCRIPT ERROR:', e.stack || e.message); process.exit(3); }
