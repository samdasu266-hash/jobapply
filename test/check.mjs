// 지원 전형 일정 — 회귀 검사
//
// 실행: node test/check.mjs          (실패가 있으면 종료 코드 1)
//       node test/check.mjs --keep   (스크린샷을 test/out 에 남김)
//
// 속성값(el.hidden 같은)만 보면 실제로 화면에 보이는지 알 수 없다. 실제로
// 그런 버그를 놓친 적이 있어서, 표시 여부는 계산된 스타일과 크기로 본다.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'file://' + join(ROOT, 'index.html');
const KEEP = process.argv.includes('--keep');
const OUT = join(ROOT, 'test', 'out');
if (KEEP) mkdirSync(OUT, { recursive: true });

let pass = 0;
const fails = [];
let group = '';

const section = (n) => { group = n; console.log('\n── ' + n + ' ──'); };
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(group + ' › ' + name + (detail ? '  (' + detail + ')' : '')); console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

// 화면에 실제로 보이는가 — 속성이 아니라 계산된 스타일과 크기로 판정
const shown = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { exists: false };
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  return {
    exists: true,
    visible: cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 0 && r.height > 0,
    display: cs.display,
  };
}, sel);

// 픽스처는 격리되어야 한다. 직접 상태를 주면 시드(미리 등록된 공고)를 넣지
// 않는다 — 그러지 않으면 내가 정의하지 않은 기관·일정이 섞여 결과를 흐린다.
// 시드 자체를 보려면 상태를 주지 말고 기본값으로 띄운다.
//
// index.html 에 시드를 추가하면 여기에도 키를 넣어야 한다. 빠뜨리면 아래
// 가드가 무슨 일인지 바로 알려준다 — 예전에 이걸 빠뜨려 엉뚱한 항목 다섯 개가
// 실패하는 바람에 원인을 한참 찾았다.
const SEED_KEYS = ['nhis', 'hira2026'];

const boot = async (p, state, ui) => {
  await p.goto(PAGE);
  const s = state
    ? { seeded: Object.fromEntries(SEED_KEYS.map(k => [k, true])), ...state }
    : null;
  await p.evaluate(([s, u]) => {
    localStorage.clear();
    if (s) localStorage.setItem('jobtracker.v1', JSON.stringify(s));
    if (u) localStorage.setItem('jobtracker.ui.v2', JSON.stringify(u));
  }, [s, ui ?? null]);
  await p.reload();
  await p.waitForTimeout(400);

  if (state?.institutions) {
    const extra = await p.evaluate((ids) =>
      JSON.parse(localStorage.getItem('jobtracker.v1'))
        .institutions.map(i => i.id).filter(id => !ids.includes(id)),
      state.institutions.map(i => i.id));
    if (extra.length) throw new Error(
      '픽스처에 없는 기관이 섞였습니다: ' + extra.join(', ') +
      '\n  → index.html 에 새 시드가 생겼습니다. test/check.mjs 의 SEED_KEYS 에 그 키를 추가하세요.');
  }
};

const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('jobtracker.v1')));
const texts = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map(e => e.textContent.trim()), sel);

const INST = (id, name, color, extra = {}) => ({ id, name, color, status: 'active', ...extra });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 } });
const p = await ctx.newPage();
const runtimeErrors = [];
p.on('pageerror', e => runtimeErrors.push(e.message));
p.on('console', m => { if (m.type() === 'error') runtimeErrors.push('console: ' + m.text()); });
p.on('dialog', d => d.accept());

/* ─────────────────────────────────────────────── */
section('첫 화면');
await boot(p);
ok('다가오는 일정이 보인다', (await shown(p, '.up-card')).visible);
ok('기관별 진행 현황이 보인다', (await shown(p, '.pipe')).visible);
ok('달력이 보인다', (await shown(p, '.month')).visible);
ok('결과 메뉴는 숨어 있다', !(await shown(p, '#rmenu')).visible,
   'display=' + (await shown(p, '#rmenu')).display);
ok('드로어는 닫혀 있다', await p.evaluate(() =>
   getComputedStyle(document.getElementById('drawer')).transform !== 'none'));
ok('오늘 날짜가 표시된다', (await p.textContent('#todayLabel')).includes('오늘'));

