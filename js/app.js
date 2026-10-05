/**
 * app.js
 * 포즈코치 메인 오케스트레이션
 */

const $ = (id) => document.getElementById(id);

const store = new Store();
const analyzer = new SquatAnalyzer();
let engineSide = null;
let engineFront = null;
let sessionStart = null;
let setStartTime = null;
let running = false;
let workoutSets = [];   // 이번 운동의 저장된 세트들
let currentMode = 'dual'; // 'single-side' | 'single-front' | 'dual'

const PHASE_KO = { ready: '대기', down: '하강 중', up: '상승 중' };

/* ---------- 카메라 목록 ---------- */
async function initCameras() {
  const cams = await PoseEngine.listCameras();
  const s1 = $('cam1-device'), s2 = $('cam2-device');
  s1.innerHTML = ''; s2.innerHTML = '';
  // 카메라 2는 선택사항: '사용 안 함'을 두면 단일 카메라 모드
  s2.add(new Option('사용 안 함 (단일 카메라 모드)', ''));
  if (!cams.length) {
    s1.innerHTML = '<option value="">카메라 없음</option>';
    return;
  }
  cams.forEach((c, i) => {
    const label = c.label || `카메라 ${i + 1}`;
    s1.add(new Option(label, c.deviceId));
    s2.add(new Option(label, c.deviceId));
  });
  // 2개 이상이면 서로 다른 카메라를 기본 선택, 1개면 단일 모드 기본
  if (cams.length > 1) s2.selectedIndex = 1;
  else s2.selectedIndex = 0;
}

/* ---------- 측정 시작 ---------- */
async function start() {
  const dev1 = $('cam1-device').value;
  const dev2 = $('cam2-device').value;
  const role1 = $('cam1-role').value;
  const role2 = $('cam2-role').value;
  const res = ($('resolution').value || '640x480').split('x');
  const resOpts = { width: parseInt(res[0], 10), height: parseInt(res[1], 10) };

  if (!dev1 && !dev2) {
    alert('사용 가능한 카메라가 없습니다.');
    return;
  }

  $('btn-start').disabled = true;
  $('btn-stop').disabled = false;
  $('setup-panel').classList.add('hidden');
  $('stage').classList.remove('hidden');

  analyzer.reset();
  sessionStart = Date.now();
  setStartTime = sessionStart;
  running = true;
  workoutSets = [];
  $('rep-log').innerHTML = '';
  renderSetList();

  const videosEl = document.querySelector('.videos');
  const boxes = document.querySelectorAll('.video-box');
  videosEl.classList.remove('single');
  boxes.forEach((b) => b.classList.remove('off'));

  // 카메라 2가 '사용 안 함'이거나 카메라 1과 같으면 단일 카메라 모드
  const single = !dev2 || dev2 === dev1;

  try {
    if (single) {
      // ---- 단일 카메라: 방향(role1)에 맞는 분석 자동 선택 ----
      videosEl.classList.add('single');
      $('stage').classList.add('single-layout');
      $('cam-controls').style.display = '';
      boxes[1].classList.add('off');
      const label = `${labelOf(dev1)} (단독)`;

      if (role1 === 'side') {
        // 측면 단독: 각도 측정 + rep 카운트 + 채점
        currentMode = 'single-side';
        setStatLabels('side');
        boxes[0].querySelector('.video-label').textContent = `측면 카메라 — ${label}`;
        engineSide = new PoseEngine($('video-side'), $('canvas-side'), (lm) => {
          if (!running) return;
          renderSide(analyzer.analyzeSide(lm));
        });
        await engineSide.start(dev1, resOpts);
        await setupZoom(engineSide);
      } else {
        // 정면 단독: 대칭 체크 + 엉덩이 이동 기반 rep 카운트 (간이 채점)
        currentMode = 'single-front';
        setStatLabels('front');
        boxes[0].querySelector('.video-label').textContent = `정면 카메라 — ${label}`;
        engineFront = new PoseEngine($('video-side'), $('canvas-side'), (lm) => {
          if (!running) return;
          renderFront(analyzer.analyzeFrontSolo(lm));
        });
        await engineFront.start(dev1, resOpts);
        await setupZoom(engineFront);
      }
    } else {
      // ---- 듀얼 카메라 (기존 동작) ----
      currentMode = 'dual';
      $('stage').classList.remove('single-layout');
      $('cam-controls').style.display = 'none';
      // 역할에 따라 엔진 배정 (같은 카메를 두 역할에 쓰지 않도록)
      const assignments = [];
      if (dev1) assignments.push({ deviceId: dev1, role: role1 });
      if (dev2 && dev2 !== dev1) assignments.push({ deviceId: dev2, role: role2 });

      const sideAsg = assignments.find((a) => a.role === 'side') || assignments[0];
      const frontAsg = assignments.find((a) => a.role === 'front' && a !== sideAsg) || null;

      setStatLabels('side');
      engineSide = new PoseEngine($('video-side'), $('canvas-side'), (lm) => {
        if (!running) return;
        const r = analyzer.analyzeSide(lm);
        renderSide(r);
      });
      await engineSide.start(sideAsg.deviceId, resOpts);
      document.querySelectorAll('.video-box')[0].querySelector('.video-label').textContent =
        `측면 카메라 (${labelOf(sideAsg.deviceId)})`;

      if (frontAsg) {
        engineFront = new PoseEngine($('video-front'), $('canvas-front'), (lm) => {
          if (!running || !lm) return;
          const fb = analyzer.analyzeFront(lm);
          if (fb.length) renderExtraFeedback(fb);
        });
        await engineFront.start(frontAsg.deviceId, resOpts);
        document.querySelectorAll('.video-box')[1].querySelector('.video-label').textContent =
          `정면 카메라 (${labelOf(frontAsg.deviceId)})`;
      } else {
        document.querySelectorAll('.video-box')[1].querySelector('.video-label').textContent =
          '정면 카메라 (미사용)';
      }
    }
  } catch (e) {
    console.error(e);
    alert('카메라 시작 실패: ' + e.message);
    stop(true);
  }
}

