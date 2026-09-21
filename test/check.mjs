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
section('결과 메뉴에서 일정·기관명 바로 수정');
await boot(p);
const chipInfo = await p.evaluate(() => {
  const s = document.querySelector('.pipe .step');
  return { instName: s.closest('.pipe').querySelector('.pipe-name').textContent };
});
const chipLabel = await p.evaluate(() =>
  document.querySelector('.pipe .step').textContent.replace(/\s+\d+\/\d+\(.\)$/, '').trim());
await p.click('.pipe .step'); await p.waitForTimeout(150);
await p.click('.rmenu button[data-action="edit-event"]'); await p.waitForTimeout(300);
ok('일정 수정: 결과 메뉴가 닫힌다', !(await shown(p, '#rmenu')).visible);
// 드로어를 열고 폼까지 스크롤하던 땜질 대신 그 일정 시트를 바로 띄운다
ok('일정 수정: 일정 시트가 바로 열린다', (await shown(p, '#evSheet')).visible);
ok('일정 수정: 드로어는 열리지 않는다',
   !(await p.getAttribute('#drawer', 'class')).includes('open'));
eq('일정 수정: 그 일정이 채워져 있다', await p.inputValue('#evLabel'), chipLabel);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
ok('일정 시트는 ESC 로 닫힌다', !(await shown(p, '#evSheet')).visible);

await p.click('.pipe .step'); await p.waitForTimeout(150);
await p.click('.rmenu button[data-action="edit-inst"]'); await p.waitForTimeout(300);
ok('기관 정보: 결과 메뉴가 닫힌다', !(await shown(p, '#rmenu')).visible);
ok('기관 정보: 기관 시트가 바로 열린다', (await shown(p, '#instSheet')).visible);
eq('기관 정보: 그 기관이 채워져 있다', await p.inputValue('#instName'), chipInfo.instName);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);

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
// 탈락 기관은 취소선을 친 채로 남기지 않고 화면에서 뺀다
ok('진행 현황에서 빠진다', !(await texts(p, '.pipe-name')).some(t => t.includes('NIKOM')));
ok('달력에서 빠진다', !(await p.evaluate(() =>
   [...document.querySelectorAll('.bar')].some(b => (b.title || '').includes('NIKOM')))));
ok('다가오는 일정에서도 빠진다', !(await p.evaluate(() =>
   [...document.querySelectorAll('.up-inst')].some(e => e.textContent.includes('NIKOM')))));
ok('겹침 경고에서도 빠진다', !(await p.evaluate(() =>
   [...document.querySelectorAll('.cf-body')].some(e => e.textContent.includes('NIKOM')))));
// 숨긴 것이지 지운 게 아니다 — 칩을 다시 켜면 돌아온다.
// 탈락하면서 칩이 뒤로 밀려 '+N' 안으로 들어갔으니 먼저 펼친다
await p.click('.chip.more'); await p.waitForTimeout(150);
await p.evaluate(() => [...document.querySelectorAll('.chip:not(.all):not(.more)')]
  .find(c => c.textContent.includes('NIKOM')).click());
await p.waitForTimeout(250);
ok('칩을 켜면 진행 현황에 다시 나온다', (await texts(p, '.pipe-name')).some(t => t.includes('NIKOM')));
ok('되살리면 탈락 배지가 붙어 있다', (await texts(p, '.pipe .badge')).includes('탈락'));

/* ─────────────────────────────────────────────── */
section('차수(회차) 이력 관리');
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [
  { id: 'r1', inst: 'a', label: '서류마감', start: '2026-08-01', end: '2026-08-01', round: '2026-1차' },
  { id: 'r2', inst: 'a', label: '면접',     start: '2026-08-20', end: '2026-08-20', round: '2026-1차' },
  { id: 'r3', inst: 'a', label: '서류마감', start: '2026-10-01', end: '2026-10-01', round: '2026-2차' },
  { id: 'r4', inst: 'a', label: '면접',     start: '2026-11-01', end: '2026-11-01', round: '2026-2차' },
]});
eq('차수를 쓰면 차수 제목이 각각 나타난다', await texts(p, '.pipe .round-head'), ['2026-1차', '2026-2차']);
ok('두 차수 모두 자기 몫의 단계만 보인다', await p.evaluate(() => {
  const heads = [...document.querySelectorAll('.pipe .round-head')];
  const r1steps = heads[0].nextElementSibling.querySelectorAll('.step:not(.more)').length;
  const r2steps = heads[1].nextElementSibling.querySelectorAll('.step:not(.more)').length;
  return r1steps === 1 && r2steps === 1; // 각자 다음 단계 하나씩만 기본으로 보임
}));

