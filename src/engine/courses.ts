import type { Course, Gate, Hazard, Persona, SnowType, Vec2 } from './types';
import { dist, mulberry32, normalize, sub } from './math';

/**
 * FIS 规格（按常见赛事参数取工程近似，单位米/度）：
 * - 回转 SL：垂直落差 140–220m，旗门 55–75 个，门间距 7–13m，门宽 4–6m，
 *   相邻门横向偏移 4–9m，弯道急、节奏快。
 * - 大回转 GS：垂直落差 250–450m，旗门 ~46–70 个，门间距 13–22m，门宽 4–8m，
 *   相邻门横向偏移 6–14m，弯大、速度高。
 */
export interface GenSpec {
  id: string;
  name: string;
  discipline: 'slalom' | 'giant';
  gateCount: number;
  seed: number;
  verticalDrop: number;
  corridorHalfWidth: number;
  snow: SnowType;
  hazardCount: number;
  /** 坡角范围（弧度） */
  slopeMinDeg: number;
  slopeMaxDeg: number;
}

export const COURSE_SPECS: GenSpec[] = [
  {
    id: 'sl-classic',
    name: '经典回转 · 鹿鸣坡',
    discipline: 'slalom',
    gateCount: 60,
    seed: 20260117,
    verticalDrop: 185,
    corridorHalfWidth: 14,
    snow: 'compact',
    hazardCount: 7,
    slopeMinDeg: 17,
    slopeMaxDeg: 28,
  },
  {
    id: 'sl-icy-night',
    name: '夜场冰面回转',
    discipline: 'slalom',
    gateCount: 64,
    seed: 7711,
    verticalDrop: 200,
    corridorHalfWidth: 13,
    snow: 'icy',
    hazardCount: 10,
    slopeMinDeg: 18,
    slopeMaxDeg: 30,
  },
  {
    id: 'sl-powder',
    name: '粉雪回转训练道',
    discipline: 'slalom',
    gateCount: 56,
    seed: 31337,
    verticalDrop: 165,
    corridorHalfWidth: 15,
    snow: 'powder',
    hazardCount: 5,
    slopeMinDeg: 15,
    slopeMaxDeg: 24,
  },
  {
    id: 'gs-alpine',
    name: '阿尔卑斯大回转',
    discipline: 'giant',
    gateCount: 48,
    seed: 9001,
    verticalDrop: 340,
    corridorHalfWidth: 20,
    snow: 'compact',
    hazardCount: 8,
    slopeMinDeg: 14,
    slopeMaxDeg: 26,
  },
  {
    id: 'gs-glacier',
    name: '冰川大回转',
    discipline: 'giant',
    gateCount: 60,
    seed: 55555,
    verticalDrop: 400,
    corridorHalfWidth: 22,
    snow: 'icy',
    hazardCount: 12,
    slopeMinDeg: 12,
    slopeMaxDeg: 24,
  },
];

function buildGate(
  id: number,
  center: Vec2,
  turn: 'L' | 'R',
  width: number,
  prevCenter: Vec2 | null,
): Gate {
  // 门线大致横向、并沿行进方向略微倾斜（真实赛事旗门有朝向）
  const baseAngle = turn === 'L' ? -0.18 : 0.18;
  const dir: Vec2 = { x: Math.cos(baseAngle), y: Math.sin(baseAngle) };
  const normal: Vec2 = { x: -dir.y, y: dir.x };
  const half = width / 2;
  // 回转中选手从 inside 杆旁擦过：L 弯的 inside 杆在门线左侧
  const insideSign = turn === 'L' ? -1 : 1;
  const insidePole = {
    x: center.x + dir.x * half * insideSign,
    y: center.y + dir.y * half * insideSign,
  };
  const outsidePole = {
    x: center.x - dir.x * half * insideSign,
    y: center.y - dir.y * half * insideSign,
  };
  const spacing = prevCenter ? dist(prevCenter, center) : 0;
  return { id, center, dir, normal, width, turn, insidePole, outsidePole, spacing };
}

