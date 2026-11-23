import { store, type RivalState } from '../store';
import { drawCourse } from '../renderer';

let rafId = 0;
let replayT = 0;
let playing = false;

function fmtTime(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(2) + 's';
}

function rivalRow(r: RivalState): string {
  const race = r.race;
  const statusText: Record<RivalState['status'], string> = {
    idle: '待计算',
    optimizing: '优化走线中…',
    ready: '就绪',
    racing: '比赛模拟中…',
    error: '错误',
  };
  return `
    <tr>
      <td><span class="badge-dot" style="background:${r.persona.color}"></span>${r.persona.name}
        <span class="tag ${r.persona.risk}" style="margin-left:6px">${
          r.persona.risk === 'aggressive' ? '冒险' : r.persona.risk === 'cautious' ? '稳健' : '均衡'
        }</span></td>
      <td class="num">${r.line ? fmtTime(r.line.totalTime) : '—'}</td>
      <td class="num">${r.improvementPct != null ? `<span class="good">${(r.improvementPct * 100).toFixed(1)}%</span>` : '—'}</td>
      <td class="num">${race ? (race.finished ? fmtTime(race.finishTime) : 'DNF') : '—'}</td>
      <td class="num">${race ? race.maxSpeed.toFixed(1) : '—'}</td>
      <td>${race ? (race.finished
        ? '<span class="pill-result finish">完赛</span>'
        : `<span class="pill-result dnf" title="${race.dnfReason ?? ''}">DNF · ${race.dnfReason ?? ''}</span>`)
        : statusText[r.status]}</td>
    </tr>`;
}

export function renderRacePage(): string {
  const s = store.getState();
  const course = store.currentCourse();
  const busy = s.rivals.some((r) => r.status === 'optimizing' || r.status === 'racing');
  const allReady = s.rivals.every((r) => r.line);
  const allRaced = s.rivals.every((r) => r.race);

  // 比赛排名（仅完赛）
  const ranked = s.rivals
    .filter((r) => r.race?.finished)
    .sort((a, b) => (a.race!.finishTime ?? 0) - (b.race!.finishTime ?? 0));

  return `
    <h2 style="margin-top:0">比赛 · ${course.name}</h2>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <button class="primary" id="btn-optimize" ${busy ? 'disabled' : ''}>
        ${allReady ? '重新计算 AI 走线' : '在 Web Worker 中计算走线（≤3s/人）'}
      </button>
      <button class="ghost" id="btn-race" ${!allReady || busy ? 'disabled' : ''}>
        ${allRaced ? '重新模拟比赛' : '开始比赛模拟'}
      </button>
      <button class="ghost" id="btn-replay" ${!allRaced ? 'disabled' : ''}>${playing ? '暂停回放' : '回放比赛'}</button>
      <span class="muted small" id="worker-status">${s.workerBusy ? 'Worker 计算中…' : 'Worker 空闲'}</span>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="section-title">赛道与走线俯视图</div>
        <canvas id="race-canvas" width="520" height="640"></canvas>
        <div class="legend">
          <span><i style="background:#94a3b8"></i>旗门连线（旧走线）</span>
          <span><i style="background:#3b82f6"></i>稳健</span>
          <span><i style="background:#10b981"></i>均衡</span>
          <span><i style="background:#ef4444"></i>冒险</span>
        </div>
        <input type="range" id="replay-scrub" min="0" max="1000" value="0" style="margin-top:8px" />
      </div>

      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="section-title">成绩榜</div>
          <table>
            <thead><tr><th>对手</th><th class="num">优化用时</th><th class="num">vs 连线</th><th class="num">比赛用时</th><th class="num">最高速</th><th>状态</th></tr></thead>
            <tbody>${s.rivals.map(rivalRow).join('')}</tbody>
          </table>
        </div>
        <div class="card">
          <div class="section-title">领奖台（含冰面/雪包临时修正后的实战成绩）</div>
          ${ranked.length === 0
            ? '<p class="muted small">完成比赛模拟后显示排名。冒险型速度快但冰面可能 DNF。</p>'
            : ranked.map((r, i) => `
              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
                <span>${['🥇', '🥈', '🥉'][i] ?? '  '} ${r.persona.name}
                  <span class="muted small">· ${r.race!.corrections.length} 次临时修正</span></span>
                <b class="mono">${fmtTime(r.race!.finishTime)}</b>
              </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function draw() {
  const canvas = document.getElementById('race-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const s = store.getState();
  drawCourse(ctx, store.currentCourse(), {
    width: canvas.width,
    height: canvas.height,
    showBaseline: true,
    rivalStates: s.rivals,
    showHazards: true,
    replayProgress: replayT,
  });
}

function tick() {
  if (!playing) return;
  replayT += 0.0035;
  if (replayT >= 1) {
    replayT = 1;
    playing = false;
  }
  const scrub = document.getElementById('replay-scrub') as HTMLInputElement | null;
  if (scrub) scrub.value = String(Math.round(replayT * 1000));
  draw();
  rafId = requestAnimationFrame(tick);
}

export function mountRacePage() {
  replayT = 0;
  playing = false;
  cancelAnimationFrame(rafId);
  draw();

  // Worker 进度/结果返回时刷新内容，但保留回放状态与 RAF
  const unsub = store.subscribe((s) => {
    if (s.page !== 'race') {
      unsub();
      cancelAnimationFrame(rafId);
      playing = false;
      return;
    }
    const host = document.getElementById('page-host');
    if (!host) return;
    const scrub = document.getElementById('replay-scrub') as HTMLInputElement | null;
    const savedT = replayT;
    const wasPlaying = playing;
    host.innerHTML = renderRacePage();
    replayT = savedT;
    bindRaceControls();
    if (scrub) (document.getElementById('replay-scrub') as HTMLInputElement).value = String(Math.round(replayT * 1000));
    draw();
    if (wasPlaying) {
      playing = true;
      rafId = requestAnimationFrame(tick);
    }
  });

  bindRaceControls();
}

function bindRaceControls() {
  document.getElementById('btn-optimize')!.addEventListener('click', async () => {
    await store.optimizeAll(3000);
  });
  document.getElementById('btn-race')!.addEventListener('click', async () => {
    await store.raceAll();
    replayT = 0;
    draw();
  });
  document.getElementById('btn-replay')!.addEventListener('click', () => {
    if (replayT >= 1) replayT = 0;
    playing = !playing;
    if (playing) {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    }
  });
  document.getElementById('replay-scrub')!.addEventListener('input', (e) => {
    playing = false;
    replayT = Number((e.target as HTMLInputElement).value) / 1000;
    draw();
  });
}