// 지난 차수(1차)에서 불합격해도, 2차가 아직 진행 중이면 기관을 탈락으로
// 돌리지 않는다 — 2차 필터까지 함께 숨겨지면 안 되기 때문이다.
await p.evaluate(() => {
  const heads = [...document.querySelectorAll('.pipe .round-head')];
  heads[0].nextElementSibling.querySelector('.step:not(.more)').dataset.probe = '1';
});
await p.click('.step[data-probe="1"]'); await p.waitForTimeout(150);
await p.click('.rmenu button[data-r="불합격"]'); await p.waitForTimeout(300);
let st = await store(p);
eq('지난 차수 불합격: 기관은 그대로 진행중이다', st.institutions.find(i => i.id === 'a').status, 'active');
ok('그 차수 일정에 불합격이 기록된다', st.events.some(e => e.round === '2026-1차' && e.result === '불합격'));

// 반대로 최신 차수(2차)에서 불합격하면 지금까지와 같이 기관 전체가 탈락된다
await p.evaluate(() => {
  const heads = [...document.querySelectorAll('.pipe .round-head')];
  heads[1].nextElementSibling.querySelector('.step:not(.more)').dataset.probe = '2';
});
await p.click('.step[data-probe="2"]'); await p.waitForTimeout(150);
await p.click('.rmenu button[data-r="불합격"]'); await p.waitForTimeout(300);
st = await store(p);
eq('최신 차수 불합격: 기관이 탈락으로 바뀐다', st.institutions.find(i => i.id === 'a').status, 'rejected');

await boot(p);
eq('차수를 안 쓰면 차수 제목이 나타나지 않는다', (await texts(p, '.pipe .round-head')).length, 0);

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
section('전형 단계 접기');
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [
  { id: 'p1', inst: 'a', label: '서류마감', start: '2026-08-20', end: '2026-08-20' },
  { id: 'p2', inst: 'a', label: '서류결과', start: '2026-09-01', end: '2026-09-01', result: '합격' },
  { id: 'f1', inst: 'a', label: '면접',     start: '2026-10-06', end: '2026-10-08' },
  { id: 'f2', inst: 'a', label: '최종발표', start: '2026-10-20', end: '2026-10-20' },
]});
eq('기본은 다음 단계 하나와 +N', await texts(p, '.pipe .step'), ['면접 10/6(화)', '+3']);
await p.click('.step.more'); await p.waitForTimeout(250);
eq('펼치면 전 단계가 나온다', (await texts(p, '.pipe .step')).length, 5);
ok('접혀 있던 결과 기록이 살아 있다',
   (await texts(p, '.pipe .step.pass')).some(t => t.includes('서류결과')));
// 접힌 단계에 결과를 적는 동안 다시 접히면 연달아 기록할 수 없다.
// (불합격은 기관을 숨기므로, 상태를 바꾸지 않는 합격으로 확인한다)
await p.evaluate(() => [...document.querySelectorAll('.pipe .step')]
  .find(s => s.textContent.includes('서류마감')).dataset.probe = '1');
await p.click('.step[data-probe="1"]'); await p.waitForTimeout(150);
await p.click('.rmenu button[data-r="합격"]'); await p.waitForTimeout(350);
ok('결과를 적어도 펼침이 유지된다', (await p.textContent('.step.more')) === '접기');
await p.click('.step.more'); await p.waitForTimeout(250);
eq('다시 접힌다', (await texts(p, '.pipe .step')).length, 2);

// 전부 지난 기관은 마지막 단계를 보여준다 (빈 줄이 되지 않게)
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [
  { id: 'q1', inst: 'a', label: '서류마감', start: '2026-08-20', end: '2026-08-20' },
  { id: 'q2', inst: 'a', label: '서류결과', start: '2026-09-01', end: '2026-09-01' },
]});
eq('앞으로 남은 단계가 없으면 마지막 단계를 보여준다',
   await texts(p, '.pipe .step'), ['서류결과 9/1(화)', '+1']);

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

// 기관이 늘수록 필터 칩이 여러 줄을 차지해, 기본은 몇 개만 보여주고
// 나머지는 '+N'으로 접는다.
const CHIP_COLORS = ['#2E6F5E', '#96491B', '#2F5F92', '#7A4BA0', '#9C4370', '#4A5560'];
await boot(p, {
  institutions: ['가', '나', '다', '라', '마', '바'].map((n, i) => INST(String(i), n, CHIP_COLORS[i])),
  events: [],
});
eq('기본은 칩 4개만 보인다', (await texts(p, '.chip:not(.all):not(.more)')).length, 4);
eq('나머지는 +N 으로 접힌다', await p.textContent('.chip.more'), '+2');
await p.click('.chip.more'); await p.waitForTimeout(150);
eq('펼치면 전 기관이 보인다', (await texts(p, '.chip:not(.all):not(.more)')).length, 6);
eq('펼친 뒤엔 접기로 바뀐다', await p.textContent('.chip.more'), '접기');
await p.click('.chip.more'); await p.waitForTimeout(150);
eq('접으면 다시 4개만 보인다', (await texts(p, '.chip:not(.all):not(.more)')).length, 4);

