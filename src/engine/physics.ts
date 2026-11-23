import type {
  Course,
  Gate,
  GateAnalysis,
  OptimizedLine,
  Persona,
  Vec2,
} from './types';
import { clamp, dist, interpolateProfile } from './math';
import { samplePath, type SampledPath } from './spline';

const G = 9.81;
/** 弯侧切刮雪损耗：侧向载荷的切向折减比例（刻滑也有少量损耗） */
const TURN_SCRUB = 0.12;
/** 起步初速度 m/s */
const START_SPEED = 2.2;

export interface TerrainInfo {
  slopeRad: number;
  /** 该点可用侧向摩擦系数（已含雪况 / 冰面 / 性格修正） */
  mu: number;
  /** 雪包限速，Infinity 表示无限制 */
  speedCap: number;
  onIce: boolean;
  onBump: boolean;
}

const SNOW_GRIP_SCALE: Record<Course['snow'], number> = {
  powder: 0.88,
  compact: 1,
  icy: 0.8,
};

/** 赛道坡度查找表（每米一格，预计算一次，评价时 O(1)） */
export function buildSlopeTable(course: Course): Float64Array {
  const maxY = Math.ceil(course.finishY) + 1;
  const table = new Float64Array(maxY);
  const profile = course.slopeProfile.map((p) => ({ y: p.y, value: p.angleRad }));
  for (let y = 0; y < maxY; y++) table[y] = interpolateProfile(profile, y);
  return table;
}

export function terrainAt(
  course: Course,
  persona: Persona,
  p: Vec2,
  slopeTable: Float64Array,
): TerrainInfo {
  const yi = clamp(Math.round(p.y), 0, slopeTable.length - 1);
  const slopeRad = slopeTable[yi];

  let mu = persona.gripBase * SNOW_GRIP_SCALE[course.snow];
  let speedCap = Infinity;
  let onIce = false;
  let onBump = false;

  for (const h of course.hazards) {
    const dx = p.x - h.center.x;
    const dy = p.y - h.center.y;
    const r2 = dx * dx + dy * dy;
    if (r2 > h.radius * h.radius) continue;
    if (h.kind === 'ice') {
      onIce = true;
      // 冰面：基础握力 × 冰面系数 × 性格的冰面保留率
      mu *= (h.gripFactor ?? 0.5) * persona.iceGripRetention;
    } else {
      onBump = true;
      speedCap = Math.min(speedCap, h.speedCap ?? 11);
    }
  }

  return { slopeRad, mu, speedCap, onIce, onBump };
}

/** 双向速度扫描：前向重力/阻力积分并按弯中握力限速，后向制动能力约束 */
export function solveSpeedProfile(
  course: Course,
  persona: Persona,
  path: SampledPath,
  slopeTable: Float64Array,
): { speed: number[]; edgeAngle: number[]; time: number } {
  const m = path.points.length;
  const speed = new Array<number>(m);
  const edgeAngle = new Array<number>(m).fill(0);
  speed[0] = START_SPEED;

  // 前向
  for (let i = 1; i < m; i++) {
    const ds = path.arcLength[i] - path.arcLength[i - 1];
    const mid: Vec2 = {
      x: (path.points[i - 1].x + path.points[i].x) / 2,
      y: (path.points[i - 1].y + path.points[i].y) / 2,
    };
    const ter = terrainAt(course, persona, mid, slopeTable);
    const vPrev = speed[i - 1];

    const aGrav = G * Math.sin(ter.slopeRad);
    const aDrag = persona.dragCoef * vPrev * vPrev;
    // 用目标节点的点曲率限速，保证报告值（edgeAngle）与约束完全一致
    const kappaSeg = Math.abs(path.curvature[i]);
    const aScrub = TURN_SCRUB * vPrev * vPrev * kappaSeg;
    const vTry2 = vPrev * vPrev + 2 * ds * (aGrav - aDrag - aScrub);
    const vTry = Math.sqrt(Math.max(0, vTry2));

    const cosSlope = Math.cos(ter.slopeRad);
    const aGrip = ter.mu * G * cosSlope;
    const aEdge = G * cosSlope * Math.tan(persona.maxEdgeAngleRad);
    const aLatMax = Math.min(aGrip, aEdge);
    const vTurn = kappaSeg > 1e-7 ? Math.sqrt(aLatMax / kappaSeg) : Infinity;
    // 转弯角速度约束（人体旋转能力）：v·κ ≤ ω → v ≤ ω/κ。
    // 光滑刻滑弯 κ 小，几乎不触发；尖角 pivot 会被限速并计入真实 pivot 时间
    const vRate = kappaSeg > 1e-7 ? persona.turnRateMax / kappaSeg : Infinity;
    const vCap = Math.min(persona.speedCap, ter.speedCap, vTurn, vRate);

    speed[i] = Math.min(vTry, vCap);
  }

  // 后向：下一节点速度必须在制动距离内可达
  for (let i = m - 2; i >= 0; i--) {
    const ds = path.arcLength[i + 1] - path.arcLength[i];
    const vReach = Math.sqrt(speed[i + 1] * speed[i + 1] + 2 * ds * persona.brakeDecel);
    if (speed[i] > vReach) speed[i] = vReach;
  }

  // 时间积分 + 立刃角反推
  let time = 0;
  for (let i = 0; i < m; i++) {
    const ter = terrainAt(course, persona, path.points[i], slopeTable);
    const kappa = Math.abs(path.curvature[i]);
    const cosSlope = Math.cos(ter.slopeRad);
    if (kappa > 1e-7 && cosSlope > 1e-6) {
      const tanEdge = (speed[i] * speed[i] * kappa) / (G * cosSlope);
      edgeAngle[i] = Math.atan(Math.max(0, tanEdge));
    }
    if (i > 0) {
      const ds = path.arcLength[i] - path.arcLength[i - 1];
      const vAvg = (speed[i - 1] + speed[i]) / 2;
      time += ds / Math.max(0.5, vAvg);
    }
  }

  return { speed, edgeAngle, time };
}

