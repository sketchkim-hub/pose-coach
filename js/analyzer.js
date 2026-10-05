/**
 * analyzer.js
 * 스쿼트 자세 분석: 관절 각도 계산, rep 카운트, 점수, 피드백
 *
 * MediaPipe 랜드마크 인덱스:
 *   어깨 11(좌)/12(우), 엉덩이 23/24, 무릎 25/26, 발목 27/28
 */

// 세 점(b를 꼭짓점)으로 각도(도) 계산
function jointAngle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return null;
  const cos = Math.min(1, Math.max(-1, dot / (m1 * m2)));
  return Math.acos(cos) * 180 / Math.PI;
}

// 상체 기울기: 엉덩이->어깨 벡터와 수직선 사이의 각도 (0=바르게 선 상태)
function torsoLean(shoulder, hip) {
  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y; // 위쪽이 양수
  if (dy <= 0) return 90;
  return Math.atan2(Math.abs(dx), dy) * 180 / Math.PI;
}

class SquatAnalyzer {
  constructor() {
    this.reset();
    // 임계값 (튜닝 가능)
    this.T = {
      downKnee: 115,   // 이 각도 아래로 내려가면 하강 시작으로 판정
      upKnee: 160,     // 이 각도 위로 올라오면 상승 완료로 판정
      targetMinKnee: 80,   // 이상적인 최저 무릎 각도 범위
      targetMaxKnee: 95,
      countMinKnee: 100,   // ★ 이 각도 이하까지 내려가야 1회로 인정 (정밀 판정)
      countMinDrop: 0.12,  // ★ 정면 모드: 엉덩이가 이만큼(정규화 좌표) 내려가야 인정
      minDownMs: 450,      // ★ 하강 동작이 이 시간(ms)보다 짧으면 카운트 제외 (까딱임 방지)
      maxBackLean: 50,     // 상체 기울기 허용 한계 (도)
      maxKneeOverToe: 0.14 // 무릎-발목 수평거리 허용 한계 (정규화 좌표)
    };
  }

  /** 다음 세트를 위해 rep 상태만 초기화 (정면 베이스라인은 유지) */
  resetSet() {
    this.phase = 'ready';
    this.reps = 0;
    this.scores = [];
    this.repMinKnee = 180;
    this.repMaxLean = 0;
    this.repKneeOverToe = false;
    this.repMaxDrop = 0;
    this.repAsym = false;
    this.repStartTime = 0;   // 하강 시작 시각 (까딱임 판정용)
    this.repDepthOk = false; // 인정 깊이 도달 여부
    this.lastResult = null;
  }

  reset() {
    this.resetSet();
    // 정면 단독 모드용 상태
    this.frontBase = null;     // 선 자세 엉덩이 Y 기준값 (캘리브레이션)
    this._frontCalib = [];
  }

  /** 가시성이 더 좋은 쪽(좌/우) 랜드마크 선택 */
  _pickSide(lm) {
    const L = [11, 23, 25, 27], R = [12, 24, 26, 28];
    const vis = (ids) => ids.reduce((s, i) => s + (lm[i].visibility || 0), 0) / ids.length;
    return vis(L) >= vis(R) ? { s: 11, h: 23, k: 25, a: 27 } : { s: 12, h: 24, k: 26, a: 28 };
  }