/** 生成一条完整赛道（确定性，同 seed 可复现） */
export function generateCourse(spec: GenSpec): Course {
  const rnd = mulberry32(spec.seed);
  const isSL = spec.discipline === 'slalom';

  // 沿坡（y）间距规格。spacing 为欧氏距离（含横向分量），
  // 按勾股定理预留横向偏移余量，保证 spacing 严格落在 FIS 区间内
  const gapMin = isSL ? 7.6 : 13.6;
  const gapMax = isSL ? 12.0 : 20.6;
  // 横向偏移规格（相邻门中心）
  const latMin = isSL ? 4.6 : 6.6;
  const latMax = isSL ? 8.4 : 13.4;
  const gateWidth = isSL ? 4.2 + rnd() * 1.5 : 4.6 + rnd() * 2.6;

  const gates: Gate[] = [];
  const startY = 0;
  let y = startY + 12;
  let x = 0;
  let prevCenter: Vec2 | null = null;
  let lastTurn: 'L' | 'R' = 'R';
  const lim = spec.corridorHalfWidth * 0.55;

  for (let i = 0; i < spec.gateCount; i++) {
    // 以交替为主，偶尔同向连弯（约 12%），模拟组合门节奏
    let turn: 'L' | 'R';
    if (i > 0 && rnd() < 0.12) turn = lastTurn;
    else turn = lastTurn === 'L' ? 'R' : 'L';
    lastTurn = turn;

    const lat = latMin + rnd() * (latMax - latMin);
    const sign = turn === 'L' ? -1 : 1;
    let nx = x + sign * lat;
    // 边界反射：翻转后重新取满足横向位移规格的位置
    if (nx > lim || nx < -lim) {
      nx = x - sign * lat;
      lastTurn = turn === 'L' ? 'R' : 'L';
    }
    nx = Math.max(-lim, Math.min(lim, nx));

    // 由欧氏间距反推 y 增量，硬保证 spacing 落在 [gapMin, gapMax]
    const dx = Math.abs(nx - x);
    const sMin = Math.max(gapMin, Math.hypot(dx, 1) + 0.3);
    const sMax = gapMax;
    const spacing = sMin + rnd() * Math.max(0.1, sMax - sMin);
    const dy = Math.sqrt(Math.max(0.5, spacing * spacing - dx * dx));
    y += dy;
    x = nx;

    const center = { x, y };
    gates.push(buildGate(i, center, lastTurn, gateWidth, prevCenter));
    prevCenter = center;
  }

  const finishY = y + 18;

  // 坡度剖面：4–7 个分段，角度在规格范围内平滑变化
  const slopeProfile: { y: number; angleRad: number }[] = [];
  const segCount = 4 + Math.floor(rnd() * 4);
  const toRad = Math.PI / 180;
  for (let i = 0; i <= segCount; i++) {
    const yy = (finishY * i) / segCount;
    const ang =
      spec.slopeMinDeg +
      rnd() * (spec.slopeMaxDeg - spec.slopeMinDeg);
    slopeProfile.push({ y: yy, angleRad: ang * toRad });
  }

  // 病害：冰面与雪包，撒在门间通道上但不压住门线
  const hazards: Hazard[] = [];
  for (let i = 0; i < spec.hazardCount; i++) {
    const gIdx = 2 + Math.floor(rnd() * Math.max(1, gates.length - 4));
    const g0 = gates[gIdx - 1].center;
    const g1 = gates[gIdx].center;
    const t = 0.35 + rnd() * 0.3;
    const center = {
      x: g0.x + (g1.x - g0.x) * t + (rnd() - 0.5) * 4,
      y: g0.y + (g1.y - g0.y) * t,
    };
    const isIce = rnd() < 0.6;
    hazards.push({
      id: i,
      kind: isIce ? 'ice' : 'bump',
      center,
      radius: isIce ? 2.2 + rnd() * 2.4 : 1.2 + rnd() * 1.2,
      gripFactor: isIce ? 0.45 + rnd() * 0.25 : undefined,
      speedCap: isIce ? undefined : 9 + rnd() * 4,
    });
  }

  return {
    id: spec.id,
    name: spec.name,
    discipline: spec.discipline,
    gates,
    corridorHalfWidth: spec.corridorHalfWidth,
    slopeProfile,
    snow: spec.snow,
    hazards,
    start: { x: gates[0].center.x * 0.3, y: startY },
    finishY,
  };
}

/** 预设对手（风险偏好通过物理参数体现，而非简单速度加成） */
export const PERSONAS: Persona[] = [
  {
    id: 'steady',
    name: '稳将 · 林岚',
    risk: 'cautious',
    maxEdgeAngleRad: (62 * Math.PI) / 180,
    gripBase: 0.62,
    iceGripRetention: 0.85,
    speedCap: 23.5,
    brakeDecel: 5.2,
    turnRateMax: 2.3,
    corridorMargin: 1.6,
    gateMargin: 0.55,
    dragCoef: 0.012,
    color: '#3b82f6',
  },
  {
    id: 'allround',
    name: '全能 · 陈溯',
    risk: 'balanced',
    maxEdgeAngleRad: (68 * Math.PI) / 180,
    gripBase: 0.7,
    iceGripRetention: 0.7,
    speedCap: 26,
    brakeDecel: 6.0,
    turnRateMax: 2.7,
    corridorMargin: 1.0,
    gateMargin: 0.35,
    dragCoef: 0.011,
    color: '#10b981',
  },
  {
    id: 'rocket',
    name: '冒险王 · 雷克',
    risk: 'aggressive',
    maxEdgeAngleRad: (73 * Math.PI) / 180,
    gripBase: 0.78,
    iceGripRetention: 0.5,
    speedCap: 28.5,
    brakeDecel: 6.6,
    turnRateMax: 3.1,
    corridorMargin: 0.35,
    gateMargin: 0.12,
    dragCoef: 0.01,
    color: '#ef4444',
  },
];

/** 工具：门线法向带符号距离（正 = normal 侧） */
export function gateOffsetOf(gate: Gate, p: Vec2): number {
  const d = sub(p, gate.center);
  return d.x * gate.normal.x + d.y * gate.normal.y;
}

/** 点到门线线段的距离 */
export function distanceToGateLine(gate: Gate, p: Vec2): number {
  const toP = sub(p, gate.center);
  const along = toP.x * gate.dir.x + toP.y * gate.dir.y;
  const clamped = Math.max(-gate.width / 2, Math.min(gate.width / 2, along));
  const closest = {
    x: gate.center.x + gate.dir.x * clamped,
    y: gate.center.y + gate.dir.y * clamped,
  };
  return dist(p, closest);
}

/** 单位向量工具（供 UI 复用） */
export { normalize };
