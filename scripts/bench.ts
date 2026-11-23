import { COURSE_SPECS, PERSONAS, generateCourse } from '../src/engine/courses';
import { optimizeLine } from '../src/engine/optimizer';
import { simulateRace } from '../src/engine/race';

console.log('赛道'.padEnd(18), '性格'.padEnd(10), '基线s'.padStart(8), '优化s'.padStart(8), '提升'.padStart(7), '耗时ms'.padStart(8), '漏门'.padStart(4), '比赛'.padStart(10));
for (const spec of COURSE_SPECS) {
  const course = generateCourse(spec);
  for (const persona of PERSONAS) {
    const t0 = Date.now();
    const { line, baselineTime } = optimizeLine(course, persona, 3000);
    const ms = Date.now() - t0;
    const imp = ((baselineTime - line.totalTime) / baselineTime) * 100;
    const race = simulateRace(course, persona, line, 42);
    const raceTxt = race.finished ? `${race.finishTime!.toFixed(1)}s` : `DNF(${race.corrections.length}修)`;
    console.log(
      spec.name.padEnd(16),
      persona.risk.padEnd(10),
      baselineTime.toFixed(1).padStart(8),
      line.totalTime.toFixed(1).padStart(8),
      (imp.toFixed(1) + '%').padStart(7),
      String(ms).padStart(8),
      String(line.allGatesCleared ? 0 : 1).padStart(4),
      raceTxt.padStart(10),
    );
  }
}
