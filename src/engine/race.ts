import type {
  CorrectionEvent,
  Course,
  Hazard,
  OptimizedLine,
  Persona,
  RaceResult,
  Vec2,
} from './types';
import { clamp, dist, mulberry32 } from './math';

const G = 9.81;
const DT = 0.05;

/** 在重采样走线上按弧长插值取状态 */
function sampleAt(line: OptimizedLine, s: number): { p: Vec2; vPlan: number; idx: number } {
  const arc = line.arcLength;
  const total = arc[arc.length - 1];
  const ss = clamp(s, 0, total);
  let lo = 0;
  let hi = arc.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] <= ss) lo = mid;
    else hi = mid;
  }
  const span = arc[hi] - arc[lo] || 1e-9;
  const t = (ss - arc[lo]) / span;
  const p: Vec2 = {
    x: line.points[lo].x + (line.points[hi].x - line.points[lo].x) * t,
    y: line.points[lo].y + (line.points[hi].y - line.points[lo].y) * t,
  };
  const vPlan = line.speed[lo] + (line.speed[hi] - line.speed[lo]) * t;
  return { p, vPlan, idx: lo };
}

/** 某点是否在病害内 */
function hazardAt(course: Course, p: Vec2): Hazard | null {
  for (const h of course.hazards) {
    if (dist(h.center, p) <= h.radius) return h;
  }
  return null;
}

/**
 * 比赛模拟：沿优化走线做时间步进，遇到冰面 / 雪包前瞻触发临时修正。
 * 冒险型握力裕度小、走廊裕度小，修正失败会真实出局（DNF），而不是概率掷骰。
 */
