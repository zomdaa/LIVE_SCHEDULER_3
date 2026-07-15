'use strict';
/* ============================================================
   출근길의 왕자 (Prince of Commute) — 프로토타입
   페르시안의 왕자(1989) 스타일 타이밍 플랫포머 리스킨
   캐릭터: 절차적 스켈레톤 → 저해상도 픽셀 렌더링 (로토스코핑 느낌)
   ============================================================ */

// ---------------- 기본 설정 ----------------
const VW = 320, VH = 180, TILE = 16;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

// 텍스트 전용 고해상도 오버레이 (글자만 덜 픽셀화)
const TS = 3;
const tcv = document.getElementById('text');
const tctx = tcv.getContext('2d');
const TFONT = '"Malgun Gothic","Apple SD Gothic Neo",sans-serif';
function otext(str, x, y, size, color, align, bold) {
  tctx.textAlign = align || 'left';
  tctx.font = (bold ? 'bold ' : '') + (size * TS) + 'px ' + TFONT;
  tctx.fillStyle = color;
  tctx.fillText(str, x * TS, y * TS);
}
function otextW(str, size, bold) {
  tctx.font = (bold ? 'bold ' : '') + (size * TS) + 'px ' + TFONT;
  return tctx.measureText(str).width / TS;
}

// 캐릭터 전용 중해상도 레이어 (월드보다 2배 촘촘한 픽셀)
const fgc = document.getElementById('fg');
const fgx = fgc.getContext('2d');
fgx.imageSmoothingEnabled = false;

const wrap = document.getElementById('wrap');
function fit() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / VW, innerHeight / VH)));
  wrap.style.width = (VW * s) + 'px';
  wrap.style.height = (VH * s) + 'px';
}
addEventListener('resize', fit); fit();

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------- 입력 ----------------
const Input = { left: false, right: false, jump: false, down: false,
                jumpHit: false, downHit: false, anyHit: false };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'down', KeyS: 'down'
};
addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (k) {
    e.preventDefault();
    if (!Input[k]) Input[k + 'Hit'] = true;
    Input[k] = true;
  }
  Input.anyHit = true;
  if (e.code === 'KeyR') restartAll();
  if (e.code === 'KeyT' && scene === 'title') { score = 0; loadStage(0); }
});
addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k) Input[k] = false;
});
cv.addEventListener('pointerdown', () => { Input.anyHit = true; ensureAudio(); });

// 모바일 터치 버튼
const touchRoot = document.getElementById('touch');
if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) touchRoot.classList.add('show');
touchRoot.querySelectorAll('.tbtn').forEach(btn => {
  const k = btn.dataset.k;
  const on = e => { e.preventDefault(); ensureAudio();
    if (!Input[k]) Input[k + 'Hit'] = true;
    Input[k] = true; Input.anyHit = true; btn.classList.add('on'); };
  const off = e => { e.preventDefault(); Input[k] = false; btn.classList.remove('on'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
});

// ---------------- 사운드 (Web Audio 8비트 비프) ----------------
let AC = null;
function ensureAudio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (AC && AC.state === 'suspended') AC.resume();
}
function beep(f0, f1, dur, type, vol) {
  if (!AC) return;
  try {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f0, AC.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), AC.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.1, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch (e) {}
}
const SFX = {
  jump:  () => beep(300, 560, 0.13, 'square', 0.09),
  land:  () => beep(150, 55, 0.07, 'triangle', 0.18),
  grab:  () => beep(640, 880, 0.08, 'square', 0.07),
  climb: () => beep(420, 660, 0.12, 'square', 0.07),
  slide: () => beep(240, 110, 0.16, 'triangle', 0.07),
  step:  () => beep(95, 70, 0.03, 'triangle', 0.05),
  death: () => beep(480, 55, 0.55, 'sawtooth', 0.13),
  clear: () => { beep(523, 523, 0.12, 'square', 0.1);
                 setTimeout(() => beep(659, 659, 0.12, 'square', 0.1), 130);
                 setTimeout(() => beep(784, 784, 0.12, 'square', 0.1), 260);
                 setTimeout(() => beep(1046, 1046, 0.3, 'square', 0.1), 390); }
};

// ---------------- 스테이지 시스템 ----------------
const LH = 17;
let LW = 100;
let grid = [];
let spawn = { x: 56, y: 224 };     // 스테이지 시작점
let spawnPt = { x: 56, y: 224 };   // 현재 체크포인트
let exitPt = { x: 0, y: 0 };
let exitSign = null;               // { x, y, label }
let hints = [];
let checkpoints = [];
let gates = [];                    // 개찰구 플랩 { c, r1, r2, period, open, offset }
let doors = [];                    // 스크린도어 { c, r1, r2, period, open, warn, close, offset }
let crumbles = [];                 // 부서지는 발판 { c, r, state:0멀쩡|1흔들림|2붕괴, t }
let npcs = [];                     // 시간 지연형 NPC { type:'granny'|'coffee', x, y, home, dir, t, give }
let shutter = null;                // 보안 셔터 { c, r1, r2, open }
let switchDef = null;              // 카드 태그 리더 { x, y, done }
let stageIdx = 0, stageT = 0;

function newGrid(w) {
  LW = w; grid = [];
  for (let r = 0; r < LH; r++) grid.push(new Array(LW).fill('.'));
}
function F(c1, c2, r1, r2, ch) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) grid[r][c] = ch;
}

function buildPractice() {
  newGrid(100);
  F(0, 13, 14, 16, '#');
  F(14, 16, 16, 16, '#'); F(14, 16, 15, 15, '^');
  F(17, 39, 14, 16, '#');
  F(23, 25, 9, 12, '#');
  F(30, 33, 14, 16, '.'); F(30, 33, 16, 16, '#'); F(30, 33, 15, 15, '^');
  F(40, 52, 9, 16, '#');
  F(53, 70, 16, 16, '#'); F(53, 70, 15, 15, '^');
  F(55, 56, 8, 8, '-');
  F(60, 61, 7, 7, '-');
  F(65, 66, 7, 16, '#');
  F(70, 99, 14, 16, '#');
  F(93, 94, 12, 13, 'E');
  spawn = { x: 3.5 * TILE, y: 14 * TILE };
  exitPt = { x: 94 * TILE, y: 14 * TILE };
  exitSign = { x: 93 * TILE, y: 12 * TILE, label: '회 사' };
  hints = [
    { x: 30,  y: 168, t: '← →  달리기  ·  SPACE 점프' },
    { x: 218, y: 150, t: '가시 조심!' },
    { x: 340, y: 128, t: '달리다가 ↓ 슬라이딩!' },
    { x: 560, y: 120, t: '달려서 점프 → 자동 매달리기 · ↑ 오르기 · ↓ 놓기' },
    { x: 880, y: 90,  t: '좁은 발판 정밀 착지' },
    { x: 1180, y: 168, t: '연습 끝! 앞으로 쭉!' },
  ];
}

function buildSubway() {
  newGrid(110);
  // A: 개찰구 통로 (낮은 천장의 지하 통로)
  F(0, 23, 0, 10, '#');            // 천장
  F(0, 27, 14, 16, '#');           // 바닥
  gates = [
    { c: 11, r1: 12, r2: 13, period: 2.6, open: 1.3, offset: 0 },
    { c: 15, r1: 12, r2: 13, period: 2.6, open: 1.3, offset: 0.9 },
    { c: 19, r1: 12, r2: 13, period: 2.6, open: 1.3, offset: 1.8 },
  ];
  // B: 승강장 진입 계단 + 승강장
  F(26, 27, 13, 16, '#');
  F(28, 52, 12, 16, '#');
  F(24, 55, 0, 8, '#');            // 승강장 실내 천장 (스크린도어 프레임이 매달림)
  doors = [
    { c: 34, r1: 9, r2: 11, period: 3.4, open: 1.8, warn: 0.6, close: 0.3, offset: 0 },
    { c: 40, r1: 9, r2: 11, period: 3.4, open: 1.8, warn: 0.6, close: 0.3, offset: 1.1 },
    { c: 46, r1: 9, r2: 11, period: 3.4, open: 1.8, warn: 0.6, close: 0.3, offset: 2.2 },
    { c: 50, r1: 9, r2: 11, period: 3.4, open: 1.8, warn: 0.6, close: 0.3, offset: 0.7 },
  ];
  // 승강장 끝 돌출부: 부서지는 보도블럭 (아래는 선로!)
  crumbles = [
    { c: 53, r: 12, state: 0, t: 0 },
    { c: 54, r: 12, state: 0, t: 0 },
    { c: 55, r: 12, state: 0, t: 0 },
  ];
  F(53, 55, 16, 16, '#'); F(53, 55, 15, 15, '^');
  // 카드 태그 리더 → 종착 승강장 보안 셔터 개방 (스위치-게이트 연동)
  switchDef = { x: 31 * TILE, y: 12 * TILE, done: false };
  shutter = { c: 98, r1: 9, r2: 11, open: false };
  // 시간 지연형 NPC
  npcs = [
    { type: 'granny', x: 6 * TILE, y: 14 * TILE, home: 6 * TILE, dir: 1, t: 0, give: 0 },
    { type: 'coffee', x: 43 * TILE, y: 12 * TILE, home: 43 * TILE, dir: 1, t: 0, give: 0 },
  ];
  // D: 선로 + 정차된 열차 지붕
  F(56, 95, 0, 5, '#');            // 터널 천장
  F(56, 95, 16, 16, '#');
  F(56, 95, 15, 15, '^');          // 선로 (감전)
  F(58, 66, 11, 15, 'T');
  F(70, 78, 11, 15, 'T');
  F(82, 90, 11, 15, 'T');
  F(62, 63, 10, 10, 'M');          // 지붕 위 에어컨 유닛
  F(74, 75, 10, 10, 'M');
  F(86, 87, 10, 10, 'M');
  // E: 종착 승강장 + 출구
  F(96, 109, 0, 8, '#');
  F(96, 109, 12, 16, '#');
  F(104, 105, 10, 11, 'E');
  spawn = { x: 3.5 * TILE, y: 14 * TILE };
  exitPt = { x: 105 * TILE, y: 12 * TILE };
  exitSign = { x: 104 * TILE, y: 10 * TILE, label: '환승' };
  checkpoints = [
    { x: 29 * TILE, y: 12 * TILE },
    { x: 49 * TILE, y: 12 * TILE },
  ];
  hints = [
    { x: 36, y: 204, t: '개찰구: 초록불일 때 통과!' },
    { x: 500, y: 166, t: '스크린도어: 빨간불이면 곧 닫힌다!' },
    { x: 900, y: 152, t: '열차 지붕을 건너라! 선로는 감전!' },
    { x: 1560, y: 166, t: '환승 통로로!' },
  ];
}

function solid(c, r) {
  if (c < 0 || c >= LW) return true;
  if (r < 0 || r >= LH) return false;
  const ch = grid[r][c];
  return ch === '#' || ch === 'T' || ch === 'M';
}
function oneway(c, r) {
  if (c < 0 || c >= LW || r < 0 || r >= LH) return false;
  return grid[r][c] === '-';
}