/** 找路径上最靠近某门的采样索引区间 */
function gateWindow(path: SampledPath, gate: Gate): { idx: number; lo: number; hi: number } {
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < path.points.length; i++) {
    const d = dist(path.points[i], gate.center);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  // 弧长窗口：门间距的一半
  const s = path.arcLength[idx];
  let lo = idx;
  let hi = idx;
  const half = Math.max(6, (gate.spacing || 10) * 0.55);
  while (lo > 0 && s - path.arcLength[lo] < half) lo--;
  while (hi < path.points.length - 1 && path.arcLength[hi] - s < half) hi++;
  return { idx, lo, hi };
}

export interface EvalResult {
  time: number;
  /** 含惩罚的综合代价（优化目标） */
  cost: number;
  path: SampledPath;
  speed: number[];
  edgeAngle: number[];
  corridorViolations: number;
  gateViolations: number;
  gateAnalysis: GateAnalysis[];
  allGatesCleared: boolean;
}

// 漏门/越界是硬可行性问题，惩罚必须压过任何时间收益（赛道总用时仅百秒量级）
const PENALTY_SEC = 500;

/** 评价一组控制点（Catmull-Rom 光滑走线） */
export function evaluateControls(
  course: Course,
  persona: Persona,
  controls: Vec2[],
  slopeTable: Float64Array,
  stepM = 1.5,
): EvalResult {
  const path = samplePath(controls, stepM);
  return evaluatePath(course, persona, path, slopeTable);
}

