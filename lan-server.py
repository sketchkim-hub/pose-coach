#!/usr/bin/env python3
"""
lan-server.py — 포즈코치 WiFi 카메라용 로컬 서버

하는 일:
  1) 포즈코치 웹 파일을 http://localhost:8000 으로 서빙
     (localhost는 브라우저의 보안 컨텍스트라 카메라 권한이 정상 동작)
  2) /cam?src=<휴대폰 주소> 로 휴대폰 MJPEG 영상을 프록시
     (same-origin이라 캔버스에 그려도 오염되지 않음)

사용법:
  1. 휴대폰에 'IP Webcam'(안드로이드 무료 앱) 설치 → '서버 시작'
     → 화면에 나오는 주소 확인 (예: http://192.168.0.5:8080/video)
  2. PC에서: python3 lan-server.py
  3. PC 브라우저에서 http://localhost:8000 접속
  4. 카메라 1에서 '📶 WiFi 카메라 (휴대폰)' 선택 → 휴대폰 주소 입력 → 측정 시작

조건: 휴대폰과 PC가 같은 WiFi에 연결되어 있어야 함.
"""

import http.server
import socketserver
import urllib.parse
import urllib.request
import os

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/cam":
            qs = urllib.parse.parse_qs(parsed.query)
            src = (qs.get("src") or [""])[0]
            if not src.startswith("http://"):
                self.send_error(400, "src must be an http:// phone URL")
                return
            self._proxy_mjpeg(src)
            return
        super().do_GET()

    def _proxy_mjpeg(self, src):
        """휴대폰 MJPEG 스트림을 그대로 중계"""
        try:
            req = urllib.request.Request(src, headers={"User-Agent": "pose-coach-lan"})
            upstream = urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            self.send_error(502, f"Phone connection failed: {e}")
            return
        ctype = upstream.headers.get(
            "Content-Type", "multipart/x-mixed-replace; boundary=--BoundaryString"
        )
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache, no-store")
        self.end_headers()
        try:
            while True:
                chunk = upstream.read(16384)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            upstream.close()

    def log_message(self, fmt, *args):
        # /cam은 계속 이어지는 스트림이라 로그가 넘치므로 조용히 처리
        if self.path.startswith("/cam"):
            return
        super().log_message(fmt, *args)


if __name__ == "__main__":
    print("=" * 60)
    print(" 포즈코치 WiFi 카메라 서버")
    print("=" * 60)
    print(f" 1) PC 브라우저에서 열기: http://localhost:{PORT}")
    print(" 2) 카메라 1 → '📶 WiFi 카메라 (휴대폰)' 선택")
    print(" 3) 휴대폰 IP Webcam 앱의 주소를 입력 (예: http://192.168.0.5:8080/video)")
    print(" ※ 휴대폰과 PC가 같은 WiFi에 있어야 합니다.")
    print(" 종료: Ctrl+C")
    print("=" * 60)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        httpd.serve_forever()