// ---------------- 동적 장애물 (개찰구/스크린도어) ----------------
function gatePhase(g) {
  const t = (stageT + g.offset) % g.period;
  return t < g.open ? 'open' : 'closed';
}
function doorPhase(d) {
  const t = (stageT + d.offset) % d.period;
  if (t < d.open) return 'open';
  if (t < d.open + d.warn) return 'warn';       // 경고: 아직 열려 있음
  if (t < d.open + d.warn + d.close) return 'closing';
  return 'closed';
}
function doorK(d) { // 문 닫힘 정도 0..1
  const ph = doorPhase(d);
  if (ph === 'open' || ph === 'warn') return 0;
  if (ph === 'closed') return 1;
  const t = (stageT + d.offset) % d.period;
  return clamp((t - d.open - d.warn) / d.close, 0, 1);
}
function dynBlocked(c, r) {
  for (const g of gates)
    if (c === g.c && r >= g.r1 && r <= g.r2 && gatePhase(g) === 'closed') return true;
  for (const d of doors)
    if (c === d.c && r >= d.r1 && r <= d.r2) {
      const ph = doorPhase(d);
      if (ph === 'closing' || ph === 'closed') return true;
    }
  if (shutter && !shutter.open && c === shutter.c && r >= shutter.r1 && r <= shutter.r2) return true;
  for (const b of crumbles)
    if (b.state < 2 && c === b.c && r === b.r) return true;
  return false;
}
function solidDyn(c, r) { return solid(c, r) || dynBlocked(c, r); }
function overlapCol(c, r1, r2) {
  const hw = 4;
  return p.x + hw > c * TILE && p.x - hw < (c + 1) * TILE &&
         p.y > r1 * TILE && p.y - p.h < (r2 + 1) * TILE;
}

// ---------------- 플레이어 ----------------
const G = 640, RUN = 110, ACC = 500, FRI = 560, AIRACC = 320;
const STAND_H = 34, SLIDE_H = 14;

const p = {};
function respawn() {
  p.x = spawnPt.x; p.y = spawnPt.y;
  p.vx = 0; p.vy = 0; p.facing = 1;
  p.h = STAND_H; p.state = 'ground';
  p.onGround = true; p.coyote = 0; p.jbuf = 0;
  p.runT = 0; p.lastFr = -1; p.slideT = 0;
  p.hang = null; p.climbT = 0; p.climbFrom = null;
  p.deadT = 0; p.jumpRun = false;
  p.slowT = 0; p.stunT = 0;
  // 무너진 발판 복구, NPC 원위치
  for (const b of crumbles) { b.state = 0; b.t = 0; }
  for (const n of npcs) { n.x = n.home; n.t = 0; n.dir = 1; n.give = 0; }
}

let scene = 'title';   // title | play | clear | late
let timer = 180;       // 출근 마감 타이머
let lateG = 0;         // 지각 게이지 0~100% (두 번째 실패 축)
let score = 0;
let goMsg = '';        // 게임오버 사유
let tGlobal = 0;
let shake = 0;
const cam = { x: 0, y: 0 };
// 카메라 연출: 줌(1=기본), 도입부 타이머, 스위치 작동 시 포커스 이동
let zoom = 1, introT = 0;
let camFocus = null;   // { x, y, t } — 잠깐 그쪽을 비춤
let ZW = VW, ZH = VH; // 줌 반영 유효 뷰포트 (매 렌더 갱신)

const STAGES = [
  { name: '연습 구간', time: 180, theme: 'tunnel', build: buildPractice, wide: { x1: 530, x2: 690, y: 190 } },
  { name: 'STAGE 1 · 지하철 승강장', time: 150, theme: 'subway', build: buildSubway, wide: { x1: 430, x2: 580, y: 0 } },
];

function loadStage(i) {
  stageIdx = i;
  gates = []; doors = []; checkpoints = []; crumbles = []; npcs = [];
  shutter = null; switchDef = null; camFocus = null;
  STAGES[i].build();
  spawnPt = { x: spawn.x, y: spawn.y };
  timer = STAGES[i].time;
  stageT = 0; lateG = 0;
  respawn();
  cam.x = Math.max(0, spawn.x - VW / 2); cam.y = 0;
  scene = 'play';
  introT = 2.4; zoom = 0.74; // 도입부: 줌아웃으로 공간 전체를 보여주고 수렴
}
function restartAll() { if (scene !== 'title') loadStage(stageIdx); }

// 실패 처리: 대부분은 지각 게이지 증가(소프트), 극소수만 즉시 게임오버(하드)
function addLate(amount) {
  lateG = Math.min(100, lateG + amount);
  if (lateG >= 100) { gameover('도저히 정시 출근은 불가능합니다...'); return true; }
  return false;
}
function softFail(amount) {
  if (p.state === 'dead') return;
  shake = 0.35; SFX.death();
  if (!addLate(amount)) { p.state = 'dead'; p.deadT = 0.9; p.vx = 0; p.vy = 0; }
}
function hardFail(msg) { lateG = 100; gameover(msg); }
function gameover(msg) { goMsg = msg; scene = 'late'; SFX.death(); }

buildPractice(); // 부팅 시 그리드 초기화
respawn();

// ---------------- 물리/충돌 ----------------
function collideX(nx) {
  const hw = 4, top = p.y - p.h + 1, bot = p.y - 1;
  if (p.vx > 0) {
    const c = Math.floor((nx + hw) / TILE);
    for (let r = Math.floor(top / TILE); r <= Math.floor(bot / TILE); r++)
      if (solidDyn(c, r)) { nx = c * TILE - hw - 0.01; p.vx = 0; break; }
  } else if (p.vx < 0) {
    const c = Math.floor((nx - hw) / TILE);
    for (let r = Math.floor(top / TILE); r <= Math.floor(bot / TILE); r++)
      if (solidDyn(c, r)) { nx = (c + 1) * TILE + hw + 0.01; p.vx = 0; break; }
  }
  return nx;
}
function collideY(ny) {
  const hw = 4;
  const c1 = Math.floor((p.x - hw + 1) / TILE), c2 = Math.floor((p.x + hw - 1) / TILE);
  if (p.vy > 0) {
    const r = Math.floor(ny / TILE);
    for (let c = c1; c <= c2; c++) {
      if (solidDyn(c, r) || (oneway(c, r) && p.y <= r * TILE + 0.5)) {
        ny = r * TILE; p.vy = 0; break;
      }
    }
  } else if (p.vy < 0) {
    const r = Math.floor((ny - p.h) / TILE);
    for (let c = c1; c <= c2; c++)
      if (solidDyn(c, r)) { ny = (r + 1) * TILE + p.h; p.vy = 0; break; }
  }
  return ny;
}
function supported() {
  const hw = 4;
  const r = Math.round(p.y / TILE);
  if (Math.abs(p.y - r * TILE) > 2) return false;
  const c1 = Math.floor((p.x - hw + 1) / TILE), c2 = Math.floor((p.x + hw - 1) / TILE);
  for (let c = c1; c <= c2; c++)
    if (solidDyn(c, r) || oneway(c, r)) return true;
  return false;
}
function headroom() {
  const hw = 4, top = p.y - STAND_H;
  const c1 = Math.floor((p.x - hw + 1) / TILE), c2 = Math.floor((p.x + hw - 1) / TILE);
  for (let r = Math.floor(top / TILE); r <= Math.floor((p.y - 1) / TILE); r++)
    for (let c = c1; c <= c2; c++)
      if (solidDyn(c, r)) return false;
  return true;
}

function doJump() {
  p.jbuf = 0; p.coyote = 0;
  const run = Math.abs(p.vx) > 85;
  p.vy = run ? -226 : -238;
  if (run) p.vx *= 1.12;
  p.vx = clamp(p.vx, -132, 132);
  p.state = 'air'; p.onGround = false; p.jumpRun = run;
  SFX.jump();
}

function tryGrab() {
  if (p.vy <= -20) return;
  const f = p.facing;
  const toward = (f > 0 && Input.right) || (f < 0 && Input.left) || Input.jump;
  if (!toward) return;
  const hx = p.x + f * 6;
  const c = Math.floor(hx / TILE);
  const top = p.y - p.h;
  for (let r = Math.floor((top - 4) / TILE); r <= Math.floor((top + 14) / TILE); r++) {
    if (solid(c, r) && !solid(c, r - 1)) {
      const ledgeY = r * TILE;
      if (ledgeY >= top - 9 && ledgeY <= top + 14) {
        p.state = 'hang';
        p.hang = { c, r, ledgeY };
        p.x = f > 0 ? c * TILE - 5 : (c + 1) * TILE + 5;
        p.y = ledgeY + 36;
        p.vx = 0; p.vy = 0;
        SFX.grab();
        return;
      }
    }
  }
}
function climbSpace() {
  const { c, r } = p.hang;
  return !solid(c, r - 1) && !solid(c, r - 2) && !solid(c, r - 3);
}

function physics(dt) {
  p.vy = Math.min(p.vy + G * dt, 430);
  p.x = collideX(p.x + p.vx * dt);
  p.x = clamp(p.x, 5, LW * TILE - 5);
  p.y = collideY(p.y + p.vy * dt);

  const was = p.onGround;
  p.onGround = p.vy >= 0 && supported();
  if (p.onGround) {
    p.coyote = 0.09;
    if (!was && p.state === 'air') { p.state = 'ground'; SFX.land(); }
  } else {
    if (p.state === 'ground') p.state = 'air';
  }
}

function checks() {
  const subway = STAGES[stageIdx].theme === 'subway';
  // 완전 추락 — 하드 (즉시 게임오버)
  if (p.y - p.h > LH * TILE + 40) return hardFail('완전히 추락했습니다...');
  // 위험 타일 '^' — 지하철 선로는 하드(열차 진입), 그 외(철근 잔해)는 소프트
  const hw = 4;
  const c1 = Math.floor((p.x - hw) / TILE), c2 = Math.floor((p.x + hw) / TILE);
  const r1 = Math.floor((p.y - p.h) / TILE), r2 = Math.floor((p.y - 0.1) / TILE);
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      if (r >= 0 && r < LH && c >= 0 && c < LW && grid[r][c] === '^') {
        if (p.y > r * TILE + 8) {
          if (subway) return hardFail('선로에 떨어졌습니다... 열차가 들어옵니다!');
          return softFail(22);
        }
      }
    }
  // 체크포인트 통과
  for (const cp of checkpoints)
    if (p.x > cp.x && spawnPt.x < cp.x) { spawnPt = { x: cp.x, y: cp.y }; SFX.grab(); }
  // 카드 태그 리더 → 보안 셔터 개방 + 카메라가 셔터를 잠깐 비춤
  if (switchDef && !switchDef.done && p.x > switchDef.x) {
    switchDef.done = true;
    if (shutter) {
      shutter.open = true;
      shutter.openedAt = stageT;
      camFocus = { x: (shutter.c + 0.5) * TILE, y: shutter.r2 * TILE, t: 1.6 };
    }
    SFX.climb();
  }
  // 출구
  if (Math.abs(p.x - exitPt.x) < 18 && Math.abs(p.y - exitPt.y) < 26 && scene === 'play') {
    scene = 'clear';
    score += Math.floor(timer) * 10 + Math.round(100 - lateG) * 5 + 500;
    SFX.clear();
  }
}