/** 줌 슬라이더 초기화 (하드웨어 지원 시에만 활성화) */
async function setupZoom(engine) {
  const zr = $('zoom-range'), zv = $('zoom-val'), zn = $('zoom-note');
  zr.disabled = true; zr.value = 1; zv.textContent = '-'; zn.textContent = '';
  zr.oninput = null;
  let caps = null;
  try { caps = engine.getZoomRange(); } catch (e) { /* 무시 */ }
  if (!caps) {
    zn.textContent = '이 카메라는 하드웨어 줌을 지원하지 않아요. 전신이 안 나오면 카메라를 2~3m 뒤로 옮기거나 해상도를 1280×720으로 바꿔보세요.';
    return;
  }
  zr.min = caps.min; zr.max = caps.max; zr.step = caps.step || 0.1; zr.value = caps.min;
  zr.disabled = false;
  zv.textContent = Number(caps.min).toFixed(1) + 'x';
  if (caps.min >= 1) {
    zn.textContent = '이 카메라의 줌은 확대(줌인)만 돼요. 화면을 넓히려면(줌아웃) 카메라를 뒤로 옮겨주세요.';
  }
  zr.oninput = async () => {
    const v = parseFloat(zr.value);
    zv.textContent = v.toFixed(1) + 'x';
    try { await engine.setZoom(v); }
    catch (e) { zn.textContent = '줌 조절에 실패했어요.'; }
  };
}

/** 화면 맞춤 모드 전환 (cover=꽉 채움, contain=전체 보기) */
function setFitMode(mode) {
  $('fit-cover').classList.toggle('on', mode === 'cover');
  $('fit-contain').classList.toggle('on', mode === 'contain');
  document.querySelectorAll('#stage .video-box video, #stage .video-box canvas')
    .forEach((el) => { el.style.objectFit = mode; });
}

