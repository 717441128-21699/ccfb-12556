import { optimizeLine } from '../engine/optimizer';
import { simulateRace } from '../engine/race';
import type {
  Course,
  OptimizeRequest,
  OptimizeResponse,
  Persona,
  RaceResult,
} from '../engine/types';
import type { OptimizedLine } from '../engine/types';

// 轨迹优化与比赛模拟都在 Worker 内完成，不阻塞 UI 渲染
const ctx = self as unknown as DedicatedWorkerGlobalScope;

export interface RaceMessage {
  type: 'race';
  requestId: number;
  course: Course;
  persona: Persona;
  line: OptimizedLine;
  seed: number;
}

export interface RaceResponse {
  type: 'raced';
  requestId: number;
  result: RaceResult;
}

export type WorkerRequest = OptimizeRequest | RaceMessage;
export type WorkerResponse = OptimizeResponse | RaceResponse;

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;

  if (msg.type === 'optimize') {
    const { requestId, course, persona, budgetMs } = msg;
    const outcome = optimizeLine(course, persona, budgetMs);
    const response: OptimizeResponse = {
      type: 'optimized',
      requestId,
      line: outcome.line,
      baselineTime: outcome.baselineTime,
      improvementPct:
        (outcome.baselineTime - outcome.line.totalTime) / outcome.baselineTime,
    };
    ctx.postMessage(response);
    return;
  }

  if (msg.type === 'race') {
    const result = simulateRace(msg.course, msg.persona, msg.line, msg.seed);
    const response: RaceResponse = {
      type: 'raced',
      requestId: msg.requestId,
      result,
    };
    ctx.postMessage(response);
    return;
  }
};
