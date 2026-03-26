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

// ── Fullscreen + Landscape lock ──────────────────────────────
(function () {
  function goFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (req) req.call(el).catch(() => {});
  }
  function lockLandscape() {
    const so = screen.orientation || screen.msOrientation;
    if (so && so.lock) so.lock('landscape').catch(() => {});
    else if (screen.lockOrientation) screen.lockOrientation('landscape');
  }
  function onFirstInteraction() {
    goFullscreen();
    lockLandscape();
  }
  document.addEventListener('click',      onFirstInteraction, { once: true });
  document.addEventListener('touchstart', onFirstInteraction, { once: true });
})();

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

    // ── Save to Firebase Firestore (auto-creates "characters" collection) ──
    if (fbOK && fbAuth.currentUser) {
      fbDb.collection('characters')
        .doc(fbAuth.currentUser.uid)
        .set(character)
        .then(() => console.log('[YGG] Character saved to Firestore ✓'))
        .catch(e => console.warn('[YGG] Firestore save failed (continuing):', e));
    }

    localStorage.setItem('character', JSON.stringify(character));
    console.log('[YGG] Character created:', character);

    // Stop the character-creation preview renderer
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }

    // Transition to game world
    document.getElementById('s-create').classList.remove('show');
    Game.init(character);
  },

  _initScene() {
    if (this._renderer) {
      if (!this._animId) this._startLoop();
      return;
    }

    const canvas   = document.getElementById('model-canvas');
    const viewport = canvas.parentElement;

    const w = viewport.clientWidth  || 400;
    const h = viewport.clientHeight || 400;

    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    this._camera.position.set(0, 0.9, 3.8);
    this._camera.lookAt(0, 0.9, 0);

    this._renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(w, h);
    this._renderer.outputEncoding = THREE.sRGBEncoding;
    this._renderer.setClearColor(0x000000, 0);

    const ro = new ResizeObserver(() => {
      const nw = viewport.clientWidth;
      const nh = viewport.clientHeight;
      if (!nw || !nh) return;
      this._camera.aspect = nw / nh;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(nw, nh);
    });
    ro.observe(viewport);

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
    if (!THREE.GLTFLoader)  { this._showFallback(); return; }
    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(draco);

    loader.load('src/models/idle.glb', (gltf) => {
      this._model = gltf.scene;
      this._scene.add(this._model);
      this._model.updateMatrixWorld(true);

      let minY = Infinity, maxY = -Infinity;
      const wp = new THREE.Vector3();
      this._model.traverse(obj => {
        obj.getWorldPosition(wp);
        if (wp.y < minY) minY = wp.y;
        if (wp.y > maxY) maxY = wp.y;
      });

      const skelH = maxY - minY;
      const scale = skelH > 0.01 ? 1.8 / skelH : 1.0;
      this._model.scale.setScalar(scale);
      this._model.position.y = -minY * scale;

      this._applyColor(this.selectedColor);
      this._startLoop();
    },
    null,
    (err) => { console.error('[YGG] idle.glb load failed:', err); this._showFallback(); }
    );
  },

  _showFallback() {
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

// ══════════════════════════════════════════════════════════════
//  GAME WORLD
// ══════════════════════════════════════════════════════════════
const Game = {

  /* ════════════════════════════════════════════════════════════
     ⚙  TUNING PARAMETERS — change these to adjust feel
     ════════════════════════════════════════════════════════════

     CHAR_SCALE  — multiplier on top of the auto-fit height.
                   1.0  = character is fitted to ~1.8 world-units tall.
                   0.5  = half size (tiny),  2.0 = double size (giant).

     MOVE_SPEED  — world-units per second the character travels.
                   3  = leisurely walk,  5  = default jog,
                   8  = fast run,        12 = sprint.
                   The run animation playback speed scales with this value
                   automatically (see _update → timeScale line).

     ════════════════════════════════════════════════════════════ */
  CHAR_SCALE : 1.0,
  TOWN_SCALE : 1.0,   // multiply if town feels too small/large after auto-fit
  MOVE_SPEED : 5.0,

  // Camera follow config
  CAM_DIST   : 5.5,   // world-units behind the character
  CAM_HEIGHT : 2.8,   // world-units above the character's feet
  CAM_LERP   : 0.12,  // 0=frozen camera, 1=snap — how fast the camera follows

  // Map boundary
  MAP_RADIUS : 130,   // character is clamped within this radius from world origin

  // ── Internal state ──────────────────────────────────────────
  _scene:    null,
  _camera:   null,
  _renderer: null,
  _clock:    null,
  _animId:   null,

  _char:      null,
  _mixer:     null,
  _runAction: null,
  _charData:  null,
  _worldScale: 0.086,  // set when character loads; town uses same value

  _town: null,
  _terrainMeshes:   [],  // ground meshes — downward raycasting
  _collisionMeshes: [],  // building/wall meshes — horizontal collision
  _raycaster: null,
  _keys: {},
  _camYaw:    0,
  _mouseDown: false,     // true while player manually drags camera
  _joystick:  { x: 0, y: 0 },
  _water:     null,
  _waterTime: 0,

  // ── Entry point ─────────────────────────────────────────────
  init(charData) {
    this._charData = charData;
    this._loadedAssets = 0; 
    // Safety net — hide overlay after 30s no matter what
this._loadTimeout = setTimeout(() => {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) { overlay.style.opacity = '0'; overlay.style.display = 'none'; }
  console.warn('[YGG] Load timeout hit — forcing overlay off');
}, 30000);

    // Show game screen
    const sg = document.getElementById('s-game');
    sg.style.display = 'block';

    // Update HUD
    const hn = document.getElementById('hud-name');
    if (hn) hn.textContent = charData.name.toUpperCase();

    this._setupRenderer();
    this._setupScene();
    this._setupSunsetSky();
    this._addGround();
    this._addOcean();
    this._loadCharacter(() => this._loadTown());
    this._setupControls();
    this._startLoop();

    // Hide controls hint after first interaction
    document.addEventListener('keydown', () => {
      const h = document.getElementById('controls-hint');
      if (h) h.style.opacity = '0';
    }, { once: true });
  },

  // ── Renderer ────────────────────────────────────────────────
  _setupRenderer() {
    const canvas = document.getElementById('game-canvas');
    this._clock  = new THREE.Clock();
    this._scene  = new THREE.Scene();
    this._raycaster = new THREE.Raycaster();
    this._raycaster.near = 0.01;
    this._raycaster.far  = 500;
    this._camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setSize(innerWidth, innerHeight);
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this._renderer.outputEncoding    = THREE.sRGBEncoding;
    this._renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.25;

    window.addEventListener('resize', () => {
      this._camera.aspect = innerWidth / innerHeight;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(innerWidth, innerHeight);
    });
  },

  // ── Scene / Lighting ────────────────────────────────────────
  _setupScene() {
    // Warm sunset fog
    this._scene.fog = new THREE.FogExp2(0xb83800, 0.005);

    // Warm ambient (golden hour fill)
    this._scene.add(new THREE.AmbientLight(0xff9955, 0.75));

    // Main sun — low on the horizon, golden-orange
    const sun = new THREE.DirectionalLight(0xffaa44, 3.8);
    sun.position.set(120, 28, -200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   =   1;
    sun.shadow.camera.far    = 600;
    sun.shadow.camera.left   = -150;
    sun.shadow.camera.right  =  150;
    sun.shadow.camera.top    =  150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.bias = -0.0005;
    this._scene.add(sun);

    // Warm fill — bounced light from the ground
    const fill = new THREE.DirectionalLight(0xff5500, 0.5);
    fill.position.set(-60, 8, 120);
    this._scene.add(fill);

    // Cool back light — sky reflection from opposite horizon
    const sky = new THREE.DirectionalLight(0x304080, 0.35);
    sky.position.set(0, 100, 150);
    this._scene.add(sky);
  },

  // ── Sunset sky with sun disc ─────────────────────────────────
  _setupSunsetSky() {
    /* Sky dome — large inverted sphere with vertex-color gradient.
       Colors go from near-black at the bottom (ground side) through
       burnt-orange at the horizon to deep indigo at the zenith.       */
    const skyGeo  = new THREE.SphereGeometry(1500, 32, 20);
    const pos     = skyGeo.attributes.position;
    const colors  = new Float32Array(pos.count * 3);
    const tmp     = new THREE.Vector3();

    // Key gradient stops
    const cZenith  = new THREE.Color(0x080c35); // deep navy-indigo
    const cMidSky  = new THREE.Color(0x7a1228); // deep crimson-rose
    const cHorizon = new THREE.Color(0xff4800); // molten orange
    const cGround  = new THREE.Color(0x0e0501); // near-black

    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).normalize();
      const t = tmp.y; // -1 = ground, 0 = horizon, +1 = zenith

      let c;
      if (t >= 0) {
        // Sky half: horizon → mid → zenith
        if (t < 0.25) {
          c = cHorizon.clone().lerp(cMidSky,  t / 0.25);
        } else {
          c = cMidSky.clone().lerp(cZenith, (t - 0.25) / 0.75);
        }
      } else {
        // Ground half: fade to black below horizon
        c = cHorizon.clone().lerp(cGround, Math.min(1, -t * 3));
      }

      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._scene.add(new THREE.Mesh(skyGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })
    ));

    // ── Sun glow helper ─────────────────────────────────────────
    const makeTex = (size, stops) => {
      const c   = document.createElement('canvas');
      c.width   = c.height = size;
      const ctx = c.getContext('2d');
      const g   = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      stops.forEach(([s, col]) => g.addColorStop(s, col));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      return new THREE.CanvasTexture(c);
    };

    // Sun position (must match the directional light position direction)
    const SUN_POS = new THREE.Vector3(600, 90, -1400);

    // Inner disc — bright white-yellow core
    const discSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeTex(256, [
        [0.00, 'rgba(255,255,240,1.0)'],
        [0.06, 'rgba(255,250,160,1.0)'],
        [0.15, 'rgba(255,200, 50,0.9)'],
        [0.30, 'rgba(255,120,  0,0.5)'],
        [0.55, 'rgba(255, 60,  0,0.15)'],
        [1.00, 'rgba(255, 30,  0,0.0)'],
      ]),
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false
    }));
    discSprite.position.copy(SUN_POS);
    discSprite.scale.set(180, 180, 1);
    this._scene.add(discSprite);

    // Outer corona / atmospheric halo
    const coronaSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeTex(256, [
        [0.00, 'rgba(255,120, 30,0.55)'],
        [0.20, 'rgba(255, 60,  0,0.25)'],
        [0.50, 'rgba(220, 30,  0,0.08)'],
        [1.00, 'rgba(180, 20,  0,0.00)'],
      ]),
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false
    }));
    coronaSprite.position.copy(SUN_POS);
    coronaSprite.scale.set(700, 700, 1);
    this._scene.add(coronaSprite);

    // Horizon glow band — a radial gradient spread across the horizon
    const hgCanvas = document.createElement('canvas');
    hgCanvas.width = hgCanvas.height = 512;
    const hgCtx = hgCanvas.getContext('2d');
    const hg    = hgCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
    hg.addColorStop(0.00, 'rgba(255, 80,  0, 0.60)');
    hg.addColorStop(0.30, 'rgba(220, 40,  0, 0.25)');
    hg.addColorStop(0.65, 'rgba(180, 20,  0, 0.08)');
    hg.addColorStop(1.00, 'rgba(150, 10,  0, 0.00)');
    hgCtx.fillStyle = hg;
    hgCtx.fillRect(0, 0, 512, 512);

    const hgMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(hgCanvas),
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide
      })
    );
    hgMesh.rotation.x = -Math.PI / 2;
    hgMesh.position.set(150, 8, -400); // offset toward the sun direction
    this._scene.add(hgMesh);
  },

  // ── Ground plane — kept as invisible fallback if town has gaps ──
  _addGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.95, metalness: 0.0 })
    );
    ground.rotation.x    = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.position.y    = -0.05; // slightly below y=0 so town terrain wins
  },

  // ── Load town.glb ────────────────────────────────────────────
  _loadTown() {
    const loader = this._makeLoader();
    loader.load('src/models/town.glb',
      (gltf) => {
        this._town = gltf.scene;
        

        // ── Auto-fit town independently ──────────────────────────
        // The town and character may come from different export scales,
        // so we measure the town's own raw bounding box and scale it so
        // its longest horizontal span hits a target world size (~300 units).
        // TOWN_SCALE (default 1.0) is a final tuning multiplier on top.
        this._town.updateMatrixWorld(true);
        const rawBox  = new THREE.Box3().setFromObject(this._town);
        const rawSize = new THREE.Vector3();
        rawBox.getSize(rawSize);
        const rawSpan       = Math.max(rawSize.x, rawSize.z, 0.01);
        const townAutoScale = 300 / rawSpan; // target ~300 world-unit span
        const s = townAutoScale * this.TOWN_SCALE;
        this._town.scale.setScalar(s);

        // ── Floor placement ──────────────────────────────────────
        // Re-measure after scaling, then shift so floor sits at y = 0.
        this._town.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this._town);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Centre horizontally (X/Z), keep Y so floor = 0
        this._town.position.x -= center.x;
        this._town.position.z -= center.z;
        this._town.position.y -= box.min.y; // lift floor to y=0

        // Shadows
        this._town.traverse(child => {
          if (child.isMesh) {
            child.castShadow    = true;
            child.receiveShadow = true;
          }
        });

        this._scene.add(this._town);

        // ── Build terrain mesh list for raycasting ───────────────
        this._terrainMeshes = [];
this._town.traverse(child => {
  // We only want meshes that are part of the floor/ground.
  // We exclude anything with "tree" or "leaf" in the name.
  if (child.isMesh) {
    const name = child.name.toLowerCase();
    if (!name.includes('tree') && !name.includes('leaf')) {
      this._terrainMeshes.push(child);
    }
  }
});

        // ── Build collision mesh list — all opaque town meshes ────
        // Horizontal raycasts at waist height will naturally miss flat
        // ground polygons and only hit walls/buildings.
        this._collisionMeshes = [];
        this._town.traverse(child => {
          if (child.isMesh) this._collisionMeshes.push(child);
        });

        // ── Snap character to terrain surface on first frame ─────
        if (this._char) this._snapToTerrain(this._char, true);
        console.log('[YGG] Town loaded ✓  scale:', s.toFixed(4),
          '  world size:',
          (box.max.x-box.min.x).toFixed(1),'×',
          (box.max.y-box.min.y).toFixed(1),'×',
          (box.max.z-box.min.z).toFixed(1));
        this._showLoadStep('town');
      },
      (xhr) => {
        if (xhr.lengthComputable)
          console.log(`[YGG] Town GLB: ${(xhr.loaded/xhr.total*100).toFixed(1)}%`);
      },
      err => {
        console.error('[YGG] Town load error:', err);
        this._showLoadStep('town');
      }
    );
  },

  // ── Load running.glb and set up animation ───────────────────
  _loadCharacter(onDone) {
    const loader = this._makeLoader();
    loader.load('src/models/running.glb',
      (gltf) => {
        this._char = gltf.scene;
        this._char.updateMatrixWorld(true);

        /* ── AUTO-SIZE ──────────────────────────────────────────────
           Measures the actual bone/node extent (not bind-pose verts)
           and scales the model to exactly 1.8 world-units tall, then
           multiplies by CHAR_SCALE so you can tweak one number.       */
        let minY = Infinity, maxY = -Infinity;
        const wp = new THREE.Vector3();
        this._char.traverse(o => {
          o.getWorldPosition(wp);
          if (wp.y < minY) minY = wp.y;
          if (wp.y > maxY) maxY = wp.y;
        });
        const skelH      = maxY - minY;
        // Scale so the character is exactly 1.8 world-units tall, then
        // apply the CHAR_SCALE tuning multiplier on top.
        const baseScale  = skelH > 0.01 ? 1.8 / skelH : 2;
        const finalScale = baseScale * this.CHAR_SCALE;

        this._worldScale = baseScale; // kept for reference / legacy

        this._char.scale.setScalar(finalScale);
        this._char.position.set(11, 11, 11); // x, z = where on the map, y=10 so it drops onto terrain


        // Apply chosen skin colour
        const skinColor = new THREE.Color(this._charData?.color || '#fff0e6');
        this._char.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => { if (m.color) m.color.set(skinColor); });
          }
        });

        this._scene.add(this._char);

        /* ── ANIMATION ─────────────────────────────────────────────
           Uses the first clip in running.glb.
           • timeScale = 0   → animation frozen (idle pose)
           • timeScale = 1   → normal playback speed
           • timeScale > 1   → faster (used when MOVE_SPEED is high)    */
        if (gltf.animations?.length) {
          this._mixer     = new THREE.AnimationMixer(this._char);
          this._runAction = this._mixer.clipAction(gltf.animations[0]);
          this._runAction.play();
          this._runAction.timeScale = 0; // start frozen
        }

        this._updateCamera(true);
        console.log('[YGG] Character loaded ✓  scale:');
        this._showLoadStep('char');
        if (onDone) onDone();
      },
      null,
      err => { console.error('[YGG] Character load error:', err); this._showLoadStep('char'); if (onDone) onDone(); }
    );
  },

  // ── Simple two-asset loading tracker ────────────────────────
  _loadedAssets: 0,
  _showLoadStep(which) {
    this._loadedAssets++;
    console.log(`[YGG] Loaded: ${which} (${this._loadedAssets}/2)`);
    if (this._loadedAssets >= 2) {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.opacity = '0';
  setTimeout(() => { if (overlay) overlay.style.display = 'none'; }, 600);
  clearTimeout(this._loadTimeout); // cancel safety timeout if already set
}
  },

  // ── GLTF loader factory ──────────────────────────────────────
  _makeLoader() {
    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(draco);
    return loader;
  },

  // ── Controls ─────────────────────────────────────────────────
  _setupControls() {
    // Keyboard
    document.addEventListener('keydown', e => { this._keys[e.code] = true;  });
    document.addEventListener('keyup',   e => { this._keys[e.code] = false; });

    // Mouse — rotate camera by dragging
    const canvas = document.getElementById('game-canvas');
    let mDown = false, mLast = 0;
    canvas.addEventListener('mousedown', e => { mDown = true; this._mouseDown = true;  mLast = e.clientX; });
    canvas.addEventListener('mouseup',   ()  => { mDown = false; this._mouseDown = false; });
    canvas.addEventListener('mousemove', e => {
      if (!mDown) return;
      this._camYaw -= (e.clientX - mLast) * 0.004;
      mLast = e.clientX;
    });

    // Touch — joystick (left half) + camera drag (right half)
    // Mouse wheel zoom
const gameCanvas = document.getElementById('game-canvas');
gameCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  this.CAM_DIST = Math.max(2, Math.min(20, this.CAM_DIST + e.deltaY * 0.01));
}, { passive: false });
    this._setupTouch();
  },

  _setupTouch() {
    const joyZone = document.getElementById('joystick-zone');
    const camZone = document.getElementById('cam-rotate-zone');
    if (!joyZone || !camZone) return;

    if ('ontouchstart' in window) {
      joyZone.style.display = 'flex';
      camZone.style.display = 'block';
    }

    const knob   = document.getElementById('joystick-knob');
    const MAX_R  = 44; // max knob travel in px

    // Joystick touch
    let joyId = null, joyX0 = 0, joyY0 = 0;

    joyZone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyId = t.identifier; joyX0 = t.clientX; joyY0 = t.clientY;
    }, { passive: false });

    joyZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        const dx = t.clientX - joyX0;
        const dy = t.clientY - joyY0;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const clamp = Math.min(len, MAX_R);
        const nx = dx / len, ny = dy / len;
        this._joystick.x = nx * (clamp / MAX_R);
        this._joystick.y = ny * (clamp / MAX_R);
        if (knob) knob.style.transform = `translate(${nx*clamp}px,${ny*clamp}px)`;
      }
    }, { passive: false });

    const endJoy = e => {
      e.preventDefault();
      this._joystick.x = 0; this._joystick.y = 0;
      if (knob) knob.style.transform = 'translate(0,0)';
      joyId = null;
    };
    joyZone.addEventListener('touchend',    endJoy, { passive: false });
    joyZone.addEventListener('touchcancel', endJoy, { passive: false });

    // Camera drag touch (right zone)
    // Pinch zoom
