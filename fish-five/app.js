'use strict';

// ===== 1. 자주 수정하는 설정 =====
// 시간은 밀리초(ms): 1000 = 1초. 영상은 나중에 assets 폴더에 넣고 경로를 적으세요.
const CONFIG = {
  videoSrc: '',                    // 예: 'assets/fish-swim.mp4'. 비워두면 기다림 화면 유지
  requiredTaps: 3,                  // 수도꼭지를 돌려야 하는 횟수
  rotationStepMs: 850,              // 방사형 배경이 60도씩 돌아가는 간격
  fillPauseMs: 650,                 // 물방울을 채운 뒤 잠시 기다리는 시간
  levelTolerance: 12,               // 수평 허용 오차(도). 클수록 성공하기 쉬움
  levelHoldMs: 900,                 // 다음 화면으로 넘어가기까지 수평을 유지할 시간
  fishId: 'fish05',                 // 향후 전시 서버에 연결할 때 사용할 물고기 이름
};

// 각 프레임의 재생 시간. 제공된 GIF/APNG의 시간을 그대로 사용합니다.
const FRAME_TIMES = {
  tap: [140, 140, 140, 140, 140, 140, 140, 140],
  hose: [220, 220, 220, 220, 220, 220, 220, 220, 220],
};

// ===== 2. 공통 기능과 현재 진행 상태 =====
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let scene = 'intro';
let count = 0;
let busy = false;
let run = 0;                      // 다시 시작하면 이전 애니메이션을 무효화
let motionEnabled = false;
let lastSensor = 0;
let levelSince = null;
let sensorTimer;

// 프레임 이미지를 먼저 불러와 애니메이션 중 깜빡임을 줄입니다.
const imageLoads = [];
for (const [kind, times] of Object.entries(FRAME_TIMES)) {
  times.forEach((_, index) => {
    const image = new Image();
    image.src = `assets/${kind}-${index}.png`;
    imageLoads.push(image.decode().catch(() => {}));
  });
}
const assetsReady = Promise.all(imageLoads);

function show(name) {
  scene = name;
  for (const id of ['intro', 'water', 'reveal', 'ocean']) {
    $(id).hidden = id !== name;
  }
  $('stage').dataset.scene = name;
}

function announce(text) {
  $('live').textContent = text;
}

// ===== 3. 시작 화면 =====
function start() {
  if (scene !== 'intro') return;
  show('water');
  announce(`수도꼭지를 ${CONFIG.requiredTaps}번 돌려주세요.`);
}
$('start').onclick = start;
$('intro').onclick = start;

// ===== 4. 수도꼭지 → 호스 → 물방울 채우기 =====
async function playFrames(kind, token) {
  for (let index = 0; index < FRAME_TIMES[kind].length; index++) {
    if (token !== run) return false;
    $(kind).src = `assets/${kind}-${index}.png`;
    await sleep(FRAME_TIMES[kind][index]);
  }
  if (token !== run) return false;
  $(kind).src = `assets/${kind}-0.png`;
  return true;
}

$('tapButton').onclick = async () => {
  // 재생 중에는 추가 터치를 무시합니다.
  if (busy || scene !== 'water' || count >= CONFIG.requiredTaps) return;
  busy = true;
  $('tapButton').disabled = true;
  const token = run;
  await assetsReady;
  if (!(await playFrames('tap', token))) return;
  if (!(await playFrames('hose', token))) return;

  count++;
  $('fill').setAttribute('y', String(110 - (count / CONFIG.requiredTaps) * 105));
  $('count').textContent = `물방울 ${count}/${CONFIG.requiredTaps} 채움`;
  await sleep(CONFIG.fillPauseMs);
  if (token !== run) return;
  busy = false;
  if (count === CONFIG.requiredTaps) reveal();
  else $('tapButton').disabled = false;
};

// ===== 5. 물고기 등장 → 배경 360도 회전 → 수평 안내 =====
async function reveal() {
  show('reveal');
  const token = run;
  $('message').src = 'assets/awake.png';
  $('message').className = 'art awake';
  $('message').alt = '물고기의 몸에 물이 닿자, 물고기가 깨어났어요!';
  $('rays').style.transform = 'translate(-50%,-50%) rotate(0deg)';

  for (let step = 1; step <= 6; step++) {
    await sleep(CONFIG.rotationStepMs);
    if (token !== run) return;
    $('rays').style.transform = `translate(-50%,-50%) rotate(${step * 60}deg)`;
  }
  await sleep(550);                // CSS 배경 회전 효과가 끝나기를 기다림
  if (token !== run) return;
  $('message').src = 'assets/level.png';
  $('message').className = 'art level';
  $('message').alt = '물고기가 헤엄칠 수 있도록 핸드폰을 수평으로 유지해주세요';
  $('sensorPanel').hidden = false;
  levelSince = null;
  announce('핸드폰을 수평으로 유지해주세요.');

  if (motionEnabled) {
    $('enableMotion').hidden = true;
    armSensorTimeout();
  }
  if (!('DeviceOrientationEvent' in window) || !matchMedia('(pointer:coarse)').matches) {
    $('simulate').hidden = false;
    $('sensorNote').textContent = 'PC에서는 아래 버튼으로 다음 화면을 확인할 수 있어요.';
  }
}