// ---------------- 동적 장애물/NPC 갱신 ----------------
function updateDynamics(dt) {
  stageT += dt;
  const near = x => Math.abs(x - p.x) < 220;
  // 개찰구: 닫히는 순간 겹쳐 있으면 밀어냄 + 소량 지각
  for (const g of gates) {
    const closed = gatePhase(g) === 'closed';
    if (closed && !g.wasClosed && overlapCol(g.c, g.r1, g.r2)) {
      p.x = p.x < (g.c + 0.5) * TILE ? g.c * TILE - 5.5 : (g.c + 1) * TILE + 5.5;
      p.vx = -p.facing * 50;
      addLate(3); SFX.slide();
    }
    g.wasClosed = closed;
  }
  // 스크린도어: 닫히는 순간 끼이면 소프트 실패
  for (const d of doors) {
    const ph = doorPhase(d);
    if (ph === 'closing' && !d.wasClosing) {
      if (overlapCol(d.c, d.r1, d.r2)) softFail(18);
      else if (near((d.c + 0.5) * TILE)) SFX.land();
    }
    if (ph === 'warn' && !d.wasWarn && near((d.c + 0.5) * TILE)) SFX.grab();
    d.wasClosing = ph === 'closing'; d.wasWarn = ph === 'warn';
  }
  // 부서지는 발판: 밟는 순간 타이머 시작 → 붕괴
  if (p.onGround && p.state !== 'dead') {
    const fr = Math.round(p.y / TILE);
    const fc1 = Math.floor((p.x - 4) / TILE), fc2 = Math.floor((p.x + 4) / TILE);
    for (const b of crumbles)
      if (b.state === 0 && b.r === fr && b.c >= fc1 && b.c <= fc2) {
        b.state = 1; b.t = 0.45; SFX.slide();
      }
  }
  for (const b of crumbles)
    if (b.state === 1) { b.t -= dt; if (b.t <= 0) { b.state = 2; SFX.land(); } }
  // NPC
  for (const n of npcs) {
    if (n.type === 'granny') {
      // 전단지 할머님: 가까우면 쫓아오고, 붙으면 감속. 멀어지면 포기하고 복귀
      const sameLevel = Math.abs(p.y - n.y) < 24;
      const dHome = Math.abs(n.x - n.home);
      if (n.give > 0) {
        n.give -= dt;
        n.x += Math.sign(n.home - n.x) * 22 * dt;
      } else if (sameLevel && Math.abs(p.x - n.x) < 70 && dHome < 130 && p.state !== 'dead') {
        n.x += Math.sign(p.x - n.x) * 30 * dt;
        if (Math.abs(p.x - n.x) < 13) p.slowT = 0.25; // 전단지 받아야 해요~
        if (dHome >= 128) n.give = 2.2;
      } else if (dHome > 4) {
        n.x += Math.sign(n.home - n.x) * 16 * dt;
      }
    } else if (n.type === 'coffee') {
      // 커피 든 행인: 짧게 왕복, 부딪히면 잠깐 옷 닦기 + 지각
      n.x += n.dir * 18 * dt;
      if (n.x > n.home + 26) n.dir = -1;
      if (n.x < n.home - 26) n.dir = 1;
      if (n.t > 0) n.t -= dt;
      if (n.t <= 0 && p.state !== 'dead' && Math.abs(p.y - n.y) < 24 &&
          Math.abs(p.x - n.x) < 9 && p.onGround && Math.abs(p.vx) > 25) {
        n.t = 2.0;                       // 쿨다운
        p.stunT = 0.7; p.vx = -p.facing * 45;
        addLate(8); SFX.slide();
      }
    }
  }
}

// ---------------- 게임 스텝 ----------------
function step(dt) {
  // 히트 플래그는 여기서 소비 (렌더 프레임에서 지우면 스텝을 건너뛴 프레임의 입력이 소실됨)
  const jumpHit = Input.jumpHit; Input.jumpHit = false;
  const downHit = Input.downHit; Input.downHit = false;
  const anyHit = Input.anyHit;  Input.anyHit = false;

  if (scene === 'title') {
    if (jumpHit || anyHit) { score = 0; loadStage(1); }
    return;
  }
  if (scene === 'clear') {
    if (jumpHit) {
      if (stageIdx + 1 < STAGES.length) loadStage(stageIdx + 1);
      else scene = 'title';
    }
    return;
  }
  if (scene === 'late') {
    if (jumpHit) { score = 0; loadStage(stageIdx); }
    return;
  }
  if (scene !== 'play') return;

  timer -= dt;
  if (timer <= 0) { timer = 0; gameover('09:00 마감 시간을 넘겼습니다'); return; }

  updateDynamics(dt);

  // 카메라 연출: 도입부 줌아웃 → 수렴, 스테이지별 와이드 샷 구간, 스위치 포커스
  if (introT > 0) introT -= dt;
  if (camFocus) { camFocus.t -= dt; if (camFocus.t <= 0) camFocus = null; }
  let zt = 1;
  const wz = STAGES[stageIdx].wide;
  if (introT > 0) zt = 0.74 + 0.26 * Math.pow(1 - introT / 2.4, 2);
  else if (camFocus) zt = 0.9;
  else if (wz && p.x > wz.x1 && p.x < wz.x2 && p.y > wz.y) zt = 0.84;
  zoom = lerp(zoom, zt, 0.045);
  if (Math.abs(zoom - zt) < 0.002) zoom = zt;

  // 경직(커피)·감속(할머님) 타이머
  if (p.stunT > 0) p.stunT -= dt;
  if (p.slowT > 0) p.slowT -= dt;

  let dir = (Input.right ? 1 : 0) - (Input.left ? 1 : 0);
  if (p.stunT > 0) dir = 0; // 옷 닦는 중
  if (jumpHit) p.jbuf = 0.15;
  p.jbuf -= dt; p.coyote -= dt;

  switch (p.state) {
    case 'ground': {
      if (dir !== 0) { p.vx += dir * ACC * dt; p.facing = dir; }
      else {
        const s = Math.sign(p.vx);
        p.vx -= s * FRI * dt;
        if (Math.sign(p.vx) !== s) p.vx = 0;
      }
      const cap = p.slowT > 0 ? 55 : RUN; // 할머님에게 붙잡히면 감속
      p.vx = clamp(p.vx, -cap, cap);
      p.runT += Math.abs(p.vx) / RUN * dt * 1.7;
      if (Math.abs(p.vx) > 30) {
        const fr = Math.floor((p.runT % 1) * 8);
        if (fr !== p.lastFr && (fr === 1 || fr === 5)) SFX.step();
        p.lastFr = fr;
      }
      if (downHit && Math.abs(p.vx) > 55) {
        p.state = 'slide'; p.slideT = 0.55; p.h = SLIDE_H; SFX.slide();
      } else if (p.jbuf > 0 && p.stunT <= 0) doJump();
      break;
    }
    case 'slide': {
      const s = Math.sign(p.vx);
      p.vx -= s * 95 * dt;
      if (Math.sign(p.vx) !== s) p.vx = 0;
      p.slideT -= dt;
      const wantEnd = p.slideT <= 0 || Math.abs(p.vx) < 18;
      if (p.jbuf > 0 && headroom()) { p.h = STAND_H; doJump(); }
      else if (wantEnd) {
        if (headroom()) { p.h = STAND_H; p.state = p.onGround ? 'ground' : 'air'; }
        else { p.slideT = 0.1; if (Math.abs(p.vx) < 40) p.vx = 40 * p.facing; }
      }
      break;
    }
    case 'air': {
      if (dir !== 0) {
        p.vx += dir * AIRACC * dt;
        p.vx = clamp(p.vx, -132, 132);
        p.facing = dir;
      }
      if (!Input.jump && p.vy < -90) p.vy = -90; // 점프 컷 (길게 누르면 높이)
      if (p.jbuf > 0 && p.coyote > 0) doJump();
      tryGrab();
      break;
    }
    case 'hang': {
      if (p.jbuf > 0) {
        p.jbuf = 0;
        if (climbSpace()) {
          p.state = 'climb'; p.climbT = 0;
          p.climbFrom = { x: p.x, y: p.hang.ledgeY + 38 };
          SFX.climb();
        }
      } else if (downHit) {
        p.state = 'air'; p.vy = 20;
      }
      break;
    }
    case 'climb': {
      p.climbT += dt / 0.55;
      if (p.climbT >= 1) {
        p.x = p.hang.c * TILE + 8;
        p.y = p.hang.ledgeY;
        p.vx = 0; p.vy = 0;
        p.state = 'ground'; p.onGround = true;
      }
      break;
    }
    case 'dead': {
      p.deadT -= dt;
      if (p.deadT <= 0) respawn();
      break;
    }
  }

  if (p.state === 'ground' || p.state === 'air' || p.state === 'slide') {
    physics(dt);
    if (p.state === 'slide' && !p.onGround) { p.state = 'air'; if (headroom()) p.h = STAND_H; }
    checks();
  }

  shake = Math.max(0, shake - dt);
}

/* ============================================================
   캐릭터 렌더링 — 스켈레톤 기반 픽셀 스프라이트
   ============================================================ */
const FS = 2; // 캐릭터 픽셀 밀도 (월드 대비 2배 — 원작처럼 인물 움직임이 잘 읽히도록)
const fig = document.createElement('canvas'); fig.width = 144; fig.height = 144;
const fx = fig.getContext('2d');

const C = {
  skin: '#efb789', skinD: '#cf9668',
  shirt: '#f2f6ff', shirtD: '#c2cee6',
  slack: '#4a5268', slackD: '#343b4e',
  shoe: '#1a1a24', shoeD: '#101018',
  hair: '#2a1e13', hairHi: '#4a3826',
  bag: '#8a5a2e', bagD: '#5f3d1e', bagHi: '#a9773f', clasp: '#d9b25a',
  strap: '#4a3115',
  glass: '#232833'
};

// 좌표는 1x 단위, 실제 렌더는 2x 그리드 → 사선이 부드러워짐
function seg(c, x1, y1, x2, y2, w, col) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const steps = Math.ceil(len * FS * 2);
  c.fillStyle = col;
  const px = Math.round(w * FS);
  for (let i = 0; i <= steps; i++) {
    const x = x1 + dx * i / steps, y = y1 + dy * i / steps;
    c.fillRect(Math.round(x * FS - px / 2), Math.round(y * FS - px / 2), px, px);
  }
}

function drawShoe(c, ax, ay, f, dark) {
  const X = Math.round((f > 0 ? ax - 1 : ax - 3) * FS), Y = Math.round((ay - 1) * FS);
  c.fillStyle = dark ? C.shoeD : C.shoe;
  c.fillRect(X, Y, 8, 4);
  c.fillRect(f > 0 ? X + 8 : X - 2, Y + 2, 2, 2); // 앞코
}

function drawHead(c, hx, hy, f, bob) {
  const X = Math.round(hx * FS) - 5, Y = Math.round((hy - 6 + bob) * FS);
  const R = f > 0;
  // 얼굴
  c.fillStyle = C.skin;
  c.fillRect(X + 1, Y + 2, 8, 9);
  c.fillStyle = C.skinD;
  c.fillRect(X + 1, Y + 10, 8, 1);                 // 턱 음영
  // 머리카락 (윗머리 + 뒷머리)
  c.fillStyle = C.hair;
  c.fillRect(X, Y, 10, 3);
  c.fillRect(R ? X : X + 7, Y + 2, 3, 5);
  c.fillStyle = C.hairHi;
  c.fillRect(R ? X + 2 : X + 6, Y, 2, 1);
  // 귀
  c.fillStyle = C.skinD;
  c.fillRect(R ? X + 3 : X + 5, Y + 5, 2, 3);
  // 안경 (렌즈 + 다리)
  c.fillStyle = C.glass;
  if (R) { c.fillRect(X + 6, Y + 5, 3, 2); c.fillRect(X + 4, Y + 5, 2, 1); }
  else { c.fillRect(X + 1, Y + 5, 3, 2); c.fillRect(X + 4, Y + 5, 2, 1); }
}

