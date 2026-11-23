import type { Course, OptimizedLine, Persona } from './engine/types';
import type { RivalState } from './store';

export interface RenderOptions {
  width: number;
  height: number;
  showBaseline?: boolean;
  rivalStates?: RivalState[];
  /** 只画指定对手 id 的走线；null = 全部 */
  focusRivalId?: string | null;
  showHazards?: boolean;
  showSpeedColor?: boolean;
  /** 回放进度 0..1 */
  replayProgress?: number | null;
}

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function buildTransform(course: Course, w: number, h: number, pad = 28): Transform {
  const maxY = course.finishY;
  const maxX = course.corridorHalfWidth + 4;
  const sx = (w - pad * 2) / (maxX * 2);
  const sy = (h - pad * 2) / maxY;
  const scale = Math.min(sx, sy);
  return {
    scale,
    offsetX: w / 2,
    offsetY: pad,
  };
}

function toScreen(t: Transform, x: number, y: number): [number, number] {
  return [t.offsetX + x * t.scale, t.offsetY + y * t.scale];
}

const RISK_COLORS: Record<Persona['risk'], string> = {
  cautious: '#3b82f6',
  balanced: '#10b981',
  aggressive: '#ef4444',
};

/** 画赛道底图：走廊、雪面、旗门、病害、起终点 */
export function drawCourse(
  ctx: CanvasRenderingContext2D,
  course: Course,
  opts: RenderOptions,
) {
  const { width: w, height: h } = opts;
  const t = buildTransform(course, w, h);
  ctx.clearRect(0, 0, w, h);

  // 背景
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, w, h);

  // 走廊
  const [x1, y1] = toScreen(t, -course.corridorHalfWidth, 0);
  const [x2, y2] = toScreen(t, course.corridorHalfWidth, course.finishY);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  ctx.setLineDash([]);

  // 基线（旗门连线）
  if (opts.showBaseline) {
    ctx.beginPath();
    course.gates.forEach((g, i) => {
      const [sx, sy] = toScreen(t, g.center.x, g.center.y);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 病害
  if (opts.showHazards !== false) {
    for (const hz of course.hazards) {
      const [cx, cy] = toScreen(t, hz.center.x, hz.center.y);
      ctx.beginPath();
      ctx.arc(cx, cy, hz.radius * t.scale, 0, Math.PI * 2);
      if (hz.kind === 'ice') {
        ctx.fillStyle = 'rgba(56,189,248,0.35)';
        ctx.strokeStyle = '#0284c7';
      } else {
        ctx.fillStyle = 'rgba(217,119,6,0.3)';
        ctx.strokeStyle = '#b45309';
      }
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hz.kind === 'ice' ? '#0369a1' : '#92400e';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(hz.kind === 'ice' ? '冰' : '包', cx, cy + 3);
    }
  }

  // 旗门：两根门杆 + 门线
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  for (const g of course.gates) {
    const [ix, iy] = toScreen(t, g.insidePole.x, g.insidePole.y);
    const [ox, oy] = toScreen(t, g.outsidePole.x, g.outsidePole.y);
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(ox, oy);
    ctx.strokeStyle = g.turn === 'L' ? '#7c3aed' : '#db2777';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 门杆
    for (const [px, py] of [[ix, iy], [ox, oy]] as const) {
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
    }
    if (g.id % 5 === 0) {
      const [mx, my] = toScreen(t, g.center.x, g.center.y);
      ctx.fillStyle = '#64748b';
      ctx.fillText(String(g.id + 1), mx, my - 6);
    }
  }

  // 起点 / 终点
  const [, sy0] = toScreen(t, 0, 0);
  const [, syF] = toScreen(t, 0, course.finishY);
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x1, sy0);
  ctx.lineTo(x2, sy0);
  ctx.stroke();
  ctx.strokeStyle = '#dc2626';
  ctx.beginPath();
  ctx.moveTo(x1, syF);
  ctx.lineTo(x2, syF);
  ctx.stroke();

  // 优化走线
  if (opts.rivalStates) {
    for (const rival of opts.rivalStates) {
      if (!rival.line) continue;
      if (opts.focusRivalId && rival.persona.id !== opts.focusRivalId) continue;
      drawLine(ctx, t, rival, opts);
    }
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  rival: RivalState,
  opts: RenderOptions,
) {
  const line = rival.line!;
  const color = rival.persona.color || RISK_COLORS[rival.persona.risk];
  const pts = line.points;
  const endIdx =
    opts.replayProgress == null
      ? pts.length - 1
      : Math.floor(opts.replayProgress * (pts.length - 1));

  ctx.beginPath();
  for (let i = 0; i <= endIdx; i++) {
    const [sx, sy] = toScreen(t, pts[i].x, pts[i].y);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = rival.persona.id === opts.focusRivalId ? 2.6 : 1.8;
  ctx.globalAlpha = opts.focusRivalId && rival.persona.id !== opts.focusRivalId ? 0.35 : 0.95;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 速度色点（分析页用）
  if (opts.showSpeedColor && endIdx > 1) {
    const vMax = Math.max(...line.speed);
    for (let i = 0; i <= endIdx; i += 6) {
      const [sx, sy] = toScreen(t, pts[i].x, pts[i].y);
      const ratio = line.speed[i] / vMax;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = speedColor(ratio);
      ctx.fill();
    }
  }

  // 回放滑手标记
  if (opts.replayProgress != null && endIdx >= 0) {
    const p = pts[Math.min(endIdx, pts.length - 1)];
    const [sx, sy] = toScreen(t, p.x, p.y);
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function speedColor(ratio: number): string {
  // 蓝（慢）→ 黄 → 红（快）
  const r = Math.round(255 * Math.min(1, ratio * 1.3 - 0.2));
  const g = Math.round(200 * (1 - Math.abs(ratio - 0.5) * 1.6));
  const b = Math.round(255 * (1 - ratio));
  return `rgb(${Math.max(0, r)},${Math.max(0, g)},${Math.max(0, b)})`;
}

/** 分析页：单门几何示意（过门偏移、起弧点） */
export function drawGateDetail(
  ctx: CanvasRenderingContext2D,
  course: Course,
  line: OptimizedLine,
  gateId: number,
  width: number,
  height: number,
) {
  const gate = course.gates[gateId];
  const around = line.points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => Math.abs(p.y - gate.center.y) < (gate.spacing || 10) * 0.9);
  if (around.length < 2) return;

  const xs = around.map((a) => a.p.x);
  const ys = around.map((a) => a.p.y);
  const minX = Math.min(...xs, gate.insidePole.x, gate.outsidePole.x);
  const maxX = Math.max(...xs, gate.insidePole.x, gate.outsidePole.x);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 30;
  const sx = (width - pad * 2) / Math.max(1, maxX - minX);
  const sy = (height - pad * 2) / Math.max(1, maxY - minY);
  const sc = Math.min(sx, sy);
  const tx = (x: number) => pad + (x - minX) * sc;
  const ty = (y: number) => pad + (y - minY) * sc;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  // 门线
  ctx.beginPath();
  ctx.moveTo(tx(gate.insidePole.x), ty(gate.insidePole.y));
  ctx.lineTo(tx(gate.outsidePole.x), ty(gate.outsidePole.y));
  ctx.strokeStyle = '#db2777';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#1e293b';
  for (const pole of [gate.insidePole, gate.outsidePole]) {
    ctx.beginPath();
    ctx.arc(tx(pole.x), ty(pole.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 走线
  ctx.beginPath();
  around.forEach(({ p }, i) => {
    if (i === 0) ctx.moveTo(tx(p.x), ty(p.y));
    else ctx.lineTo(tx(p.x), ty(p.y));
  });
  ctx.strokeStyle = '#0f766e';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // 过门点
  const ga = line.gateAnalysis[gateId];
  if (ga) {
    const hit = around.find(({ i }) => i > 0);
    if (hit) {
      ctx.beginPath();
      ctx.arc(tx(hit.p.x), ty(hit.p.y), 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        `${gateId + 1} 号门 · ${ga.line === 'high' ? '走高线' : ga.line === 'low' ? '走低线' : '标准线'} · 提前起弧 ${ga.turnInDistance.toFixed(1)}m`,
        10,
        18,
      );
    }
  }
}
