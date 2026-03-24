/* ============================================================
   Yggdrasil Online — app.js
   ============================================================ */

// ── Firebase ──────────────────────────────────────────────────
const FBCFG = {
  apiKey:            "AIzaSyCUZKyN-sxLvJCXLAOUjZ_nsRghqUagcjs",
  authDomain:        "yggdrasil-online.firebaseapp.com",
  databaseURL:       "https://yggdrasil-online-default-rtdb.firebaseio.com",
  projectId:         "yggdrasil-online",
  storageBucket:     "yggdrasil-online.firebasestorage.app",
  messagingSenderId: "445950943508",
  appId:             "1:445950943508:web:b2597f9ce1f12b8cd6a201"
};

let fbAuth = null, fbDb = null, fbRt = null, fbOK = false;

try {
  const app = firebase.initializeApp(FBCFG);
  fbAuth = firebase.auth();
  fbDb   = firebase.firestore();
  fbRt   = firebase.database();
  fbOK   = true;
  console.log('[YGG] Firebase initialized');
} catch (e) {
  console.error('[YGG] Firebase init failed:', e);
}

// ── Auth ──────────────────────────────────────────────────────
const Auth = {
  google: async () => {
    if (!fbOK) { alert('Firebase not initialized'); return; }
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const result = await fbAuth.signInWithPopup(provider);
      console.log('[YGG] Signed in:', result.user.displayName);
      CharCreate.show('google');
    } catch (e) {
      console.error('[YGG] Google sign-in error:', e);
      alert('Google sign in failed. Check console for details.');
    }
  },

  guest: () => {
    CharCreate.show('guest');
  },

  backToLogin: () => {
    document.getElementById('s-create').classList.remove('show');
    document.getElementById('s-auth').style.display = 'flex';
    // Pause render loop to save battery while not visible
    if (CharCreate._animId) {
      cancelAnimationFrame(CharCreate._animId);
      CharCreate._animId = null;
    }
  }
};

// ── Character Creation ────────────────────────────────────────
const CharCreate = {
  selectedColor: '#fff0e6',
  authType: 'guest',

  _scene:    null,
  _camera:   null,
  _renderer: null,
  _model:    null,
  _animId:   null,

  show(type = 'guest') {
    this.authType = type;
    document.getElementById('s-auth').style.display = 'none';
    document.getElementById('s-create').classList.add('show');
    document.getElementById('char-name').focus();
    // Two rAF: first lets display:flex apply, second lets layout reflow finish
    requestAnimationFrame(() => requestAnimationFrame(() => this._initScene()));
  },

  selectColor(el) {
    document.querySelectorAll('.cc-color').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    this.selectedColor = el.getAttribute('data-color');
    this._applyColor(this.selectedColor);
  },

  submit() {
    const name = document.getElementById('char-name').value.trim();
    if (!name) { alert('Please enter a character name'); return; }

    const character = {
      name,
      class:     'Swordsman',
      color:     this.selectedColor,
      createdAt: new Date().toISOString(),
      authType:  this.authType
    };

    if (this.authType === 'guest') {
      character.guestId = 'guest_' + Date.now();
      localStorage.setItem('guestId', character.guestId);
    }

    localStorage.setItem('character', JSON.stringify(character));
    console.log('[YGG] Character created:', character);
    alert('Character created: ' + name);
    // TODO: transition to game world
  },

  _initScene() {
    if (this._renderer) {
      // Scene already exists — just resume the loop
      if (!this._animId) this._startLoop();
      return;
    }

    const canvas   = document.getElementById('model-canvas');
    const viewport = canvas.parentElement; // .cc-viewport div

    // Read dimensions from the parent container — reliable after layout
    const w = viewport.clientWidth  || 400;
    const h = viewport.clientHeight || 400;
    console.log('[YGG] Canvas size:', w, h);

    this._scene = new THREE.Scene();

    // Camera framed for a ~1.8-unit humanoid centered at y=0.9
    this._camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    this._camera.position.set(0, 0.9, 3.8);
    this._camera.lookAt(0, 0.9, 0);

    this._renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(w, h);
    this._renderer.outputEncoding = THREE.sRGBEncoding;
    this._renderer.setClearColor(0x000000, 0);

    // Respond to orientation changes and window resize
    const ro = new ResizeObserver(() => {
      const nw = viewport.clientWidth;
      const nh = viewport.clientHeight;
      if (!nw || !nh) return;
      this._camera.aspect = nw / nh;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(nw, nh);
    });
    ro.observe(viewport);

    // Lighting
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 5);
    this._scene.add(key);

    const fill = new THREE.DirectionalLight(0xaad4ff, 0.4);
    fill.position.set(-4, 2, -3);
    this._scene.add(fill);

    this._loadModel();
  },

  _loadModel() {
    if (!THREE.GLTFLoader)  { console.error('[YGG] GLTFLoader missing');  this._showFallback(); return; }
    if (!THREE.DRACOLoader) { console.error('[YGG] DRACOLoader missing'); this._showFallback(); return; }

    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');

    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(draco);

    const modelPath = 'src/models/idle.glb';
    console.log('[YGG] Loading:', modelPath);

    loader.load(
      modelPath,

      (gltf) => {
        console.log('[YGG] Model loaded ✓');
        this._model = gltf.scene;
        this._scene.add(this._model);

        // ── Skinned mesh scale fix ──
        // Box3 measures bind-pose vertices (all near 0,0,0 for rigged models).
        // Traverse all nodes and measure their actual world positions instead.
        this._model.updateMatrixWorld(true);

        let minY =  Infinity, maxY = -Infinity;
        const wp = new THREE.Vector3();
        this._model.traverse(obj => {
          obj.getWorldPosition(wp);
          if (wp.y < minY) minY = wp.y;
          if (wp.y > maxY) maxY = wp.y;
        });

        const skelH  = maxY - minY;       // ~21 units for a Mixamo rig
        const scale  = skelH > 0.01 ? 1.8 / skelH : 1.0;

        console.log('[YGG] Skeleton height:', skelH.toFixed(3), '→ scale:', scale.toFixed(4));

        this._model.scale.setScalar(scale);
        this._model.position.y = -minY * scale; // feet at y = 0

        this._applyColor(this.selectedColor);
        this._startLoop();
      },

      (xhr) => {
        if (xhr.lengthComputable)
          console.log(`[YGG] GLB: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
      },

      (err) => {
        console.error('[YGG] GLB load failed:', err);
        this._showFallback();
      }
    );
  },

  _showFallback() {
    console.warn('[YGG] Showing fallback geometry');
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.6, 0.3),
      new THREE.MeshStandardMaterial({ color: this.selectedColor })
    );
    mesh.position.y = 0.8;
    this._model = mesh;
    this._scene.add(this._model);
    this._startLoop();
  },

  _startLoop() {
    if (this._animId) return;
    const loop = () => {
      this._animId = requestAnimationFrame(loop);
      if (this._model) this._model.rotation.y += 0.008;
      this._renderer.render(this._scene, this._camera);
    };
    loop();
  },

  _applyColor(hex) {
    if (!this._model) return;
    const color = new THREE.Color(hex);
    this._model.traverse(child => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => { if (m.color) m.color.set(color); });
      }
    });
  }
};
