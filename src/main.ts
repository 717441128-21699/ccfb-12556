import './styles.css';
import { store, type PageId } from './store';
import { renderCoursesPage, mountCoursesPage } from './pages/courses';
import { renderRacePage, mountRacePage } from './pages/race';
import { renderAnalysisPage, mountAnalysisPage } from './pages/analysis';
import { renderOpponentsPage, mountOpponentsPage } from './pages/opponents';

const TABS: { id: PageId; label: string }[] = [
  { id: 'courses', label: '赛道选择' },
  { id: 'race', label: '比赛' },
  { id: 'analysis', label: '路线分析' },
  { id: 'opponents', label: '对手设置' },
];

function mountPage() {
  const page = store.getState().page;
  const host = document.getElementById('page-host')!;
  switch (page) {
    case 'courses':
      host.innerHTML = renderCoursesPage();
      mountCoursesPage();
      break;
    case 'race':
      host.innerHTML = renderRacePage();
      mountRacePage();
      break;
    case 'analysis':
      host.innerHTML = renderAnalysisPage();
      mountAnalysisPage();
      break;
    case 'opponents':
      host.innerHTML = renderOpponentsPage();
      mountOpponentsPage();
      break;
  }
}

function renderShellAndPage() {
  const app = document.getElementById('app')!;
  const page = store.getState().page;
  app.innerHTML = `
    <header class="topbar">
      <h1>⛷️ 回转走线 · AI 轨迹优化</h1>
      <nav class="tabs">
        ${TABS.map((t) => `<button data-tab="${t.id}" class="${t.id === page ? 'active' : ''}">${t.label}</button>`).join('')}
      </nav>
    </header>
    <main><div id="page-host"></div></main>`;
  app.querySelectorAll<HTMLElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => store.navigate(btn.dataset.tab as PageId));
  });
  mountPage();
}

let currentPage: PageId | null = null;
store.subscribe((s) => {
  if (s.page !== currentPage) {
    // 只有真正切页才重建 DOM，避免 Worker 进度更新打断回放/滑杆
    currentPage = s.page;
    renderShellAndPage();
  }
  // 页面内的数据刷新由各页面自行监听 store（本项目页面数据在切页/动作后读取即可）
});
currentPage = store.getState().page;
renderShellAndPage();