// 끝난 기관이 앞자리를 차지하면 정작 볼 기관이 '+N' 뒤로 밀린다
await boot(p, {
  institutions: [
    INST('0', '가', '#2E6F5E'),
    INST('1', '나탈락', '#96491B', { status: 'rejected' }),
    INST('2', '다', '#2F5F92'),
    INST('3', '라', '#7A4BA0'),
    INST('4', '마', '#9C4370'),
    INST('5', '바포기', '#4A5560', { status: 'withdrawn' }),
  ],
  events: [],
}, { hidden: {}, hideInactive: false });
eq('탈락·포기 기관은 앞자리를 차지하지 않는다',
   await texts(p, '.chip:not(.all):not(.more)'), ['가', '다', '라', '마']);
await p.click('.chip.more'); await p.waitForTimeout(150);
eq('펼치면 끝난 기관이 뒤에 붙어 나온다',
   await texts(p, '.chip:not(.all):not(.more)'), ['가', '다', '라', '마', '나탈락', '바포기']);

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
ok('기본 상태에서는 접기 버튼이 없다', !(await shown(p, '#collapseMonths')).visible);
await p.click('#moreMonths'); await p.waitForTimeout(250);
eq('더 보기로 마지막 일정 달까지 펼쳐진다', (await texts(p, '.month h3')).length, 4);
ok('더 보여줄 달이 없으면 더 보기 버튼이 사라진다', !(await shown(p, '#moreMonths')).visible);
ok('더 펼친 상태에서는 접기 버튼이 나타난다', (await shown(p, '#collapseMonths')).visible);
await p.click('#collapseMonths'); await p.waitForTimeout(250);
eq('접기를 누르면 기본(2개월)으로 돌아간다', (await texts(p, '.month h3')).length, 2);
ok('기본으로 돌아오면 더 보기 버튼이 다시 나타난다', (await shown(p, '#moreMonths')).visible);
ok('기본으로 돌아오면 접기 버튼이 다시 사라진다', !(await shown(p, '#collapseMonths')).visible);

await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')],
  events: [{ id: 'x', inst: 'a', label: '면접', start: '2026-09-21', end: '2026-09-21' }] });
eq('일정이 이번 달뿐이면 그 달만 그린다', (await texts(p, '.month h3')).length, 1);
ok('더 보여줄 게 없으면 더 보기 버튼이 처음부터 없다', !(await shown(p, '#moreMonths')).visible);

/* ─────────────────────────────────────────────── */
section('장소와 링크');
// 방문형 일정(면접)이 확실히 "다가오는 일정" 안에 들도록 고정 픽스처를 쓴다
// — 실제 기본 데이터는 오늘 날짜에 따라 가까운 6건이 달라지므로, 면접이
// 그 안에 안 들 수도 있어서 결과가 날짜에 좌우되면 안 된다.
await boot(p, {
  institutions: [INST('a', 'A', '#2E6F5E', { place: '서울 광진구 능동로 400' })],
  events: [{ id: 'x', inst: 'a', label: '면접', start: '2026-10-06', end: '2026-10-06' }],
});
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
section('방문형 vs 온라인형 일정의 장소 표시');
// 서류마감·서류결과·인적성검사처럼 방문이 필요 없는 일정은 기관의 물리적
// 주소를 자동으로 보여주면 안 된다 — 실제로 가야 하는 줄 오해하게 만든다.
await boot(p, {
  institutions: [INST('a', 'A', '#2E6F5E', { place: '서울 광진구 능동로 400' })],
  events: [
    { id: 'e1', inst: 'a', label: '면접',       start: '2026-10-06', end: '2026-10-06' },
    { id: 'e2', inst: 'a', label: '서류마감',   start: '2026-10-01', end: '2026-10-01' },
    { id: 'e3', inst: 'a', label: '서류결과',   start: '2026-10-08', end: '2026-10-08', place: 'https://apply.example.com/result' },
    { id: 'e4', inst: 'a', label: '인적성검사', start: '2026-10-10', end: '2026-10-12', place: 'https://hr.example.com/test' },
    { id: 'e5', inst: 'a', label: '필기시험',   start: '2026-10-17', end: '2026-10-17', place: '서울 소재 고사장' },
  ],
});
const cardOf = (label) => p.evaluate((l) => {
  const c = [...document.querySelectorAll('.up-card')].find(x => x.querySelector('.up-title').textContent === l);
  const a = c.querySelector('.up-place a');
  return { text: c.querySelector('.up-place').textContent.trim(), href: a ? a.href : null };
}, label);
eq('면접(장소 없음): 기관 기본 주소를 물려받아 지도로 연결', (await cardOf('면접')).href,
   'https://map.kakao.com/link/search/' + encodeURIComponent('서울 광진구 능동로 400'));
