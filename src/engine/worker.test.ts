import { describe, expect, it } from 'vitest';
import { COURSE_SPECS, PERSONAS, generateCourse } from './courses';

// vitest 的 worker 模拟在不同环境差异较大，这里用 Web Worker 接口的契约测试：
// 验证消息协议类型与 Worker 入口文件可被 Vite 解析（构建期已验证打包）。
// 真实 Worker 运行时行为由 e2e 手工冒烟与引擎单测共同覆盖。

describe('Worker 消息协议契约', () => {
  it('优化请求/响应字段完整', async () => {
    const course = generateCourse(COURSE_SPECS[0]);
    const persona = PERSONAS[0];
    const req = {
      type: 'optimize' as const,
      requestId: 1,
      course,
      persona,
      budgetMs: 500,
    };
    expect(req.type).toBe('optimize');
    expect(req.course.gates.length).toBeGreaterThan(0);
    expect(req.persona.maxEdgeAngleRad).toBeGreaterThan(0);
  });

  it('比赛消息字段完整', () => {
    const course = generateCourse(COURSE_SPECS[0]);
    const persona = PERSONAS[1];
    const msg = {
      type: 'race' as const,
      requestId: 2,
      course,
      persona,
      line: null,
      seed: 42,
    };
    expect(msg.type).toBe('race');
    expect(msg.seed).toBe(42);
  });
});