let pinchDist = 0;
camZone.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchDist = Math.sqrt(dx*dx + dy*dy);
  }
}, { passive: false });

camZone.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const newDist = Math.sqrt(dx*dx + dy*dy);
    this.CAM_DIST = Math.max(2, Math.min(20, this.CAM_DIST - (newDist - pinchDist) * 0.05));
    pinchDist = newDist;
  }
}, { passive: false });
    let camId = null, camLast = 0;
    camZone.addEventListener('touchstart', e => {
      e.preventDefault();
      this._mouseDown = true;
      const t = e.changedTouches[0];
      camId = t.identifier; camLast = t.clientX;
    }, { passive: false });

    camZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== camId) continue;
        this._camYaw -= (t.clientX - camLast) * 0.005;
        camLast = t.clientX;
      }
    }, { passive: false });

    const endCam = e => { e.preventDefault(); camId = null; this._mouseDown = false; };
    camZone.addEventListener('touchend',    endCam, { passive: false });
    camZone.addEventListener('touchcancel', endCam, { passive: false });
  },

  // ── Main loop ────────────────────────────────────────────────
  _startLoop() {
    const loop = () => {
      this._animId = requestAnimationFrame(loop);
      const raw = this._clock.getDelta();
      const dt  = Math.min(raw, 0.05); // cap at 50ms to avoid huge jumps
      this._update(dt);
      this._renderer.render(this._scene, this._camera);
    };
    loop();
  },

  // ── Building collision — push character out of walls ─────────
  // Shoots 8 horizontal rays at waist height from the character.
  // Each hit within CHAR_RADIUS pushes the character away by the
  // penetration depth.  Runs after movement, before terrain snap.
  _collide() {
    if (!this._collisionMeshes.length || !this._char) return;

    const CHAR_RADIUS = 0.45; // collision sphere radius (world units)
    const NUM_RAYS    = 8;
    const origin = new THREE.Vector3(
      this._char.position.x,
      this._char.position.y + 0.9,   // waist / chest height
      this._char.position.z
    );

    const ray = new THREE.Raycaster();
    ray.near = 0;
    ray.far  = CHAR_RADIUS + 0.1;

    for (let i = 0; i < NUM_RAYS; i++) {
      const angle = (i / NUM_RAYS) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      ray.set(origin, dir);
      const hits = ray.intersectObjects(this._collisionMeshes, false);
      if (hits.length && hits[0].distance < CHAR_RADIUS) {
        const pen = CHAR_RADIUS - hits[0].distance;
        this._char.position.x -= dir.x * pen;
        this._char.position.z -= dir.z * pen;
        // Move origin along too so subsequent rays are accurate
        origin.x -= dir.x * pen;
        origin.z -= dir.z * pen;
      }
    }
  },

  // ── Terrain raycasting — snap character Y to surface ─────────
  // Shoots a ray straight down from above the character's XZ position.
  // Returns the terrain Y at that point, or null if nothing was hit.
  _snapToTerrain(obj, forceSnap = false) {
    if (!this._terrainMeshes.length) return;

    // Cast from well above the character so we catch hills higher than current pos
    const origin = new THREE.Vector3(
      obj.position.x,
      obj.position.y + 2,   // start 50 units above current Y
      obj.position.z
    );
    this._raycaster.set(origin, new THREE.Vector3(0, -1, 0)); // straight down

    const hits = this._raycaster.intersectObjects(this._terrainMeshes, false);

    if (hits.length > 0) {
      const groundY = hits[0].point.y;
      if (forceSnap) {
        obj.position.y = groundY;
      } else {
        // Smooth vertical follow — lerp toward terrain surface each frame
        obj.position.y = THREE.MathUtils.lerp(obj.position.y, groundY, 0.25);
      }
    }
  },

  // ── Update ───────────────────────────────────────────────────
  _update(dt) {
    if (!this._char) return;

    // ── Read keyboard ──────────────────────────────────────────
    const kW = this._keys['KeyW'] || this._keys['ArrowUp'];
    const kS = this._keys['KeyS'] || this._keys['ArrowDown'];
    const kA = this._keys['KeyA'] || this._keys['ArrowLeft'];
    const kD = this._keys['KeyD'] || this._keys['ArrowRight'];

    // Combine keyboard + joystick input axes
    let ix = ((kD ? 1 : 0) - (kA ? 1 : 0)) + this._joystick.x;
    let iz = ((kS ? 1 : 0) - (kW ? 1 : 0)) + this._joystick.y;

    // Normalize diagonal input
    const inputLen = Math.sqrt(ix * ix + iz * iz);
    if (inputLen > 1) { ix /= inputLen; iz /= inputLen; }

    const isMoving = inputLen > 0.05;

    if (isMoving) {
      /* Transform input direction by camera yaw so "forward" always
         means "away from the camera" regardless of where you're facing. */
      const sin = Math.sin(this._camYaw);
      const cos = Math.cos(this._camYaw);
      const dx  = (ix * cos - iz * sin) * this.MOVE_SPEED * dt;
      const dz  = (ix * sin + iz * cos) * this.MOVE_SPEED * dt;

      this._char.position.x += dx;
      this._char.position.z += dz;

      // Rotate character to face movement direction (smooth slerp)
      const targetYaw = Math.atan2(dx, dz);
      let diff = targetYaw - this._char.rotation.y;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this._char.rotation.y += diff * Math.min(1, 14 * dt);

      // ── Camera auto-follow ──────────────────────────────────────
      // When the player is NOT manually dragging the camera, ease
      // _camYaw toward the character's facing so controls always feel
      // relative to "where I'm going" rather than the world axis.
      if (!this._mouseDown) {
        let camDiff = this._char.rotation.y - this._camYaw;
        while (camDiff >  Math.PI) camDiff -= Math.PI * 2;
        while (camDiff < -Math.PI) camDiff += Math.PI * 2;
        this._camYaw += camDiff * Math.min(1, 3.5 * dt);
      }
    }

    // ── Building collision ──────────────────────────────────────
    ;

    // ── Map boundary clamp ──────────────────────────────────────
    // Hard-stop at MAP_RADIUS so the player can't walk off into open sea.
    const cx   = this._char.position.x;
    const cz   = this._char.position.z;
    const dist = Math.sqrt(cx * cx + cz * cz);
    if (dist > this.MAP_RADIUS) {
      const ratio = this.MAP_RADIUS / dist;
      this._char.position.x = cx * ratio;
      this._char.position.z = cz * ratio;
    }

    // ── Terrain following — snap character Y to ground surface ──
    this._snapToTerrain(this._char);

    // ── Animation playback ────────────────────────────────────
    if (this._runAction) {
      const targetTs = isMoving ? (this.MOVE_SPEED / 5.0) : 0.0;
      this._runAction.timeScale = THREE.MathUtils.lerp(
        this._runAction.timeScale, targetTs, Math.min(1, 8 * dt)
      );
    }
    if (this._mixer) this._mixer.update(dt);

    // ── Animate water ─────────────────────────────────────────
    if (this._water) {
      this._waterTime += dt;
      const t = this._waterTime;
      this._water.material.emissive.setRGB(
        0.02 + Math.sin(t * 0.4) * 0.01,
        0.06 + Math.sin(t * 0.27) * 0.02,
        0.14 + Math.sin(t * 0.35) * 0.04
      );
    }

    this._updateCamera(false, dt);
  },

  // ── Third-person camera ───────────────────────────────────────
  _updateCamera(snap, dt) {
    if (!this._char) return;

    const tx = this._char.position.x - Math.sin(this._camYaw) * this.CAM_DIST;
    const ty = this._char.position.y + this.CAM_HEIGHT;
    const tz = this._char.position.z - Math.cos(this._camYaw) * this.CAM_DIST;

    if (snap) {
      this._camera.position.set(tx, ty, tz);
    } else {
      this._camera.position.lerp(
        new THREE.Vector3(tx, ty, tz),
        this.CAM_LERP
      );
    }

    this._camera.lookAt(
      this._char.position.x,
      this._char.position.y + 1.1,
      this._char.position.z
    );
  },

  // ── Ocean — fills everything outside the town boundary ────────
  // A large dark-blue plane at y = -0.6 so it sits just below the
  // terrain edge.  The existing sunset fog naturally blends it into
  // the orange horizon without any extra shader work.
  _addOcean() {
    // Main water surface
    const geo = new THREE.PlaneGeometry(6000, 6000, 1, 1);
    const mat = new THREE.MeshPhongMaterial({
      color:       0x062a52,
      emissive:    new THREE.Color(0x061a30),
      specular:    new THREE.Color(0x6699cc),
      shininess:   55,
      transparent: true,
      opacity:     0.94,
    });
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.6;
    water.receiveShadow = false;
    this._scene.add(water);
    this._water = water;
    this._waterTime = 0;

    // Thin horizon-glow ring so the sea looks lit at the sunset edge
    const ringGeo = new THREE.RingGeometry(
      this.MAP_RADIUS + 2,   // inner radius — just outside the walkable area
      this.MAP_RADIUS + 40,  // outer radius — blends into the sea
      64
    );
    const ringMat = new THREE.MeshBasicMaterial({
      color:       0xff5500,
      transparent: true,
      opacity:     0.08,
      side:        THREE.DoubleSide,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.3;
    this._scene.add(ring);
  }
};