eq('서류마감(장소 없음): 기관 주소를 물려받지 않고 비워둔다', (await cardOf('서류마감')).text, '');
const r3 = await cardOf('서류결과');
eq('서류결과(링크 입력): 짧은 하이퍼링크로 표시', r3.text, 'apply.example.com ↗');
eq('서류결과: 실제 링크는 원래 URL 그대로', r3.href, 'https://apply.example.com/result');
eq('인적성검사(링크 입력): 짧은 하이퍼링크로 표시', (await cardOf('인적성검사')).text, 'hr.example.com ↗');
eq('필기시험(직접 넣은 주소): 지도 링크 유지', (await cardOf('필기시험')).href,
   'https://map.kakao.com/link/search/' + encodeURIComponent('서울 소재 고사장'));

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
  .find(r => r.querySelector('.nm').textContent === '건보공단').querySelector('.inst-more').click());
await p.waitForTimeout(250);
await p.click('#instDelete');
await p.waitForTimeout(300);
await p.reload(); await p.waitForTimeout(400);
ok('지운 뒤에는 다시 생기지 않는다', !(await store(p)).institutions.some(i => i.id === 'nhis'));

/* ─────────────────────────────────────────────── */
section('관리 드로어 — 목록만 두고 편집은 시트에서');
await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(250);
ok('목록에는 편집 입력칸이 없다', await p.evaluate(() =>
  document.querySelectorAll('#instList input, #instList select').length === 0));
ok('기관 이름 아래에 그 기관 일정이 중첩되어 보인다', await p.evaluate(() => {
  const block = document.querySelector('.inst-events');
  return !!block && block.querySelectorAll('.ev-item').length > 0;
}));
ok('일정 줄 자체가 버튼이다', await p.evaluate(() =>
  document.querySelector('.inst-events .ev-item').tagName === 'BUTTON'));
ok('줄마다 붙던 수정·삭제 버튼이 없다', await p.evaluate(() =>
  document.querySelectorAll('#instList .ev-item button').length === 0));
ok('진행중 기관에는 배지를 달지 않는다', await p.evaluate(() =>
  document.querySelectorAll('#instList .badge').length === 0));
ok('소속 없는 일정 목록은 고아 일정이 없으면 숨겨진다',
   (await shown(p, '#evListHead')).visible === false);

// 기관 편집은 ⋯ → 시트에서, 저장을 눌러야 반영된다
await p.click('.mgr-item .inst-more'); await p.waitForTimeout(250);
ok('⋯ 로 기관 시트가 열린다', (await shown(p, '#instSheet')).visible);
eq('그 기관 이름이 채워져 있다', await p.inputValue('#instName'), 'NECA (보의연)');
await p.fill('#instName', 'NECA(이름바꿈)');
await p.click('#instSave'); await p.waitForTimeout(300);
eq('기관 이름 변경이 저장된다', (await store(p)).institutions[0].name, 'NECA(이름바꿈)');
ok('저장하면 시트가 닫힌다', !(await shown(p, '#instSheet')).visible);

await p.click('.mgr-item .inst-more'); await p.waitForTimeout(250);
await p.fill('#instName', '');
await p.click('#instSave'); await p.waitForTimeout(250);
eq('빈 이름으로는 저장되지 않는다', (await store(p)).institutions[0].name, 'NECA(이름바꿈)');
ok('빈 이름이면 시트가 닫히지 않는다', (await shown(p, '#instSheet')).visible);

// 상태는 목록이 아니라 시트에서 바꾸고, 탈락·포기일 때만 배지가 붙는다
await p.fill('#instName', 'NECA(이름바꿈)');
await p.click('#instStatus button[data-status="rejected"]');
await p.click('#instSave'); await p.waitForTimeout(300);
eq('상태 변경이 저장된다', (await store(p)).institutions[0].status, 'rejected');
ok('탈락이면 목록에 배지가 붙는다', (await texts(p, '#instList .badge')).includes('탈락'));

/* ─────────────────────────────────────────────── */
section('색상');
await boot(p);
ok('기본 기관 색이 겹치지 않는다', await p.evaluate(() => {
  const c = JSON.parse(localStorage.getItem('jobtracker.v1')).institutions.map(i => i.color);
  return new Set(c).size === c.length;
}));
await p.click('#openDrawer'); await p.waitForTimeout(250);
await p.click('.mgr-item .inst-more'); await p.waitForTimeout(250);
ok('다른 기관이 쓰는 색은 고를 수 없다', await p.evaluate(() =>
  [...document.querySelectorAll('#instSwatch button')].some(b => b.disabled)));
