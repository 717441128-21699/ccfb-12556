import { describe, expect, it } from 'vitest';
import { COURSE_SPECS, PERSONAS, generateCourse } from './courses';
import { optimizeLine } from './optimizer';
import { simulateRace } from './race';
import { buildSlopeTable, evaluateBaseline, evaluateControls } from './physics';
import { samplePath } from './spline';

const slalomSpec = COURSE_SPECS.find((c) => c.id === 'sl-classic')!;
const giantSpec = COURSE_SPECS.find((c) => c.id === 'gs-glacier')!;

describe('赛道规格（FIS 近似）', () => {
  it('回转：60 门、门距 7–13m、门宽 4–6m、横向偏移 4–9m', () => {
    const c = generateCourse(slalomSpec);
    expect(c.gates.length).toBe(60);
    for (const g of c.gates) {
      expect(g.width).toBeGreaterThanOrEqual(4);
      expect(g.width).toBeLessThanOrEqual(6);
      if (g.id > 0) {
        expect(g.spacing).toBeGreaterThanOrEqual(7);
        expect(g.spacing).toBeLessThanOrEqual(13);
        const prev = c.gates[g.id - 1].center;
        const lat = Math.abs(g.center.x - prev.x);
        expect(lat).toBeGreaterThanOrEqual(3.5);
        expect(lat).toBeLessThanOrEqual(9.5);
      }
    }
  });

  it('大回转：门距 13–22m、门宽 4–8m、横向偏移 6–14m', () => {
    const c = generateCourse(giantSpec);
    for (const g of c.gates) {
      expect(g.width).toBeGreaterThanOrEqual(4);
      expect(g.width).toBeLessThanOrEqual(8);
      if (g.id > 0) {
        expect(g.spacing).toBeGreaterThanOrEqual(13);
        expect(g.spacing).toBeLessThanOrEqual(22);
        const prev = c.gates[g.id - 1].center;
        const lat = Math.abs(g.center.x - prev.x);
        expect(lat).toBeGreaterThanOrEqual(5.5);
        expect(lat).toBeLessThanOrEqual(14.5);
      }
    }
  });

  it('门序沿坡单调、门杆几何自洽', () => {
    for (const spec of COURSE_SPECS) {
      const c = generateCourse(spec);
      for (let i = 1; i < c.gates.length; i++) {
        expect(c.gates[i].center.y).toBeGreaterThan(c.gates[i - 1].center.y);
        const g = c.gates[i];
        expect(Math.hypot(g.dir.x, g.dir.y)).toBeCloseTo(1, 6);
        expect(Math.hypot(g.normal.x, g.normal.y)).toBeCloseTo(1, 6);
      }
    }
  });
});

describe('硬指标 1：优化线比旗门连线快 5% 以上且不漏门', () => {
  for (const persona of PERSONAS) {
    it(`${persona.name}（${persona.risk}）在回转赛道`, () => {
      const course = generateCourse(slalomSpec);
      const { line, baselineTime } = optimizeLine(course, persona, 3000);
      const improvement = (baselineTime - line.totalTime) / baselineTime;
      expect(line.allGatesCleared).toBe(true);
      expect(line.gateAnalysis.length).toBe(course.gates.length);
      expect(line.corridorViolations).toBe(0);
      expect(improvement).toBeGreaterThan(0.05);
      // 输出实际数字，便于人工核对
      // eslint-disable-next-line no-console
      console.log(
        `[${persona.risk}] 基线 ${baselineTime.toFixed(2)}s → 优化 ${line.totalTime.toFixed(2)}s，快 ${(improvement * 100).toFixed(1)}%，评价 ${line.iterations} 次`,
      );
    });
  }

  it('大回转赛道同样满足', () => {
    const course = generateCourse(giantSpec);
    const persona = PERSONAS[1];
    const { line, baselineTime } = optimizeLine(course, persona, 3000);
    const improvement = (baselineTime - line.totalTime) / baselineTime;
    expect(line.allGatesCleared).toBe(true);
    expect(improvement).toBeGreaterThan(0.05);
  });
});

