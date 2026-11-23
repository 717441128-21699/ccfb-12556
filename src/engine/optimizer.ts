import type { Course, Persona, Vec2 } from './types';
import {
  buildSlopeTable,
  evaluateBaseline,
  evaluateControls,
  toOptimizedLine,
  type EvalResult,
} from './physics';
import type { OptimizedLine } from './types';

export interface OptimizeOutcome {
  line: OptimizedLine;
  baselineTime: number;
  baseline: EvalResult;
  best: EvalResult;
}

/** 每门两个决策变量：沿门线位置 along、过门上下偏移 normal（正=低线/负=高线） */
export function buildControls(course: Course, along: number[], normal: number[]): Vec2[] {
  const controls: Vec2[] = [course.start];
  course.gates.forEach((g, i) => {
    controls.push({
      x: g.center.x + g.dir.x * along[i] + g.normal.x * normal[i],
      y: g.center.y + g.dir.y * along[i] + g.normal.y * normal[i],
    });
  });
  const last = course.gates[course.gates.length - 1].center;
  controls.push({ x: last.x, y: course.finishY });
  return controls;
}

interface StartVariant {
  name: string;
  /** 初始 along 相对门内边界的比例与方向系数（-1..1） */
  alongFrac: number;
  /** 初始 normal 偏移（米，负=高线） */
  normalBias: number;
}

const VARIANTS: StartVariant[] = [
  { name: 'inside', alongFrac: 0.4, normalBias: 0 },
  { name: 'center', alongFrac: 0, normalBias: 0 },
  { name: 'high', alongFrac: -0.5, normalBias: -0.6 },
];

/**
 * 多分辨率坐标下降（Gauss-Seidel 贪心 + 步长衰减 + 正反扫），
 * 配合多起点初始化避免低握力/冰面赛道上的局部最优。
 * 确定性、无需求导；Catmull-Rom 光滑使相邻门变量天然耦合，
 * “提前起弧 / 走高线”由优化器在物理代价下自行涌现。
 */
export function optimizeLine(
  course: Course,
  persona: Persona,
  budgetMs = 3000,
): OptimizeOutcome {
  const t0 = Date.now();
  const slopeTable = buildSlopeTable(course);
  const G = course.gates.length;

  const baseline = evaluateBaseline(course, persona, slopeTable);

  const alongBound = new Array<number>(G);
  const xLimit = course.corridorHalfWidth - persona.corridorMargin;
  course.gates.forEach((g, i) => {
    alongBound[i] = Math.max(0.2, g.width / 2 - persona.gateMargin - 0.05);
  });

  const evalCount = { n: 0 };
  // 多起点下降与终评都受预算保护；绝对截止保证任何赛道都在预算内返回
  const hardDeadline = t0 + budgetMs * 0.72;
  const absoluteDeadline = t0 + budgetMs * 0.94;

  const evalAt = (a: number[], nm: number[], stepM: number): EvalResult => {
    evalCount.n++;
    return evaluateControls(course, persona, buildControls(course, a, nm), slopeTable, stepM);
  };

  const stages: { stepM: number; stepSizes: number[]; sweeps: number }[] = [
    { stepM: 2.2, stepSizes: [2.0, 1.0, 0.5], sweeps: 2 },
    { stepM: 1.8, stepSizes: [0.6, 0.3], sweeps: 2 },
    { stepM: 1.4, stepSizes: [0.25, 0.12, 0.06], sweeps: 1 },
  ];

  /** 从一组初始变量出发跑坐标下降，返回该起点的最优解 */
  const descend = (
    initAlong: number[],
    initNormal: number[],
    startDeadline: number,
  ): { ev: EvalResult; along: number[]; normal: number[] } => {
    let best = evalAt(initAlong, initNormal, 2.2);
    let bestAlong = initAlong.slice();
    let bestNormal = initNormal.slice();

    stageLoop: for (const stage of stages) {
      for (let sweep = 0; sweep < stage.sweeps; sweep++) {
        const order = [...Array(G).keys()];
        if (sweep % 2 === 1) order.reverse();
        for (const step of stage.stepSizes) {
          for (const i of order) {
            if ((evalCount.n & 15) === 0 && Date.now() >= startDeadline) break stageLoop;
            const g = course.gates[i];

            for (const dir of [1, -1]) {
              const trialA = bestAlong.slice();
              trialA[i] = Math.max(
                -alongBound[i],
                Math.min(alongBound[i], trialA[i] + dir * step),
              );
              const ev = evalAt(trialA, bestNormal, stage.stepM);
              if (ev.cost < best.cost - 1e-6) {
                best = ev;
                bestAlong = trialA;
              }
            }

            for (const dir of [1, -1]) {
              const trialN = bestNormal.slice();
              const cand = trialN[i] + dir * step;
              // 收紧过门上下偏移：偏离门线过远会让样条首穿点落到门杆外
              if (Math.abs(cand) > 1.8) continue;
              const ctrlX = g.center.x + g.dir.x * bestAlong[i] + g.normal.x * cand;
              if (Math.abs(ctrlX) > xLimit) continue;
              trialN[i] = cand;
              const ev = evalAt(bestAlong, trialN, stage.stepM);
              if (ev.cost < best.cost - 1e-6) {
                best = ev;
                bestNormal = trialN;
              }
            }
          }
        }
      }
    }
    return { ev: best, along: bestAlong, normal: bestNormal };
  };

  // 多起点：预算均分，全局保留代价最低的解
  const perStart = Math.max(250, (hardDeadline - Date.now()) / VARIANTS.length);
  let globalBest: EvalResult | null = null;
  let globalAlong: number[] = [];
  let globalNormal: number[] = [];

  for (const variant of VARIANTS) {
    if (Date.now() >= hardDeadline) break;
    const initAlong = new Array<number>(G);
    const initNormal = new Array<number>(G);
    course.gates.forEach((g, i) => {
      const sign = g.turn === 'L' ? -1 : 1;
      initAlong[i] = sign * alongBound[i] * variant.alongFrac;
      initNormal[i] = variant.normalBias;
    });
    const startDeadline = Math.min(hardDeadline, Date.now() + perStart);
    const outcome = descend(initAlong, initNormal, startDeadline);
    if (!globalBest || outcome.ev.cost < globalBest.cost) {
      globalBest = outcome.ev;
      globalAlong = outcome.along;
      globalNormal = outcome.normal;
    }
  }

  // 终评：标准分辨率，保证报告数据一致；时间不够则沿用下降阶段的最优解
  if (Date.now() < absoluteDeadline) {
    const finalEv = evalAt(globalAlong, globalNormal, 1.2);
    if (!globalBest || finalEv.cost <= globalBest.cost + 1e-6) globalBest = finalEv;
  }

  const computeMs = Date.now() - t0;
  const line = toOptimizedLine(globalBest!, globalNormal, evalCount.n, computeMs);

  return { line, baselineTime: baseline.time, baseline, best: globalBest! };
}