// pose: {hipH, hipX, lean, legs:[[hip,knee]x2 (far,near)], arms:[[sh,elbow]x2], bagSwing, headBob}
function drawFigure(px, py, f, pose, alpha) {
  fx.clearRect(0, 0, 144, 144);
  const FX = 36, FY = 62;
  const hip = { x: FX + (pose.hipX || 0) * f, y: FY - pose.hipH };
  const lean = pose.lean || 0;
  const TL = 12;
  const sh = { x: hip.x + Math.sin(lean) * TL * f, y: hip.y - Math.cos(lean) * TL };

  function legJ(a, k) {
    const TH = 9, SHN = 8;
    const kx = hip.x + Math.sin(a) * TH * f, ky = hip.y + Math.cos(a) * TH;
    const a2 = a - k;
    return { kx, ky, ax: kx + Math.sin(a2) * SHN * f, ay: ky + Math.cos(a2) * SHN };
  }
  function armJ(b, e) {
    const UA = 7, FA = 7;
    const ex = sh.x + Math.sin(b) * UA * f, ey = sh.y + Math.cos(b) * UA;
    const b2 = b + e;
    return { ex, ey, wx: ex + Math.sin(b2) * FA * f, wy: ey + Math.cos(b2) * FA };
  }

  const L1 = legJ(pose.legs[0][0], pose.legs[0][1]); // 먼쪽 다리
  const L2 = legJ(pose.legs[1][0], pose.legs[1][1]); // 가까운 다리
  const A1 = armJ(pose.arms[0][0], pose.arms[0][1]); // 먼쪽 팔
  const A2 = armJ(pose.arms[1][0], pose.arms[1][1]); // 가까운 팔

  // 먼쪽 팔 (걷어붙인 소매: 상완=셔츠, 전완=피부)
  seg(fx, sh.x, sh.y, A1.ex, A1.ey, 2, C.shirtD);
  seg(fx, A1.ex, A1.ey, A1.wx, A1.wy, 2, C.skinD);
  fx.fillStyle = C.skinD; fx.fillRect(Math.round(A1.wx * FS - 2), Math.round(A1.wy * FS - 2), 4, 4);
  // 먼쪽 다리
  seg(fx, hip.x, hip.y, L1.kx, L1.ky, 3, C.slackD);
  seg(fx, L1.kx, L1.ky, L1.ax, L1.ay, 2, C.slackD);
  drawShoe(fx, L1.ax, L1.ay, f, true);
  // 몸통(셔츠) + 등쪽 음영 + 골반(슬랙스)
  seg(fx, hip.x, hip.y, sh.x, sh.y, 5, C.shirt);
  seg(fx, hip.x - 1.6 * f, hip.y, sh.x - 1.6 * f, sh.y, 1.5, C.shirtD);
  fx.fillStyle = C.slack;
  fx.fillRect(Math.round(hip.x * FS - 6), Math.round((hip.y - 2) * FS), 12, 8);
  // 크로스 스트랩: 앞쪽 어깨 → 가방이 걸린 뒤쪽 골반
  const bs = pose.bagSwing || 0;
  seg(fx, sh.x + 2 * f, sh.y + 1, hip.x - 5.5 * f, hip.y + bs * 0.4, 1.5, C.strap);
  // 서류가방 (직사각 가죽 가방: 플랩 + 손잡이 + 잠금장치)
  const bx = Math.round((hip.x - f * 8) * FS) - 7, by = Math.round((hip.y - 2 + bs) * FS);
  fx.fillStyle = C.bag;  fx.fillRect(bx, by, 14, 10);
  fx.fillStyle = C.bagHi; fx.fillRect(bx, by, 14, 1); fx.fillRect(bx, by, 1, 10);
  fx.fillStyle = C.bagD; fx.fillRect(bx, by + 3, 14, 1);           // 플랩 라인
  fx.fillRect(bx + 4, by - 2, 6, 2);                                // 손잡이
  fx.fillRect(bx, by + 9, 14, 1);                                   // 바닥 모서리
  fx.fillStyle = C.clasp; fx.fillRect(bx + 6, by + 4, 2, 2);        // 금속 잠금장치
  // 가까운 다리
  seg(fx, hip.x, hip.y, L2.kx, L2.ky, 3, C.slack);
  seg(fx, L2.kx, L2.ky, L2.ax, L2.ay, 2, C.slack);
  drawShoe(fx, L2.ax, L2.ay, f, false);
  // 머리
  drawHead(fx, sh.x + Math.sin(lean) * 2 * f + f, sh.y - 2, f, pose.headBob || 0);
  // 가까운 팔
  seg(fx, sh.x, sh.y, A2.ex, A2.ey, 2, C.shirt);
  seg(fx, A2.ex, A2.ey, A2.wx, A2.wy, 2, C.skin);
  fx.fillStyle = C.skin; fx.fillRect(Math.round(A2.wx * FS - 2), Math.round(A2.wy * FS - 2), 4, 4);

  if (alpha !== undefined) fgx.globalAlpha = alpha;
  fgx.drawImage(fig, px * FS - FX * FS, py * FS - FY * FS);
  fgx.globalAlpha = 1;
}

// ---------------- 포즈 ----------------
function poseRun(t) {
  const q = Math.floor(((t % 1) + 1) % 1 * 8) / 8;   // 8프레임 양자화
  const ph = q * Math.PI * 2;
  const sA = Math.sin(ph), sB = Math.sin(ph + Math.PI);
  const hA = 0.85 * sA, hB = 0.85 * sB;
  const kA = 0.25 + 1.15 * Math.max(0, Math.sin(ph - 2.3));
  const kB = 0.25 + 1.15 * Math.max(0, Math.sin(ph + Math.PI - 2.3));
  return {
    hipH: 16 + 1.3 * Math.abs(Math.cos(ph)),
    lean: 0.3,
    legs: [[hB, kB], [hA, kA]],
    arms: [[0.7 * sA - 0.1, 1.5], [0.7 * sB - 0.1, 1.5]],
    bagSwing: Math.sin(ph * 2) * 1.2,
    headBob: 0.5 * Math.abs(sA)
  };
}
function poseIdle(time) {
  const br = Math.sin((Math.floor(time * 8) / 8) * 2.1); // 8fps 양자화
  return {
    hipH: 16.5, lean: 0.06 + br * 0.02,
    legs: [[0.14, 0.14], [-0.1, 0.08]],
    arms: [[0.14, 0.28], [-0.13, 0.22]],
    bagSwing: 0, headBob: br * 0.4
  };
}
function poseAir(vy, leap) {
  if (leap) { // 러닝 점프: 앞뒤로 쭉 뻗은 도약
    return {
      hipH: 17, lean: 0.38,
      legs: [[-1.05, 0.45], [1.1, 0.2]],
      arms: [[0.95, 1.1], [-0.85, 0.5]],
      bagSwing: 2, headBob: 0
    };
  }
  if (vy < -40) return { // 상승: 다리 접기
    hipH: 16, lean: 0.2,
    legs: [[-0.5, 1.35], [0.7, 1.05]],
    arms: [[0.55, 1.6], [-0.9, 1.0]],
    bagSwing: 1.5, headBob: 0
  };
  return { // 하강: 팔 벌리고 다리 뻗기
    hipH: 15.5, lean: 0.08,
    legs: [[-0.3, 0.85], [0.42, 0.45]],
    arms: [[1.45, 0.35], [-1.15, 0.25]],
    bagSwing: 1, headBob: 0
  };
}
function poseHang(time) {
  time = Math.floor(time * 8) / 8; // 8fps 양자화
  const sw = Math.sin(time * 3) * 0.06;
  return {
    hipH: 14, hipX: -1, lean: -0.06 + sw,
    legs: [[-0.16 + sw * 2, 0.5], [0.1 + sw * 2, 0.32]],
    arms: [[Math.PI - 0.62, 0.2], [Math.PI - 0.18, -0.08]],
    bagSwing: Math.sin(time * 3) * 1.4, headBob: 0
  };
}
function poseSlide() {
  return {
    hipH: 6, hipX: -1, lean: -1.15,
    legs: [[0.9, 1.55], [1.38, 0.12]],
    arms: [[0.4, 1.15], [-1.5, 0.3]],
    bagSwing: 2, headBob: 0
  };
}
function poseClimbK(k) {
  if (k < 0.55) { // 팔로 끌어올리기
    const u = k / 0.55;
    return {
      hipH: 12, lean: 0.15,
      legs: [[0.5, 1.8], [0.9, 1.85]],
      arms: [[Math.PI - 0.4 + u * 0.5, 0.25], [Math.PI - 0.2 - u * 0.45, -0.15]],
      bagSwing: 1, headBob: 0
    };
  }
  const u = (k - 0.55) / 0.45; // 웅크림 → 일어서기
  return {
    hipH: 7 + 10 * u, lean: 0.5 - 0.44 * u,
    legs: [[0.9 - 0.8 * u, 1.6 - 1.45 * u], [0.3 - 0.2 * u, 0.6 - 0.5 * u]],
    arms: [[0.6 - 0.45 * u, 1.0 - 0.7 * u], [-0.6 + 0.45 * u, 0.6 - 0.38 * u]],
    bagSwing: 1, headBob: 0
  };
}
function poseDead(k) {
  const u = Math.min(1, k * 2.2);
  return {
    hipH: lerp(14, 4, u), hipX: -2 * u, lean: lerp(-0.3, -1.5, u),
    legs: [[lerp(0.3, 1.2, u), 0.4], [lerp(-0.2, 1.5, u), 0.15]],
    arms: [[lerp(0.5, 1.7, u), 0.2], [lerp(-0.5, -1.6, u), 0.1]],
    bagSwing: 2 * u, headBob: 0
  };
}

function drawPlayer() {
  let pose;
  let px = Math.round(p.x - cam.x), py = Math.round(p.y - cam.y);
  const f = p.facing;
  let alpha;
  switch (p.state) {
    case 'ground':
      pose = Math.abs(p.vx) > 8 ? poseRun(p.runT) : poseIdle(tGlobal);
      break;
    case 'air':
      pose = poseAir(p.vy, p.jumpRun && Math.abs(p.vx) > 88 && p.vy < 60);
      break;
    case 'slide': pose = poseSlide(); break;
    case 'hang':
      pose = poseHang(tGlobal);
      py = Math.round(p.hang.ledgeY + 38 - cam.y);
      break;
    case 'climb': {
      // 6단계 키프레임으로 양자화 — 원작의 뚝뚝 끊기는 프레임감
      const k = Math.floor(Math.min(1, p.climbT) * 6) / 6;
      pose = poseClimbK(k);
      const tx = p.hang.c * TILE + 8, ty = p.hang.ledgeY;
      const ky = Math.min(1, k * 1.45);
      const kx = Math.max(0, (k - 0.35) / 0.65);
      px = Math.round(lerp(p.climbFrom.x, tx, kx) - cam.x);
      py = Math.round(lerp(p.climbFrom.y, ty, ky) - cam.y);
      break;
    }
    case 'dead':
      pose = poseDead(1.1 - p.deadT);
      alpha = 0.4 + 0.6 * Math.abs(Math.sin(p.deadT * 12));
      break;
    default: pose = poseIdle(tGlobal);
  }
  drawFigure(px, py, f, pose, alpha);
}

/* ============================================================
   월드 렌더링
   ============================================================ */
function hash2(c, r) {
  let h = (c * 374761393 + r * 668265263) >>> 0;
  h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
  return (h >>> 8) / 16777216;
}