// 자기 색까지 잠그면 기관 시트를 열자마자 선택된 색이 사라진다
ok('자기 색은 선택된 채로 고를 수 있다', await p.evaluate(() => {
  const b = [...document.querySelectorAll('#instSwatch button')].find(x => x.getAttribute('aria-pressed') === 'true');
  return !!b && !b.disabled;
}));
const newColor = await p.evaluate(() => {
  const b = [...document.querySelectorAll('#instSwatch button')].find(x => !x.disabled && x.getAttribute('aria-pressed') !== 'true');
  b.click();
  return b.style.backgroundColor;
});
await p.click('#instSave'); await p.waitForTimeout(300);
ok('고른 색이 저장된다', await p.evaluate((want) => {
  const it = JSON.parse(localStorage.getItem('jobtracker.v1')).institutions[0];
  const el = document.createElement('div'); el.style.backgroundColor = it.color;
  return el.style.backgroundColor === want;
}, newColor));

/* ─────────────────────────────────────────────── */
section('일정 편집');
await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(250);
const before = (await store(p)).events.length;
await p.click('.inst-events .ev-item'); await p.waitForTimeout(250);
ok('줄을 누르면 그 일정 시트가 열린다', (await shown(p, '#evSheet')).visible);
eq('수정일 때는 제목이 일정 수정', await p.textContent('#evSheetTitle'), '일정 수정');
ok('수정일 때는 삭제 버튼이 있다', (await shown(p, '#evDelete')).visible);
await p.fill('#evStart', '2026-11-05');
await p.fill('#evEnd', '2026-11-05');
await p.click('#evSave'); await p.waitForTimeout(300);
eq('수정해도 일정이 늘지 않는다', (await store(p)).events.length, before);
ok('수정이 반영된다', (await store(p)).events.some(e => e.start === '2026-11-05'));

// 값이 없는 선택 항목은 접혀 있다가 눌러야 펼쳐진다.
// 시드 일정은 대부분 메모를 갖고 있으므로, 빈 상태는 '추가' 시트로 확인한다.
await p.click('#newEventBtn'); await p.waitForTimeout(250);
eq('추가 시트에서는 선택 항목 셋이 모두 접혀 있다',
   await p.evaluate(() => [...document.querySelectorAll('.opt-field')].filter(f => !f.hidden).length), 0);
await p.click('#evOptRow .opt[data-opt="memo"]'); await p.waitForTimeout(150);
ok('누르면 펼쳐진다', (await shown(p, '.opt-field[data-optfield="memo"]')).visible);
ok('펼친 항목의 버튼은 사라진다',
   !(await shown(p, '#evOptRow .opt[data-opt="memo"]')).visible);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);

// 값이 있으면 펼친 채로 연다
await boot(p, {
  institutions: [INST('a', 'A', '#2E6F5E')],
  events: [{ id: 'm', inst: 'a', label: '면접', start: '2026-10-06', end: '2026-10-06', memo: '정장 착용' }],
});
await p.click('#openDrawer'); await p.waitForTimeout(250);
await p.click('.inst-events .ev-item'); await p.waitForTimeout(250);
ok('값이 있는 항목은 펼친 채로 열린다', (await shown(p, '.opt-field[data-optfield="memo"]')).visible);
eq('그 값이 채워져 있다', await p.inputValue('#evMemo'), '정장 착용');
ok('값이 없는 항목은 여전히 접혀 있다', !(await shown(p, '.opt-field[data-optfield="round"]')).visible);
await p.fill('#evMemo', '고침');
await p.click('#evSave'); await p.waitForTimeout(300);
eq('펼친 항목의 수정이 저장된다', (await store(p)).events[0].memo, '고침');

await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(250);

// 추가는 같은 시트를 빈 채로 연다
await p.click('#newEventBtn'); await p.waitForTimeout(250);
eq('추가일 때는 제목이 일정 추가', await p.textContent('#evSheetTitle'), '일정 추가');
ok('추가일 때는 삭제 버튼이 없다', !(await shown(p, '#evDelete')).visible);
await p.selectOption('#evInst', '__new__'); await p.waitForTimeout(150);
ok('새 기관 입력칸이 나타난다', (await shown(p, '#evNewInstField')).visible);
await p.fill('#evNewInst', '테스트기관');
await p.fill('#evLabel', '면접');
await p.fill('#evStart', '2026-11-10');
await p.click('#evSave'); await p.waitForTimeout(300);
ok('목록에 없는 기관이 만들어진다', (await store(p)).institutions.some(i => i.name === '테스트기관'));
ok('만들어진 기관은 목록에서 바로 ⋯ 로 열 수 있다', await p.evaluate(() =>
  [...document.querySelectorAll('.mgr-item')].some(r =>
    r.querySelector('.nm').textContent === '테스트기관' && r.querySelector('.inst-more'))));