/* ─────────────────────────────────────────────── */
section('결과 기록 — 세 경로');
for (const [label, sel] of [['진행 현황 칩', '.pipe .step'], ['다가오는 일정 카드', '.up-card'], ['달력 막대', '.bar']]) {
  await boot(p);
  await p.click(sel);
  await p.waitForTimeout(150);
  ok(label + ': 메뉴가 실제로 보인다', (await shown(p, '#rmenu')).visible);
  ok(label + ': 메뉴가 화면 안에 있다', await p.evaluate(() => {
    const r = document.getElementById('rmenu').getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  }));
  await p.click('.rmenu button[data-r="합격"]');
  await p.waitForTimeout(300);
  const saved = (await store(p)).events.filter(e => e.result === '합격').length;
  ok(label + ': 합격이 저장된다', saved === 1, 'saved=' + saved);
  ok(label + ': 선택 후 메뉴가 닫힌다', !(await shown(p, '#rmenu')).visible);
}

await boot(p);
await p.click('.pipe .step'); await p.waitForTimeout(150);
await p.keyboard.press('Escape'); await p.waitForTimeout(150);
ok('ESC 로 닫힌다', !(await shown(p, '#rmenu')).visible);
await p.click('.pipe .step'); await p.waitForTimeout(150);
await p.click('h1'); await p.waitForTimeout(150);
ok('바깥 클릭으로 닫힌다', !(await shown(p, '#rmenu')).visible);

/* ─────────────────────────────────────────────── */
section('불합격 → 기관 탈락 연동');
await boot(p);
await p.evaluate(() => {
  const c = [...document.querySelectorAll('.up-card')].find(x => x.querySelector('.up-inst').textContent.includes('NIKOM'));
  c.dataset.probe = '1';
});
await p.click('.up-card[data-probe="1"]'); await p.waitForTimeout(150);
await p.click('.rmenu button[data-r="불합격"]'); await p.waitForTimeout(350);
const afterFail = await store(p);
eq('기관이 탈락으로 바뀐다', afterFail.institutions.find(i => i.id === 'nikom').status, 'rejected');
ok('탈락 배지가 보인다', (await texts(p, '.pipe .badge')).includes('탈락'));
ok('달력에서 빠진다', !(await p.evaluate(() =>
   [...document.querySelectorAll('.bar')].some(b => (b.title || '').includes('NIKOM')))));
ok('겹침 경고에서도 빠진다', !(await p.evaluate(() =>
   [...document.querySelectorAll('.cf-body')].some(e => e.textContent.includes('NIKOM')))));

/* ─────────────────────────────────────────────── */
section('주말·공휴일 처리');
await boot(p, {
  institutions: [INST('a', 'A', '#2E6F5E')],
  events: [
    { id: 'i1', inst: 'a', label: '면접',       start: '2026-10-08', end: '2026-10-12' }, // 10/9 한글날, 10/10~11 주말
    { id: 'i2', inst: 'a', label: '필기시험',   start: '2026-10-24', end: '2026-10-24' }, // 토요일
    { id: 'i3', inst: 'a', label: '인적성검사', start: '2026-10-08', end: '2026-10-12' }, // 온라인
  ],
});
const segs = (t) => p.evaluate((k) =>
  [...document.querySelectorAll('.bar')].filter(b => (b.title || '').includes(k)).map(b => b.style.gridColumn), t);
eq('면접은 휴일을 건너뛴다', await segs('면접'), ['5 / span 1', '2 / span 1']);
eq('필기시험은 토요일에 그대로 표시', await segs('필기시험'), ['7 / span 1']);
eq('인적성검사는 기간 연속', await segs('인적성검사'), ['5 / span 3', '1 / span 2']);

/* ─────────────────────────────────────────────── */
section('일정 겹침');
await boot(p, {
  institutions: [INST('a', 'A', '#2E6F5E'), INST('b', 'B', '#2F5F92')],
  events: [
    { id: 'x', inst: 'a', label: '면접', start: '2026-10-09', end: '2026-10-11' }, // 전부 휴일
    { id: 'y', inst: 'b', label: '면접', start: '2026-10-10', end: '2026-10-13' },
  ],
});
eq('주말에만 겹치면 경고하지 않는다', (await texts(p, '.cf-body')).length, 0);
await boot(p, {
  institutions: [INST('a', 'A', '#2E6F5E'), INST('b', 'B', '#2F5F92')],
  events: [
    { id: 'x', inst: 'a', label: '면접', start: '2026-10-06', end: '2026-10-08' },
    { id: 'y', inst: 'b', label: '면접', start: '2026-10-08', end: '2026-10-08' },
  ],
});
eq('평일에 겹치면 경고한다', (await texts(p, '.cf-body')).length, 1);