/** 모드에 따라 실시간 측정 라벨 전환 */
function setStatLabels(mode) {
  if (mode === 'front') {
    $('lbl-knee').textContent = '하강 깊이';
    $('lbl-hip').textContent = '좌우 대칭';
    $('lbl-back').textContent = '채점 방식';
    $('stat-back').textContent = '간이';
  } else {
    $('lbl-knee').textContent = '무릎 각도';
    $('lbl-hip').textContent = '엉덩이 각도';
    $('lbl-back').textContent = '상체 기울기';
    $('stat-back').textContent = '-';
  }
}

function labelOf(deviceId) {
  for (const id of ['cam1-device', 'cam2-device']) {
    const sel = $(id);
    const opt = [...sel.options].find((o) => o.value === deviceId);
    if (opt) return opt.text;
  }
  return '카메라';
}

/* ---------- 세트 저장 ---------- */
function saveSet(auto = false) {
  if (analyzer.reps === 0) {
    if (!auto) {
      const ul = $('feedback-list');
      const li = document.createElement('li');
      li.textContent = '아직 완료된 횟수가 없어요. 운동을 한 뒤 저장해 주세요.';
      li.className = 'idle';
      ul.prepend(li);
      while (ul.children.length > 6) ul.removeChild(ul.lastChild);
    }
    return;
  }
  const now = Date.now();
  const set = {
    setNo: workoutSets.length + 1,
    reps: analyzer.reps,
    scores: [...analyzer.scores],
    avgScore: analyzer.avgScore(),
    durationSec: setStartTime ? Math.round((now - setStartTime) / 1000) : 0,
    savedAt: new Date().toISOString()
  };
  workoutSets.push(set);
  analyzer.resetSet(); // 다음 세트 준비 (정면 베이스라인은 유지)
  setStartTime = now;
  renderSetList();
  $('stat-reps').textContent = '0';
  $('stat-score').textContent = '-';
  $('rep-log').innerHTML = '';
  if (!auto) speak(`${set.setNo}세트 저장`);
}

/* ---------- 세트 기록 렌더링 ---------- */
function renderSetList() {
  const ul = $('set-list');
  ul.innerHTML = '';
  if (!workoutSets.length) {
    ul.innerHTML = '<li class="idle">아직 저장된 세트가 없습니다. 한 세트를 마치면 ‘세트 저장’을 눌러주세요.</li>';
    return;
  }
  workoutSets.forEach((s) => {
    const li = document.createElement('li');
    li.textContent = `세트 ${s.setNo} · ${s.reps}회 · 평균 ${s.avgScore}점`;
    li.className = s.avgScore >= 80 ? 'ok' : 'warn';
    ul.appendChild(li);
  });
}

/* ---------- 측정 종료 ---------- */
async function stop(silent) {
  running = false;
  if (engineSide) { engineSide.stop(); engineSide = null; }
  if (engineFront) { engineFront.stop(); engineFront = null; }

  if (!silent) {
    // 저장하지 않은 진행 중 세트가 있으면 마지막 세트로 자동 포함
    if (analyzer.reps > 0) saveSet(true);
    if (workoutSets.length > 0) {
      const totalReps = workoutSets.reduce((s, x) => s + x.reps, 0);
      const allScores = workoutSets.flatMap((x) => x.scores);
      const workout = {
        date: new Date().toISOString(),
        exercise: 'squat',
        mode: currentMode,
        sets: workoutSets,
        totalReps,
        avgScore: allScores.length
          ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
          : null,
        durationSec: Math.round((Date.now() - sessionStart) / 1000)
      };
      await store.saveSession(workout);
      renderHistory();
    }
  }

  workoutSets = [];
  setStartTime = null;
  renderSetList();
  $('btn-start').disabled = false;
  $('btn-stop').disabled = true;
  $('setup-panel').classList.remove('hidden');
  $('stage').classList.add('hidden');
  $('stage').classList.remove('single-layout');
  $('cam-controls').style.display = 'none';
  setFitMode('cover');
}