function drawFlame(x, y, seed) {
  // 2~3프레임으로 흔들리는 픽셀 불꽃
  const fr = (Math.floor(tGlobal * 9) + seed) % 3;
  ctx.fillStyle = '#ff5e2e';
  ctx.fillRect(x, y - 4, 3, 4);
  ctx.fillStyle = '#ff9d3a';
  if (fr === 0) { ctx.fillRect(x, y - 6, 2, 3); ctx.fillRect(x + 1, y - 8, 1, 2); }
  else if (fr === 1) { ctx.fillRect(x + 1, y - 6, 2, 3); ctx.fillRect(x + 1, y - 7, 1, 1); }
  else { ctx.fillRect(x, y - 7, 2, 4); ctx.fillRect(x + 2, y - 5, 1, 2); }
  ctx.fillStyle = '#ffd75e';
  ctx.fillRect(x + 1, y - 3, 1, 2);
}

function drawBackground() {
  if (STAGES[stageIdx].theme === 'subway') drawBackgroundSubway();
  else drawBackgroundTunnel();
}

// ── 지하철 승강장 배경 세트 (3단 패럴랙스 + 반대편 선로 창 + 지나가는 열차) ──
function drawBackgroundSubway() {
  ctx.fillStyle = '#0b0c13';
  ctx.fillRect(0, 0, ZW, ZH);
  const bgY = -Math.round(cam.y * 0.25);
  const parFar = cam.x * 0.15, parWall = cam.x * 0.45, parPil = cam.x * 0.6;

  // 중경: 타일 벽
  const wallTop = bgY - 24, wallH = ZH + 80;
  ctx.fillStyle = '#232735';
  ctx.fillRect(0, wallTop, ZW, wallH);
  ctx.fillStyle = '#1b1e2a';
  for (let yy = 0; yy < wallH; yy += 8) ctx.fillRect(0, wallTop + yy, ZW, 1);
  for (let xx = -12; xx < ZW + 12; xx += 12)
    ctx.fillRect(Math.round(xx - (parWall % 12)), wallTop, 1, wallH);
  // 노선 색 띠
  ctx.fillStyle = '#2c4f86'; ctx.fillRect(0, bgY + 98, ZW, 6);
  ctx.fillStyle = '#1d3357'; ctx.fillRect(0, bgY + 104, ZW, 2);

  for (let i = 0; i < 16; i++) {
    // 반대편 선로가 보이는 개구부 (원경이 다른 속도로 흐름)
    const ax = Math.round(i * 130 + 46 - parWall);
    const aw = 44, ay0 = bgY + 46, ah = 74;
    if (ax > -70 && ax < ZW + 10) {
      ctx.save();
      ctx.beginPath(); ctx.rect(ax, ay0, aw, ah); ctx.clip();
      ctx.fillStyle = '#06070d'; ctx.fillRect(ax, ay0, aw, ah);
      // 원경: 반대편 승강장 기둥 실루엣
      for (let k = -1; k < ZW / 52 + 2; k++) {
        const icx = Math.round(k * 52 - (parFar % 52));
        ctx.fillStyle = '#131728'; ctx.fillRect(icx, ay0 + 10, 8, 54);
        ctx.fillStyle = '#1a1f33'; ctx.fillRect(icx, ay0 + 10, 2, 54);
      }
      ctx.fillStyle = '#151928'; ctx.fillRect(ax, ay0 + 56, aw, 8);
      ctx.fillStyle = '#0e1120'; ctx.fillRect(ax, ay0 + 62, aw, 12);
      // 지나가는 열차 (주기적으로 원경을 스쳐감 — "출발하는 열차")
      const cyc = tGlobal % 11;
      if (cyc < 2.4) {
        const tx0 = Math.round(ZW + 140 - cyc * ((ZW + 460) / 2.4));
        ctx.fillStyle = '#1c2336'; ctx.fillRect(tx0, ay0 + 24, 240, 36);
        ctx.fillStyle = '#8fa7c9';
        for (let w = 0; w < 14; w++) ctx.fillRect(tx0 + 8 + w * 16, ay0 + 31, 9, 8);
        ctx.fillStyle = '#e8d06a'; ctx.fillRect(tx0 + 234, ay0 + 42, 5, 4);
      }
      ctx.restore();
      // 창 프레임 + 안전 난간
      ctx.fillStyle = '#323848';
      ctx.fillRect(ax - 2, ay0 - 2, aw + 4, 2); ctx.fillRect(ax - 2, ay0 + ah, aw + 4, 2);
      ctx.fillRect(ax - 2, ay0, 2, ah); ctx.fillRect(ax + aw, ay0, 2, ah);
      ctx.fillStyle = '#3d4456'; ctx.fillRect(ax, ay0 + 34, aw, 2);
    }
    // 형광등 + 역명판 (개구부 사이 벽면)
    const sx = Math.round(i * 130 + 112 - parWall);
    if (sx > -40 && sx < ZW + 10) {
      ctx.fillStyle = 'rgba(210,225,255,0.07)';
      ctx.fillRect(sx - 8, bgY + 34, 36, 34);
      ctx.fillStyle = '#e9eefb'; ctx.fillRect(sx - 2, bgY + 32, 22, 2);
      ctx.fillStyle = '#8d94a8'; ctx.fillRect(sx - 2, bgY + 34, 22, 1);
      // 역명판 (파란 띠)
      ctx.fillStyle = '#20344f'; ctx.fillRect(sx - 3, bgY + 56, 26, 12);
      ctx.fillStyle = '#dfe5ee'; ctx.fillRect(sx - 1, bgY + 58, 22, 8);
      ctx.fillStyle = '#2c4f86'; ctx.fillRect(sx - 1, bgY + 63, 22, 3);
      ctx.fillStyle = '#39404f'; ctx.fillRect(sx + 2, bgY + 59, 16, 2);
    }
  }

  // 중경(앞줄): 승강장 사각 기둥 (오블리크 측면 + 하단 노선 띠)
  for (let i = 0; i < 20; i++) {
    const px2 = Math.round(i * 108 + 20 - parPil);
    if (px2 < -20 || px2 > ZW + 10) continue;
    const pt = bgY + 6, pb = ZH + 12;
    for (let k = 1; k <= 4; k++) {
      const up = Math.round(OBY * k / OBX);
      ctx.fillStyle = k === 4 ? '#10131f' : '#1a1e2c';
      ctx.fillRect(px2 + 13 + k, pt - up, 1, pb - pt);
    }
    ctx.fillStyle = '#2b3040'; ctx.fillRect(px2, pt, 14, pb - pt);
    ctx.fillStyle = '#3a4053'; ctx.fillRect(px2, pt, 3, pb - pt);
    ctx.fillStyle = '#191d2a'; ctx.fillRect(px2 + 12, pt, 2, pb - pt);
    ctx.fillStyle = '#2c4f86'; ctx.fillRect(px2, bgY + 100, 14, 10);
  }
}

// ── 터널(연습 구간) 배경 세트 ──
function drawBackgroundTunnel() {
  // ── 3단 레이어 패럴랙스: 원경 ×0.15 · 중경 벽 ×0.45 · 중경 기둥 ×0.6 · 전경(타일) ×1 ──
  ctx.fillStyle = '#0b0c14';
  ctx.fillRect(0, 0, ZW, ZH);
  const bgY = -Math.round(cam.y * 0.25);
  const parFar = cam.x * 0.15;
  const parWall = cam.x * 0.45;
  const parPil = cam.x * 0.6;
  const prog = clamp(p.x / (LW * TILE), 0, 1);

  // ── 중경: 석벽 (큰 블록 패턴) ──
  const wallTop = bgY - 24, wallH = ZH + 80;
  ctx.fillStyle = '#1a1d30';
  ctx.fillRect(0, wallTop, ZW, wallH);
  ctx.fillStyle = '#12141f';
  for (let yy = 0; yy < wallH; yy += 14) {
    ctx.fillRect(0, wallTop + yy, ZW, 1);
    const off = ((yy / 14) | 0) % 2 ? 14 : 0;
    for (let xx = -28; xx < ZW + 28; xx += 28) {
      ctx.fillRect(Math.round(xx - (parWall % 28)) + off, wallTop + yy + 1, 1, 13);
    }
  }
  ctx.fillStyle = '#1f2337';
  for (let yy = 1; yy < wallH; yy += 14) ctx.fillRect(0, wallTop + yy, ZW, 1);

  // ── 아치 개구부: 안쪽으로 뚫려 원경(터널 회랑)이 비쳐 보임 ──
  for (let i = 0; i < 14; i++) {
    const ax = Math.round(i * 130 + 46 - parWall);
    const aw = 40, ay0 = bgY + 44, ah = 80;
    if (ax > -60 && ax < ZW + 10) {
      ctx.save();
      ctx.beginPath(); ctx.rect(ax, ay0 + 4, aw, ah); ctx.clip();
      // 원경 베이스 (가장 어둡고 채도 낮음)
      ctx.fillStyle = '#07080f';
      ctx.fillRect(ax, ay0, aw, ah + 10);
      // 원경: 안쪽 회랑의 기둥 실루엣 (아치 프레임보다 훨씬 느리게 흐름)
      for (let k = -1; k < ZW / 48 + 2; k++) {
        const icx = Math.round(k * 48 - (parFar % 48));
        ctx.fillStyle = '#12152a';
        ctx.fillRect(icx, ay0 + 12, 7, 66);
        ctx.fillStyle = '#181c33';
        ctx.fillRect(icx, ay0 + 12, 2, 66);
        ctx.fillStyle = '#0e1122';
        ctx.fillRect(icx + 1, ay0 + 12, 5, 2);
      }
      // 원경: 소실점으로 후퇴하는 바닥 밴드
      ctx.fillStyle = '#151830'; ctx.fillRect(ax, ay0 + 64, aw, 20);
      ctx.fillStyle = '#101327'; ctx.fillRect(ax, ay0 + 64, aw, 8);
      ctx.fillStyle = '#0c0f1e'; ctx.fillRect(ax, ay0 + 64, aw, 3);
      // 원경: 터널 끝 불빛 — 진행할수록 밝고 커짐 (목적지가 이어져 있다는 힌트)
      const gx = Math.round(300 - parFar * 0.6);
      const gw = 6 + prog * 16;
      ctx.fillStyle = 'rgba(255,190,90,' + (0.05 + prog * 0.22).toFixed(3) + ')';
      ctx.fillRect(gx - gw / 2, ay0 + 26, gw, 44);
      ctx.fillStyle = 'rgba(255,220,140,' + (0.08 + prog * 0.3).toFixed(3) + ')';
      ctx.fillRect(gx - 2, ay0 + 42, 4, 28);
      ctx.restore();
      // 아치 프레임 (문설주/상인방/어깨)
      ctx.fillStyle = '#1a1d30';
      ctx.fillRect(ax, ay0 + 4, 3, 3); ctx.fillRect(ax + 37, ay0 + 4, 3, 3);
      ctx.fillStyle = '#2e3450';
      ctx.fillRect(ax - 2, ay0 + 4, 2, ah); ctx.fillRect(ax + aw, ay0 + 4, 2, ah);
      ctx.fillRect(ax - 4, ay0, 48, 4);
      ctx.fillStyle = '#3a4160';
      ctx.fillRect(ax - 4, ay0, 48, 1);
      // 상인방 윗면 (오블리크 고정 각도)
      for (let k = 1; k <= 2; k++) {
        const off = Math.round(OBX * k / OBY);
        ctx.fillStyle = '#454d70';
        ctx.fillRect(ax - 4 + off, ay0 - k, 48, 1);
      }
      // 개구부 안 바닥선 (문턱)
      ctx.fillStyle = '#141726';
      ctx.fillRect(ax, ay0 + 76, aw, 4);
    }
    // 횃불 (개구부 사이 벽면) — 은은한 광원 포함
    const tx = Math.round(i * 130 + 112 - parWall);
    if (tx > -10 && tx < ZW + 10) {
      ctx.fillStyle = 'rgba(255,150,60,0.07)';
      ctx.fillRect(tx - 12, bgY + 66, 28, 30);
      ctx.fillStyle = 'rgba(255,150,60,0.06)';
      ctx.fillRect(tx - 7, bgY + 72, 18, 20);
      ctx.fillStyle = '#4a4f68';
      ctx.fillRect(tx, bgY + 86, 2, 6);
      ctx.fillRect(tx - 1, bgY + 85, 4, 2);
      drawFlame(tx - 1, bgY + 85, i);
    }
  }

  // ── 중경 힌트 1: 철골 실루엣 (곧 나올 외발 발판 구간 예고, 벽 좌표계) ──
  {
    const sx = Math.round(392 - parWall);
    if (sx > -110 && sx < ZW + 10) {
      ctx.fillStyle = '#232945';
      ctx.fillRect(sx, bgY + 56, 96, 3);
      ctx.fillRect(sx + 26, bgY + 78, 96, 3);
      ctx.fillRect(sx + 8, bgY + 56, 3, 60);
      ctx.fillRect(sx + 78, bgY + 56, 3, 60);
      ctx.fillStyle = '#1c2138';
      ctx.fillRect(sx + 40, bgY + 59, 3, 22);
    }
  }
  // ── 중경 힌트 2: 회사 로비의 따뜻한 불빛 (출구 예고, 벽 좌표계) ──
  {
    const lx = Math.round(688 - parWall);
    if (lx > -60 && lx < ZW + 10) {
      ctx.fillStyle = 'rgba(255,205,120,0.10)';
      ctx.fillRect(lx - 6, bgY + 46, 46, 78);
      ctx.fillStyle = 'rgba(255,215,140,0.14)';
      ctx.fillRect(lx + 2, bgY + 52, 30, 72);
      ctx.fillStyle = 'rgba(255,230,170,0.20)';
      ctx.fillRect(lx + 12, bgY + 60, 10, 64);
      ctx.fillStyle = '#20304a';
      ctx.fillRect(lx + 2, bgY + 40, 30, 8);
    }
  }

  // ── 중경(앞줄): 독립 기둥 열 — 벽보다 빠르게 흘러 레이어가 분리돼 보임 ──
  for (let i = 0; i < 18; i++) {
    const px2 = Math.round(i * 108 + 20 - parPil);
    if (px2 < -20 || px2 > ZW + 10) continue;
    const pt = bgY + 8, pb = ZH + 12;
    // 측면 평행사변형 (오블리크 고정 각도, 깊이 4)
    for (let k = 1; k <= 4; k++) {
      const up = Math.round(OBY * k / OBX);
      ctx.fillStyle = k === 4 ? '#111527' : '#1c2138';
      ctx.fillRect(px2 + 13 + k, pt - up, 1, pb - pt);
    }
    // 전면
    ctx.fillStyle = '#262b42';
    ctx.fillRect(px2, pt, 12, pb - pt);
    ctx.fillStyle = '#333a58';
    ctx.fillRect(px2, pt, 3, pb - pt);
    ctx.fillStyle = '#15182a';
    ctx.fillRect(px2 + 10, pt, 2, pb - pt);
    // 주두(캡): 윗면 평행사변형 + 전면
    for (let k = 1; k <= 3; k++) {
      const off = Math.round(OBX * k / OBY);
      ctx.fillStyle = k === 3 ? '#3d4463' : '#4a5273';
      ctx.fillRect(px2 - 2 + off, pt - k, 16, 1);
    }
    ctx.fillStyle = '#3a415f';
    ctx.fillRect(px2 - 2, pt, 16, 4);
    ctx.fillStyle = '#454d6e';
    ctx.fillRect(px2 - 2, pt, 16, 1);
    // 주초(베이스)
    ctx.fillStyle = '#2c3350';
    ctx.fillRect(px2 - 2, bgY + 124, 16, 5);
  }
}

