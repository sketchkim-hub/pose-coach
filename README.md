# 포즈코치 (Pose Coach) 🏋️

웹캠 1~2대 + MediaPipe Pose 기반 실시간 운동 자세 교정 웹앱.

- **측면 카메라**: 무릎/엉덩이/상체 각도 실시간 측정
- **정면 카메라**: 좌우 대칭 체크
- 스쿼트 rep 자동 카운트 + 자세 점수 + 음성 피드백
- 카메라 영상은 기기를 떠나지 않음 (온디바이스 처리)

## 실행 방법

별도 빌드 없이 정적 파일만으로 동작합니다.

```bash
cd pose-coach
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 접속
```

> `file://` 로 직접 열면 카메라 권한 문제로 동작하지 않을 수 있으니 로컬 서버로 실행하세요.

## 카메라 설정

| 모드 | 설정 | 분석 내용 |
|------|------|-----------|
| 듀얼 (2대) | 카메라 1 = 측면, 카메라 2 = 정면 | 각도 측정·채점 + 대칭 체크 동시 |
| 단일·측면 | 카메라 2 = '사용 안 함', 카메라 1 방향 = 측면 | 각도 측정·rep 카운트·채점 (정식) |
| 단일·정면 | 카메라 2 = '사용 안 함', 카메라 1 방향 = 정면 | 대칭 체크·rep 카운트 (간이 채점) |

카메라 1의 방향(측면/정면) 선택에 따라 분석 방식이 자동으로 바뀝니다.
정면 단독 모드는 시작 시 약 1초간 서 있는 자세를 인식한 뒤 측정합니다.

### 카메라 배치

- 측면: 몸의 옆모습이 나오도록 (왼쪽/오른쪽)
- 정면: 몸의 앞모습이 나오도록
- 전신이 화면에 들어오도록 거리를 두세요 (2~3m)
- 밝은 조명에서 사용하세요

## GitHub Pages 배포

1. 이 폴더를 GitHub 저장소에 푸시
2. 저장소 Settings → Pages → Source를 `main` 브랜치로 설정
3. `https://<사용자명>.github.io/<저장소명>/` 에서 접속
4. HTTPS에서만 카메라가 동작합니다 (GitHub Pages는 기본 HTTPS)

## Firebase 연동 (선택)

운동 기록을 클라우드에 저장하려면:

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 프로젝트 생성
2. 웹 앱 추가 → 설정 값 복사
3. `js/firebase-config.js`에 값 입력
4. Authentication → 익명 로그인 활성화
5. Firestore Database 생성 (테스트 모드로 시작)

설정을 비워 두면 자동으로 **로컬 저장 모드**(localStorage)로 동작합니다.

## 프로젝트 구조

```
pose-coach/
├── index.html            # UI
├── css/style.css         # 스타일
├── js/
│   ├── pose-engine.js    # 카메라 + MediaPipe Pose
│   ├── analyzer.js       # 스쿼트 각도 분석·rep 카운트·채점 (측면/정면 단독 지원)
│   ├── store.js          # Firebase / localStorage 저장
│   ├── firebase-config.js# Firebase 설정 (값 입력 필요)
│   └── app.js            # UI 오케스트레이션 (단일/듀얼 카메라 모드)
├── manifest.json         # PWA 매니페스트
├── icons/                # 앱 아이콘
├── twa-manifest.json     # Android TWA 설정
└── README.md
```

## 운동 추가하기

`js/analyzer.js`에 분석 클래스를 추가하고 `index.html`의 운동 선택지에
`<option>`을 넣으면 됩니다. (푸쉬업·플랭크·런지 예정)

## 주의

- 참고용 자세 가이드입니다. 의료기기가 아닙니다.
- 통증이 있으면 즉시 중단하고 전문가와 상담하세요.
