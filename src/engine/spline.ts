import type { Vec2 } from './types';
import { add, dist, scale, sub } from './math';

/**
 * 带张力的 Cardinal 样条（chordal 节点参数化）。
 * tension=0 即标准 Catmull-Rom；这里取 0.5 收紧控制点处的切线，
 * 在保持 C1 光滑的同时显著抑制门线附近的过冲/回环。
 */
const TENSION = 0.5;

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number): Vec2 {
  const u2 = u * u;
  const u3 = u2 * u;
  const s = (1 - TENSION) / 2;
  // 切向量按弦长归一化，避免门间距不均时的自交
  const d01 = dist(p0, p1) || 1e-6;
  const d12 = dist(p1, p2) || 1e-6;
  const d23 = dist(p2, p3) || 1e-6;
  const m1 = scale(sub(p2, p0), (s * 2 * d12) / (d01 + d12));
  const m2 = scale(sub(p3, p1), (s * 2 * d12) / (d12 + d23));

  // Hermite 基函数
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  return add(
    add(scale(p1, h00), scale(m1, h10)),
    add(scale(p2, h01), scale(m2, h11)),
  );
}

export interface SampledPath {
  points: Vec2[];
  arcLength: number[];
  /** 单位切向量 */
  tangent: Vec2[];
  /** 曲率 1/m（带符号，左正右负） */
  curvature: number[];
  totalLength: number;
}

/** 对控制点序列做 Catmull-Rom 插值并按固定弧长重采样 */
export function samplePath(control: Vec2[], stepM = 1.5): SampledPath {
  const n = control.length;
  if (n < 2) throw new Error('至少需要 2 个控制点');

  // 首尾用幽灵点夹住，保证端点切线自然
  const pts: Vec2[] = [
    add(control[0], sub(control[0], control[1])),
    ...control,
    add(control[n - 1], sub(control[n - 1], control[n - 2])),
  ];

  const dense: Vec2[] = [control[0]];
  const SUBDIV = 10;
  for (let i = 1; i < pts.length - 2; i++) {
    for (let k = 0; k < SUBDIV; k++) {
      dense.push(catmullRom(pts[i - 1], pts[i], pts[i + 1], pts[i + 2], k / SUBDIV));
    }
  }
  dense.push(control[n - 1]);

  // 弧长重采样
  const cum: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    cum.push(cum[i - 1] + dist(dense[i - 1], dense[i]));
  }
  const totalLength = cum[cum.length - 1];
  const targetCount = Math.max(8, Math.ceil(totalLength / stepM));

  const points: Vec2[] = [];
  const arcLength: number[] = [];
  let seg = 0;
  for (let j = 0; j <= targetCount; j++) {
    const s = (totalLength * j) / targetCount;
    while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
    const s0 = cum[seg];
    const s1 = cum[seg + 1];
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    points.push({
      x: dense[seg].x + (dense[seg + 1].x - dense[seg].x) * t,
      y: dense[seg].y + (dense[seg + 1].y - dense[seg].y) * t,
    });
    arcLength.push(s);
  }

  // 切向量与曲率（中心差分）
  const tangent: Vec2[] = [];
  const curvature: number[] = [];
  const m = points.length;
  for (let i = 0; i < m; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(m - 1, i + 1)];
    const d = sub(b, a);
    const l = Math.hypot(d.x, d.y) || 1e-9;
    tangent.push({ x: d.x / l, y: d.y / l });
  }
  for (let i = 0; i < m; i++) {
    const a = tangent[Math.max(0, i - 1)];
    const b = tangent[Math.min(m - 1, i + 1)];
    const ds = arcLength[Math.min(m - 1, i + 1)] - arcLength[Math.max(0, i - 1)] || 1e-9;
    // dT/ds 的法向分量即有符号曲率
    const dTx = (b.x - a.x) / ds;
    const dTy = (b.y - a.y) / ds;
    const t = tangent[i];
    curvature.push(dTx * -t.y + dTy * t.x);
  }

  return { points, arcLength, tangent, curvature, totalLength };
}

/** 在重采样路径上找距离给定点最近的采样索引 */
export function nearestIndex(path: SampledPath, p: Vec2): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.points.length; i++) {
    const d = dist(path.points[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