// 삭제는 시트 안에서만 — 목록에서 실수로 눌릴 일이 없다
const beforeDel = (await store(p)).events.length;
await p.click('.inst-events .ev-item'); await p.waitForTimeout(250);
await p.click('#evDelete'); await p.waitForTimeout(300);
eq('시트에서 삭제하면 일정이 준다', (await store(p)).events.length, beforeDel - 1);
ok('삭제 후 시트가 닫힌다', !(await shown(p, '#evSheet')).visible);

/* ─────────────────────────────────────────────── */
section('전형 단계 일괄 추가');
await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(250);
await p.click('#newBulkBtn'); await p.waitForTimeout(250);
ok('일괄 추가 시트가 열린다', (await shown(p, '#bulkSheet')).visible);
const b0 = (await store(p)).events.length;
await p.evaluate(() => {
  const set = (stage, v) => {
    const i = [...document.querySelectorAll('#bulkRows input')].find(x => x.dataset.stage === stage);
    i.value = v;
  };
  set('서류결과', '2026-11-02'); set('면접', '2026-11-09');
});
await p.click('#bulkAdd'); await p.waitForTimeout(300);
eq('채운 날짜만 추가된다', (await store(p)).events.length - b0, 2);
ok('추가하면 시트가 닫힌다', !(await shown(p, '#bulkSheet')).visible);
await p.click('#newBulkBtn'); await p.waitForTimeout(250);
ok('입력칸이 비워진다', await p.evaluate(() =>
  [...document.querySelectorAll('#bulkRows input')].every(i => !i.value)));
await p.keyboard.press('Escape'); await p.waitForTimeout(200);

/* ─────────────────────────────────────────────── */
section('데이터 오염 방지');
// 일괄 추가에서 기관 생성이 날짜 검증보다 먼저면, 날짜를 하나도 안 채우고
// 눌렀을 때 일정 없는 빈 기관만 남고 다음 저장에 딸려 들어간다.
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [
  { id: 'x', inst: 'a', label: '면접', start: '2026-10-06', end: '2026-10-06' }]});
await p.click('#openDrawer'); await p.waitForTimeout(250);
await p.click('#newBulkBtn'); await p.waitForTimeout(250);
await p.selectOption('#bulkInst', '__new__'); await p.waitForTimeout(150);
await p.fill('#bulkNewInst', '빈기관');
await p.click('#bulkAdd'); await p.waitForTimeout(300);
ok('날짜를 안 채우면 기관이 만들어지지 않는다', await p.evaluate(() =>
  ![...document.querySelectorAll('#bulkInst option')].some(o => o.textContent === '빈기관')));
// 메모리에만 생겼다가 다음 저장에 딸려 들어가는 경로까지 막혔는지 본다
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.click('#closeDrawer'); await p.waitForTimeout(250);
await p.click('.pipe .step'); await p.waitForTimeout(200);
await p.click('.rmenu button[data-r="합격"]'); await p.waitForTimeout(400);
ok('다른 저장이 일어나도 빈 기관이 저장되지 않는다',
   !(await store(p)).institutions.some(i => i.name === '빈기관'));

// 같은 기관·내용·기간·차수면 같은 일정이다
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [] });
await p.click('#openDrawer'); await p.waitForTimeout(250);
for (let k = 0; k < 2; k++) {
  await p.click('#newEventBtn'); await p.waitForTimeout(250);
  await p.fill('#evLabel', '면접');
  await p.fill('#evStart', '2026-11-11');
  await p.click('#evSave'); await p.waitForTimeout(300);
}
eq('같은 일정을 두 번 저장해도 하나만 남는다',
   (await store(p)).events.filter(e => e.label === '면접').length, 1);
// 중복을 거부당한 시트는 열린 채로 남는다 (고쳐서 다시 저장할 수 있게)
ok('중복이면 시트가 닫히지 않는다', (await shown(p, '#evSheet')).visible);
await p.keyboard.press('Escape'); await p.waitForTimeout(250);

// 차수가 다르면 다른 일정이다
await p.click('#newEventBtn'); await p.waitForTimeout(250);
await p.fill('#evLabel', '면접');
await p.fill('#evStart', '2026-11-11');
await p.click('#evOptRow .opt[data-opt="round"]'); await p.waitForTimeout(150);
await p.fill('#evRound', '2차');
await p.click('#evSave'); await p.waitForTimeout(300);
eq('차수가 다르면 따로 등록된다',
   (await store(p)).events.filter(e => e.label === '면접').length, 2);