export function simulateRace(
  course: Course,
  persona: Persona,
  line: OptimizedLine,
  seed = 1,
): RaceResult {
  const rnd = mulberry32(seed + persona.id.length * 131);
  const totalLen = line.arcLength[line.arcLength.length - 1];
  const snapshots: RaceResult['snapshots'] = [];
  const corrections: CorrectionEvent[] = [];

  let s = 0;
  let v = line.speed[0];
  let t = 0;
  let maxSpeed = 0;
  let speedSum = 0;
  let speedN = 0;
  let lateralShift: Vec2 = { x: 0, y: 0 }; // 当前生效的二维避让位移
  let dnfReason: string | undefined;
  // 前瞻冰面设定的提前降速目标（弧长上限 → 目标速度）
  const iceSpeedTargets: { untilS: number; v: number }[] = [];
  const reactedHazards = new Set<number>();
  let nextGateIdx = 0;
  let prevPos: Vec2 = {
    x: line.points[0].x + lateralShift.x,
    y: line.points[0].y + lateralShift.y,
  };

  const pushSnapshot = () => {
    const { p: sp } = sampleAt(line, s);
    snapshots.push({ t, x: sp.x + lateralShift.x, y: sp.y + lateralShift.y, v });
  };
  pushSnapshot();

  let nextSnapshot = 0.1;

  while (s < totalLen) {
    const { p, vPlan, idx } = sampleAt(line, s);

    // ---- 前瞻 14m：沿弧长窗口扫描病害并决定修正 ----
    let upcoming: { h: Hazard; ahead: number } | null = null;
    for (let ls = 0.5; ls <= 14; ls += 1.0) {
      const probe = sampleAt(line, Math.min(totalLen, s + ls));
      const found = hazardAt(course, probe.p);
      if (found && !reactedHazards.has(found.id)) {
        upcoming = { h: found, ahead: ls };
        break;
      }
    }
    if (upcoming) {
      const h = upcoming.h;
      reactedHazards.add(h.id);
      if (h.kind === 'bump') {
        corrections.push({
          timeSec: t,
          arcLength: s,
          kind: 'bump',
          action: 'brake',
          detail: `雪包（前 ${upcoming.ahead.toFixed(0)}m）：提前收速至 ${h.speedCap?.toFixed(1) ?? '限速'} m/s`,
        });
      } else {
        // 冰面：稳将绕开（走线横移），冒险型强行直线通过只降一点速。
        // 避让方向取最近门的门线方向（dir）：沿门线平移不改变门线法向坐标，
        // 几何上不会把选手推过门线端点，再由沿途每道门的门杆余量独立夹取位移量
        const wantNudge =
          persona.risk === 'aggressive'
            ? h.radius * 0.3
            : persona.risk === 'balanced'
              ? h.radius * 0.9
              : h.radius * 1.35;
        const hazardS = Math.min(totalLen, s + upcoming.ahead);
        const probe = sampleAt(line, hazardS);
        const probeP = probe.p;
        const nearGate =
          course.gates.find(
            (g2) => Math.abs(g2.center.y - h.center.y) < (g2.spacing || 10),
          ) ?? course.gates[course.gates.length - 1];
        // 选离开冰面中心的门线方向侧
        const side =
          (h.center.x - probeP.x) * nearGate.dir.x +
          (h.center.y - probeP.y) * nearGate.dir.y >= 0
            ? -1
            : 1;

        // 门杆约束：横移持续窗口内可能穿过多道门，逐门求允许的最大位移
        const shiftReach = h.radius + 14;
        let nudge = wantNudge;
        for (const g of course.gates) {
          if (Math.abs(g.center.y - h.center.y) > shiftReach) continue;
          // 优化线在该门的计划过门点（门线法向过零插值）
          let plannedAlong = 0;
          for (let i = 1; i < line.points.length; i++) {
            const n0 =
              (line.points[i - 1].x - g.center.x) * g.normal.x +
              (line.points[i - 1].y - g.center.y) * g.normal.y;
            const n1 =
              (line.points[i].x - g.center.x) * g.normal.x +
              (line.points[i].y - g.center.y) * g.normal.y;
            if (n0 * n1 <= 0) {
              const q = Math.abs(n0) / (Math.abs(n0) + Math.abs(n1) || 1e-9);
              const a0 =
                (line.points[i - 1].x - g.center.x) * g.dir.x +
                (line.points[i - 1].y - g.center.y) * g.dir.y;
              const a1 =
                (line.points[i].x - g.center.x) * g.dir.x +
                (line.points[i].y - g.center.y) * g.dir.y;
              plannedAlong = a0 + (a1 - a0) * q;
              break;
            }
          }
          // 位移在该门门线方向的分量
          const dirComponent = side * (nearGate.dir.x * g.dir.x + nearGate.dir.y * g.dir.y);
          const clearance = g.width / 2 - 0.2 - Math.abs(plannedAlong);
          if (Math.abs(dirComponent) > 1e-6) {
            nudge = Math.min(nudge, Math.max(0, clearance / Math.abs(dirComponent)));
          }
        }
        // 走廊边界约束
        const xRoom = course.corridorHalfWidth - 0.3 - Math.abs(probeP.x);
        const xComp = Math.abs(nearGate.dir.x);
        if (xComp > 1e-6) nudge = Math.min(nudge, Math.max(0, xRoom / xComp));
        lateralShift = {
          x: nearGate.dir.x * side * nudge,
          y: nearGate.dir.y * side * nudge,
        };
        // 按冰面实际握力与该处曲率反推安全速度，从现在起就提前制动
        const muIce =
          persona.gripBase * (h.gripFactor ?? 0.5) * persona.iceGripRetention;
        const kappa = Math.abs(line.curvature[probe.idx]);
        let vSafe = persona.speedCap;
        if (kappa > 1e-7) vSafe = Math.sqrt((muIce * G * 0.9) / kappa);
        const riskFactor =
          persona.risk === 'aggressive' ? 1.06 : persona.risk === 'cautious' ? 0.92 : 0.98;
        iceSpeedTargets.push({ untilS: hazardS + h.radius, v: vSafe * riskFactor });
        corrections.push({
          timeSec: t,
          arcLength: s,
          kind: 'ice',
          action: persona.risk === 'aggressive' ? 'straighten' : 'line-nudge',
          detail:
            persona.risk === 'aggressive'
              ? `冰面（前 ${upcoming.ahead.toFixed(0)}m）：冒险直线通过，提前收速至 ${(vSafe * riskFactor).toFixed(1)} m/s`
              : `冰面（前 ${upcoming.ahead.toFixed(0)}m）：沿门线横移 ${nudge.toFixed(1)}m，提前收速至 ${(vSafe * riskFactor).toFixed(1)} m/s`,
        });
      }
    }
    // 已越过病害后解除横移
    const hHere = hazardAt(course, p);
    if (!hHere && (lateralShift.x !== 0 || lateralShift.y !== 0)) {
      const k = 1 - Math.min(1, DT * 2.5);
      lateralShift = { x: lateralShift.x * k, y: lateralShift.y * k };
      if (Math.hypot(lateralShift.x, lateralShift.y) < 0.05) {
        lateralShift = { x: 0, y: 0 };
      }
    }

    // ---- 纵向动力学：以计划速度为目标，允许性格偏差 ----
    // 发挥波动：冒险型起伏最大（±3%），稳将最稳定（±0.8%），由种子确定性生成
    const volatility = persona.risk === 'aggressive' ? 0.03 : persona.risk === 'cautious' ? 0.008 : 0.016;
    const jitter = 1 + (rnd() - 0.5) * 2 * volatility;
    const riskBoost = (persona.risk === 'aggressive' ? 1.03 : persona.risk === 'cautious' ? 0.97 : 1) * jitter;
    let vTarget = vPlan * riskBoost;

    const hNow = hazardAt(course, p);
    if (hNow?.kind === 'bump' && hNow.speedCap) {
      vTarget = Math.min(vTarget, hNow.speedCap);
    }
    // 前瞻冰面的提前降速目标（在到达冰面前持续生效）
    for (let k = iceSpeedTargets.length - 1; k >= 0; k--) {
      if (s > iceSpeedTargets[k].untilS) iceSpeedTargets.splice(k, 1);
      else vTarget = Math.min(vTarget, iceSpeedTargets[k].v);
    }
    if (hNow?.kind === 'ice') {
      // 冰面制动能力差：再叠一层性格保守因子
      const iceFactor =
        persona.risk === 'aggressive' ? 0.95 : persona.risk === 'cautious' ? 0.85 : 0.9;
      vTarget = Math.min(vTarget, vPlan * iceFactor);
      // 物理硬约束：按冰面实际可用握力反推该曲率下的安全速度
      const kappa = Math.abs(line.curvature[idx]);
      const muIce =
        persona.gripBase * (hNow.gripFactor ?? 0.5) * persona.iceGripRetention;
      if (kappa > 1e-7) {
        const vGrip = Math.sqrt((muIce * G * 0.92) / kappa);
        vTarget = Math.min(vTarget, vGrip);
      }
    }

    const dv = vTarget - v;
    const a = clamp(dv / DT, -persona.brakeDecel, 0.35 * G);
    v = Math.max(1, v + a * DT);

    // ---- DNF 判定（物理后果，而非随机） ----
    const xNow = p.x + lateralShift.x;
    if (Math.abs(xNow) > course.corridorHalfWidth) {
      dnfReason = '冲出赛道走廊';
      break;
    }
    if (hNow?.kind === 'ice') {
      // 冰面所需侧向摩擦 vs 实际握力；留 10% 控制容差，
      // 让前瞻制动成功的选手能通过，真正超出物理极限才侧滑
      const kappa = Math.abs(line.curvature[idx]);
      const need = (v * v * kappa) / G;
      const mu =
        persona.gripBase * (hNow.gripFactor ?? 0.5) * persona.iceGripRetention;
      if (need > mu * 1.1) {
        dnfReason = `冰面侧滑失控（需摩擦 ${need.toFixed(2)} > 可用 ${mu.toFixed(2)}）`;
        break;
      }
    }
    // 漏门判定：按门序推进，在门线附近的相邻步线段上取首次穿越点，
    // 与优化评价函数使用同一套“首穿即定”几何规则（门线带倾角，不能只比 y）
    const curPos: Vec2 = { x: xNow, y: p.y + lateralShift.y };
    while (nextGateIdx < course.gates.length) {
      const gate = course.gates[nextGateIdx];
      const nPrev =
        (prevPos.x - gate.center.x) * gate.normal.x +
        (prevPos.y - gate.center.y) * gate.normal.y;
      const nCur =
        (curPos.x - gate.center.x) * gate.normal.x +
        (curPos.y - gate.center.y) * gate.normal.y;
      // 还没到这道门的影响窗口，等后续步进
      if (nCur <= 0) break;
      if (nPrev <= 0 && nCur > 0) {
        // 首次穿越门线：插值求交点的沿门线坐标
        const tt = nPrev / (nPrev - nCur);
        const aPrev =
          (prevPos.x - gate.center.x) * gate.dir.x +
          (prevPos.y - gate.center.y) * gate.dir.y;
        const aCur =
          (curPos.x - gate.center.x) * gate.dir.x +
          (curPos.y - gate.center.y) * gate.dir.y;
        const along = aPrev + (aCur - aPrev) * tt;
        if (Math.abs(along) > gate.width / 2) {
          dnfReason = `漏过 ${gate.id + 1} 号旗门（避让横移超出门杆）`;
        }
      } else if (nPrev > 0) {
        // 本步两端都在门线远端：若整段沿门线坐标都在门外，才算漏门
        const aPrev =
          (prevPos.x - gate.center.x) * gate.dir.x +
          (prevPos.y - gate.center.y) * gate.dir.y;
        const aCur =
          (curPos.x - gate.center.x) * gate.dir.x +
          (curPos.y - gate.center.y) * gate.dir.y;
        if (Math.abs(aPrev) > gate.width / 2 && Math.abs(aCur) > gate.width / 2) {
          dnfReason = `漏过 ${gate.id + 1} 号旗门`;
        }
      }
      nextGateIdx++;
      continue;
    }
    prevPos = curPos;
    if (dnfReason) break;

    s += v * DT;
    t += DT;
    maxSpeed = Math.max(maxSpeed, v);
    speedSum += v;
    speedN++;

    if (t >= nextSnapshot - 1e-9) {
      pushSnapshot();
      nextSnapshot = Math.round((t + 0.1) * 10) / 10;
    }
  }

  const finished = dnfReason === undefined;
  if (finished) {
    pushSnapshot();
  }

  return {
    personaId: persona.id,
    personaName: persona.name,
    finishTime: finished ? t : null,
    finished,
    dnfReason,
    maxSpeed,
    avgSpeed: speedN ? speedSum / speedN : 0,
    corrections,
    snapshots,
  };
}