// ── 오블리크(캐벌리어) 투영 — 시어 각도는 전 화면 공통 고정값 (절대 불변) ──
const OBX = 6, OBY = 4; // 우상향 오프셋: 타일의 37~45%, atan(4/6) ≈ 34°

// 윗면 평행사변형: 정면 상단 변에서 우상향으로 이어 붙임 (계단식 시어 = 픽셀 크리스프)
// pal: 0 석재, 1 금속(열차/기계)
function obTopFace(x, y, c, pal) {
  for (let k = 1; k <= OBY; k++) {
    const off = Math.round(OBX * k / OBY);
    if (pal === 1) ctx.fillStyle = k === OBY ? '#5f6880' : '#8b96ae';
    else ctx.fillStyle = k === OBY ? '#7e86a3' : (((c >> 1) % 2) ? '#a6aec9' : '#9ba3c0');
    ctx.fillRect(x + off, y - k, TILE, 1);
    if (pal !== 1 && c % 2 === 0) { ctx.fillStyle = '#6a7292'; ctx.fillRect(x + off, y - k, 1, 1); } // 석판 이음매
  }
}
// 측면 평행사변형: 정면 오른쪽 변에서 우상향으로 이어 붙임
function obSideFace(x, y, h, pal) {
  for (let k = 1; k <= OBX; k++) {
    const up = Math.round(OBY * k / OBX);
    if (pal === 1) ctx.fillStyle = k === OBX ? '#10141f' : '#1f2534';
    else ctx.fillStyle = k === OBX ? '#151a2c' : '#252b46';
    ctx.fillRect(x + TILE - 1 + k, y - up, 1, h);
  }
}

function drawTiles() {
  const c1 = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const c2 = Math.min(LW - 1, Math.floor((cam.x + ZW) / TILE) + 1);
  const camX = Math.round(cam.x), camY = Math.round(cam.y);

  // ── 패스 1: 윗면/측면 (뒤로 물러나는 면 — 이웃 블록 전면이 나중에 그려져 올바르게 가림) ──
  for (let r = 0; r < LH; r++) {
    for (let c = c1; c <= c2; c++) {
      const ch = grid[r][c];
      const x = c * TILE - camX, y = r * TILE - camY;
      if (ch === '#' || ch === 'T') {
        const pal = ch === 'T' ? 1 : 0;
        if (!solid(c, r - 1)) obTopFace(x, y, c, pal);
        if (!solid(c + 1, r)) obSideFace(x, y, TILE, pal);
      } else if (ch === '-') {
        obTopFace(x, y, c, 0);
        if (!oneway(c + 1, r)) obSideFace(x, y, 5, 0);
      }
    }
  }

  // ── 패스 2: 전면 + 오브젝트 ──
  for (let r = 0; r < LH; r++) {
    for (let c = c1; c <= c2; c++) {
      const ch = grid[r][c];
      const x = c * TILE - camX, y = r * TILE - camY;
      if (ch === '#') {
        const h = hash2(c, r);
        const airUp = !solid(c, r - 1);
        const airDn = !solid(c, r + 1) && r + 1 < LH;
        // 전면 — 큰 석재 블록 (32px 폭, 행마다 엇갈림)
        ctx.fillStyle = ((c >> 1) + r) % 2 ? '#3b425a' : '#374056';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#484f6b';
        ctx.fillRect(x, y, TILE, 1);            // 블록 상단 하이라이트
        ctx.fillStyle = '#252a3e';
        ctx.fillRect(x, y + 15, TILE, 1);       // 가로 모르타르
        if (((c + (r % 2)) % 2) === 0) ctx.fillRect(x, y, 1, TILE); // 세로 모르타르
        if (h < 0.3) { ctx.fillStyle = '#313749'; ctx.fillRect(x + 3 + ((h * 40) | 0) % 9, y + 5 + ((h * 90) | 0) % 7, 2, 2); }
        // 윗면과 만나는 앞모서리(발선) 하이라이트 — 승강장은 노란 안전선
        if (airUp) {
          if (STAGES[stageIdx].theme === 'subway' && r === 12) {
            ctx.fillStyle = '#e3c05a'; ctx.fillRect(x, y, TILE, 1);
            ctx.fillStyle = '#d9b25a'; ctx.fillRect(x + 2, y - 1, TILE, 1);
          } else { ctx.fillStyle = '#bcc4dc'; ctx.fillRect(x, y, TILE, 1); }
        }
        if (!solid(c - 1, r)) { ctx.fillStyle = '#4a5170'; ctx.fillRect(x, y, 1, TILE); }
        // 밑면 어둡게 + 아래 공간으로 떨어지는 그림자
        if (airDn) {
          ctx.fillStyle = '#151826'; ctx.fillRect(x, y + 14, TILE, 2);
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + 16, TILE, 5);
        }
      } else if (ch === '^') {
        if (STAGES[stageIdx].theme === 'subway') {
          // 선로: 자갈 + 침목 + 레일 + 전기 스파크
          ctx.fillStyle = '#14161f'; ctx.fillRect(x, y + 6, TILE, 10);
          ctx.fillStyle = '#2a2f3d'; ctx.fillRect(x + 2, y + 11, 3, 5); ctx.fillRect(x + 9, y + 11, 3, 5);
          ctx.fillStyle = '#79839a'; ctx.fillRect(x, y + 8, TILE, 2);
          ctx.fillStyle = '#464e61'; ctx.fillRect(x, y + 10, TILE, 1);
          const sp = (Math.floor(tGlobal * 10) + c) % 7;
          if (sp === 0) {
            const ox = (c * 5) % 11;
            ctx.fillStyle = '#ffe98a';
            ctx.fillRect(x + ox, y + 4, 2, 4);
            ctx.fillRect(x + ox + 2, y + 2, 1, 2);
          }
        } else {
          // 철근 잔해
          ctx.fillStyle = '#565c6e';
          for (let i = 0; i < 4; i++) {
            const sx = x + i * 4;
            ctx.fillRect(sx + 1, y + 8, 2, 8);
            ctx.fillRect(sx + 1, y + 6, 1, 2);
          }
          ctx.fillStyle = '#7d8498';
          for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 4 + 1, y + 8, 1, 8);
        }
      } else if (ch === 'T') {
        // 정차된 열차 (르row 위치별: 11 지붕 / 12 창문 / 13-14 차체·문 / 15 하부)
        ctx.fillStyle = '#3f4a61'; ctx.fillRect(x, y, TILE, TILE);
        if (r === 11) {
          ctx.fillStyle = '#525f79'; ctx.fillRect(x, y, TILE, 6);
          ctx.fillStyle = '#98a3bc'; ctx.fillRect(x, y, TILE, 1);
          ctx.fillStyle = '#2e3648'; ctx.fillRect(x, y + 6, TILE, 1);
        } else if (r === 12) {
          ctx.fillStyle = '#2a3245'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = hash2(c, 3) > 0.5 ? '#cfdcf0' : '#171e2e';
          ctx.fillRect(x + 2, y + 3, 12, 9);
          ctx.fillStyle = '#4a5772'; ctx.fillRect(x + 2, y + 3, 12, 1);
        } else if (r <= 14) {
          ctx.fillStyle = '#414c64'; ctx.fillRect(x, y, TILE, TILE);
          if (c % 4 === 0) { // 출입문 (위아래 두 타일에 걸침)
            ctx.fillStyle = '#333d52'; ctx.fillRect(x + 3, y + (r === 13 ? 2 : 0), 10, r === 13 ? 14 : 12);
            ctx.fillStyle = '#1f2635'; ctx.fillRect(x + 8, y + (r === 13 ? 2 : 0), 1, r === 13 ? 14 : 12);
            if (r === 13) { ctx.fillStyle = '#5d6a84'; ctx.fillRect(x + 4, y + 4, 3, 4); ctx.fillRect(x + 9, y + 4, 3, 4); }
          } else {
            ctx.fillStyle = '#39445c'; ctx.fillRect(x, y + (r === 13 ? 14 : 6), TILE, 1);
          }
        } else {
          ctx.fillStyle = '#2b3242'; ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#161a26'; ctx.fillRect(x, y + 8, TILE, 8);
          ctx.fillStyle = '#0f1219'; ctx.fillRect(x + 2, y + 10, 5, 5); ctx.fillRect(x + 9, y + 10, 5, 5);
        }
        if (grid[r][c - 1] !== 'T') { ctx.fillStyle = '#5d6880'; ctx.fillRect(x, y, 1, TILE); }
        if (grid[r][c + 1] !== 'T') { ctx.fillStyle = '#20263a'; ctx.fillRect(x + 15, y, 1, TILE); }
      } else if (ch === 'M') {
        // 지붕 위 기계 유닛 (에어컨) — 자체 오블리크 윗면/측면 포함
        for (let k = 1; k <= 2; k++) {
          const off = Math.round(OBX * k / OBY);
          ctx.fillStyle = '#8b96ae'; ctx.fillRect(x + off, y + 2 - k, TILE, 1);
        }
        for (let k = 1; k <= 3; k++) {
          const up = Math.round(OBY * k / OBX);
          ctx.fillStyle = '#1f2534'; ctx.fillRect(x + TILE - 1 + k, y + 2 - up, 1, 14);
        }
        ctx.fillStyle = '#5a6478'; ctx.fillRect(x, y + 2, TILE, 14);
        ctx.fillStyle = '#78829a'; ctx.fillRect(x, y + 2, TILE, 1);
        ctx.fillStyle = '#39404f';
        for (let i = 0; i < 3; i++) ctx.fillRect(x + 3, y + 6 + i * 3, 10, 1);
        ctx.fillStyle = '#2b303e'; ctx.fillRect(x, y + 14, TILE, 2);
      } else if (ch === '-') {
        // 외발 석판 발판 — 전면 립 (윗면은 패스 1의 오블리크 평행사변형)
        ctx.fillStyle = '#6d7694'; ctx.fillRect(x, y, TILE, 4);
        ctx.fillStyle = '#bcc4dc'; ctx.fillRect(x, y, TILE, 1);
        ctx.fillStyle = '#171b2a'; ctx.fillRect(x, y + 4, TILE, 1);
        ctx.fillStyle = '#2c3147'; ctx.fillRect(x + 7, y + 5, 2, 5);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x, y + 5, TILE, 3);
      } else if (ch === 'E') {
        // 회사 입구 (유리문)
        ctx.fillStyle = '#0f2233';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#4db8e8';
        ctx.fillRect(x + 2, y + 1, TILE - 4, TILE - 1);
        ctx.fillStyle = '#8adfff';
        ctx.fillRect(x + 3, y + 2, 3, TILE - 3);
        ctx.fillStyle = '#dfe6ee';
        ctx.fillRect(x + 1, y, TILE - 2, 1);
      }
    }
  }
  // 출구 간판
  if (exitSign) {
    const ex = exitSign.x - camX, ey = exitSign.y - camY;
    ctx.fillStyle = '#20304a';
    ctx.fillRect(ex - 2, ey - 12, 36, 10);
    otext(exitSign.label, (ex + 8) * zoom, (ey - 4) * zoom, 7 * zoom, '#ffd75e');
  }
}