/* ─────────────────────────────────────────────── */
section('필터');
await boot(p);
const barInsts = () => p.evaluate(() =>
  [...new Set([...document.querySelectorAll('.bar')].map(b => (b.title || '').split(' · ')[0]))].length);
const n0 = await barInsts();
await p.click('.chip:not(.all)'); await p.waitForTimeout(200);
ok('칩으로 기관을 끌 수 있다', await barInsts() === n0 - 1);
await p.click('.chip.all'); await p.waitForTimeout(200);
eq('전체 해제', await barInsts(), 0);
await p.click('.chip.all'); await p.waitForTimeout(200);
ok('전체 선택', await barInsts() === n0);

await boot(p,
  { institutions: [INST('a', 'A', '#2E6F5E'), INST('b', 'B탈락', '#2F5F92', { status: 'rejected' })],
    events: [{ id: 'y', inst: 'b', label: '면접', start: '2026-10-06', end: '2026-10-06' }] });
ok('탈락 기관은 기본으로 숨는다', await barInsts() === 0);
await p.evaluate(() => [...document.querySelectorAll('.chip:not(.all)')]
  .find(c => c.textContent.includes('B탈락')).click());
await p.waitForTimeout(200);
ok('숨기기가 켜져 있어도 칩으로 되살릴 수 있다', await barInsts() === 1);
ok('체크박스는 켜진 채 유지', await p.evaluate(() => document.querySelector('.toggle input').checked));

/* ─────────────────────────────────────────────── */
section('달력 범위');
// 달력이 페이지 높이의 절반을 넘겨서, 기본은 현재월+다음달까지만 펼친다
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [
  { id: 'a1', inst: 'a', label: '면접',     start: '2026-09-21', end: '2026-09-21' },
  { id: 'a2', inst: 'a', label: '최종발표', start: '2026-12-07', end: '2026-12-07' },
]});
eq('기본은 현재월과 다음달까지', await texts(p, '.month h3'), ['2026년 9월', '2026년 10월']);
ok('접힌 달에 일정이 있으면 버튼이 알린다',
   (await p.textContent('#moreMonths')).includes('12월까지 일정이 더 있습니다'),
   await p.textContent('#moreMonths'));
await p.click('#moreMonths'); await p.waitForTimeout(250);
eq('더 보기로 마지막 일정 달까지 펼쳐진다', (await texts(p, '.month h3')).length, 4);
ok('다 펼치면 안내 문구가 사라진다',
   !(await p.textContent('#moreMonths')).includes('일정이 더 있습니다'));

await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')],
  events: [{ id: 'x', inst: 'a', label: '면접', start: '2026-09-21', end: '2026-09-21' }] });
eq('일정이 이번 달뿐이면 그 달만 그린다', (await texts(p, '.month h3')).length, 1);

/* ─────────────────────────────────────────────── */
section('장소와 링크');
await boot(p);
ok('기관 기본 장소를 일정이 물려받는다', await p.evaluate(() =>
  [...document.querySelectorAll('.up-card')].some(c => c.querySelector('.up-place a'))));
const href = await p.evaluate(() => (document.querySelector('.up-place a') || {}).href || '');
ok('카카오맵 검색 링크로 연결된다', href.startsWith('https://map.kakao.com/link/search/'), href.slice(0, 60));
ok('장소 링크는 새 탭 + noopener', await p.evaluate(() => {
  const a = document.querySelector('.up-place a');
  return a.target === '_blank' && a.rel.includes('noopener');
}));
await p.evaluate(() => { window.__opened = []; window.open = u => (window.__opened.push(u), null); });
await p.evaluate(() => document.querySelector('.up-card .up-place a').click());
await p.waitForTimeout(200);
ok('장소 링크를 눌러도 결과 메뉴가 뜨지 않는다', !(await shown(p, '#rmenu')).visible);

await boot(p, { institutions: [INST('a', 'A', '#2E6F5E', { url: 'javascript:alert(1)' })], events: [] });
eq('javascript: 링크는 렌더하지 않는다', (await texts(p, '.pipe-link')).length, 0);

