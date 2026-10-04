/**
 * store.js
 * 운동 기록 저장: Firebase Firestore (설정 시) / localStorage (기본)
 *
 * Firebase를 쓰려면 js/firebase-config.js 에 실제 값을 입력하세요.
 * 설정이 없으면 자동으로 로컬 저장 모드로 동작합니다.
 */

class Store {
  constructor() {
    this.mode = 'local'; // 'firebase' | 'local'
    this.db = null;
    this._init();
  }

  _init() {
    try {
      const cfg = window.FIREBASE_CONFIG;
      const hasConfig = cfg && cfg.apiKey && !cfg.apiKey.includes('YOUR_');
      if (hasConfig && typeof firebase !== 'undefined') {
        firebase.initializeApp(cfg);
        // 익명 로그인 (기록을 사용자별로 구분)
        firebase.auth().signInAnonymously().catch(() => {});
        this.db = firebase.firestore();
        this.mode = 'firebase';
      }
    } catch (e) {
      console.warn('Firebase 초기화 실패, 로컬 모드:', e);
    }
    this._updateBadge();
  }

  _updateBadge() {
    const el = document.getElementById('store-badge');
    if (!el) return;
    el.textContent = this.mode === 'firebase' ? '☁️ Firebase 저장 모드' : '💾 로컬 저장 모드';
    el.classList.toggle('cloud', this.mode === 'firebase');
  }

  _uid() {
    return (firebase.auth().currentUser && firebase.auth().currentUser.uid) || 'local';
  }

  async saveSession(session) {
    session.savedAt = new Date().toISOString();
    if (this.mode === 'firebase') {
      try {
        await this.db.collection('sessions').add({ ...session, uid: this._uid() });
        return;
      } catch (e) {
        console.warn('Firestore 저장 실패, 로컬로 대체:', e);
      }
    }
    const list = this._loadLocal();
    list.unshift(session);
    localStorage.setItem('pose-coach-sessions', JSON.stringify(list.slice(0, 50)));
  }

  async getSessions(limit = 10) {
    if (this.mode === 'firebase') {
      try {
        const snap = await this.db.collection('sessions')
          .where('uid', '==', this._uid())
          .orderBy('savedAt', 'desc').limit(limit).get();
        return snap.docs.map((d) => d.data());
      } catch (e) {
        console.warn('Firestore 조회 실패:', e);
      }
    }
    return this._loadLocal().slice(0, limit);
  }

  _loadLocal() {
    try {
      return JSON.parse(localStorage.getItem('pose-coach-sessions') || '[]');
    } catch (e) {
      return [];
    }
  }
}
