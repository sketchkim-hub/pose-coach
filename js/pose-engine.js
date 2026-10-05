/**
 * pose-engine.js
 * 듀얼 웹캠 + MediaPipe Pose 실시간 스켈레톤 추적
 *
 * 사용법:
 *   const engine = new PoseEngine(videoEl, canvasEl, (landmarks) => {...});
 *   await engine.start(deviceId);  // 중지: engine.stop()
 */

class PoseEngine {
  constructor(videoEl, canvasEl, onLandmarks) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.onLandmarks = onLandmarks;
    this.pose = null;
    this.stream = null;
    this.rafId = null;
    this.running = false;
    this.lastLandmarks = null;
  }

  async start(deviceId, opts = {}) {
    // 1. 카메라 스트림 열기
    const constraints = {
      audio: false,
      video: {
        width: { ideal: opts.width || 640 },
        height: { ideal: opts.height || 480 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {})
      }
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    await this.video.play();

    // 캔버스 크기를 비디오에 맞춤
    const setSize = () => {
      this.canvas.width = this.video.videoWidth || 640;
      this.canvas.height = this.video.videoHeight || 480;
    };
    setSize();

    // 2. MediaPipe Pose 초기화
    this.pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });
    this.pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    this.pose.onResults((results) => this._onResults(results));

    // 3. 프레임 루프
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      if (this.video.readyState >= 2) {
        try {
          await this.pose.send({ image: this.video });
        } catch (e) {
          // 프레임 전송 실패는 무시하고 다음 프레임 계속
        }
      }
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  _onResults(results) {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    // 비디오 좌우 반전(거울 모드)
    ctx.translate(w, 0);
    ctx.scale(-1, 1);

    if (results.poseLandmarks) {
      this.lastLandmarks = results.poseLandmarks;
      // 스켈레톤 그리기
      drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
        color: '#00FF88', lineWidth: 3
      });
      drawLandmarks(ctx, results.poseLandmarks, {
        color: '#FF4444', lineWidth: 1, radius: 3
      });
      if (this.onLandmarks) this.onLandmarks(results.poseLandmarks);
    } else {
      this.lastLandmarks = null;
      if (this.onLandmarks) this.onLandmarks(null);
    }
    ctx.restore();
  }

  /** 하드웨어 줌 지원 범위 반환 (미지원이면 null) */
  getZoomRange() {
    try {
      const track = this.stream && this.stream.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : null;
      if (caps && caps.zoom) {
        return { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
      }
    } catch (e) { /* 무시 */ }
    return null;
  }

  /** 하드웨어 줌 설정 */
  async setZoom(value) {
    const track = this.stream.getVideoTracks()[0];
    await track.applyConstraints({ advanced: [{ zoom: value }] });
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    const ctx = this.ctx;
    if (ctx) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** 연결된 비디오 입력 장치 목록 반환 */
  static async listCameras() {
    // 권한 요청 (장치 라벨을 보려면 필요)
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tmp.getTracks().forEach((t) => t.stop());
    } catch (e) {
      // 거부되어도 목록은 시도
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }
}
