// 全局类型定义：赛道、旗门、雪况、对手性格、优化结果

/** 二维点（米）。y 沿滚落线向下增大，x 为横向 */
export interface Vec2 {
  x: number;
  y: number;
}

/** 旗门：由两根门杆组成的过门线段 */
export interface Gate {
  id: number;
  /** 门线中点 */
  center: Vec2;
  /** 门线方向的单位向量（沿两杆连线） */
  dir: Vec2;
  /** 与 dir 垂直、用于衡量过门偏移的单位法向量 */
  normal: Vec2;
  /** 两门杆间距（米） */
  width: number;
  /** 弯形：下一段主要向左还是向右（inside 杆所在侧） */
  turn: 'L' | 'R';
  /** 内侧门杆位置 */
  insidePole: Vec2;
  /** 外侧门杆位置 */
  outsidePole: Vec2;
  /** 与上一门的沿坡距离（米），第 0 门为 0 */
  spacing: number;
}

/** 雪况类型 */
export type SnowType = 'powder' | 'compact' | 'icy';

/** 雪面病害（冰面 / 雪包），按矩形区域给出 */
export interface Hazard {
  id: number;
  kind: 'ice' | 'bump';
  /** 区域中心 */
  center: Vec2;
  /** 区域半径（米，按圆近似） */
  radius: number;
  /** 冰面：握力折减系数；雪包：通过时的等效限速 m/s */
  gripFactor?: number;
  speedCap?: number;
}

/** 赛道定义 */
export interface Course {
  id: string;
  name: string;
  discipline: 'slalom' | 'giant';
  /** 旗门列表，y 单调递增 */
  gates: Gate[];
  /** 赛道安全走廊半宽（米），走线越界视为出局 */
  corridorHalfWidth: number;
  /** 中心线各点的坡角（弧度），按 y 分段插值 */
  slopeProfile: { y: number; angleRad: number }[];
  /** 基础雪况 */
  snow: SnowType;
  /** 病害列表 */
  hazards: Hazard[];
  /** 起点 */
  start: Vec2;
  /** 终点 y */
  finishY: number;
}

/** 对手性格 / 滑行风格（物理参数化的风险偏好） */
export interface Persona {
  id: string;
  name: string;
  /** 风险偏好标签 */
  risk: 'cautious' | 'balanced' | 'aggressive';
  /** 最大立刃角（弧度） */
  maxEdgeAngleRad: number;
  /** 常规雪面握力（等效摩擦系数上限） */
  gripBase: number;
  /** 冰面握力保留比例（1 = 不衰减；越小越怕冰） */
  iceGripRetention: number;
  /** 直道极速 m/s */
  speedCap: number;
  /** 舒适制动减速度 m/s^2（后扫约束用） */
  brakeDecel: number;
  /** 最大转弯角速度 rad/s（人体旋转能力，限制尖角 pivot，v·κ ≤ ω） */
  turnRateMax: number;
  /** 走廊裕度（米）：走线离边界至少留多远 */
  corridorMargin: number;
  /** 过门安全裕度（米） */
  gateMargin: number;
  /** 基础滚阻 + 气动阻力系数组合 */
  dragCoef: number;
  /** 展示用颜色 */
  color: string;
}

/** 单个旗门的过弯分析数据 */
export interface GateAnalysis {
  gateId: number;
  /** 过门点相对门线中心的带符号偏移（米，沿 gate.normal） */
  offset: number;
  /** 距内侧门杆净距（米） */
  insideClearance: number;
  /** 提前起弧点距旗门的沿弧长距离（米） */
  turnInDistance: number;
  /** 弯中最小速度 m/s */
  apexSpeed: number;
  /** 弯中最大立刃角（弧度） */
  maxEdgeRad: number;
  /** 走高线 / 标准线 / 走低线 */
  line: 'high' | 'standard' | 'low';
}

/** 优化产出的完整走线 */
export interface OptimizedLine {
  /** 重采样后的折线点（米） */
  points: Vec2[];
  /** 累积弧长（米），与 points 等长 */
  arcLength: number[];
  /** 各点速度 m/s */
  speed: number[];
  /** 各点曲率 1/m */
  curvature: number[];
  /** 各点立刃角（弧度） */
  edgeAngle: number[];
  /** 总用时（秒） */
  totalTime: number;
  /** 总滑行距离（米） */
  totalLength: number;
  /** 每门分析 */
  gateAnalysis: GateAnalysis[];
  /** 决策变量：每门过门偏移（米） */
  offsets: number[];
  /** 优化迭代次数 */
  iterations: number;
  /** 优化墙钟耗时（毫秒） */
  computeMs: number;
  /** 是否所有门都通过 */
  allGatesCleared: boolean;
  /** 越界点数量 */
  corridorViolations: number;
}

/** 比赛中的临时修正事件 */
export interface CorrectionEvent {
  timeSec: number;
  arcLength: number;
  kind: 'ice' | 'bump';
  action: 'brake' | 'straighten' | 'line-nudge';
  detail: string;
}

/** 比赛模拟结果 */
export interface RaceResult {
  personaId: string;
  personaName: string;
  finishTime: number | null;
  finished: boolean;
  dnfReason?: string;
  maxSpeed: number;
  avgSpeed: number;
  corrections: CorrectionEvent[];
  /** 每 0.1s 的比赛快照（位置/速度），用于回放 */
  snapshots: { t: number; x: number; y: number; v: number }[];
}

/** Worker 优化请求 */
export interface OptimizeRequest {
  type: 'optimize';
  requestId: number;
  course: Course;
  persona: Persona;
  /** 时间预算（毫秒），到点即返回当前最优 */
  budgetMs: number;
}

/** Worker 优化响应 */
export interface OptimizeResponse {
  type: 'optimized';
  requestId: number;
  line: OptimizedLine;
  baselineTime: number;
  improvementPct: number;
}