// ===== 6. 휴대폰 센서 권한과 수평 감지 =====
function armSensorTimeout() {
  clearTimeout(sensorTimer);
  sensorTimer = setTimeout(() => {
    if (scene === 'reveal' && Date.now() - lastSensor > 2500) {
      $('sensorNote').textContent = '기울기 신호가 없어요. 권한을 확인하거나 미리보기로 진행해주세요.';
      $('simulate').hidden = false;
    }
  }, 3500);
}

// 아이폰의 센서 권한은 사용자 버튼 클릭 안에서 요청해야 합니다.
$('enableMotion').onclick = async () => {
  try {
    const orientation = window.DeviceOrientationEvent;
    if (!orientation) throw new Error('unsupported');
    if (typeof orientation.requestPermission === 'function') {
      const result = await orientation.requestPermission();
      if (result !== 'granted') throw new Error('denied');
    }
    motionEnabled = true;
    $('enableMotion').hidden = true;
    $('sensorNote').textContent = '화면이 위를 향하도록 휴대폰을 평평하게 들어주세요.';
    armSensorTimeout();
  } catch (error) {
    $('sensorNote').textContent = '기울기 권한을 사용할 수 없어요. 브라우저 설정에서 허용하거나 미리보기로 진행해주세요.';
    $('simulate').hidden = false;
  }
};

window.addEventListener('deviceorientation', (event) => {
  if (!motionEnabled || event.beta == null || event.gamma == null) return;
  lastSensor = Date.now();
  const flat = Math.abs(event.beta) < CONFIG.levelTolerance
    && Math.abs(event.gamma) < CONFIG.levelTolerance;

  if (scene === 'reveal' && !$('sensorPanel').hidden) {
    if (flat) {
      levelSince ??= performance.now();
      if (performance.now() - levelSince >= CONFIG.levelHoldMs) ocean();
    } else {
      levelSince = null;
    }
  }
  if (scene === 'ocean') {
    $('balanceHint').hidden = flat;
    if (CONFIG.videoSrc) {
      if (flat) $('fishVideo').play().catch(() => {});
      else $('fishVideo').pause();
    }
  }
});

// ===== 7. 기다림 화면 — 마지막 영상은 현재 비어 있습니다 =====
function ocean() {
  show('ocean');
  clearTimeout(sensorTimer);
  $('balanceHint').hidden = true;
  if (CONFIG.videoSrc) {
    $('fishVideo').src = CONFIG.videoSrc;
    $('fishVideo').hidden = false;
    $('fishVideo').play().catch(() => {});
  }
  announce('물고기가 헤엄칠 수 있도록 우리 잠시 기다려보자.');

  // 브라우저 내부 이벤트입니다. 아직 Render/TouchDesigner로 전송하지 않습니다.
  window.dispatchEvent(new CustomEvent('fish:waiting', {
    detail: { fish: CONFIG.fishId },
  }));
}
$('simulate').onclick = ocean;

// 기포의 [왼쪽 위치 %, 위쪽 위치 %, 너비 %]
const bubbles = [
  [7, 20, 9], [15, 23, 18], [78, 45, 9], [64, 52, 19],
  [65, 56, 31], [21, 80, 9], [9, 87, 15],
];
for (const [index, [left, top, width]] of bubbles.entries()) {
  const image = document.createElement('img');
  image.src = 'assets/bubble.svg';
  image.className = 'bubble';
  image.style.cssText = `left:${left}%;top:${top}%;width:${width}%;animation-delay:-${index * 0.7}s`;
  image.alt = '';
  $('bubbles').append(image);
}

// ===== 8. 처음으로 돌아가기 =====
$('restart').onclick = () => {
  run++;
  count = 0;
  busy = false;
  levelSince = null;
  clearTimeout(sensorTimer);
  $('tapButton').disabled = false;
  $('tap').src = 'assets/tap-0.png';
  $('hose').src = 'assets/hose-0.png';
  $('fill').setAttribute('y', '110');
  $('count').textContent = `물을 ${CONFIG.requiredTaps}번 주세요`;
  $('sensorPanel').hidden = true;
  $('simulate').hidden = true;
  $('sensorNote').textContent = '';
  $('enableMotion').hidden = motionEnabled;
  $('fishVideo').pause();
  show('intro');
};

show('intro');