// ---------------- 동적 오브젝트/NPC 렌더 ----------------
function drawDynamics() {
  const camX = Math.round(cam.x), camY = Math.round(cam.y);
  // 부서지는 발판
  for (const b of crumbles) {
    if (b.state === 2) continue;
    let x = b.c * TILE - camX, y = b.r * TILE - camY;
    if (b.state === 1) x += (Math.floor(tGlobal * 30) % 2) ? 1 : -1; // 흔들림
    obTopFace(x, y, b.c, 0);
    ctx.fillStyle = '#8a92ad'; ctx.fillRect(x, y, TILE, 6);
    ctx.fillStyle = '#e3c05a'; ctx.fillRect(x, y, TILE, 1);
    ctx.fillStyle = '#171b2a'; ctx.fillRect(x, y + 6, TILE, 1);
    // 금 간 무늬
    ctx.fillStyle = '#4a5170';
    ctx.fillRect(x + 4, y + 1, 1, 3); ctx.fillRect(x + 5, y + 3, 3, 1); ctx.fillRect(x + 10, y + 2, 1, 4);
  }
  // 개찰구
  for (const g of gates) {
    const x = g.c * TILE - camX, y = g.r1 * TILE - camY;
    const ph = gatePhase(g);
    const t = (stageT + g.offset) % g.period;
    const closingSoon = ph === 'open' && (g.open - t) < 0.35;
    // 양옆 스텐 몸체
    ctx.fillStyle = '#7c8496';
    ctx.fillRect(x - 6, y + 4, 6, 28); ctx.fillRect(x + 16, y + 4, 6, 28);
    ctx.fillStyle = '#99a1b3';
    ctx.fillRect(x - 6, y + 4, 6, 2); ctx.fillRect(x + 16, y + 4, 6, 2);
    ctx.fillStyle = '#565d6e';
    ctx.fillRect(x - 6, y + 30, 6, 2); ctx.fillRect(x + 16, y + 30, 6, 2);
    // 상태등
    ctx.fillStyle = ph === 'open'
      ? (closingSoon && Math.floor(tGlobal * 8) % 2 ? '#e8c76a' : '#5ad978')
      : '#e4485a';
    ctx.fillRect(x - 4, y + 7, 2, 2); ctx.fillRect(x + 18, y + 7, 2, 2);
    // 플랩
    ctx.fillStyle = '#e8933a';
    if (ph === 'open') {
      ctx.fillRect(x - 1, y + 12, 2, 12); ctx.fillRect(x + 15, y + 12, 2, 12);
    } else {
      ctx.fillRect(x + 1, y + 10, 7, 16); ctx.fillRect(x + 8, y + 10, 7, 16);
      ctx.fillStyle = '#b56a20'; ctx.fillRect(x + 7, y + 10, 2, 16);
    }
  }
  // 스크린도어
  for (const d of doors) {
    const x = d.c * TILE - camX, yT = d.r1 * TILE - camY;
    const hpx = (d.r2 - d.r1 + 1) * TILE;
    const ph = doorPhase(d);
    // 프레임
    ctx.fillStyle = '#8b93a8';
    ctx.fillRect(x - 3, yT, 3, hpx); ctx.fillRect(x + 16, yT, 3, hpx);
    ctx.fillStyle = '#aab2c6';
    ctx.fillRect(x - 3, yT, 1, hpx); ctx.fillRect(x + 16, yT, 1, hpx);
    // 상태 램프
    let lamp = '#5ad978';
    if (ph === 'warn') lamp = Math.floor(tGlobal * 6) % 2 ? '#e4485a' : '#6e2230';
    else if (ph !== 'open') lamp = '#e4485a';
    ctx.fillStyle = lamp;
    ctx.fillRect(x + 6, yT - 4, 4, 3);
    // 문짝 (좌우에서 중앙으로)
    const w = Math.round(8 * doorK(d));
    if (w > 0) {
      ctx.fillStyle = 'rgba(140,190,220,0.45)';
      ctx.fillRect(x, yT, w, hpx); ctx.fillRect(x + 16 - w, yT, w, hpx);
      ctx.fillStyle = '#cfe4f2';
      ctx.fillRect(x + w - 1, yT, 1, hpx); ctx.fillRect(x + 16 - w, yT, 1, hpx);
    }
  }
  // 보안 셔터 (열릴 때 위로 말려 올라가는 애니메이션)
  if (shutter) {
    const fullH = (shutter.r2 - shutter.r1 + 1) * TILE;
    let hpx = fullH;
    if (shutter.open) {
      const k = clamp((stageT - (shutter.openedAt || 0)) / 0.9, 0, 1);
      hpx = Math.round(fullH * (1 - k));
    }
    if (hpx > 0) {
      const x = shutter.c * TILE - camX, yT = shutter.r1 * TILE - camY;
      ctx.fillStyle = '#6e7688'; ctx.fillRect(x, yT, TILE, hpx);
      ctx.fillStyle = '#565d6e';
      for (let yy = 3; yy < hpx - 1; yy += 5) ctx.fillRect(x, yT + yy, TILE, 2);
      ctx.fillStyle = shutter.open ? '#5ad978' : '#e4485a';
      ctx.fillRect(x + 6, yT - 4, 4, 3);
    }
  }
  // 카드 태그 리더
  if (switchDef) {
    const x = switchDef.x - camX, y = switchDef.y - camY;
    ctx.fillStyle = '#39404f'; ctx.fillRect(x - 2, y - 14, 4, 14);
    ctx.fillStyle = switchDef.done ? '#5ad978' : (Math.floor(tGlobal * 3) % 2 ? '#e8c76a' : '#8b93a8');
    ctx.fillRect(x - 3, y - 18, 6, 5);
    ctx.fillStyle = '#dfe5ee'; ctx.fillRect(x - 2, y - 17, 4, 1);
  }
  // 체크포인트 깃발
  for (const cp of checkpoints) {
    const x = cp.x - camX, y = cp.y - camY;
    ctx.fillStyle = '#565d6e'; ctx.fillRect(x, y - 14, 2, 14);
    ctx.fillStyle = spawnPt.x === cp.x ? '#5ad978' : '#39404f';
    ctx.fillRect(x + 2, y - 14, 7, 5);
  }
  // NPC
  for (const n of npcs) {
    const x = Math.round(n.x - camX), y = Math.round(n.y - camY);
    const st = Math.floor(tGlobal * 5) % 2; // 2프레임 걸음
    if (n.type === 'granny') {
      // 전단지 할머님 (몸집 작고 허리 굽음)
      ctx.fillStyle = '#3e3548';
      ctx.fillRect(x - 4, y - 14, 9, 10);                       // 몸빼 원피스
      ctx.fillStyle = '#2e2736';
      ctx.fillRect(x - 4 + (st ? 1 : 0), y - 4, 3, 4); ctx.fillRect(x + 2 - (st ? 1 : 0), y - 4, 3, 4);
      ctx.fillStyle = '#efb789'; ctx.fillRect(x - 2, y - 20, 6, 6); // 얼굴
      ctx.fillStyle = '#8d94a8'; ctx.fillRect(x - 3, y - 21, 8, 2); // 흰머리
      ctx.fillStyle = '#7a4a8a'; ctx.fillRect(x - 4, y - 22, 10, 2); // 챙 넓은 모자
      // 전단지 뭉치
      ctx.fillStyle = '#dfe5ee'; ctx.fillRect(x + 5, y - 12, 5, 4);
      ctx.fillStyle = '#8b93a8'; ctx.fillRect(x + 5, y - 10, 5, 1);
    } else if (n.type === 'coffee') {
      // 커피 든 행인
      ctx.fillStyle = '#31435c';
      ctx.fillRect(x - 3, y - 22, 7, 12);                        // 정장
      ctx.fillStyle = '#232f42';
      ctx.fillRect(x - 3 + (st ? 1 : 0), y - 10, 3, 10); ctx.fillRect(x + 1 - (st ? 1 : 0), y - 10, 3, 10);
      ctx.fillStyle = '#efb789'; ctx.fillRect(x - 2, y - 28, 6, 6);
      ctx.fillStyle = '#2a1e13'; ctx.fillRect(x - 2, y - 29, 6, 2);
      // 커피잔 (부딪히면 쏟음)
      if (n.t > 1.2) {
        ctx.fillStyle = '#8a5a2e'; // 쏟아진 커피
        ctx.fillRect(x + 5, y - 18, 2, 2); ctx.fillRect(x + 7, y - 15, 2, 2); ctx.fillRect(x + 4, y - 13, 2, 2);
      } else {
        ctx.fillStyle = '#f0f0f0'; ctx.fillRect(x + 4, y - 17, 4, 5);
        ctx.fillStyle = '#8a5a2e'; ctx.fillRect(x + 4, y - 17, 4, 1);
      }
    }
  }
  // 경직 중 말풍선
  if (p.stunT > 0) {
    const x = Math.round(p.x - camX), y = Math.round(p.y - p.h - camY);
    otext('앗, 죄송…!', (x - 14) * zoom, (y - 8) * zoom, 6 * zoom, '#e8c76a');
  }
  if (p.slowT > 0) {
    const x = Math.round(p.x - camX), y = Math.round(p.y - p.h - camY);
    otext('전단지 좀…', (x - 14) * zoom, (y - 8) * zoom, 6 * zoom, '#c8a8e0');
  }
}

