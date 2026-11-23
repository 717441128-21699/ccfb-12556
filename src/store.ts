import { COURSE_SPECS, PERSONAS, generateCourse } from './engine/courses';
import type {
  Course,
  OptimizedLine,
  Persona,
  RaceResult,
} from './engine/types';
import type { WorkerRequest, WorkerResponse } from './workers/optimizer.worker';

export type PageId = 'courses' | 'race' | 'analysis' | 'opponents';

/** 单个对手的计算状态机 */
export interface RivalState {
  persona: Persona;
  line: OptimizedLine | null;
  baselineTime: number | null;
  improvementPct: number | null;
  race: RaceResult | null;
  status: 'idle' | 'optimizing' | 'ready' | 'racing' | 'error';
}

interface AppState {
  page: PageId;
  courses: Course[];
  selectedCourseId: string;
  rivals: RivalState[];
  /** 分析页选中的对手 */
  analysisRivalId: string;
  workerBusy: boolean;
}

type Listener = (s: AppState) => void;

const worker = new Worker(
  new URL('./workers/optimizer.worker.ts', import.meta.url),
  { type: 'module' },
);

let requestSeq = 1;
const pending = new Map<number, (resp: WorkerResponse) => void>();

worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
  const resp = ev.data;
  const cb = pending.get(resp.requestId);
  if (cb) {
    pending.delete(resp.requestId);
    cb(resp);
  }
  state.workerBusy = pending.size > 0;
  emit();
};

function callWorker(req: Omit<WorkerRequest, 'requestId'>): Promise<WorkerResponse> {
  const requestId = requestSeq++;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    state.workerBusy = true;
    worker.postMessage({ ...req, requestId } as WorkerRequest);
    emit();
  });
}

const courses = COURSE_SPECS.map(generateCourse);

const state: AppState = {
  page: 'courses',
  courses,
  selectedCourseId: courses[0].id,
  rivals: PERSONAS.map((persona) => ({
    persona,
    line: null,
    baselineTime: null,
    improvementPct: null,
    race: null,
    status: 'idle' as const,
  })),
  analysisRivalId: PERSONAS[1].id,
  workerBusy: false,
};

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l({ ...state, rivals: state.rivals.map((r) => ({ ...r })) });
}

export const store = {
  getState(): AppState {
    return state;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    l(state);
    return () => listeners.delete(l);
  },
  navigate(page: PageId) {
    state.page = page;
    emit();
  },
  selectCourse(id: string) {
    state.selectedCourseId = id;
    // 换赛道后所有缓存失效
    for (const r of state.rivals) {
      r.line = null;
      r.race = null;
      r.baselineTime = null;
      r.improvementPct = null;
      r.status = 'idle';
    }
    emit();
  },
  setAnalysisRival(id: string) {
    state.analysisRivalId = id;
    emit();
  },
  currentCourse(): Course {
    return state.courses.find((c) => c.id === state.selectedCourseId) ?? state.courses[0];
  },
  rival(id: string): RivalState {
    return state.rivals.find((r) => r.persona.id === id) ?? state.rivals[0];
  },

  /** 为全部对手计算优化走线（串行派发，避免 Worker 并发抢占） */
  async optimizeAll(budgetMs = 3000) {
    const course = this.currentCourse();
    for (const rival of state.rivals) {
      rival.status = 'optimizing';
      emit();
      const resp = await callWorker({
        type: 'optimize',
        course,
        persona: rival.persona,
        budgetMs,
      } as WorkerRequest);
      if (resp.type === 'optimized') {
        rival.line = resp.line;
        rival.baselineTime = resp.baselineTime;
        rival.improvementPct = resp.improvementPct;
        rival.status = 'ready';
      } else {
        rival.status = 'error';
      }
      emit();
    }
  },

  /** 跑全部对手的比赛模拟 */
  async raceAll() {
    const course = this.currentCourse();
    for (const rival of state.rivals) {
      if (!rival.line) continue;
      rival.status = 'racing';
      emit();
      const resp = await callWorker({
        type: 'race',
        course,
        persona: rival.persona,
        line: rival.line,
        seed: 42,
      } as WorkerRequest);
      if (resp.type === 'raced') {
        rival.race = resp.result;
        rival.status = 'ready';
      } else {
        rival.status = 'error';
      }
      emit();
    }
  },
};
