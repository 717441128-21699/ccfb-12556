import { store } from '../store';
import { drawCourse } from '../renderer';
import type { Course } from '../engine/types';

const SNOW_LABEL: Record<Course['snow'], string> = {
  powder: '粉雪',
  compact: '压实雪',
  icy: '冰面',
};

function courseCard(course: Course): string {
  const selected = store.getState().selectedCourseId === course.id;
  const totalLen = course.gates.reduce((a, g) => a + g.spacing, 0);
  return `
    <div class="card ${selected ? 'selected' : ''}" data-course="${course.id}" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <h3>${course.name}</h3>
        <span class="tag ${course.discipline}">${course.discipline === 'slalom' ? '回转 SL' : '大回转 GS'}</span>
      </div>
      <div class="muted small" style="margin:6px 0 12px">
        ${course.gates.length} 门 · 落差 ${Math.round(totalLen)}m ·
        <span class="tag ${course.snow}" style="margin-left:4px">${SNOW_LABEL[course.snow]}</span>
        · ${course.hazards.length} 处冰面/雪包
      </div>
      <canvas data-preview="${course.id}" width="260" height="220"></canvas>
      <div class="muted small" style="margin-top:10px">
        门距 ${course.discipline === 'slalom' ? '7–13m' : '13–22m'} ·
        门宽 ${Math.min(...course.gates.map((g) => g.width)).toFixed(1)}–${Math.max(...course.gates.map((g) => g.width)).toFixed(1)}m
      </div>
    </div>`;
}

export function renderCoursesPage(): string {
  const s = store.getState();
  return `
    <h2 style="margin-top:0">赛道选择</h2>
    <p class="muted">按 FIS 规格程序化生成的 5 条赛道：回转门距 7–13m / 门宽 4–6m，大回转门距 13–22m / 门宽 4–8m。点击卡片选择。</p>
    <div class="grid cols-3">
      ${s.courses.map(courseCard).join('')}
    </div>
    <div style="margin-top:20px;display:flex;gap:12px;align-items:center">
      <button class="primary" id="go-race">前往比赛页计算 AI 走线 →</button>
      <span class="muted small">当前选择：${store.currentCourse().name}</span>
    </div>`;
}

export function mountCoursesPage() {
  const s = store.getState();
  // 画缩略预览
  for (const course of s.courses) {
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-preview="${course.id}"]`);
    if (canvas) {
      const ctx = canvas.getContext('2d')!;
      drawCourse(ctx, course, {
        width: canvas.width,
        height: canvas.height,
        showHazards: true,
      });
    }
  }
  document.querySelectorAll<HTMLElement>('[data-course]').forEach((el) => {
    el.addEventListener('click', () => store.selectCourse(el.dataset.course!));
  });
  document.getElementById('go-race')!.addEventListener('click', () => store.navigate('race'));
}
