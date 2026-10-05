// Accounts (email + Google) and cloud data (saved pictures, boards, community) via Firebase.
const cfg = window.MUSE_FIREBASE;
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const slim = u => u ? { uid: u.uid, email: u.email || '', name: u.displayName || '', photo: u.photoURL || '', created: (u.metadata && u.metadata.creationTime) || '', provider: (u.providerData && u.providerData[0] && u.providerData[0].providerId) || '' } : null;
const clean = o => JSON.parse(JSON.stringify(o));

function makeDB(F, db) {
  let unsubs = [];
  const err = e => emit('muse-db-error', { message: (e && e.code) || String(e) });
  return {
    listen(uid) {
      this.stop();
      unsubs.push(F.onSnapshot(
        F.query(F.collection(db, 'users', uid, 'saves'), F.orderBy('savedAt', 'desc')),
        snap => emit('muse-saves', { items: snap.docs.map(d => d.data()), fromCache: snap.metadata.fromCache }), err));
      unsubs.push(F.onSnapshot(
        F.query(F.collection(db, 'users', uid, 'boards'), F.orderBy('createdAt', 'asc')),
        snap => emit('muse-boards', { items: snap.docs.map(d => Object.assign({ id: d.id }, d.data())) }), err));
    },
    stop() { unsubs.forEach(u => u()); unsubs = []; },
    addSave: (uid, rec) => F.setDoc(F.doc(db, 'users', uid, 'saves', rec.id), clean(rec)),
    removeSave: (uid, id) => F.deleteDoc(F.doc(db, 'users', uid, 'saves', id)),
    setSaveBoards: (uid, id, boards) => F.updateDoc(F.doc(db, 'users', uid, 'saves', id), { boards }),
    async addBoard(uid, name) {
      const ref = await F.addDoc(F.collection(db, 'users', uid, 'boards'), { name, createdAt: Date.now() });
      return ref.id;
    },
    async deleteBoard(uid, id, saveIds) {
      const b = F.writeBatch(db);
      b.delete(F.doc(db, 'users', uid, 'boards', id));
      saveIds.forEach(sid => b.update(F.doc(db, 'users', uid, 'saves', sid), { boards: F.arrayRemove(id) }));
      await b.commit();
    },
    async createPost(post) {
      const ref = await F.addDoc(F.collection(db, 'posts'), clean(post));
      return ref.id;
    },
    async loadPosts(cursor, mineUid) {
      if (mineUid) {
        const snap = await F.getDocs(F.query(F.collection(db, 'posts'), F.where('uid', '==', mineUid), F.limit(40)));
        const docs = snap.docs.slice().sort((x, y) => (y.data().createdAt || 0) - (x.data().createdAt || 0));
        return { docs, items: docs.map(d => Object.assign({ id: d.id }, d.data())) };
      }
      const parts = [F.collection(db, 'posts'), F.orderBy('createdAt', 'desc')];
      if (cursor) parts.push(F.startAfter(cursor));
      parts.push(F.limit(12));
      const snap = await F.getDocs(F.query(...parts));
      return { docs: snap.docs, items: snap.docs.map(d => Object.assign({ id: d.id }, d.data())) };
    },
    async deleteAllData(uid) {
      const wipe = async q => {
        const snap = await F.getDocs(q);
        for (let i = 0; i < snap.docs.length; i += 400) {
          const b = F.writeBatch(db);
          snap.docs.slice(i, i + 400).forEach(d => b.delete(d.ref));
          await b.commit();
        }
      };
      await wipe(F.collection(db, 'users', uid, 'saves'));
      await wipe(F.collection(db, 'users', uid, 'boards'));
      await wipe(F.collection(db, 'users', uid, 'meta'));
      await wipe(F.query(F.collection(db, 'posts'), F.where('uid', '==', uid)));
    },
    async countPosts(uid) {
      const s = await F.getCountFromServer(F.query(F.collection(db, 'posts'), F.where('uid', '==', uid)));
      return s.data().count;
    },
    async getProfile(uid) {
      const s = await F.getDoc(F.doc(db, 'users', uid, 'meta', 'profile'));
      return s.exists() ? s.data() : null;
    },
    setProfile: (uid, data) => F.setDoc(F.doc(db, 'users', uid, 'meta', 'profile'), clean(data)),
    async getPost(id) {
      const s = await F.getDoc(F.doc(db, 'posts', id));
      return s.exists() ? s.data() : null;
    },
    deletePost: id => F.deleteDoc(F.doc(db, 'posts', id)),
    report: (postId, uid, reason) => F.addDoc(F.collection(db, 'reports'), { postId, uid, reason, createdAt: Date.now() })
  };
}

async function start() {
  const V = '10.12.2', base = 'https://www.gstatic.com/firebasejs/' + V + '/';
  let A, fbApp, auth;
  try {
    const [appMod, authMod] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js')]);
    A = authMod; fbApp = appMod.initializeApp(cfg); auth = A.getAuth(fbApp);
  } catch (e) {
    emit('muse-auth-error', { message: String(e) });
    return;
  }

  // Cloud data is optional: if it fails to load, the app falls back to saving on the phone.
  try {
    const F = await import(base + 'firebase-firestore.js');
    window.museDB = makeDB(F, F.getFirestore(fbApp));
  } catch (e) { /* stay in phone-only mode */ }

  window.museAuth = {
    async signUp(name, email, password) {
      const cred = await A.createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await A.updateProfile(cred.user, { displayName: name });
        emit('muse-auth', { user: slim(auth.currentUser) });
      }
      return cred.user;
    },
    signIn: (email, password) => A.signInWithEmailAndPassword(auth, email, password),
    google: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    reset: email => A.sendPasswordResetEmail(auth, email),
    async updateName(name) {
      await A.updateProfile(auth.currentUser, { displayName: name });
      emit('muse-auth', { user: slim(auth.currentUser) });
    },
    async reauth(password) {
      const u = auth.currentUser;
      if (password !== undefined) await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(u.email, password));
      else await A.reauthenticateWithPopup(u, new A.GoogleAuthProvider());
    },
    deleteAccount: () => A.deleteUser(auth.currentUser),
    signOut: () => A.signOut(auth)
  };
  A.onAuthStateChanged(auth, user => emit('muse-auth', { user: slim(user) }));
}

if (cfg && cfg.apiKey) start();