function drawHints() {
  for (const h of hints) {
    const x = Math.round(h.x - cam.x), y = Math.round(h.y - cam.y);
    if (x < -250 || x > ZW + 40) continue;
    const w = otextW(h.t, 7);
    ctx.fillStyle = '#00000088';
    ctx.fillRect(x - 3, y - 8, w + 6, 11);
    otext(h.t, x * zoom, y * zoom, 7 * zoom, '#a8b2d8');
  }
}

// ---------------- HUD ----------------
const FONT3 = {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7],
  '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7],
  '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7],
  '9': [7, 5, 7, 1, 7], ':': [0, 2, 0, 2, 0]
};
function drawDots(str, x, y, s, col) {
  ctx.fillStyle = col;
  let cx = x;
  for (const ch of str) {
    const gl = FONT3[ch];
    if (gl) {
      for (let r = 0; r < 5; r++)
        for (let b = 0; b < 3; b++)
          if (gl[r] & (4 >> b)) ctx.fillRect(cx + b * s, y + r * s, s, s);
    }
    cx += 4 * s;
  }
  return cx;
}
function drawHeart(x, y, on) {
  ctx.fillStyle = on ? '#e4485a' : '#3a2530';
  ctx.fillRect(x, y, 3, 2); ctx.fillRect(x + 4, y, 3, 2);
  ctx.fillRect(x, y + 1, 7, 3);
  ctx.fillRect(x + 1, y + 4, 5, 1);
  ctx.fillRect(x + 2, y + 5, 3, 1);
  ctx.fillRect(x + 3, y + 6, 1, 1);
  if (on) { ctx.fillStyle = '#ff9aa8'; ctx.fillRect(x + 1, y + 1, 1, 1); }
}

function drawHUD() {
  ctx.fillStyle = '#00000090';
  ctx.fillRect(0, 0, VW, 20);
  // 지각 게이지 (0~100%)
  otext('지각', 5, 13, 7, '#8b93b8');
  const gx = 24, gy = 7, gw = 54, gh = 7;
  ctx.fillStyle = '#12141d'; ctx.fillRect(gx - 1, gy - 1, gw + 2, gh + 2);
  ctx.fillStyle = '#39404f'; ctx.fillRect(gx, gy, gw, gh);
  const fw = Math.round(gw * lateG / 100);
  let gcol = '#5ad978';
  if (lateG >= 80) gcol = (Math.floor(tGlobal * 4) % 2) ? '#ff5252' : '#a33';
  else if (lateG >= 50) gcol = '#e8c76a';
  if (fw > 0) {
    ctx.fillStyle = gcol; ctx.fillRect(gx, gy, fw, gh);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(gx, gy, fw, 1);
  }
  // 타이머
  const t = Math.max(0, timer);
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(Math.floor(t % 60)).padStart(2, '0');
  const warn = t < 30 && (Math.floor(tGlobal * 3) % 2 === 0);
  otext('09:00 마감까지', 96, 13, 7, '#8b93b8');
  drawDots(mm + ':' + ss, 164, 5, 2, warn ? '#ff5252' : '#ffd75e');
  // 스테이지 라벨
  otext(STAGES[stageIdx].name, 314, 13, 7, '#8b93b8', 'right');
}

// ---------------- 화면(씬) ----------------
function drawTitle() {
  ctx.fillStyle = '#101321';
  ctx.fillRect(0, 0, VW, VH);
  // 바닥 (오블리크: 윗면 평행사변형 + 전면 블록)
  ctx.fillStyle = '#181c2e';
  ctx.fillRect(0, 150, VW, 30);
  ctx.fillStyle = '#3b425a'; ctx.fillRect(0, 150, VW, 14);
  ctx.fillStyle = '#252a3e';
  for (let x = 0; x < VW; x += 32) ctx.fillRect(x, 150, 1, 14);
  ctx.fillRect(0, 163, VW, 1);
  for (let k = 1; k <= OBY; k++) {
    const off = Math.round(OBX * k / OBY);
    ctx.fillStyle = k === OBY ? '#7e86a3' : '#a6aec9';
    ctx.fillRect(0, 150 - k, VW, 1);
    ctx.fillStyle = '#6a7292';
    for (let x = -32; x < VW; x += 32) ctx.fillRect(x + off, 150 - k, 1, 1);
  }
  ctx.fillStyle = '#bcc4dc'; ctx.fillRect(0, 150, VW, 1);

  otext('출근길의 왕자', VW / 2, 42, 22, '#ffd75e', 'center', true);
  otext('PRINCE  OF  COMMUTE', VW / 2, 57, 8, '#5b6488', 'center');
  otext('— 캐릭터/조작 프로토타입 —', VW / 2, 72, 8, '#8b93b8', 'center');

  const blink = Math.floor(tGlobal * 2) % 2 === 0;
  if (blink) otext('SPACE — 출근 시작 (STAGE 1 지하철 승강장)', VW / 2, 96, 10, '#e9f4ff', 'center');
  otext('T — 연습 구간 · ← → 이동 · SPACE 점프/매달리기 · ↓ 슬라이딩 · R 재시작', VW / 2, 112, 7, '#5b6488', 'center');

  // 달리는 주인공 시연
  drawFigure(VW / 2, 150, 1, poseRun(tGlobal * 1.6));
}

function drawOverlay(title, sub, color, prompt) {
  // 텍스트 캔버스에 어둠을 깔아 장면 + 월드 텍스트를 함께 어둡게
  tctx.fillStyle = 'rgba(0,0,0,0.72)';
  tctx.fillRect(0, 0, tcv.width, tcv.height);
  otext(title, VW / 2, 76, 20, color, 'center', true);
  otext(sub, VW / 2, 98, 8, '#c3cae6', 'center');
  if (Math.floor(tGlobal * 2) % 2 === 0) {
    otext(prompt || 'SPACE — 다시 출근하기', VW / 2, 120, 8, '#8b93b8', 'center');
  }
}

// ---------------- 메인 루프 ----------------
function render() {
  tctx.clearRect(0, 0, tcv.width, tcv.height);
  fgx.setTransform(1, 0, 0, 1, 0, 0);
  fgx.clearRect(0, 0, fgc.width, fgc.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (scene === 'title') { drawTitle(); return; }

  // 카메라 (줌 반영 유효 뷰포트 + 도입부엔 전방을 먼저 보여줌)
  ZW = VW / zoom; ZH = VH / zoom;
  const ahead = introT > 0 ? 60 * Math.min(1, introT / 2.4) : 0;
  // 스위치 작동 시 결과물(셔터) 쪽을 잠깐 비춤
  const focX = camFocus ? camFocus.x : p.x + ahead;
  const focY = camFocus ? camFocus.y : p.y;
  const tx = clamp(focX - ZW / 2, 0, Math.max(0, LW * TILE - ZW));
  cam.x = lerp(cam.x, tx, camFocus ? 0.1 : 0.15);
  if (Math.abs(cam.x - tx) < 0.5) cam.x = tx;
  const ty = clamp(focY - ZH * 0.62, 0, Math.max(0, LH * TILE - ZH));
  cam.y = lerp(cam.y, ty, 0.12);
  if (Math.abs(cam.y - ty) < 0.5) cam.y = ty;
  if (shake > 0) cam.x += (Math.random() - 0.5) * 4;

  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
  drawBackground();
  drawHints();
  drawTiles();
  drawDynamics();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  fgx.setTransform(zoom, 0, 0, zoom, 0, 0);
  drawPlayer();
  fgx.setTransform(1, 0, 0, 1, 0, 0);
  drawHUD();
  // 도입부 레터박스 (시네마틱 와이드 샷)
  if (introT > 0) {
    const bh = Math.round(14 * Math.min(1, introT / 0.7)) * TS;
    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, tcv.width, bh);
    tctx.fillRect(0, tcv.height - bh, tcv.width, bh);
  }

  if (scene === 'clear') {
    const next = stageIdx + 1 < STAGES.length ? STAGES[stageIdx + 1] : null;
    drawOverlay(
      stageIdx === 0 ? '연습 구간 통과!' : '지하철 탈출 성공!',
      next ? ('점수 ' + score + ' · 다음: ' + next.name)
           : ('총점 ' + score + ' · STAGE 2: 환승 통로 — 제작 예정!'),
      '#7fd49b',
      next ? 'SPACE — 다음 스테이지로' : 'SPACE — 타이틀로');
  } else if (scene === 'late') {
    drawOverlay('지각입니다...', goMsg, '#ff5252', 'SPACE — 다시 출근하기');
  }
}

let last = 0, acc = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (!last) { last = ts; return; }
  let dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  tGlobal += dt;
  acc += dt;
  const FIXED = 1 / 60;
  while (acc >= FIXED) { step(FIXED); acc -= FIXED; }
  render();
}
requestAnimationFrame(loop);

// 디버그 훅 (개발 검증용)
window.__game = {
  p, cam, Input, restartAll, loadStage, step, render, drawFigure,
  gatePhase, doorPhase,
  poses: { poseRun, poseIdle, poseAir, poseHang, poseSlide, poseClimbK, poseDead },
  get scene() { return scene; }, set scene(v) { scene = v; },
  get timer() { return timer; },
  get lateG() { return lateG; },
  get stageT() { return stageT; },
  get stageIdx() { return stageIdx; },
  get gates() { return gates; },
  get doors() { return doors; },
  get crumbles() { return crumbles; },
  get npcs() { return npcs; },
  get shutter() { return shutter; },
  get spawnPt() { return spawnPt; },
  tick(dt, n) {
    n = n || 1;
    for (let i = 0; i < n; i++) { tGlobal += dt; step(dt); }
    render();
  }
};
