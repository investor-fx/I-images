// Sign-up and log-in, powered by Firebase Authentication (email + password).
const cfg = window.MUSE_FIREBASE;
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const slim = u => u ? { uid: u.uid, email: u.email, name: u.displayName || '' } : null;

async function start() {
  try {
    const V = '10.12.2';
    const [{ initializeApp }, A] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/' + V + '/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/' + V + '/firebase-auth.js')
    ]);
    const auth = A.getAuth(initializeApp(cfg));
    window.museAuth = {
      async signUp(name, email, password) {
        const cred = await A.createUserWithEmailAndPassword(auth, email, password);
        if (name) {
          await A.updateProfile(cred.user, { displayName: name });
          emit('muse-auth', { user: slim(cred.user) });
        }
        return cred.user;
      },
      signIn: (email, password) => A.signInWithEmailAndPassword(auth, email, password),
      reset: email => A.sendPasswordResetEmail(auth, email),
      signOut: () => A.signOut(auth)
    };
    A.onAuthStateChanged(auth, user => emit('muse-auth', { user: slim(user) }));
  } catch (err) {
    emit('muse-auth-error', { message: String(err) });
  }
}

if (cfg && cfg.apiKey) start();