/* ─────────────────────────────────────────────── */
section('깨진 데이터 방어');
await boot(p, {
  institutions: [INST('a', 'A', '#2E6F5E')],
  events: [
    { id: 'bad', inst: 'a', label: '면접', start: '2026-10-20', end: '2026-10-15' },
    { id: 'ghost', inst: '없는기관', label: '면접', start: '2026-10-07', end: '2026-10-07' },
  ],
});
eq('종료일이 시작일보다 빠르면 교정한다', (await store(p)).events.find(e => e.id === 'bad').end, '2026-10-20');
ok('기관 없는 고아 일정은 달력에 내보내지 않는다', !(await p.evaluate(() =>
  [...document.querySelectorAll('.bar')].some(b => (b.title || '').includes('삭제됨')))));

/* ─────────────────────────────────────────────── */
section('시드 (미리 등록된 공고)');
await boot(p);
ok('건보공단이 등록된다', (await store(p)).institutions.some(i => i.id === 'nhis'));
const hiraEv = (await store(p)).events.filter(e => e.inst === 'hira');
ok('이미 있는 기관에도 일정이 더해진다', hiraEv.length >= 9, 'hira events=' + hiraEv.length);
eq('같은 라벨·같은 날짜는 중복되지 않는다',
   hiraEv.filter(e => e.label === '서류결과' && e.start === '2026-09-30').length, 1);
eq('토요일 필기시험이 그날 그대로 그려진다',
   await p.evaluate(() => [...document.querySelectorAll('.bar')]
     .filter(b => (b.title || '').includes('심평원 · 필기시험')).map(b => b.style.gridColumn)),
   ['7 / span 1']);
await p.click('#openDrawer'); await p.waitForTimeout(250);
await p.evaluate(() => [...document.querySelectorAll('.mgr-item')]
  .find(r => r.querySelector('.nm').textContent === '건보공단').querySelector('button.danger').click());
await p.waitForTimeout(300);
await p.reload(); await p.waitForTimeout(400);
ok('지운 뒤에는 다시 생기지 않는다', !(await store(p)).institutions.some(i => i.id === 'nhis'));

/* ─────────────────────────────────────────────── */
section('색상');
await boot(p);
ok('기본 기관 색이 겹치지 않는다', await p.evaluate(() => {
  const c = JSON.parse(localStorage.getItem('jobtracker.v1')).institutions.map(i => i.color);
  return new Set(c).size === c.length;
}));
await p.click('#openDrawer'); await p.waitForTimeout(250);
ok('사용 중인 색은 고를 수 없다', await p.evaluate(() =>
  [...document.querySelectorAll('#swatchPick button')].some(b => b.disabled)));
ok('비어 있는 색이 자동 선택된다', await p.evaluate(() => {
  const b = [...document.querySelectorAll('#swatchPick button')].find(x => x.getAttribute('aria-pressed') === 'true');
  return b && !b.disabled;
}));

/* ─────────────────────────────────────────────── */
section('일정 편집');
await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(250);
const before = (await store(p)).events.length;
await p.click('#evList .ev-item .edit'); await p.waitForTimeout(150);
await p.fill('#evStart', '2026-11-05');
await p.fill('#evEnd', '2026-11-05');
await p.click('#addEvent'); await p.waitForTimeout(300);
eq('수정해도 일정이 늘지 않는다', (await store(p)).events.length, before);
ok('수정이 반영된다', (await store(p)).events.some(e => e.start === '2026-11-05'));

await p.selectOption('#evInst', '__new__'); await p.waitForTimeout(150);
ok('새 기관 입력칸이 나타난다', (await shown(p, '#evNewInstField')).visible);
await p.fill('#evNewInst', '테스트기관');
await p.fill('#evLabel', '면접');
await p.fill('#evStart', '2026-11-10');
await p.click('#addEvent'); await p.waitForTimeout(300);
ok('목록에 없는 기관이 만들어진다', (await store(p)).institutions.some(i => i.name === '테스트기관'));