describe('硬指标 2：60 门赛道 3 秒内算完', () => {
  it('三种性格全部在预算内返回', () => {
    const course = generateCourse(slalomSpec);
    for (const persona of PERSONAS) {
      const t0 = Date.now();
      const { line } = optimizeLine(course, persona, 3000);
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(3000);
      expect(line.computeMs).toBeLessThan(3000);
      expect(line.points.length).toBeGreaterThan(100);
    }
  });
});

describe('物理约束', () => {
  it('立刃角不超过性格上限，速度不超过极速', () => {
    const course = generateCourse(slalomSpec);
    const persona = PERSONAS[2];
    const { line } = optimizeLine(course, persona, 2500);
    for (const e of line.edgeAngle) {
      expect(e).toBeLessThanOrEqual(persona.maxEdgeAngleRad + 1e-6);
    }
    for (const v of line.speed) {
      expect(v).toBeLessThanOrEqual(persona.speedCap + 1e-6);
    }
  });

  it('弯中速度满足 v²κ ≤ 握力/立刃综合上限', () => {
    const course = generateCourse(slalomSpec);
    const persona = PERSONAS[0];
    const { line } = optimizeLine(course, persona, 2500);
    const aEdge = 9.81 * Math.tan(persona.maxEdgeAngleRad);
    const aGrip = persona.gripBase * 9.81;
    const aMax = Math.min(aEdge, aGrip);
    let worst = 0;
    for (let i = 0; i < line.points.length; i++) {
      const kappa = Math.abs(line.curvature[i]);
      const need = line.speed[i] * line.speed[i] * kappa;
      worst = Math.max(worst, need / aMax);
      // 曲率为差分估计，留 3% 离散化容差
      expect(need).toBeLessThanOrEqual(aMax * 1.03);
    }
    // 绝大多数点应严格满足
    expect(worst).toBeLessThan(1.03);
  });

  it('优化线相对门心基线物理更优：弯心速度更高、用时更短，且同样光滑过门', () => {
    const course = generateCourse(slalomSpec);
    const persona = PERSONAS[1];
    const slopeTable = buildSlopeTable(course);
    const baseline = evaluateBaseline(course, persona, slopeTable);
    const { line } = optimizeLine(course, persona, 2500);

    // 两条都是光滑样条，优化线靠过门点与高低线决策取胜，而非几何作弊
    expect(baseline.allGatesCleared).toBe(true);
    expect(line.allGatesCleared).toBe(true);
    expect(line.totalTime).toBeLessThan(baseline.time * 0.95);

    // 弯心（每门窗口最低速）的中位速度：优化线提前起弧、弯中损失更小
    const apexPerGate = (speeds: number[], pts: { x: number; y: number }[]) =>
      course.gates.map((g) => {
        let v = Infinity;
        for (let i = 0; i < pts.length; i++) {
          if (Math.abs(pts[i].y - g.center.y) < (g.spacing || 10) * 0.55) {
            v = Math.min(v, speeds[i]);
          }
        }
        return v;
      });
    const baseApex = apexPerGate(baseline.speed, baseline.path.points).sort((a, b) => a - b);
    const optApex = apexPerGate(line.speed, line.points).sort((a, b) => a - b);
    const med = (a: number[]) => a[Math.floor(a.length / 2)];
    expect(med(optApex)).toBeGreaterThan(med(baseApex) * 1.05);

    // 总转向量：过同样的门，优化线靠提前起弧把转向摊开，总转向量不应显著高于门心基线
    const totalTurn = (curv: number[], arc: number[]) => {
      let sum = 0;
      for (let i = 1; i < curv.length; i++) {
        sum += Math.abs(curv[i]) * (arc[i] - arc[i - 1]);
      }
      return sum;
    };
    const turnBase = totalTurn(baseline.path.curvature, baseline.path.arcLength);
    const turnOpt = totalTurn(line.curvature, line.arcLength);
    expect(turnOpt).toBeLessThan(turnBase * 1.2);
  });

  it('优化确实产生“走高线/提前起弧”决策，而非全部门心直穿', () => {
    const course = generateCourse(slalomSpec);
    const persona = PERSONAS[1];
    const { line } = optimizeLine(course, persona, 2500);
    const highCount = line.gateAnalysis.filter((g) => g.line === 'high').length;
    const earlyArc = line.gateAnalysis.filter((g) => g.turnInDistance > 4).length;
    expect(highCount + earlyArc).toBeGreaterThan(course.gates.length * 0.5);
  });

  it('光滑样条在每道门的门线法向过零处落在门杆之间', () => {
    const course = generateCourse(slalomSpec);
    const persona = PERSONAS[1];
    const { best } = optimizeLine(course, persona, 2500);
    expect(best.allGatesCleared).toBe(true);
    for (const g of course.gates) {
      let hit = false;
      for (let i = 0; i < best.path.points.length - 1; i++) {
        const p0 = best.path.points[i];
        const p1 = best.path.points[i + 1];
        const n0 =
          (p0.x - g.center.x) * g.normal.x + (p0.y - g.center.y) * g.normal.y;
        const n1 =
          (p1.x - g.center.x) * g.normal.x + (p1.y - g.center.y) * g.normal.y;
        if (n0 * n1 <= 0) {
          const t = Math.abs(n0) / (Math.abs(n0) + Math.abs(n1) || 1e-9);
          const a0 =
            (p0.x - g.center.x) * g.dir.x + (p0.y - g.center.y) * g.dir.y;
          const a1 =
            (p1.x - g.center.x) * g.dir.x + (p1.y - g.center.y) * g.dir.y;
          const along = a0 + (a1 - a0) * t;
          if (Math.abs(along) <= g.width / 2) hit = true;
        }
      }
      expect(hit, `门 ${g.id} 未被路径穿过`).toBe(true);
    }
  });
});