// 수정할 때 자기 자신을 중복으로 잡으면 안 된다
await p.click('.inst-events .ev-item'); await p.waitForTimeout(250);
await p.click('#evOptRow .opt[data-opt="memo"]'); await p.waitForTimeout(150);
await p.fill('#evMemo', '자기중복아님');
await p.click('#evSave'); await p.waitForTimeout(300);
ok('수정 시 자기 자신은 중복으로 보지 않는다',
   (await store(p)).events.some(e => e.memo === '자기중복아님'));

// 일괄 추가도 같은 기준으로 건너뛴다
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [
  { id: 'd', inst: 'a', label: '서류결과', start: '2026-11-02', end: '2026-11-02' }]});
await p.click('#openDrawer'); await p.waitForTimeout(250);
await p.click('#newBulkBtn'); await p.waitForTimeout(250);
await p.evaluate(() => {
  const set = (stage, v) => {
    const i = [...document.querySelectorAll('#bulkRows input')].find(x => x.dataset.stage === stage);
    i.value = v;
  };
  set('서류결과', '2026-11-02'); set('면접', '2026-11-09');
});
await p.click('#bulkAdd'); await p.waitForTimeout(300);
eq('일괄 추가는 이미 있는 일정을 건너뛴다', (await store(p)).events.length, 2);

/* ─────────────────────────────────────────────── */
section('달력은 늘 이번 달부터');
// 데이터의 가장 오래된 일정을 시작월로 잡으면, 지난 기록이 쌓일수록 달력이
// 과거로 끝없이 늘어난다 (3월 일정 하나에 3~10월 8개월이 펼쳐졌다).
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [
  { id: 'old', inst: 'a', label: '서류마감', start: '2026-03-02', end: '2026-03-02' },
  { id: 'now', inst: 'a', label: '면접',     start: '2026-10-06', end: '2026-10-06' },
]});
eq('과거 일정이 있어도 이번 달부터 그린다',
   await texts(p, '.month h3'), ['2026년 9월', '2026년 10월']);
ok('과거 일정 데이터 자체는 지우지 않는다',
   (await store(p)).events.some(e => e.id === 'old'));

/* ─────────────────────────────────────────────── */
section('다가오는 일정에 잘린 건수 표시');
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')],
  events: Array.from({ length: 9 }, (_, i) => ({
    id: 'u' + i, inst: 'a', label: '면접',
    start: '2026-10-' + String(i + 6).padStart(2, '0'),
    end: '2026-10-' + String(i + 6).padStart(2, '0') })) });
eq('데스크톱은 6장까지만 보인다', await p.evaluate(() => document.querySelectorAll('.up-card').length), 6);
ok('뒤에 더 있으면 건수를 알려준다', (await p.textContent('#upHint')).includes('3건 더'),
   await p.textContent('#upHint'));
await boot(p, { institutions: [INST('a', 'A', '#2E6F5E')], events: [
  { id: 'u1', inst: 'a', label: '면접', start: '2026-10-06', end: '2026-10-06' }]});
ok('다 보이면 건수를 붙이지 않는다', !(await p.textContent('#upHint')).includes('더'),
   await p.textContent('#upHint'));

// 한 기관이 카드를 여러 장 차지하면 정작 다른 기관 일정이 안 보인다
const upInsts = () => texts(p, '.up-inst');
const EV = (id, i, d) => ({ id, inst: i, label: '면접', start: d, end: d });
await boot(p, {
  institutions: ['가', '나', '다'].map((n, i) => INST(String(i), n, CHIP_COLORS[i])),
  events: [
    EV('a1', '0', '2026-10-01'), EV('a2', '0', '2026-10-02'), EV('a3', '0', '2026-10-03'),
    EV('a4', '0', '2026-10-06'), EV('a5', '0', '2026-10-07'),
    EV('b1', '1', '2026-10-04'), EV('b2', '1', '2026-10-05'),
    EV('c1', '2', '2026-10-09'),
  ],
});
// 날짜 순으로만 자르면 '다'(10/9)는 '가'의 다섯 장에 밀려 잘려나간다.
// 세 기관이 한 장씩 먼저 가져가고, 남는 세 자리만 나머지가 채운다.
eq('기관마다 한 장씩 먼저 잡고 남는 자리를 채운다',
   await upInsts(), ['가', '가', '가', '나', '나', '다']);
eq('카드는 여전히 날짜 오름차순이다',
   await texts(p, '.up-date'), ['10/1(목)', '10/2(금)', '10/3(토)', '10/4(일)', '10/5(월)', '10/9(금)']);

