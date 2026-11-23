import { store } from '../store';
import { drawCourse, drawGateDetail } from '../renderer';
import type { RivalState } from '../store';
import type { GateAnalysis } from '../engine/types';

function lineChart(
  canvas: HTMLCanvasElement,
  series: { values: number[]; color: string; label: string }[],
  yLabel: string,
) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, w, h);
  const padL = 46;
  const padB = 24;
  const padT = 14;
  const padR = 12;
  const allMax = Math.max(...series.flatMap((s) => s.values));
  const n = Math.max(...series.map((s) => s.values.length));
  const yMax = allMax * 1.1;

  // 网格
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const y = padT + ((h - padT - padB) * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText((yMax * (1 - g / 4)).toFixed(1), padL - 5, y + 3);
  }

  for (const s of series) {
    ctx.beginPath();
    s.values.forEach((v, i) => {
      const x = padL + ((w - padL - padR) * i) / Math.max(1, n - 1);
      const y = padT + (h - padT - padB) * (1 - v / yMax);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = '#334155';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(yLabel, padL, h - 7);
  let lx = padL;
  for (const sr of series) {
    ctx.fillStyle = sr.color;
    ctx.fillText(sr.label, lx, padT + 2);
    lx += ctx.measureText(sr.label).width + 14;
  }
}

function gateRow(g: GateAnalysis, idx: number): string {
  const lineLabel = g.line === 'high' ? '<span class="good">走高线</span>' : g.line === 'low' ? '<span class="warn">走低线</span>' : '标准';
  return `
    <tr data-gate="${idx}" style="cursor:pointer">
      <td>${idx + 1}</td>
      <td>${lineLabel}</td>
      <td class="num">${g.offset.toFixed(2)}</td>
      <td class="num">${g.insideClearance.toFixed(2)}</td>
      <td class="num">${g.turnInDistance.toFixed(1)}</td>
      <td class="num">${g.apexSpeed.toFixed(1)}</td>
      <td class="num">${((g.maxEdgeRad * 180) / Math.PI).toFixed(0)}°</td>
    </tr>`;
}

export function renderAnalysisPage(): string {
  const s = store.getState();
  const rival = s.rivals.find((r) => r.persona.id === s.analysisRivalId) ?? s.rivals[0];
  const line = rival.line;

  return `
    <h2 style="margin-top:0">路线分析 · ${store.currentCourse().name}</h2>
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      ${s.rivals.map((r: RivalState) => `
        <button class="ghost ${r.persona.id === rival.persona.id ? 'active-rival' : ''}"
          data-rival="${r.persona.id}"
          style="${r.persona.id === rival.persona.id ? `border-color:${r.persona.color};color:${r.persona.color}` : ''}">
          <span class="badge-dot" style="background:${r.persona.color}"></span>${r.persona.name}
        </button>`).join('')}
      ${!line ? '<span class="muted small" style="align-self:center">（请先在比赛页计算走线）</span>' : ''}
    </div>

    ${line ? `
    <div class="stat-row card">
      <div class="stat"><div class="v">${line.totalTime.toFixed(2)}s</div><div class="k">优化总用时</div></div>
      <div class="stat"><div class="v">${line.totalLength.toFixed(0)}m</div><div class="k">滑行距离</div></div>
      <div class="stat"><div class="v good">${((rival.improvementPct ?? 0) * 100).toFixed(1)}%</div><div class="k">比旗门连线快</div></div>
      <div class="stat"><div class="v">${Math.max(...line.speed).toFixed(1)}</div><div class="k">最高速度 m/s</div></div>
      <div class="stat"><div class="v">${((Math.max(...line.edgeAngle) * 180) / Math.PI).toFixed(0)}°</div><div class="k">峰值立刃角</div></div>
      <div class="stat"><div class="v">${line.gateAnalysis.filter((g) => g.line === 'high').length}</div><div class="k">走高线的门数</div></div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="section-title">优化走线俯视图（颜色=速度）</div>
        <canvas id="analysis-map" width="500" height="560"></canvas>
      </div>
      <div class="card">
        <div class="section-title">单门几何（点击右侧表格切换）</div>
        <canvas id="gate-detail" width="460" height="300"></canvas>
        <div id="gate-detail-text" class="small muted" style="margin-top:8px"></div>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><div class="section-title">速度剖面 v(s)，m/s</div>
        <canvas id="chart-speed" width="520" height="220"></canvas></div>
      <div class="card"><div class="section-title">立刃角剖面，度</div>
        <canvas id="chart-edge" width="520" height="220"></canvas></div>
      <div class="card"><div class="section-title">曲率剖面 κ(s)，1/m</div>
        <canvas id="chart-curve" width="520" height="220"></canvas></div>
      <div class="card"><div class="section-title">转弯半径 R=1/κ，m（仅弯段）</div>
        <canvas id="chart-radius" width="520" height="220"></canvas></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">门级决策（优化器自行决定高/低线与提前起弧距离）</div>
      <div style="max-height:340px;overflow:auto">
        <table>
          <thead><tr><th>门号</th><th>线位</th><th class="num">过门偏移 m</th><th class="num">门杆净距 m</th><th class="num">提前起弧 m</th><th class="num">弯顶点速度</th><th class="num">最大立刃</th></tr></thead>
          <tbody>${line.gateAnalysis.map(gateRow).join('')}</tbody>
        </table>
      </div>
    </div>` : '<div class="card muted">尚无优化数据。</div>'}`;
}

export function mountAnalysisPage() {
  const s = store.getState();
  document.querySelectorAll<HTMLElement>('[data-rival]').forEach((el) => {
    el.addEventListener('click', () => store.setAnalysisRival(el.dataset.rival!));
  });

  const rival = s.rivals.find((r) => r.persona.id === s.analysisRivalId) ?? s.rivals[0];
  const line = rival.line;
  if (!line) return;

  const map = document.getElementById('analysis-map') as HTMLCanvasElement;
  drawCourse(map.getContext('2d')!, store.currentCourse(), {
    width: map.width,
    height: map.height,
    rivalStates: [rival],
    focusRivalId: rival.persona.id,
    showSpeedColor: true,
    showBaseline: true,
  });

  const edgeDeg = line.edgeAngle.map((e) => (e * 180) / Math.PI);
  lineChart(
    document.getElementById('chart-speed') as HTMLCanvasElement,
    [{ values: line.speed, color: rival.persona.color, label: '速度 m/s' }],
    '沿弧长 →',
  );
  lineChart(
    document.getElementById('chart-edge') as HTMLCanvasElement,
    [{ values: edgeDeg, color: '#7c3aed', label: '立刃角 °' }],
    '沿弧长 →',
  );
  lineChart(
    document.getElementById('chart-curve') as HTMLCanvasElement,
    [{ values: line.curvature.map(Math.abs), color: '#db2777', label: '|κ| 1/m' }],
    '沿弧长 →',
  );
  // 转弯半径：直道（κ≈0）处置空，图表只呈现弯段
  const radius = line.curvature.map((k) => (Math.abs(k) > 0.015 ? 1 / Math.abs(k) : 0));
  lineChart(
    document.getElementById('chart-radius') as HTMLCanvasElement,
    [{ values: radius, color: '#0891b2', label: '转弯半径 m' }],
    '沿弧长 →',
  );

  const detailCanvas = document.getElementById('gate-detail') as HTMLCanvasElement;
  const detailText = document.getElementById('gate-detail-text')!;
  const showGate = (id: number) => {
    drawGateDetail(detailCanvas.getContext('2d')!, store.currentCourse(), line, id, detailCanvas.width, detailCanvas.height);
    const g = line.gateAnalysis[id];
    detailText.innerHTML = `门 ${id + 1}：过门偏移 <b>${g.offset.toFixed(2)}m</b>（负=门线上方/高线），
      门杆净距 <b>${g.insideClearance.toFixed(2)}m</b>，提前起弧 <b>${g.turnInDistance.toFixed(1)}m</b>，
      弯顶速度 <b>${g.apexSpeed.toFixed(1)} m/s</b>，最大立刃 <b>${((g.maxEdgeRad * 180) / Math.PI).toFixed(0)}°</b>`;
  };
  showGate(0);
  document.querySelectorAll<HTMLElement>('[data-gate]').forEach((el) => {
    el.addEventListener('click', () => showGate(Number(el.dataset.gate)));
  });
}
