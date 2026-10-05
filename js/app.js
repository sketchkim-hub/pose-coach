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
let running = false;

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
  running = true;
  $('rep-log').innerHTML = '';

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
      boxes[1].classList.add('off');
      const label = `${labelOf(dev1)} (단독)`;

      if (role1 === 'side') {
        // 측면 단독: 각도 측정 + rep 카운트 + 채점
        setStatLabels('side');
        boxes[0].querySelector('.video-label').textContent = `측면 카메라 — ${label}`;
        engineSide = new PoseEngine($('video-side'), $('canvas-side'), (lm) => {
          if (!running) return;
          renderSide(analyzer.analyzeSide(lm));
        });
        await engineSide.start(dev1);
      } else {
        // 정면 단독: 대칭 체크 + 엉덩이 이동 기반 rep 카운트 (간이 채점)
        setStatLabels('front');
        boxes[0].querySelector('.video-label').textContent = `정면 카메라 — ${label}`;
        engineFront = new PoseEngine($('video-side'), $('canvas-side'), (lm) => {
          if (!running) return;
          renderFront(analyzer.analyzeFrontSolo(lm));
        });
        await engineFront.start(dev1);
      }
    } else {
      // ---- 듀얼 카메라 (기존 동작) ----
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
      await engineSide.start(sideAsg.deviceId);
      document.querySelectorAll('.video-box')[0].querySelector('.video-label').textContent =
        `측면 카메라 (${labelOf(sideAsg.deviceId)})`;

      if (frontAsg) {
        engineFront = new PoseEngine($('video-front'), $('canvas-front'), (lm) => {
          if (!running || !lm) return;
          const fb = analyzer.analyzeFront(lm);
          if (fb.length) renderExtraFeedback(fb);
        });
        await engineFront.start(frontAsg.deviceId);
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

/* ---------- 측정 종료 ---------- */
async function stop(silent) {
  running = false;
  if (engineSide) { engineSide.stop(); engineSide = null; }
  if (engineFront) { engineFront.stop(); engineFront = null; }

  if (!silent && analyzer.reps > 0) {
    const session = {
      date: new Date().toISOString(),
      exercise: 'squat',
      reps: analyzer.reps,
      avgScore: analyzer.avgScore(),
      scores: analyzer.scores,
      durationSec: Math.round((Date.now() - sessionStart) / 1000)
    };
    await store.saveSession(session);
    renderHistory();
  }

  $('btn-start').disabled = false;
  $('btn-stop').disabled = true;
  $('setup-panel').classList.remove('hidden');
  $('stage').classList.add('hidden');
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
    li.textContent = `${date} · 스쿼트 ${s.reps}회 · 평균 ${s.avgScore}점`;
    ul.appendChild(li);
  });
}

/* ---------- 초기화 ---------- */
$('btn-start').addEventListener('click', start);
$('btn-stop').addEventListener('click', () => stop(false));
window.addEventListener('DOMContentLoaded', async () => {
  await initCameras();
  await renderHistory();
});