/* ─────────────────────────────────────────────── */
section('전형 단계 일괄 추가');
await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(250);
const b0 = (await store(p)).events.length;
await p.evaluate(() => {
  const set = (stage, v) => {
    const i = [...document.querySelectorAll('#bulkRows input')].find(x => x.dataset.stage === stage);
    i.value = v;
  };
  set('서류결과', '2026-11-02'); set('면접', '2026-11-09');
});
await p.click('#addBulk'); await p.waitForTimeout(300);
eq('채운 날짜만 추가된다', (await store(p)).events.length - b0, 2);
ok('입력칸이 비워진다', await p.evaluate(() =>
  [...document.querySelectorAll('#bulkRows input')].every(i => !i.value)));

/* ─────────────────────────────────────────────── */
section('드로어 접근성');
await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(300);
ok('열면 포커스가 드로어 안으로 간다', await p.evaluate(() =>
  document.getElementById('drawer').contains(document.activeElement)));
await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift');
await p.waitForTimeout(150);
ok('탭이 드로어 밖으로 새지 않는다', await p.evaluate(() =>
  document.getElementById('drawer').contains(document.activeElement)));
ok('dialog 역할이 지정되어 있다', await p.evaluate(() => {
  const d = document.getElementById('drawer');
  return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true';
}));
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
eq('닫으면 포커스가 열기 버튼으로 돌아온다', await p.evaluate(() => document.activeElement.id), 'openDrawer');

/* ─────────────────────────────────────────────── */
section('모바일 360px');
const mp = await (await browser.newContext({ viewport: { width: 360, height: 780 } })).newPage();
mp.on('pageerror', e => runtimeErrors.push('mobile: ' + e.message));
await boot(mp);
ok('가로 스크롤이 없다', await mp.evaluate(() =>
  document.documentElement.scrollWidth === document.documentElement.clientWidth));
ok('달력 막대가 칸을 넘치지 않는다', await mp.evaluate(() =>
  [...document.querySelectorAll('.bar')].every(b => b.getBoundingClientRect().right <= innerWidth + 1)));
await mp.click('.bar'); await mp.waitForTimeout(200);
ok('결과 메뉴가 화면 안에 들어온다', await mp.evaluate(() => {
  const r = document.getElementById('rmenu').getBoundingClientRect();
  return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0;
}));
await boot(mp);
const upM = await mp.evaluate(() => document.querySelectorAll('.up-card').length);
const upD = await p.evaluate(() => document.querySelectorAll('.up-card').length);
ok('다가오는 일정이 모바일에서는 4장까지', upM <= 4, 'mobile=' + upM);
ok('데스크톱에서는 6장까지', upD <= 6 && upD > 4, 'desktop=' + upD);
ok('페이지가 모바일에서 5화면을 넘지 않는다', await mp.evaluate(() =>
  document.body.scrollHeight / innerHeight < 5), await mp.evaluate(() =>
  (document.body.scrollHeight / innerHeight).toFixed(1) + '화면'));

/* ─────────────────────────────────────────────── */
section('다크 모드 대비');
const dp = await (await browser.newContext({ viewport: { width: 1200, height: 950 }, colorScheme: 'dark' })).newPage();
dp.on('pageerror', e => runtimeErrors.push('dark: ' + e.message));
await boot(dp);
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const parse = (s) => { const n = s.match(/[\d.]+/g).map(Number).slice(0, 3); return s.startsWith('color(') ? n.map(x => x * 255) : n; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const darkBars = await dp.evaluate(() => [...document.querySelectorAll('.bar')].slice(0, 6).map(b => {
  const cs = getComputedStyle(b); return { fg: cs.color, bg: cs.backgroundColor };
}));
const worst = Math.min(...darkBars.map(b => ratio(parse(b.fg), parse(b.bg))));
ok('다크 모드 막대 대비 4.5:1 이상', worst >= 4.5, worst.toFixed(2) + ':1');

if (KEEP) {
  await p.screenshot({ path: join(OUT, 'desktop.png'), fullPage: true });
  await mp.screenshot({ path: join(OUT, 'mobile.png'), fullPage: true });
  await dp.screenshot({ path: join(OUT, 'dark.png'), fullPage: true });
}

/* ─────────────────────────────────────────────── */
section('런타임 오류');
ok('콘솔/런타임 오류 없음', runtimeErrors.length === 0, runtimeErrors.join(' | ').slice(0, 300));

await browser.close();

console.log('\n' + '─'.repeat(52));
console.log(fails.length ? `실패 ${fails.length}건 / 통과 ${pass}건` : `전부 통과 (${pass}건)`);
fails.forEach(f => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