// 기관이 넉넉하면 한 기관도 두 장을 차지하지 않는다
await boot(p, {
  institutions: ['가', '나', '다', '라', '마', '바', '사'].map((n, i) => INST(String(i), n, CHIP_COLORS[i % 6])),
  events: [
    EV('a1', '0', '2026-10-01'), EV('a2', '0', '2026-10-02'),
    EV('b1', '1', '2026-10-03'), EV('c1', '2', '2026-10-04'),
    EV('d1', '3', '2026-10-05'), EV('e1', '4', '2026-10-06'),
    EV('f1', '5', '2026-10-07'), EV('g1', '6', '2026-10-08'),
  ],
}, { hidden: {}, hideInactive: false });
eq('기관이 넉넉하면 전부 다른 기관으로 채운다',
   await upInsts(), ['가', '나', '다', '라', '마', '바']);

/* ─────────────────────────────────────────────── */
section('시트 포커스');
// 시트가 열리자마자 텍스트 입력칸을 잡으면 모바일에서 키보드가 화면을 덮는다
await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(250);
await p.click('.mgr-item .inst-more'); await p.waitForTimeout(300);
ok('기관 시트를 열어도 입력칸에 포커스가 가지 않는다', await p.evaluate(() =>
  document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'));
ok('닫기 버튼에 포커스가 간다', await p.evaluate(() =>
  document.activeElement.classList.contains('sheet-close')));
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
ok('시트를 닫으면 열었던 버튼으로 돌아온다', await p.evaluate(() =>
  document.activeElement.classList.contains('inst-more')));

/* ─────────────────────────────────────────────── */
section('[hidden] 이 실제로 숨겨지는가');
// display 를 주는 규칙(.field, .sheet, .rmenu)이 [hidden] 을 이겨서 "속성은
// hidden 인데 화면엔 보이는" 버그를 세 번 냈다. 속성이 아니라 계산된 스타일로 본다.
await boot(p);
await p.click('#openDrawer'); await p.waitForTimeout(250);
await p.click('#newEventBtn'); await p.waitForTimeout(250);
ok('기관을 고른 상태면 새 기관 이름 칸은 보이지 않는다',
   !(await shown(p, '#evNewInstField')).visible);
eq('접힌 선택 항목은 계산된 스타일로도 숨겨져 있다',
   await p.evaluate(() => [...document.querySelectorAll('.opt-field')]
     .filter(f => getComputedStyle(f).display !== 'none').length), 0);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
ok('닫은 시트는 계산된 스타일로도 숨겨진다', !(await shown(p, '#evSheet')).visible);
ok('시트 스크림도 함께 숨겨진다', !(await shown(p, '#sheetScrim')).visible);
await p.click('#newBulkBtn'); await p.waitForTimeout(250);
ok('일괄 추가 시트에서도 새 기관 칸은 숨겨져 있다',
   !(await shown(p, '#bulkNewInstField')).visible);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);

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
// auto-fill 이면 화면 폭에 따라 열이 5개가 되어 6장이 5+1 로 쪼개졌다.
// 열 수를 고정했으므로 마지막 줄이 늘 꽉 차야 한다.
const cols = (pg) => pg.evaluate(() =>
  getComputedStyle(document.getElementById('upcoming')).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
eq('모바일은 2열', await cols(mp), 2);
eq('데스크톱은 3열', await cols(p), 3);
ok('다가오는 일정은 늘 꽉 찬 줄로 끝난다', await p.evaluate(() =>
  document.querySelectorAll('.up-card').length %
  getComputedStyle(document.getElementById('upcoming')).gridTemplateColumns.split(/\s+/).filter(Boolean).length === 0));

ok('페이지가 모바일에서 5화면을 넘지 않는다', await mp.evaluate(() =>
  document.body.scrollHeight / innerHeight < 5), await mp.evaluate(() =>
  (document.body.scrollHeight / innerHeight).toFixed(1) + '화면'));

// keep-all 만 있으면 띄어쓰기 없는 긴 한글이 끊길 자리가 없어 카드가 통째로
// 가로로 늘어난다 — 실제로 문서 폭이 390 → 700px 까지 벌어졌다.
await boot(mp, { institutions: [INST('a', '아주아주긴기관이름을넣어보자한국보건의료연구원부설센터', '#2E6F5E')], events: [
  { id: 'x', inst: 'a', label: '아주긴전형단계이름테스트입니다', start: '2026-10-06', end: '2026-10-06',
    round: '2026년도제3차수시채용', memo: '메모도아주길게'.repeat(8) },
]});
ok('띄어쓰기 없는 긴 이름·메모도 가로 스크롤을 만들지 않는다', await mp.evaluate(() =>
  document.documentElement.scrollWidth === document.documentElement.clientWidth),
  await mp.evaluate(() => document.documentElement.scrollWidth + ' / ' + document.documentElement.clientWidth));

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