  /**
   * 측면 카메라 랜드마크로 분석
   * @returns { angles, phase, feedback[], repDone:{score, details}|null }
   */
  analyzeSide(lm) {
    if (!lm) return { angles: null, phase: this.phase, feedback: ['측면 카메라에 몸이 잘 보이도록 서주세요.'], repDone: null };

    const p = this._pickSide(lm);
    const sh = lm[p.s], hip = lm[p.h], knee = lm[p.k], ankle = lm[p.a];

    const kneeAngle = jointAngle(hip, knee, ankle);
    const hipAngle = jointAngle(sh, hip, knee);
    const backLean = torsoLean(sh, hip);
    const kneeOverToe = Math.abs(knee.x - ankle.x);

    if (kneeAngle === null) {
      return { angles: null, phase: this.phase, feedback: ['관절을 인식하는 중입니다...'], repDone: null };
    }

    const angles = {
      knee: Math.round(kneeAngle),
      hip: hipAngle === null ? null : Math.round(hipAngle),
      back: Math.round(backLean),
      kneeOverToe: +kneeOverToe.toFixed(3)
    };

    const feedback = [];
    let repDone = null;
    let repRejected = null;

    // 상태 머신 (히스테리시스)
    if (this.phase === 'ready' || this.phase === 'up') {
      if (kneeAngle < this.T.downKnee) {
        this.phase = 'down';
        this.repMinKnee = kneeAngle;
        this.repMaxLean = backLean;
        this.repKneeOverToe = false;
        this.repStartTime = Date.now();
        this.repDepthOk = false;
      } else {
        this.phase = 'ready';
      }
    }

    if (this.phase === 'down') {
      this.repMinKnee = Math.min(this.repMinKnee, kneeAngle);
      this.repMaxLean = Math.max(this.repMaxLean, backLean);
      if (kneeOverToe > this.T.maxKneeOverToe) this.repKneeOverToe = true;
      if (kneeAngle <= this.T.countMinKnee) this.repDepthOk = true;

      // 실시간 피드백
      if (backLean > this.T.maxBackLean) feedback.push('⚠️ 상체가 너무 앞으로 숙여졌어요. 가슴을 펴세요.');
      if (kneeOverToe > this.T.maxKneeOverToe) feedback.push('⚠️ 무릎이 발끝보다 너무 앞으로 나갔어요.');

      if (kneeAngle > this.T.upKnee) {
        // 상승 완료 → 정밀 판정 후 카운트 여부 결정
        const downMs = Date.now() - this.repStartTime;
        if (!this.repDepthOk) {
          repRejected = { reason: 'depth', msg: `❌ 깊이가 부족해 카운트되지 않았어요. (최저 ${Math.round(this.repMinKnee)}°, ${this.T.countMinKnee}° 이하까지 내려가야 해요)` };
        } else if (downMs < this.T.minDownMs) {
          repRejected = { reason: 'fast', msg: '❌ 너무 빨라 카운트되지 않았어요. 천천히 내려갔다 올라오세요.' };
        } else {
          repDone = this._scoreRep();
        }
        this.phase = 'up';
      } else {
        this.phase = 'down';
      }
    }

    if (feedback.length === 0) {
      if (this.phase === 'down') {
        feedback.push(this.repDepthOk ? '✅ 깊이 충분해요. 이제 올라오세요.' : `⬇️ 더 깊게 내려가세요. (무릎 ${this.T.countMinKnee}° 이하)`);
      } else {
        feedback.push('일어서세요. 다음 횟수를 준비하세요.');
      }
    }

    this.lastResult = { angles, phase: this.phase, feedback, repDone, repRejected };
    return this.lastResult;
  }

  /** 정면 카메라: 좌우 대칭 체크 */
  analyzeFront(lm) {
    if (!lm) return [];
    const fb = [];
    const shY = Math.abs(lm[11].y - lm[12].y);
    const kneeY = Math.abs(lm[25].y - lm[26].y);
    const hipY = Math.abs(lm[23].y - lm[24].y);
    if (shY > 0.05) fb.push('⚠️ 어깨 높이가 좌우 달라요.');
    if (kneeY > 0.06 || hipY > 0.06) fb.push('⚠️ 좌우 균형이 틀어졌어요. 정면을 보고 하세요.');
    return fb;
  }