describe('风险偏好差异', () => {
  it('冒险型走线更直更短，稳将走线更长更保守', () => {
    const course = generateCourse(slalomSpec);
    const cautious = optimizeLine(course, PERSONAS[0], 2500).line;
    const aggressive = optimizeLine(course, PERSONAS[2], 2500).line;
    expect(aggressive.totalLength).toBeLessThan(cautious.totalLength);
    // 冒险型门杆净距更小（贴杆）
    const minClearA = Math.min(...aggressive.gateAnalysis.map((g) => g.insideClearance));
    const minClearC = Math.min(...cautious.gateAnalysis.map((g) => g.insideClearance));
    expect(minClearA).toBeLessThan(minClearC);
  });

  it('比赛模拟会产出冰面/雪包临时修正事件', () => {
    const course = generateCourse(slalomSpec);
    expect(course.hazards.length).toBeGreaterThan(0);
    const persona = PERSONAS[1];
    const { line } = optimizeLine(course, persona, 2500);
    const result = simulateRace(course, persona, line);
    expect(result.corrections.length).toBeGreaterThan(0);
    expect(result.finished).toBe(true);
    expect(result.snapshots.length).toBeGreaterThan(50);
  });
});

describe('基线对照', () => {
  it('基线本身几何上通过每道门（公平对照）', () => {
    const course = generateCourse(slalomSpec);
    const persona = PERSONAS[1];
    const slopeTable = buildSlopeTable(course);
    const base = evaluateBaseline(course, persona, slopeTable);
    expect(base.allGatesCleared).toBe(true);
  });

  it('随机控制点会被惩罚函数识别（漏门代价存在）', () => {
    const course = generateCourse(slalomSpec);
    const persona = PERSONAS[1];
    const slopeTable = buildSlopeTable(course);
    const controls = [
      course.start,
      ...course.gates.map((g, i) => ({
        x: g.center.x + (i % 2 === 0 ? 6 : -6),
        y: g.center.y,
      })),
      { x: 0, y: course.finishY },
    ];
    const ev = evaluateControls(course, persona, controls, slopeTable, 2.0);
    expect(ev.gateViolations).toBeGreaterThan(0);
    // 光滑样条仍可采样
    expect(samplePath(controls, 2).points.length).toBeGreaterThan(10);
  });
});