/* ---------- UI 렌더링 ---------- */
function renderSide(r) {
  if (r.angles) {
    $('stat-knee').textContent = r.angles.knee + '°';
    $('stat-hip').textContent = r.angles.hip !== null ? r.angles.hip + '°' : '-';
    $('stat-back').textContent = r.angles.back + '°';
  }
  $('stat-phase').textContent = PHASE_KO[r.phase] || r.phase;
  $('stat-reps').textContent = analyzer.reps;
  const avg = analyzer.avgScore();
  $('stat-score').textContent = avg === null ? '-' : avg + '점';

  const ul = $('feedback-list');
  ul.innerHTML = '';
  r.feedback.forEach((msg) => {
    const li = document.createElement('li');
    li.textContent = msg;
    li.className = msg.startsWith('⚠️') ? 'warn' : 'ok';
    ul.appendChild(li);
  });

  if (r.repDone) {
    const li = document.createElement('li');
    const d = r.repDone;
    li.textContent = `#${d.rep} 완료 — ${d.score}점 (최저 무릎 ${d.minKnee}°${d.notes.length ? ', ' + d.notes.join(', ') : ''})`;
    li.className = d.score >= 80 ? 'ok' : 'warn';
    $('rep-log').prepend(li);
    // rep 카운트 음성 피드백 (선택)
    speak(`${d.rep}회`);
  }
}

let lastFrontWarn = 0;
function renderExtraFeedback(msgs) {
  const now = Date.now();
  if (now - lastFrontWarn < 4000) return; // 4초 쿨다운
  lastFrontWarn = now;
  const ul = $('feedback-list');
  msgs.forEach((msg) => {
    const li = document.createElement('li');
    li.textContent = msg;
    li.className = 'warn';
    ul.prepend(li);
  });
  while (ul.children.length > 6) ul.removeChild(ul.lastChild);
}

/** 정면 단독 모드 렌더링 */
function renderFront(r) {
  $('stat-knee').textContent = (r.depth === null || r.depth === undefined) ? '-' : r.depth + '%';
  $('stat-hip').textContent = r.symOk ? 'OK' : '⚠️';
  $('stat-phase').textContent = PHASE_KO[r.phase] || r.phase;
  $('stat-reps').textContent = analyzer.reps;
  const avg = analyzer.avgScore();
  $('stat-score').textContent = avg === null ? '-' : avg + '점';

  const ul = $('feedback-list');
  ul.innerHTML = '';
  r.feedback.forEach((msg) => {
    const li = document.createElement('li');
    li.textContent = msg;
    li.className = msg.startsWith('⚠️') ? 'warn' : 'ok';
    ul.appendChild(li);
  });

  if (r.repDone) {
    const li = document.createElement('li');
    const d = r.repDone;
    li.textContent = `#${d.rep} 완료 — ${d.score}점 (정면 간이 채점${d.notes.length ? ': ' + d.notes.join(', ') : ''})`;
    li.className = d.score >= 80 ? 'ok' : 'warn';
    $('rep-log').prepend(li);
    speak(`${d.rep}회`);
  }
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 1.1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* 무시 */ }
}

async function renderHistory() {
  const list = await store.getSessions(10);
  const ul = $('history-list');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = '<li class="idle">아직 저장된 기록이 없습니다.</li>';
    return;
  }
  list.forEach((s) => {
    const li = document.createElement('li');
    const d = new Date(s.date || s.savedAt);
    const date = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (s.sets && s.sets.length) {
      li.textContent = `${date} · 스쿼트 ${s.sets.length}세트 · 총 ${s.totalReps}회 · 평균 ${s.avgScore}점`;
      li.title = s.sets.map((x) => `세트${x.setNo}: ${x.reps}회 ${x.avgScore}점`).join(' / ');
    } else {
      li.textContent = `${date} · 스쿼트 ${s.reps}회 · 평균 ${s.avgScore}점`;
    }
    ul.appendChild(li);
  });
}

/* ---------- 초기화 ---------- */
$('btn-start').addEventListener('click', start);
$('btn-stop').addEventListener('click', () => stop(false));
$('btn-save-set').addEventListener('click', () => saveSet(false));
$('btn-finish').addEventListener('click', () => stop(false));
$('fit-cover').addEventListener('click', () => setFitMode('cover'));
$('fit-contain').addEventListener('click', () => setFitMode('contain'));
window.addEventListener('DOMContentLoaded', async () => {
  await initCameras();
  await renderHistory();
});