  /**
   * 정면 단독 모드: 대칭 체크 + 엉덩이 Y 이동 기반 rep 카운트 (간이 채점)
   * @returns { phase, feedback[], repDone|null, depth(%), symOk }
   */
  analyzeFrontSolo(lm) {
    if (!lm) {
      return { phase: this.phase, feedback: ['정면 카메라에 몸이 잘 보이도록 서주세요.'], repDone: null, depth: null, symOk: true };
    }

    const hipY = (lm[23].y + lm[24].y) / 2;

    // 베이스라인(선 자세) 캘리브레이션: 처음 30프레임 평균
    if (this.frontBase === null) {
      this._frontCalib.push(hipY);
      if (this._frontCalib.length >= 30) {
        this.frontBase = this._frontCalib.reduce((a, b) => a + b, 0) / this._frontCalib.length;
      }
      return { phase: 'ready', feedback: ['서 있는 자세를 인식하는 중입니다... 가만히 서 계세요.'], repDone: null, depth: null, symOk: true };
    }

    const drop = hipY - this.frontBase; // 양수 = 내려감 (정규화 좌표)
    const sym = this.analyzeFront(lm);
    const feedback = [];
    let repDone = null;
    let repRejected = null;

    if (this.phase === 'ready' || this.phase === 'up') {
      if (drop > 0.07) {
        this.phase = 'down';
        this.repMaxDrop = drop;
        this.repAsym = sym.length > 0;
        this.repStartTime = Date.now();
        this.repDepthOk = false;
      } else {
        this.phase = 'ready';
      }
    }

    if (this.phase === 'down') {
      this.repMaxDrop = Math.max(this.repMaxDrop, drop);
      if (sym.length) this.repAsym = true;
      if (drop >= this.T.countMinDrop) this.repDepthOk = true;
      if (drop < 0.025) {
        // 정밀 판정 후 카운트 여부 결정
        const downMs = Date.now() - this.repStartTime;
        if (!this.repDepthOk) {
          repRejected = { reason: 'depth', msg: '❌ 깊이가 부족해 카운트되지 않았어요. 엉덩이를 더 낮추세요.' };
        } else if (downMs < this.T.minDownMs) {
          repRejected = { reason: 'fast', msg: '❌ 너무 빨라 카운트되지 않았어요. 천천히 내려갔다 올라오세요.' };
        } else {
          repDone = this._scoreFrontRep();
        }
        this.phase = 'up';
      }
    }

    feedback.push(...sym);
    if (!feedback.length) {
      if (this.phase === 'down') {
        feedback.push(this.repDepthOk ? '✅ 깊이 충분해요. 올라오세요.' : '⬇️ 더 깊게 내려가세요.');
      } else {
        feedback.push('일어서세요. 다음 횟수를 준비하세요.');
      }
    }

    return {
      phase: this.phase,
      feedback,
      repDone,
      repRejected,
      depth: Math.max(0, Math.round(drop * 100)),
      symOk: sym.length === 0
    };
  }

  /** 정면 단독 모드 간이 채점 (깊이는 카운트 게이트에서 이미 검증됨) */
  _scoreFrontRep() {
    let score = 100;
    const notes = [];
    if (this.repAsym) { score -= 15; notes.push('좌우 불균형'); }
    score = Math.max(0, score);
    this.reps += 1;
    this.scores.push(score);
    return { rep: this.reps, score, minKnee: null, maxLean: null, notes, front: true };
  }

  _scoreRep() {
    let score = 100;
    const notes = [];
    const { targetMaxKnee } = this.T;

    // 깊이: countMinKnee 이하만 카운트되므로, 그 안에서의 정밀 채점
    if (this.repMinKnee > targetMaxKnee) { score -= 10; notes.push('조금 더 깊게'); }

    if (this.repMaxLean > this.T.maxBackLean) { score -= 15; notes.push('상체 숙임'); }
    if (this.repKneeOverToe) { score -= 10; notes.push('무릎 전진'); }

    score = Math.max(0, score);
    this.reps += 1;
    this.scores.push(score);
    return {
      rep: this.reps,
      score,
      minKnee: Math.round(this.repMinKnee),
      maxLean: Math.round(this.repMaxLean),
      notes
    };
  }

  avgScore() {
    if (!this.scores.length) return null;
    return Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length);
  }
}