/** 评价一条已采样路径（光滑线或折线基线共用） */
export function evaluatePath(
  course: Course,
  persona: Persona,
  path: SampledPath,
  slopeTable: Float64Array,
): EvalResult {
  const { speed, edgeAngle, time } = solveSpeedProfile(course, persona, path, slopeTable);

  let corridorViolations = 0;
  const xLimit = course.corridorHalfWidth - persona.corridorMargin;
  for (const p of path.points) {
    if (Math.abs(p.x) > xLimit) corridorViolations++;
  }

  let gateViolations = 0;
  const gateAnalysis: GateAnalysis[] = [];

  for (const gate of course.gates) {
    const { idx, lo, hi } = gateWindow(path, gate);

    // 过门判定：取门线法向坐标的【第一次】过零穿越点（沿行进方向），
    // 与比赛模拟的过门逻辑完全一致——样条即使之后再次穿越也不能补救
    let cleared = false;
    let bestAlong = Infinity;
    let hitIdx = idx;
    // 几何回环检测：门线邻近窗口内法向坐标若出现“穿正后又回负”，
    // 说明样条在门线附近振荡（Catmull-Rom 过冲），该走线不可行
    let sawPositive = false;
    let looped = false;
    for (let i = lo; i <= hi; i++) {
      const pv = path.points[i];
      const nv =
        (pv.x - gate.center.x) * gate.normal.x +
        (pv.y - gate.center.y) * gate.normal.y;
      if (nv > 0.3) sawPositive = true;
      if (sawPositive && nv < -0.3) looped = true;
    }
    if (looped) gateViolations++;
    for (let i = lo; i < hi; i++) {
      const p0 = path.points[i];
      const p1 = path.points[i + 1];
      const n0 =
        (p0.x - gate.center.x) * gate.normal.x +
        (p0.y - gate.center.y) * gate.normal.y;
      const n1 =
        (p1.x - gate.center.x) * gate.normal.x +
        (p1.y - gate.center.y) * gate.normal.y;
      // 只认从门线上方（n<0）穿到下方（n>0）的第一次
      if (n0 <= 0 && n1 > 0) {
        const t = Math.abs(n0) / (Math.abs(n0) + Math.abs(n1) || 1e-9);
        const along0 =
          (p0.x - gate.center.x) * gate.dir.x +
          (p0.y - gate.center.y) * gate.dir.y;
        const along1 =
          (p1.x - gate.center.x) * gate.dir.x +
          (p1.y - gate.center.y) * gate.dir.y;
        const along = along0 + (along1 - along0) * t;
        bestAlong = along;
        hitIdx = i;
        cleared = Math.abs(along) <= gate.width / 2 - persona.gateMargin;
        break;
      }
    }
    if (!cleared) gateViolations++;
    const near = path.points[hitIdx];
    const insideClearance = gate.width / 2 - Math.abs(bestAlong === Infinity ? 0 : bestAlong);
    const normalOffset =
      (near.x - gate.center.x) * gate.normal.x +
      (near.y - gate.center.y) * gate.normal.y;

    // 弯顶点（窗口内曲率峰值）与提前起弧距离
    let apexIdx = idx;
    let peakK = 0;
    for (let i = lo; i <= hi; i++) {
      const k = Math.abs(path.curvature[i]);
      if (k > peakK) {
        peakK = k;
        apexIdx = i;
      }
    }
    let turnInIdx = apexIdx;
    while (turnInIdx > 0 && Math.abs(path.curvature[turnInIdx]) > 0.02) turnInIdx--;
    const turnInDistance = path.arcLength[apexIdx] - path.arcLength[turnInIdx];

    let apexSpeed = Infinity;
    let maxEdge = 0;
    for (let i = lo; i <= hi; i++) {
      apexSpeed = Math.min(apexSpeed, speed[i]);
      maxEdge = Math.max(maxEdge, edgeAngle[i]);
    }

    const line: GateAnalysis['line'] =
      normalOffset < -0.8 ? 'high' : normalOffset > 0.8 ? 'low' : 'standard';

    gateAnalysis.push({
      gateId: gate.id,
      offset: normalOffset,
      insideClearance,
      turnInDistance,
      apexSpeed,
      maxEdgeRad: maxEdge,
      line,
    });
  }

  // 长度正则：权重极小（全程仅约 0.7s 量级，远小于 5%+ 的时间收益差），
  // 只在时间几乎相同时偏好更短更直的线，并让风险性格的走线差异稳定涌现
  const lengthReg = path.totalLength * 0.001;
  const cost =
    time + lengthReg + PENALTY_SEC * (corridorViolations + gateViolations * 2);

  return {
    time,
    cost,
    path,
    speed,
    edgeAngle,
    corridorViolations,
    gateViolations,
    gateAnalysis,
    allGatesCleared: gateViolations === 0,
  };
}

/**
 * 朴素基线：过门心的光滑走线（所有决策变量为 0），
 * 与优化线使用完全相同的 Catmull-Rom 几何、重采样与物理积分，
 * 因此两者的时间差只反映“过门点 / 高低线 / 起弧时机”这些优化决策的价值。
 * 它对应旧 AI“贴着旗门连线滑、不主动走高线”的行为，而不是几何上不可行的尖角。
 */
export function evaluateBaseline(
  course: Course,
  persona: Persona,
  slopeTable: Float64Array,
): EvalResult {
  const controls: Vec2[] = [
    course.start,
    ...course.gates.map((g) => g.center),
    { x: course.gates[course.gates.length - 1].center.x, y: course.finishY },
  ];
  const path = samplePath(controls, 1.4);
  return evaluatePath(course, persona, path, slopeTable);
}

/** 把评价结果打包成对外的 OptimizedLine */
export function toOptimizedLine(
  ev: EvalResult,
  offsets: number[],
  iterations: number,
  computeMs: number,
): OptimizedLine {
  return {
    points: ev.path.points,
    arcLength: ev.path.arcLength,
    speed: ev.speed,
    curvature: ev.path.curvature,
    edgeAngle: ev.edgeAngle,
    totalTime: ev.time,
    totalLength: ev.path.totalLength,
    gateAnalysis: ev.gateAnalysis,
    offsets,
    iterations,
    computeMs,
    allGatesCleared: ev.allGatesCleared,
    corridorViolations: ev.corridorViolations,
  };
}
