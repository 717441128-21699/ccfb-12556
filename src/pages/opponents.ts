import { PERSONAS } from '../engine/courses';
import { store } from '../store';
import type { Persona } from '../engine/types';

const RAD = 180 / Math.PI;

interface FieldDef {
  key: keyof Persona;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
  toView?: (v: number) => number;
  fromView?: (v: number) => number;
}

const FIELDS: FieldDef[] = [
  {
    key: 'maxEdgeAngleRad', label: '最大立刃角', min: 50, max: 78, step: 1, unit: '°',
    hint: '立刃越大，同等速度下转弯半径越小，但对雪面握力要求越高',
    toView: (v) => v * RAD, fromView: (v) => v / RAD,
  },
  {
    key: 'gripBase', label: '基础握力 μ', min: 0.45, max: 0.85, step: 0.01, unit: '',
    hint: '雪面能提供的最大侧向摩擦系数，决定弯中速度上限 v²κ ≤ μg·cosθ',
  },
  {
    key: 'iceGripRetention', label: '冰面握力保留', min: 0.3, max: 1, step: 0.05, unit: '',
    hint: '上冰后还能保留多少握力；越低越怕冰，冒险型通常更低',
  },
  {
    key: 'speedCap', label: '直道极速', min: 20, max: 31, step: 0.5, unit: 'm/s',
    hint: '气动/姿态决定的速度天花板',
  },
  {
    key: 'brakeDecel', label: '舒适制动减速度', min: 4, max: 8, step: 0.2, unit: 'm/s²',
    hint: '后扫速度约束的核心：看到前方急弯/冰面时能多快把速度降下来',
  },
  {
    key: 'corridorMargin', label: '走廊裕度', min: 0.2, max: 2.5, step: 0.05, unit: 'm',
    hint: '走线离赛道边界的安全距离；越小越敢贴边，越容易冲出',
  },
  {
    key: 'gateMargin', label: '过门裕度', min: 0.05, max: 0.8, step: 0.01, unit: 'm',
    hint: '过门时离门杆的最小净距；贴杆走线更短但容错低',
  },
  {
    key: 'dragCoef', label: '阻力系数', min: 0.006, max: 0.02, step: 0.001, unit: '',
    hint: '滚阻+气动综合系数，作用于 v² 的减速项',
  },
];

function personaCard(p: Persona): string {
  const riskLabel = p.risk === 'aggressive' ? '冒险型' : p.risk === 'cautious' ? '稳健型' : '均衡型';
  return `
    <div class="card" data-persona-card="${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3><span class="badge-dot" style="background:${p.color}"></span>${p.name}</h3>
        <span class="tag ${p.risk}">${riskLabel}</span>
      </div>
      <p class="muted small" style="margin-top:0">
        ${p.risk === 'aggressive'
          ? '高立刃、高握力、小裕度：走线更直更快，但冰面握力储备低，比赛模拟中可能真实 DNF。'
          : p.risk === 'cautious'
            ? '中等立刃、大裕度、冰面保留高：走线略长，但几乎不会失控，成绩稳定。'
            : '介于两者之间，速度与容错均衡。'}
      </p>
      ${FIELDS.map((f) => {
        const raw = p[f.key] as number;
        const view = f.toView ? f.toView(raw) : raw;
        return `
        <label class="field">
          <span class="lab"><span>${f.label}</span><b data-value="${p.id}:${f.key}">${view.toFixed(f.step < 0.01 ? 3 : 2)}${f.unit}</b></span>
          <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${view}"
            data-persona="${p.id}" data-key="${f.key}" />
          <span class="muted small">${f.hint}</span>
        </label>`;
      }).join('')}
      <button class="ghost" data-reset="${p.id}" style="width:100%">恢复预设</button>
    </div>`;
}

export function renderOpponentsPage(): string {
  const s = store.getState();
  return `
    <h2 style="margin-top:0">对手设置</h2>
    <p class="muted">风险偏好不是速度加成，而是一组物理参数。调整后回到比赛页重新计算，优化器会按新参数重新求走线。</p>
    <div class="grid cols-3">
      ${s.rivals.map((r) => personaCard(r.persona)).join('')}
    </div>
    <div class="card" style="margin-top:18px">
      <div class="section-title">参数如何进入轨迹优化</div>
      <ul class="muted small" style="margin:0;padding-left:18px;line-height:1.9">
        <li>弯中速度硬约束：<b class="mono">v²κ ≤ min(μg·cosθ, g·cosθ·tan(立刃角))</b>，握力或立刃不足时优化器必须提前减速、放大转弯半径</li>
        <li>后扫制动约束：<b class="mono">v(s) ≤ √(v(s+ds)² + 2·制动减速度·ds)</b>，刹不住的走线直接不可行</li>
        <li>门杆/走廊裕度进入决策变量的可行域：裕度越小，优化器越敢贴杆切弯，走线越短</li>
        <li>冰面握力 = 基础握力 × 冰面系数 × 冰面保留率，比赛模拟中若需要摩擦超过可用值即侧滑 DNF</li>
      </ul>
    </div>`;
}

export function mountOpponentsPage() {
  document.querySelectorAll<HTMLInputElement>('input[type="range"][data-persona]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.dataset.persona!;
      const key = input.dataset.key as keyof Persona;
      const field = FIELDS.find((f) => f.key === key)!;
      const viewVal = Number(input.value);
      const realVal = field.fromView ? field.fromView(viewVal) : viewVal;
      const rival = store.rival(id);
      (rival.persona[key] as number) = realVal;
      // 参数变了，缓存的走线失效
      rival.line = null;
      rival.race = null;
      rival.baselineTime = null;
      rival.improvementPct = null;
      rival.status = 'idle';
      const label = document.querySelector(`[data-value="${id}:${key}"]`);
      if (label) label.textContent = `${viewVal.toFixed(field.step < 0.01 ? 3 : 2)}${field.unit}`;
    });
  });

  document.querySelectorAll<HTMLElement>('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.reset!;
      const preset = PERSONAS.find((p) => p.id === id)!;
      const rival = store.rival(id);
      Object.assign(rival.persona, preset);
      rival.line = null;
      rival.race = null;
      rival.status = 'idle';
      // 重绘本页滑杆
      remount();
    });
  });
}

function remount() {
  const host = document.getElementById('page-host')!;
  host.innerHTML = renderOpponentsPage();
  mountOpponentsPage();
}
