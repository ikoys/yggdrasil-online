/* ============================================================
   Yggdrasil Online — app.js  (CLIENT: 3D + UI only)
   All game logic lives in server.py.
   This file ONLY handles:
     · Three.js scene, models, animations
     · Input → WebSocket action messages
     · Rendering server state to UI
   ============================================================ */

// ─────────────────────────────────────────────────────────────
//  Firebase Auth  (client only — for getting an ID token)
// ─────────────────────────────────────────────────────────────
const FBCFG = {
  apiKey:            "AIzaSyCUZKyN-sxLvJCXLAOUjZ_nsRghqUagcjs",
  authDomain:        "yggdrasil-online.firebaseapp.com",
  databaseURL:       "https://yggdrasil-online-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "yggdrasil-online",
  storageBucket:     "yggdrasil-online.firebasestorage.app",
  messagingSenderId: "445950943508",
  appId:             "1:445950943508:web:b2597f9ce1f12b8cd6a201",
};

let fbAuth = null, fbRt = null;
try {
  const fbApp = firebase.initializeApp(FBCFG);
  fbAuth = firebase.auth();
  fbRt   = firebase.database();          // still used for multiplayer presence + chat
} catch (e) { console.error('[YGG] Firebase init failed:', e); }

// ─────────────────────────────────────────────────────────────
//  SERVER URL  — change to your deployed Python server address
// ─────────────────────────────────────────────────────────────
// Set data-ws-url="wss://your-server.com/ws" on <body> for production
const WS_URL = document.body?.dataset?.wsUrl || 'ws://localhost:8000/ws';

// ─────────────────────────────────────────────────────────────
//  DISPLAY DATA  (weapon/item metadata for UI only — no math)
// ─────────────────────────────────────────────────────────────
const WTYPES = {
  '1h':    { name:'Long Sword',   icon:'🗡️' },
  '2h':    { name:'Greatsword',   icon:'⚔️'  },
  'dagger':{ name:'Dagger',       icon:'🔪' },
  'mace':  { name:'Mace',         icon:'🔨' },
  'axe':   { name:'Battle Axe',   icon:'🪓' },
  'dual':  { name:'Dual Blades',  icon:'⚔️' },
};

const ITEMS = {
  hpPotion:    { n:'HP Potion',       ico:'🧪' },
  mpPotion:    { n:'SP Potion',        ico:'💧' },
  wolfsbane:   { n:'Wolfsbane',        ico:'🌿' },
  basicSword:  { n:'Basic Sword',      ico:'🗡️' },
  ironSword:   { n:'Iron Sword',       ico:'🗡️' },
  steelSword:  { n:'Steel Longsword',  ico:'🗡️' },
  ironDagger:  { n:'Iron Dagger',      ico:'🔪' },
  ironMace:    { n:'Iron Mace',        ico:'🔨' },
  ironAxe:     { n:'Iron Battle Axe',  ico:'🪓' },
  leatherArmor:{ n:'Leather Armor',    ico:'🥋' },
  chainMail:   { n:'Chain Mail',       ico:'🔗' },
  woodenShield:{ n:'Wooden Shield',    ico:'🛡️' },
  hpCharm:     { n:'HP Charm',         ico:'❤️' },
  speedBoots:  { n:'Swift Boots',      ico:'👟' },
};

const SHOP1_ITEMS = ['hpPotion','mpPotion','leatherArmor','woodenShield','ironSword','ironDagger','ironMace','ironAxe','hpCharm'];
const SHOP1_PRICES = { hpPotion:30, mpPotion:25, leatherArmor:80, woodenShield:60, ironSword:120, ironDagger:90, ironMace:130, ironAxe:140, hpCharm:55 };

const ENEMY_SHAPES = {
  draugr:     { c:0x445566, sz:1.0, shp:'biped' },
  forestWolf: { c:0x5a4a3a, sz:0.9, shp:'wolf'  },
  goblin:     { c:0x4a7a2a, sz:0.75,shp:'biped' },
  darkKnight: { c:0x1a1a2a, sz:1.2, shp:'biped' },
  treant:     { c:0x3a5a1a, sz:1.5, shp:'biped' },
  elderDraugr:{ c:0x334455, sz:1.3, shp:'boss'  },
};

// ─────────────────────────────────────────────────────────────
//  LOCAL STATE MIRROR  (read-only — always authoritative from server)
// ─────────────────────────────────────────────────────────────
let S = {
  uid:null, user:'Wanderer', skin:'#d4a882',
  lv:1, xp:0, xpN:100,
  maxHp:200, hp:200, maxSp:100, sp:100,
  atk:12, def:2, spd:4.2, crit:0.05, critMult:1.5,
  gold:0, wtype:'1h', statPts:0,
  str:5, agi:5, vit:5, dex:5,
  prof:{}, inv:[], eq:{ weapon:null, armor:null, accessory:null },
  scd:[0,0,0,0], atkCd:0,
};

// Runtime-only (never from server)
let _target = null;     // { id, tid, hp, maxHp } — enemy the player has selected
let _inSafe = false;
let _inBoss = false;

// ─────────────────────────────────────────────────────────────
//  WEBSOCKET
// ─────────────────────────────────────────────────────────────
const WS = {
  _socket: null,
  _queue:  [],
  _open:   false,

  connect(token, uid) {
    const params = token ? `token=${encodeURIComponent(token)}` : `uid=${encodeURIComponent(uid)}`;
    const url    = `${WS_URL}?${params}`;
    this._socket = new WebSocket(url);

    this._socket.onopen = () => {
      this._open = true;
      console.log('[WS] Connected to game server');
      this._queue.forEach(m => this._socket.send(m));
      this._queue = [];
    };

    this._socket.onmessage = e => {
      try { WS._handle(JSON.parse(e.data)); }
      catch (err) { console.error('[WS] Parse error', err); }
    };

    this._socket.onerror = e => console.error('[WS] Error', e);

    this._socket.onclose = () => {
      this._open = false;
      console.warn('[WS] Disconnected — reconnecting in 3s...');
      setTimeout(() => WS.connect(token, uid), 3000);
    };
  },

  send(obj) {
    const str = JSON.stringify(obj);
    if (this._open && this._socket?.readyState === WebSocket.OPEN) {
      this._socket.send(str);
    } else {
      this._queue.push(str);
    }
  },

  // ── Server → Client message handler ─────────────────────────
  _handle(msg) {
    switch (msg.type) {

      case 'AUTH_OK':
        console.log('[WS] Auth OK, uid:', msg.uid);
        break;

      case 'AUTH_FAIL':
        alert('Auth failed: ' + msg.msg);
        break;

      case 'STATE':
        // Full state sync from server
        Object.assign(S, msg.state);
        if (msg.enemies) Ens.syncFromServer(msg.enemies);
        UI.hud();
        UI.renderInv();
        UI.renderEquip();
        Stats.updateSkillButtons();
        UI.updateStatPointDot();
        break;

      case 'HIT':
        // Combat result — update local mirror, trigger FX
        if (msg.hp    !== undefined) S.hp    = msg.hp;
        if (msg.sp    !== undefined) S.sp    = msg.sp;
        if (msg.gold  !== undefined) S.gold  = msg.gold;
        if (msg.xp    !== undefined) S.xp    = msg.xp;
        if (msg.xpN   !== undefined) S.xpN   = msg.xpN;
        if (msg.atkCd !== undefined) S.atkCd = msg.atkCd;
        if (msg.prof  !== undefined) S.prof  = msg.prof;
        // Visual FX
        const hitEnemy = Ens.meshes[msg.enemyId];
        if (hitEnemy) {
          const clr   = msg.crit ? '#ffdd00' : msg.effMult > 1 ? '#ff8844' : '#e8e0c8';
          const label = msg.crit ? '✦' + msg.damage : String(msg.damage);
          FX.floatAt(label, clr, { x:msg.x, z:msg.z });
          FX.hit(hitEnemy.position.clone());
        }
        if (msg.killed) {
          UI.killLog('+' + msg.killed.xp + ' XP  +' + msg.killed.gold + '🪙');
          if (msg.killed.drops?.length) showNotif('Drop: ' + msg.killed.drops.join(', '), '#e8c96a');
          if (_target?.id === msg.enemyId) { _target = null; UI.target(); }
        }
        UI.hud();
        break;

      case 'SKILL_RESULT':
        if (msg.sp  !== undefined) S.sp  = msg.sp;
        if (msg.scd !== undefined) S.scd = msg.scd;
        if (msg.hp  !== undefined) S.hp  = msg.hp;
        if (msg.gold !== undefined) S.gold = msg.gold;
        if (msg.xp   !== undefined) S.xp   = msg.xp;
        if (msg.xpN  !== undefined) S.xpN  = msg.xpN;
        showNotif(msg.icon + ' ' + msg.skill, '#c9a84c');
        (msg.hits || []).forEach(h => {
          const me = Ens.meshes[h.enemyId];
          if (me) {
            const clr   = h.crit ? '#ffdd00' : '#e8e0c8';
            FX.floatAt(h.crit ? '✦' + h.damage : String(h.damage), clr, { x:h.x, z:h.z });
            FX.hit(me.position.clone());
          }
        });
        Game.playSlash();
        UI.hud();
        Stats.updateSkillButtons();
        break;

      case 'ENEMY_HP':
        Ens.updateHp(msg.enemyId, msg.hp, msg.maxHp, msg.alive);
        // Update boss HP bar
        const _bhp = Ens.list[msg.enemyId];
        if (_bhp?.isBoss) {
          const bf = document.getElementById('boss-bf');
          if (bf) bf.style.width = (Math.max(0, msg.hp / msg.maxHp) * 100) + '%';
          if (!msg.alive) {
            document.getElementById('bossbar')?.style && (document.getElementById('bossbar').style.display = 'none');
            showNotif('🏆 Boss defeated! Floor 1 CLEARED!', '#e8c96a');
            WS.save();
          }
        }
        if (_target?.id === msg.enemyId) {
          _target.hp    = msg.hp;
          _target.maxHp = msg.maxHp;
          if (!msg.alive) _target = null;
          UI.target();
        }
        break;

      case 'ENEMY_SPAWN':
        Ens.spawnFromServer(msg.enemy);
        break;

      case 'LEVEL_UP':
        S.lv      = msg.lv;
        S.statPts = msg.statPts;
        showNotif('🍃 LEVEL UP! Lv.' + msg.lv + ' — Spend stat points!', '#e8c96a');
        UI.updateStatPointDot();
        document.getElementById('lv-b').textContent = 'Lv ' + msg.lv;
        break;

      case 'ITEM_RESULT':
        if (msg.hp   !== undefined) S.hp   = msg.hp;
        if (msg.sp   !== undefined) S.sp   = msg.sp;
        if (msg.inv  !== undefined) S.inv  = msg.inv;
        if (msg.eq   !== undefined) S.eq   = msg.eq;
        if (msg.wtype!== undefined) S.wtype= msg.wtype;
        if (msg.atk  !== undefined) S.atk  = msg.atk;
        if (msg.def  !== undefined) S.def  = msg.def;
        showNotif(msg.msg, msg.ok ? '#e8c96a' : '#e74c3c');
        UI.hud(); UI.renderInv(); UI.renderEquip();
        break;

      case 'BUY_OK':
        S.gold = msg.gold;
        S.inv  = msg.inv;
        UI.hud(); UI.renderInv();
        document.getElementById('sh-gold') && (document.getElementById('sh-gold').textContent = msg.gold);
        break;

      case 'STAT_OK':
        Object.assign(S, msg.state);
        UI.hud(); UI.renderInv();
        Stats.updateSkillButtons();
        UI.updateStatPointDot();
        break;

      case 'NOTIF':
        showNotif(msg.text, msg.color);
        break;

      case 'SAVED':
        console.log('[WS] Save confirmed by server');
        break;

      case 'PONG':
        break;

      case 'PLAYER_HIT':
        S.hp = msg.hp;
        FX.floatAt('💔' + msg.damage, '#e74c3c', { x: 0, z: 0 });
        showNotif('⚔ ' + msg.by + ' hit you for ' + msg.damage, '#e74c3c');
        UI.hud();
        break;

      case 'PLAYER_DEATH':
        S.hp = Math.floor(S.maxHp * 0.4);
        showNotif('💀 You fell — returned to safe zone', '#e74c3c');
        if (PM.group) PM.group.position.set(0, 50, 0);
        if (Game._char) Game._char.position.set(0, 50, 0);
        _target = null; UI.target();
        UI.hud();
        break;

      case 'BLEED':
        Ens.updateHp(msg.enemyId, msg.hp, msg.maxHp, msg.alive);
        FX.floatAt('🩸' + msg.damage, '#c0392b', { x: msg.x, z: msg.z });
        if (_target?.id === msg.enemyId) { _target.hp = msg.hp; if (!msg.alive) _target = null; UI.target(); }
        if (!msg.alive) asyncio_done: {
          UI.killLog('+XP  Bleed kill!');
          const bi = document.getElementById('bleed-ind');
          if (bi) bi.style.display = 'none';
        }
        break;

      case 'ENEMY_MOVE':
        // Update visual positions of enemies from server AI tick
        (msg.moves || []).forEach(m => {
          const e = Ens.list[m.id];
          if (e) { e.x = m.x; e.z = m.z; }
          const mesh = Ens.meshes[m.id];
          if (mesh) {
            mesh.position.x += (m.x - mesh.position.x) * 0.35;
            mesh.position.z += (m.z - mesh.position.z) * 0.35;
            if (m.state === 'chase' || m.state === 'patrol') {
              const ex = Ens.list[m.id];
              if (ex) {
                const dx = ex.x - mesh.position.x, dz = ex.z - mesh.position.z;
                if (Math.sqrt(dx*dx+dz*dz) > 0.1) mesh.rotation.y = Math.atan2(dx, dz);
              }
            }
          }
        });
        break;

      case 'BOSS_SPAWN':
        Ens.spawnFromServer(msg.enemy);
        // Show boss intro overlay
        (async () => {
          const biEm = document.getElementById('bi-em');
          const biNm = document.getElementById('bi-nm');
          if (biEm) biEm.textContent = msg.emoji || '💀';
          if (biNm) biNm.textContent = msg.name.toUpperCase();
          const bi = document.getElementById('s-boss');
          if (bi) { bi.style.display = 'flex'; await new Promise(r => setTimeout(r, 2000)); bi.style.display = 'none'; }
          const bb = document.getElementById('bossbar');
          const bn = document.getElementById('boss-nm');
          if (bn) bn.textContent = '⚠ ' + msg.name.toUpperCase();
          if (bb) bb.style.display = 'block';
          showNotif('☠ ' + msg.name + ' has appeared!', '#e74c3c');
        })();
        break;
    }
  },

  // ── Action senders (called by UI/input handlers) ─────────────
  attack(enemyId)              { this.send({ type:'ATTACK', enemyId }); },
  skill(index, enemyId)        { this.send({ type:'SKILL',  index, enemyId }); },
  useItem(id)                  { this.send({ type:'USE_ITEM', id }); },
  buy(id)                      { this.send({ type:'BUY', id }); },
  statDist(changes)            { this.send({ type:'STAT_DIST', changes }); },
  position(x, z)               { this.send({ type:'POSITION', x, z }); },
  regen(dt)                    { this.send({ type:'REGEN', dt }); },
  save()                       { this.send({ type:'SAVE' }); },
};

// ─────────────────────────────────────────────────────────────
//  Fullscreen + Landscape lock
// ─────────────────────────────────────────────────────────────
(function () {
  function goFullscreen() {
    const el  = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    if (req) req.call(el).catch(() => {});
  }
  function lockLandscape() {
    const so = screen.orientation || screen.msOrientation;
    if (so?.lock) so.lock('landscape').catch(() => {});
    else if (screen.lockOrientation) screen.lockOrientation('landscape');
  }
  function onFirst() { goFullscreen(); lockLandscape(); }
  document.addEventListener('click',      onFirst, { once:true });
  document.addEventListener('touchstart', onFirst, { once:true });
})();

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
function rnd(a, b) { return a + Math.random() * (b - a); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showNotif(txt, clr = '#e8e0c8') {
  const n = document.getElementById('notif');
  if (!n) return;
  n.textContent = txt; n.style.color = clr; n.style.opacity = '1';
  clearTimeout(showNotif._t);
  showNotif._t = setTimeout(() => n.style.opacity = '0', 2600);
}

function showScreen(name) {
  const activeName = name.startsWith('s-') ? name.replace('s-', '') : name;
  ['s-auth','s-create','s-game'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (id === 's-' + activeName) ? 'block' : 'none';
  });
  const ui = document.getElementById('ui');
  if (ui) activeName === 'game' ? ui.classList.remove('hidden') : ui.classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────
const Auth = {
  google: async function () {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const result = await firebase.auth().signInWithPopup(provider);
      const user   = result.user;
      const token  = await user.getIdToken();    // send to server for verification
      WS.connect(token, null);
      WS._socket.addEventListener('message', function once(e) {
        const msg = JSON.parse(e.data);
        if (msg.type === 'AUTH_OK') {
          WS._socket.removeEventListener('message', once);
          // Check if new player (no save) → character creation, else → game
          if (msg.newPlayer) {
            CC.show('google');
            const ni = document.getElementById('cc-ni');
            if (ni && user.displayName) ni.value = user.displayName.split(' ')[0];
          } else {
            showScreen('game');
            const waitForCanvas = setInterval(() => {
              const c = document.getElementById('game-canvas');
              if (c && c.clientWidth > 0) { clearInterval(waitForCanvas); Game.init(); }
            }, 50);
          }
        }
      });
    } catch (err) {
      console.error('[Auth] Google error:', err);
      if (err.code !== 'auth/popup-closed-by-user') alert('Login failed: ' + err.message);
    }
  },

  guest: function () {
    const uid = 'guest_' + Date.now();
    WS.connect(null, uid);
    showScreen('s-create');
    CC.show('guest');
  },
};

// ─────────────────────────────────────────────────────────────
//  CHARACTER CREATION  (purely visual — sends name/skin/wtype to server)
// ─────────────────────────────────────────────────────────────
const CC = {
  selectedColor: '#d4a882',
  authType: 'guest',
  _scene:null, _camera:null, _renderer:null, _model:null, _animId:null, _mixer:null,

  show(type = 'guest') {
    this.authType = type;
    const sc = document.getElementById('s-create');
    if (sc) { sc.classList.remove('hidden'); sc.style.display = 'flex'; }
    const sa = document.getElementById('s-auth');
    if (sa) sa.style.display = 'none';
    this._buildUI();
    requestAnimationFrame(() => requestAnimationFrame(() => this._initScene()));
  },

  selectColor(el) {
    document.querySelectorAll('.cc-color').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    this.selectedColor = el.getAttribute('data-color');
    this._applyColor(this.selectedColor);
  },

  selectWeapon(el) {
    document.querySelectorAll('.cc-wpn').forEach(w => w.classList.remove('selected'));
    el.classList.add('selected');
    WS.send({ type:'SET_WTYPE', wtype: el.getAttribute('data-wtype') });
  },

  finish() {
    const nameEl = document.getElementById('cc-ni');
    const name   = nameEl ? nameEl.value.trim() : '';
    if (name.length < 2) { showNotif('Name must be 2–16 characters', '#e74c3c'); return; }

    // Tell server the chosen name/skin — server owns the state
    WS.send({ type:'SET_NAME', name });
    WS.send({ type:'SET_SKIN', skin: this.selectedColor });
    WS.save();

    // Cleanup 3D preview
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }

    showScreen('game');
    const waitForCanvas = setInterval(() => {
      const c = document.getElementById('game-canvas');
      if (c && c.clientWidth > 0) { clearInterval(waitForCanvas); Game.init(); }
    }, 50);
  },

  _initScene() {
    if (this._renderer) { if (!this._animId) this._startLoop(); return; }
    const canvas = document.getElementById('cc-cv');
    if (!canvas) return;
    const vp = canvas.parentElement;
    const w  = vp.clientWidth  || (window.innerWidth * 0.4);
    const h  = vp.clientHeight || (window.innerHeight * 0.8);
    this._scene  = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    this._camera.position.set(0, 0.9, 3.8);
    this._camera.lookAt(0, 0.9, 0);
    this._renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setSize(w, h);
    this._renderer.outputEncoding = THREE.sRGBEncoding;
    this._renderer.setClearColor(0x000000, 0);
    new ResizeObserver(() => {
      const nw = vp.clientWidth, nh = vp.clientHeight;
      if (!nw || !nh) return;
      this._camera.aspect = nw / nh;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(nw, nh);
    }).observe(vp);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 5);
    this._scene.add(key);
    this._loadModel();
  },

  _loadModel() {
    if (!THREE.GLTFLoader) { this._showFallback(); return; }
    const loader = this._makeLoader();
    loader.load('src/models/idle.glb', (gltf) => {
      this._model = gltf.scene;
      this._scene.add(this._model);
      this._model.updateMatrixWorld(true);
      let minY = Infinity, maxY = -Infinity;
      const wp = new THREE.Vector3();
      this._model.traverse(o => { o.getWorldPosition(wp); if (wp.y < minY) minY = wp.y; if (wp.y > maxY) maxY = wp.y; });
      const skelH = maxY - minY;
      const scale = skelH > 0.01 ? 1.8 / skelH : 1.0;
      this._model.scale.setScalar(scale);
      this._model.position.y = -minY * scale;
      if (gltf.animations?.length) {
        const mixer = new THREE.AnimationMixer(this._model);
        mixer.clipAction(gltf.animations[0]).play();
        this._mixer = mixer;
      }
      this._applyColor(this.selectedColor);
      this._startLoop();
    }, null, () => this._showFallback());
  },

  _showFallback() {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.3), new THREE.MeshStandardMaterial({ color: this.selectedColor }));
    mesh.position.y = 0.8;
    this._model = mesh;
    this._scene.add(this._model);
    this._startLoop();
  },

  _startLoop() {
    if (this._animId) return;
    let last = 0;
    const loop = (t) => {
      this._animId = requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.05); last = t;
      if (this._model) this._model.rotation.y += 0.008;
      if (this._mixer) this._mixer.update(dt);
      this._renderer?.render(this._scene, this._camera);
    };
    loop(0);
  },

  _applyColor(hex) {
    if (!this._model) return;
    const col = new THREE.Color(hex);
    this._model.traverse(child => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => { if (m.color) m.color.set(col); });
      }
    });
  },

  _makeLoader() {
    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(draco);
    return loader;
  },

  _buildUI() {
    const rows = document.getElementById('cc-rows');
    if (!rows || rows.children.length > 0) return;
    const colors  = [
      { hex:'#ffe0bd', label:'Pale' }, { hex:'#f1c27d', label:'Light' },
      { hex:'#d4a882', label:'Tan'  }, { hex:'#c68642', label:'Brown' },
      { hex:'#8d5524', label:'Dark' },
    ];
    const weapons = [
      { key:'1h',     label:'1-H Sword', icon:'🗡️' },
      { key:'2h',     label:'Greatsword',icon:'⚔️'  },
      { key:'dagger', label:'Dagger',    icon:'🔪' },
      { key:'mace',   label:'Mace',      icon:'🔨' },
      { key:'axe',    label:'Battle Axe',icon:'🪓' },
    ];
    rows.innerHTML = `
      <div class="cc-section">
        <div class="cc-row-lbl">SKIN TONE</div>
        <div class="cc-colors">
          ${colors.map(c => `<div class="cc-color ${c.hex === this.selectedColor ? 'selected' : ''}" data-color="${c.hex}" style="background:${c.hex}" onclick="CC.selectColor(this)" title="${c.label}"></div>`).join('')}
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-row-lbl">STARTING WEAPON</div>
        <div class="cc-wpns">
          ${weapons.map((w, i) => `<div class="cc-wpn ${i===0?'selected':''}" data-wtype="${w.key}" onclick="CC.selectWeapon(this)"><span class="cc-wpn-ico">${w.icon}</span><span class="cc-wpn-nm">${w.label}</span></div>`).join('')}
        </div>
      </div>`;
  },
};

// ─────────────────────────────────────────────────────────────
//  STATS  (display only — no math, no recalc)
// ─────────────────────────────────────────────────────────────
const Stats = {
  updateSkillButtons() {
    // Server tells us scd; we just display the unlocked skills from S
    // We still need skill names for display — request from server STATE
    for (let i = 0; i < 4; i++) {
      const icon = document.getElementById('si' + i);
      const nm   = document.getElementById('sn' + i);
      const btn  = document.getElementById('sk' + i);
      // Without server-provided skill list, dim all until STATE arrives
      if (icon) icon.textContent = '—';
      if (nm)   nm.textContent   = '';
      if (btn)  btn.style.opacity = '0.25';
    }
  },

  updateSkillButtonsFromState(skills) {
    // Called after STATE message includes unlocked skills
    for (let i = 0; i < 4; i++) {
      const sk   = skills ? skills[i] : null;
      const icon = document.getElementById('si' + i);
      const nm   = document.getElementById('sn' + i);
      const btn  = document.getElementById('sk' + i);
      if (icon) icon.textContent = sk ? sk.icon : '—';
      if (nm)   nm.textContent   = sk ? sk.name.substring(0, 8) : '';
      if (btn)  btn.style.opacity = sk ? '1' : '0.25';
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  STAT DISTRIBUTION  (local pending UI → sends to server on confirm)
// ─────────────────────────────────────────────────────────────
const StatDist = {
  pending: { str:0, agi:0, vit:0, dex:0 },

  add(stat, amount) {
    const total = Object.values(this.pending).reduce((a, b) => a + b, 0);
    if (amount > 0 && total >= S.statPts) { showNotif('No stat points remaining', '#e74c3c'); return; }
    if (amount < 0 && this.pending[stat] <= 0) return;
    this.pending[stat] += amount;
    UI.showStatPanel();
  },

  confirm() {
    const total = Object.values(this.pending).reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    WS.statDist({ ...this.pending });  // server validates + applies
    this.pending = { str:0, agi:0, vit:0, dex:0 };
    UI.closeStatPanel();
  },

  cancel() {
    this.pending = { str:0, agi:0, vit:0, dex:0 };
    UI.showStatPanel();
  },
};

// ─────────────────────────────────────────────────────────────
//  FX  (purely visual — particles + floating numbers)
// ─────────────────────────────────────────────────────────────
const FX = {
  projs: [], parts: [],
  PG: null, PC: [0xffcc44, 0xff8822, 0x88ff88, 0xffffff, 0xc0392b],

  init() { this.PG = new THREE.SphereGeometry(0.15, 5, 5); },

  hit(pos, n = 10) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.PG, new THREE.MeshBasicMaterial({
        color: this.PC[Math.floor(Math.random() * this.PC.length)], transparent:true
      }));
      m.position.copy(pos); m.position.y += 0.4;
      Game._scene.add(m);
      this.parts.push({ mesh:m, vx:rnd(-5,5), vy:rnd(2,7), vz:rnd(-5,5), life:0.6 });
    }
  },

  floatAt(val, clr, pos) {
    if (!Game._camera) return;
    const v = new THREE.Vector3(pos.x || 0, 1.2, pos.z || 0);
    v.project(Game._camera);
    const sx = (v.x + 1) / 2 * innerWidth;
    const sy = (-v.y + 1) / 2 * innerHeight;
    const d  = document.createElement('div');
    d.className = 'dn';
    d.style.cssText = `color:${clr};font-size:${13 + Math.min(typeof val === 'number' ? val / 30 : 0, 9)}px;left:${sx}px;top:${sy}px;transform:translateX(-50%);position:fixed;font-family:var(--font-t,serif);font-weight:900;pointer-events:none;text-shadow:0 2px 7px rgba(0,0,0,.9);animation:fup .9s ease-out forwards;z-index:210`;
    d.textContent = val;
    document.getElementById('ui')?.appendChild(d);
    setTimeout(() => d.remove(), 950);
  },

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { Game._scene.remove(p.mesh); this.parts.splice(i, 1); continue; }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 14 * dt;
      p.mesh.material.opacity = p.life / 0.6;
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  ENEMIES  (visual only — HP and alive state from server)
// ─────────────────────────────────────────────────────────────
const Ens = {
  list:  {},   // id → { id, tid, hp, maxHp, alive, x, z }
  meshes:{},   // id → THREE.Group

  syncFromServer(enemies) {
    // Remove meshes not in new list
    const newIds = new Set(enemies.map(e => e.id));
    Object.keys(this.meshes).forEach(id => {
      if (!newIds.has(id)) { Game._scene?.remove(this.meshes[id]); delete this.meshes[id]; }
    });
    enemies.forEach(e => {
      this.list[e.id] = e;
      if (!this.meshes[e.id]) this._spawnMesh(e);
      else {
        this.meshes[e.id].position.x = e.x;
        this.meshes[e.id].position.z = e.z;
        this.meshes[e.id].visible    = e.alive;
      }
      this.updateHp(e.id, e.hp, e.maxHp, e.alive);
    });
  },

  spawnFromServer(e) {
    this.list[e.id] = e;
    this._spawnMesh(e);
  },

  _spawnMesh(e) {
    const td  = ENEMY_SHAPES[e.tid] || { c:0x888888, sz:1.0, shp:'biped' };
    const grp = this._mk(td, e.isBoss);
    grp.position.set(e.x, 0, e.z);
    grp.visible = e.alive;
    Game._scene?.add(grp);
    this.meshes[e.id] = grp;

    // Snap to terrain if scene ready
    if (Game._raycaster && Game._terrainMeshes?.length) {
      const origin = new THREE.Vector3(e.x, 500, e.z);
      Game._raycaster.set(origin, new THREE.Vector3(0, -1, 0));
      const hits = Game._raycaster.intersectObjects(Game._terrainMeshes, false);
      if (hits.length > 0) grp.position.y = hits[0].point.y;
    }
  },

  updateHp(id, hp, maxHp, alive) {
    const e = this.list[id];
    if (e) { e.hp = hp; e.maxHp = maxHp; e.alive = alive; }
    const mesh = this.meshes[id];
    if (!mesh) return;
    mesh.visible = alive;
    // Update HP bar fill
    const fill = mesh.userData.hpBar?.userData?.fill;
    if (fill) { const r = Math.max(0, hp / maxHp); fill.scale.x = r; fill.position.x = -(1 - r) * 0.5; }
  },

  nearest(px, pz, md = 5.5) {
    let best = null, bd = md;
    Object.values(this.list).forEach(e => {
      if (!e.alive) return;
      const dx = e.x - px, dz = e.z - pz;
      const d  = Math.sqrt(dx*dx + dz*dz);
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  },

  update(dt) {
    // Simple billboard HP bars + wobble — no AI (server handles that)
    Object.entries(this.meshes).forEach(([id, mesh]) => {
      const e = this.list[id];
      if (!e?.alive || !mesh.visible) return;
      if (mesh.userData.hpBar && Game._camera) mesh.userData.hpBar.lookAt(Game._camera.position);
      // Idle wobble
      if (!mesh.userData._wobble) mesh.userData._wobble = 0;
      mesh.userData._wobble += dt * 2.5;
      const bc = mesh.children[0];
      if (bc?.position) {
        const td = ENEMY_SHAPES[e.tid] || { sz:1.0, shp:'biped' };
        const baseY = (td.shp === 'wolf' ? 0.5 * td.sz : 0.45 * td.sz);
        bc.position.y = baseY + Math.sin(mesh.userData._wobble) * 0.04;
      }
    });
  },

  _mk(td, isBoss) {
    const g   = new THREE.Group();
    const s   = td.sz;
    const mat = new THREE.MeshLambertMaterial({ color: td.c });
    const em  = new THREE.MeshBasicMaterial({ color: isBoss ? 0xff0000 : 0xff4400 });

    if (td.shp === 'wolf') {
      const bd = new THREE.Mesh(new THREE.BoxGeometry(.7*s,.5*s,1.1*s), mat); bd.position.y = .5*s; bd.castShadow = true;
      const hd = new THREE.Mesh(new THREE.BoxGeometry(.55*s,.5*s,.55*s), mat); hd.position.set(0,.65*s,.55*s);
      const e1 = new THREE.Mesh(new THREE.SphereGeometry(.06,4,4), em); e1.position.set(-.14*s,.7*s,.78*s);
      const e2 = e1.clone(); e2.position.x = .14*s;
      g.add(bd, hd, e1, e2);
    } else if (td.shp === 'boss') {
      const bd = new THREE.Mesh(new THREE.BoxGeometry(.72*s,1.1*s,.52*s), mat); bd.position.y = .55*s; bd.castShadow = true;
      const hd = new THREE.Mesh(new THREE.BoxGeometry(.65*s,.65*s,.65*s), mat); hd.position.y = 1.3*s;
      for (let i = 0; i < 2; i++) {
        const h = new THREE.Mesh(new THREE.ConeGeometry(.08*s,.3*s,4), new THREE.MeshLambertMaterial({ color:0x1a0000 }));
        h.position.set((i===0?-.22:.22)*s, 1.65*s, .1*s); h.rotation.z = (i===0?.4:-.4); g.add(h);
      }
      const e1 = new THREE.Mesh(new THREE.SphereGeometry(.1,5,5), em); e1.position.set(-.17*s,1.35*s,.38*s);
      const e2 = e1.clone(); e2.position.x = .17*s;
      g.add(bd, hd, e1, e2);
    } else {
      const bd = new THREE.Mesh(new THREE.BoxGeometry(.55*s,.9*s,.38*s), mat); bd.position.y = .45*s; bd.castShadow = true;
      const hd = new THREE.Mesh(new THREE.BoxGeometry(.44*s,.44*s,.44*s), mat); hd.position.y = 1.12*s;
      const e1 = new THREE.Mesh(new THREE.SphereGeometry(.055,4,4), em); e1.position.set(-.1*s,.88*s,.26*s);
      const e2 = e1.clone(); e2.position.x = .1*s;
      g.add(bd, hd, e1, e2);
    }

    // HP bar
    const hb  = new THREE.Group();
    const ht  = td.sz * (td.shp === 'boss' ? 1.8 : td.shp === 'wolf' ? .8 : 1.2) + .5;
    const bg  = new THREE.Mesh(new THREE.PlaneGeometry(1,.1), new THREE.MeshBasicMaterial({ color:0x111111, side:THREE.DoubleSide, depthTest:false }));
    const fil = new THREE.Mesh(new THREE.PlaneGeometry(1,.1), new THREE.MeshBasicMaterial({ color:0xe74c3c, side:THREE.DoubleSide, depthTest:false }));
    fil.position.z = .001; bg.add(fil); hb.userData.fill = fil; hb.add(bg);
    hb.position.y = ht; g.userData.hpBar = hb; g.add(hb);
    return g;
  },
};

// ─────────────────────────────────────────────────────────────
//  COMBAT  (client side = validation UI + send to server)
// ─────────────────────────────────────────────────────────────
const Combat = {
  manualAttack() {
    if (!PM.group) return;
    const px = PM.group.position.x, pz = PM.group.position.z;

    if (!_target?.alive) {
      const near = _inSafe ? null : Ens.nearest(px, pz, 6);
      if (!near) { showNotif('No enemy in range', '#e74c3c'); return; }
      _target = near;
      UI.target();
    }

    // Let server enforce cooldown too, but give instant feedback
    WS.attack(_target.id);
    PM.playSlash();
    Game.playSlash();
  },

  skill(i) {
    const eid = _target?.alive ? _target.id : null;
    WS.skill(i, eid);
    PM.playSlash();
    Game.playSlash();
  },
};

// ─────────────────────────────────────────────────────────────
//  SAFE ZONE check (client mirrors this for visual only)
// ─────────────────────────────────────────────────────────────
const SAFE_ZONE = { x:0, z:-10, r:26 };
function isSafe(px, pz) {
  const dx = px - SAFE_ZONE.x, dz = pz - SAFE_ZONE.z;
  return dx*dx + dz*dz < SAFE_ZONE.r * SAFE_ZONE.r;
}

// ─────────────────────────────────────────────────────────────
//  PLAYER MESH  (GLB — visual only)
// ─────────────────────────────────────────────────────────────
const PM = {
  group:null, mixer:null, _curAnim:'idle', _loaded:false,
  _fallback:false, _weap:null, _idleAction:null, _runAction:null, _slashAction:null,

  build() {
    if (this.group) Game._scene.remove(this.group);
    this.group = new THREE.Group();
    this._addRing();
    Game._scene.add(this.group);
    this._load();
  },

  _addRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.55, .65, 16),
      new THREE.MeshBasicMaterial({ color:0x44ff88, side:THREE.DoubleSide, transparent:true, opacity:.7 })
    );
    ring.rotation.x = -Math.PI/2; ring.position.y = .05;
    this.group.add(ring);
  },

  _load() {
    if (typeof THREE.GLTFLoader === 'undefined') { this._buildFallback(); return; }
    const loader = this._makeLoader();
    loader.load('src/models/idle.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(0.01);
      model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      if (S.skin) {
        const col = new THREE.Color(S.skin);
        model.traverse(c => { if (c.isMesh && c.material) { const mats = Array.isArray(c.material) ? c.material : [c.material]; mats.forEach(m => { if (m.color) m.color.set(col); }); }});
      }
      this.group.add(model);
      this._loaded = true;
      this.mixer   = new THREE.AnimationMixer(model);
      if (gltf.animations.length > 0) {
        this._idleAction = this.mixer.clipAction(gltf.animations[0]);
        this._idleAction.play();
        this._curAnim = 'idle';
      }
      this._loadAnim('src/models/running.glb', 'running');
      this._loadAnim('src/models/slash.glb',   'slash');
    }, null, () => this._buildFallback());
  },

  _loadAnim(url, name) {
    const loader = this._makeLoader();
    loader.load(url, (gltf) => {
      if (!gltf.animations.length) return;
      const clip = gltf.animations[0]; clip.name = name;
      const action = this.mixer.clipAction(clip);
      if (name === 'running') { action.timeScale = 1.2; this._runAction = action; }
      if (name === 'slash')   { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; this._slashAction = action; }
    }, null, () => console.warn('[YGG] Anim not found:', name));
  },

  playSlash() {
    if (!this.mixer || !this._slashAction) return;
    this._slashAction.reset().play();
    this._curAnim = 'slash';
    const dur = (this._slashAction.getClip().duration || 0.8) * 1000;
    setTimeout(() => {
      this._slashAction.stop(); this._curAnim = 'idle';
      if (this._idleAction) this._idleAction.reset().play();
    }, dur * 0.9);
  },

  _buildFallback() {
    this._fallback = true;
    const bm   = new THREE.MeshLambertMaterial({ color:0x8a6040 });
    const hm   = new THREE.MeshLambertMaterial({ color: new THREE.Color(S.skin || '#d4a882') });
    const body = new THREE.Mesh(new THREE.BoxGeometry(.55,.92,.4), bm); body.position.y = .46; body.castShadow = true; this._body = body;
    const head = new THREE.Mesh(new THREE.BoxGeometry(.48,.48,.48), hm); head.position.y = 1.16;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(.5,.14,.5), new THREE.MeshLambertMaterial({ color:0x3a2010 })); hair.position.y = 1.4;
    this.group.add(body, head, hair);
    this._loaded = true;
  },

  update(dt, mv) {
    if (!this.group) return;
    if (this.mixer) this.mixer.update(dt);
    if (!this._fallback) {
      if (mv.lengthSq() > 0.04) { if (this._curAnim !== 'running' && this._runAction) { this._runAction.reset().play(); if (this._idleAction) this._idleAction.stop(); this._curAnim = 'running'; } }
      else { if (this._curAnim !== 'idle' && this._idleAction) { this._idleAction.reset().play(); if (this._runAction) this._runAction.stop(); this._curAnim = 'idle'; } }
    } else {
      if (this._body && mv.lengthSq() > 0.01) this._body.rotation.x = Math.sin(Date.now() * 0.009) * 0.08;
      else if (this._body) this._body.rotation.x *= 0.88;
    }
  },

  _makeLoader() {
    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(draco);
    return loader;
  },
};

// ─────────────────────────────────────────────────────────────
//  CHAT  (still uses Firebase Realtime DB directly — not sensitive)
// ─────────────────────────────────────────────────────────────
const Chat = {
  send() {
    const inp = document.getElementById('chat-inp');
    if (!inp) return;
    const msg = inp.value.trim();
    if (!msg) return;
    inp.value = '';
    const e = { name:S.user, msg, wtype:S.wtype, t:Date.now() };
    this.addMsg(e, true);
    if (fbRt) fbRt.ref('wc').push(e).catch(() => {});
  },
  addMsg({ name, msg, wtype }, own = false) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const d = document.createElement('div'); d.className = 'cm';
    const ico = WTYPES[wtype]?.icon || '⚔️';
    d.innerHTML = `<span class="cn cy">${ico}${name}:</span> ${msg}`;
    log.appendChild(d);
    while (log.children.length > 30) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  },
  listenWorld() {
    if (!fbRt) return;
    fbRt.ref('wc').limitToLast(15).on('child_added', snap => {
      const d = snap.val();
      if (d && d.name !== S.user) this.addMsg(d);
    });
  },
};

// ─────────────────────────────────────────────────────────────
//  CHAT tab switching
// ─────────────────────────────────────────────────────────────
Chat.tab = function(name) {
  S.chatTab = name;
  document.getElementById('tab-w')?.classList.toggle('active', name === 'world');
  document.getElementById('tab-p')?.classList.toggle('active', name === 'party');
};

// ─────────────────────────────────────────────────────────────
//  DIALOGUE  (NPC interaction — stub, expand with your NPC data)
// ─────────────────────────────────────────────────────────────
const Dialogue = {
  _npcs: [
    { name: "Marta", lines: ["Welcome, traveler. Browse my wares.", "Stay safe out there — the Draugr are restless."], x:5, z:-5 },
    { name: "Guard", lines: ["The forest is dangerous. Keep to the safe zone if you're not ready.", "Good luck, adventurer."], x:-8, z:-3 },
  ],
  _open: false,
  _cur: null,
  _lineIdx: 0,

  openNearby() {
    if (!PM.group) return;
    const px = PM.group.position.x, pz = PM.group.position.z;
    let best = null, bd = 6;
    this._npcs.forEach(n => {
      const dx = n.x - px, dz = n.z - pz;
      const d  = Math.sqrt(dx*dx + dz*dz);
      if (d < bd) { bd = d; best = n; }
    });
    if (!best) { showNotif('No one nearby to talk to', '#c9a84c'); return; }
    this._cur     = best;
    this._lineIdx = 0;
    this._open    = true;
    this._show();
  },

  _show() {
    const dlg  = document.getElementById('dlg');
    const sp   = document.getElementById('dlg-sp');
    const tx   = document.getElementById('dlg-tx');
    const cc   = document.getElementById('dlg-cc');
    if (!dlg || !this._cur) return;
    dlg.classList.add('open');
    if (sp) sp.textContent = this._cur.name;
    if (tx) tx.textContent = this._cur.lines[this._lineIdx] || '...';
    if (cc) {
      cc.innerHTML = '';
      if (this._lineIdx < this._cur.lines.length - 1) {
        const btn = document.createElement('div'); btn.className = 'dlg-choice';
        btn.textContent = '▷ Continue'; btn.onclick = () => { this._lineIdx++; this._show(); };
        cc.appendChild(btn);
      }
      const close = document.createElement('div'); close.className = 'dlg-choice';
      close.textContent = '✕ Close'; close.onclick = () => this.close();
      cc.appendChild(close);
    }
  },

  close() {
    this._open = false; this._cur = null;
    document.getElementById('dlg')?.classList.remove('open');
  },
};

// ─────────────────────────────────────────────────────────────
//  VOICE CHAT  (WebRTC stub — mute/unmute, real impl needs a
//  signaling server; this wires the UI buttons)
// ─────────────────────────────────────────────────────────────
const Voice = {
  _stream: null,
  _muted:  false,
  _active: false,

  async toggle() {
    if (this._active) {
      this._stop();
      return;
    }
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
      this._active = true;
      this._muted  = false;
      const btn = document.getElementById('voice-btn');
      if (btn) btn.textContent = '🔴';
      showNotif('🎤 Voice chat active (local only — signaling server needed for multiplayer)', '#4caf50');
      // TODO: connect to a WebRTC signaling server here for real cross-player voice
    } catch (e) {
      showNotif('🎤 Mic access denied', '#e74c3c');
    }
  },

  mute() {
    if (!this._stream) return;
    this._muted = !this._muted;
    this._stream.getAudioTracks().forEach(t => t.enabled = !this._muted);
    const btn = document.getElementById('mute-btn');
    if (btn) btn.textContent = this._muted ? '🔇' : '🔊';
  },

  _stop() {
    this._stream?.getTracks().forEach(t => t.stop());
    this._stream = null; this._active = false;
    const btn = document.getElementById('voice-btn'); if (btn) btn.textContent = '🎤';
    showNotif('🎤 Voice off', '#c9a84c');
  },
};

// ─────────────────────────────────────────────────────────────
//  SERVICE WORKER REGISTRATION
// ─────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('[SW] Register failed:', err));
  });
}

// ─────────────────────────────────────────────────────────────
//  OTHER PLAYERS  (multiplayer presence via Firebase RT DB)
// ─────────────────────────────────────────────────────────────
const OtherP = {
  ps:{},
  start() {
    if (!fbRt || !S.uid) return;
    setInterval(() => this._push(), 900);
    this._listen();
  },
  _push() {
    if (!PM.group || !fbRt) return;
    const p = PM.group.position;
    fbRt.ref('presence/' + S.uid).set({
      uid:S.uid, name:S.user, wtype:S.wtype, skin:S.skin,
      x:Math.round(p.x*10)/10, z:Math.round(p.z*10)/10, lv:S.lv, t:Date.now()
    }).catch(() => {});
  },
  _listen() {
    if (!fbRt) return;
    fbRt.ref('presence').on('value', snap => {
      const all = snap.val() || {}, now = Date.now();
      Object.keys(this.ps).forEach(uid => { if (!all[uid] || (now - all[uid].t) > 6000) this._rm(uid); });
      Object.entries(all).forEach(([uid, d]) => {
        if (uid === S.uid || (now - d.t) > 6000) return;
        if (!this.ps[uid]) this._add(uid, d);
        else               this._upd(uid, d);
      });
    });
  },
  _add(uid, d) {
    const g  = new THREE.Group();
    const bd = new THREE.Mesh(new THREE.BoxGeometry(.52,.88,.38), new THREE.MeshLambertMaterial({ color:0x8a6040 })); bd.position.y = .44;
    const hd = new THREE.Mesh(new THREE.BoxGeometry(.46,.46,.46), new THREE.MeshLambertMaterial({ color: d.skin ? new THREE.Color(d.skin).getHex() : 0xd4a882 })); hd.position.y = 1.1;
    g.add(bd, hd); g.position.set(d.x, 0, d.z); Game._scene.add(g);
    this.ps[uid] = { mesh:g, data:d };
  },
  _upd(uid, d) {
    const p = this.ps[uid]; if (!p) return;
    p.data = d;
    p.mesh.position.x += (d.x - p.mesh.position.x) * .25;
    p.mesh.position.z += (d.z - p.mesh.position.z) * .25;
  },
  _rm(uid) { const p = this.ps[uid]; if (p) Game._scene.remove(p.mesh); delete this.ps[uid]; },
};

// ─────────────────────────────────────────────────────────────
//  UI  (display only — reads from S mirror)
// ─────────────────────────────────────────────────────────────
const UI = {
  hud() {
    const hpF = document.getElementById('hp-f'), hpT = document.getElementById('hp-t');
    const spF = document.getElementById('sp-f'), spT = document.getElementById('sp-t');
    const xpF = document.getElementById('xp-f'), xpT = document.getElementById('xp-t');
    const gT  = document.getElementById('gold-t');
    if (hpF) hpF.style.width = (S.hp / S.maxHp * 100) + '%';
    if (hpT) hpT.textContent = Math.ceil(S.hp) + '/' + S.maxHp;
    if (spF) spF.style.width = (S.sp / S.maxSp * 100) + '%';
    if (spT) spT.textContent = Math.ceil(S.sp) + '/' + S.maxSp;
    if (xpF) xpF.style.width = (S.xp / S.xpN * 100) + '%';
    if (xpT) xpT.textContent = S.xp + '/' + S.xpN;
    if (gT)  gT.textContent  = S.gold;
  },

  target() {
    const thud = document.getElementById('thud');
    if (!_target?.alive) { if (thud) thud.style.display = 'none'; return; }
    const data  = Ens.list[_target.id];
    if (!data) return;
    if (thud) thud.style.display = 'block';
    const tnm = document.getElementById('t-nm'); if (tnm) tnm.textContent = (data.isBoss ? '⚠ ' : '') + data.tid;
    const thf = document.getElementById('t-hf'); if (thf) thf.style.width = (Math.max(0, data.hp / data.maxHp) * 100) + '%';
  },

  killLog(txt) {
    const kl = document.getElementById('klog'); if (!kl) return;
    const d  = document.createElement('div'); d.className = 'kl'; d.textContent = txt;
    kl.appendChild(d); setTimeout(() => d.remove(), 4000);
    while (kl.children.length > 4) kl.removeChild(kl.firstChild);
  },

  minimap(px, pz) {
    const c = document.getElementById('mm-c'); if (!c) return;
    const ctx = c.getContext('2d'), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(76,175,80,.15)';
    ctx.beginPath(); ctx.arc(W/2+(SAFE_ZONE.x-px)*W/200, H/2+(SAFE_ZONE.z-pz)*H/200, SAFE_ZONE.r*W/200, 0, Math.PI*2); ctx.fill();
    Object.values(Ens.list).forEach(e => {
      if (!e.alive) return;
      const ex = W/2+(e.x-px)*W/200, ez = H/2+(e.z-pz)*H/200;
      if (ex < 0 || ex > W || ez < 0 || ez > H) return;
      ctx.fillStyle = e.isBoss ? '#e74c3c' : '#ff8822';
      ctx.beginPath(); ctx.arc(ex, ez, e.isBoss?3:2, 0, Math.PI*2); ctx.fill();
    });
    ctx.fillStyle = '#44ff88'; ctx.beginPath(); ctx.arc(W/2, H/2, 3, 0, Math.PI*2); ctx.fill();
  },

  openShop() {
    const box = document.getElementById('shop-panel'); if (!box) return;
    box.classList.add('open');
    const sg = document.getElementById('sh-gold'); if (sg) sg.textContent = S.gold;
    const grid = document.getElementById('sh-grid'); if (!grid) return;
    grid.innerHTML = '';
    SHOP1_ITEMS.forEach(id => {
      const item = ITEMS[id]; if (!item) return;
      const div  = document.createElement('div'); div.className = 'sh-item';
      div.innerHTML = `<span>${item.ico}</span> ${item.n} — ${SHOP1_PRICES[id] || 0}🪙`;
      div.onclick = () => WS.buy(id);
      grid.appendChild(div);
    });
  },

  closeShop() { document.getElementById('shop-panel')?.classList.remove('open'); },

  renderInv() {
    const grid = document.getElementById('inv-grid'); if (!grid) return;
    grid.innerHTML = '';
    S.inv.forEach(slot => {
      const item = ITEMS[slot.id]; if (!item) return;
      const div  = document.createElement('div'); div.className = 'inv-item';
      div.innerHTML = `<div class="inv-ico">${item.ico}</div><div class="inv-nm">${item.n}</div>${slot.qty > 1 ? '<div class="inv-ct">×'+slot.qty+'</div>' : ''}`;
      div.onclick = () => WS.useItem(slot.id);
      grid.appendChild(div);
    });
  },

  renderEquip() {
    const SLOT_ID = { weapon:'eq-w', armor:'eq-a', accessory:'eq-c' };
    ['weapon','armor','accessory'].forEach(slot => {
      const el = document.getElementById(SLOT_ID[slot]); if (!el) return;
      const id = S.eq[slot]; const item = id ? ITEMS[id] : null;
      el.innerHTML = item
        ? `<div class="eq-lbl">${slot.toUpperCase()}</div><div class="eq-ico">${item.ico}</div><div class="eq-nm">${item.n}</div>`
        : `<div class="eq-lbl">${slot.toUpperCase()}</div><div class="eq-ico">—</div>`;
    });
  },

  toggleInv() {
    const p = document.getElementById('inv-panel'); if (!p) return;
    const open = p.classList.toggle('open');
    if (open) { this.renderInv(); this.renderEquip(); }
  },

  showStatPanel() {
    const panel = document.getElementById('stat-panel'); if (!panel) return;
    panel.classList.add('open');
    document.getElementById('sp-lv') && (document.getElementById('sp-lv').textContent = 'Lv ' + S.lv);
    document.getElementById('sp-nm') && (document.getElementById('sp-nm').textContent = S.user);
    document.getElementById('sp-maxhp') && (document.getElementById('sp-maxhp').textContent = S.maxHp);
    document.getElementById('sp-maxsp') && (document.getElementById('sp-maxsp').textContent = S.maxSp);
    document.getElementById('sp-hp-bar') && (document.getElementById('sp-hp-bar').style.width = (S.hp/S.maxHp*100)+'%');
    document.getElementById('sp-sp-bar') && (document.getElementById('sp-sp-bar').style.width = (S.sp/S.maxSp*100)+'%');
    document.getElementById('sp-atk')   && (document.getElementById('sp-atk').textContent   = S.atk);
    document.getElementById('sp-def')   && (document.getElementById('sp-def').textContent   = S.def);
    document.getElementById('sp-pts')   && (document.getElementById('sp-pts').textContent   = S.statPts || 0);
    document.getElementById('sp-gold')  && (document.getElementById('sp-gold').textContent  = S.gold + ' 🪙');

    // Core stat rows with pending distribution
    const CORE_MAX = 200;
    const coreStats = [
      { key:'str', label:'STR', value:S.str },
      { key:'agi', label:'AGI', value:S.agi },
      { key:'vit', label:'VIT', value:S.vit },
      { key:'dex', label:'DEX', value:S.dex },
    ];
    const totalPending = Object.values(StatDist.pending).reduce((a,b)=>a+b, 0);
    const remaining    = (S.statPts || 0) - totalPending;

    const coreRows = document.getElementById('stat-panel-core-rows');
    if (coreRows) {
      coreRows.innerHTML = coreStats.map(stat => {
        const pend    = StatDist.pending[stat.key] || 0;
        const display = stat.value + pend;
        const barW    = Math.min(100, Math.round((display / CORE_MAX) * 100));
        const pendLbl = pend > 0 ? ` <span class="stat-dist-pending">+${pend}</span>` : '';
        return `
          <div class="stat-panel-core-row stat-dist-row">
            <span class="stat-panel-core-key">${stat.label}</span>
            <div class="stat-panel-core-bar-wrap"><div class="stat-panel-core-bar" style="width:${barW}%"></div></div>
            <span class="stat-panel-core-val">${display}${pendLbl}</span>
            <button class="stat-dist-btn stat-dist-minus" onclick="StatDist.add('${stat.key}',-1)" ${pend<=0?'disabled':''}>−</button>
            <button class="stat-dist-btn stat-dist-plus"  onclick="StatDist.add('${stat.key}',1)"  ${remaining<=0?'disabled':''}>+</button>
          </div>`;
      }).join('');
    }

    const actionsEl = document.getElementById('stat-dist-actions');
    if (actionsEl) actionsEl.style.display = totalPending > 0 ? 'flex' : 'none';
  },

  closeStatPanel()   { document.getElementById('stat-panel')?.classList.remove('open'); },

  updateStatPointDot() {
    const has = (S.statPts || 0) > 0;
    ['stat-point-dot','menu-stat-dot','char-menu-stat-dot'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.display = has ? 'block' : 'none';
    });
  },

  toggleMenu() { document.getElementById('menu-panel')?.classList.toggle('open'); },
  closeMenu()  { document.getElementById('menu-panel')?.classList.remove('open'); },

  openCharacterMenu() { this.closeMenu(); document.getElementById('character-menu-panel')?.classList.add('open'); },
  closeCharacterMenu(){ document.getElementById('character-menu-panel')?.classList.remove('open'); },

  openStatsFromCharMenu()  { this.closeCharacterMenu(); this.showStatPanel(); },
  openEquipFromCharMenu()  { this.closeCharacterMenu(); this.toggleInv(); },

  openSkyMenu()  { this.closeMenu(); document.getElementById('sky-menu-panel')?.classList.add('open'); },
  closeSkyMenu() { document.getElementById('sky-menu-panel')?.classList.remove('open'); },

  setSky(path) {
    const loader = new THREE.RGBELoader();
    loader.load(path, texture => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      Game._scene.background = Game._scene.environment = texture;
    });
    if (path.includes('night'))     { Game._ambientLight.intensity = 0.15; Game._sunLight.intensity = 0.25; Game._sunLight.color.setHex(0x334466); Game._scene.fog.color.setHex(0x050510); }
    else if (path.includes('afternoon')) { Game._ambientLight.intensity = 0.4; Game._sunLight.intensity = 1.4; Game._sunLight.color.setHex(0xff7722); Game._scene.fog.color.setHex(0xff9955); }
    else { Game._ambientLight.intensity = 1.0; Game._sunLight.intensity = 2.0; Game._sunLight.color.setHex(0xffaa44); Game._scene.fog.color.setHex(0x87ceeb); }
    this.closeSkyMenu();
  },

  toggleWpn() {
    const p = document.getElementById('wpn-panel'); if (!p) return;
    if (!p.classList.toggle('open')) return;
    const list = document.getElementById('prof-list'); if (!list) return;
    list.innerHTML = Object.entries(WTYPES).map(([k, wt]) => {
      const pv  = S.prof[k] || 0;
      const pct = Math.min(100, Math.round((pv / 1000) * 100));
      return `<div class="prof-row"><div class="prof-top"><span>${wt.icon}</span><span>${wt.name}</span><span>${pv}/1000</span></div><div class="prof-bar-wrap"><div class="prof-bar" style="width:${pct}%"></div></div></div>`;
    }).join('');
  },

  toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen).call(el).catch(()=>{});
      document.getElementById('fullscreen-btn').textContent = '✕';
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen).call(document).catch(()=>{});
      document.getElementById('fullscreen-btn').textContent = '⛶';
    }
  },

  logout() {
    this.closeMenu();
    WS.save();
    if (fbAuth?.currentUser) {
      fbAuth.signOut().then(() => { localStorage.removeItem('ygg_save_v1'); location.reload(); });
    } else {
      localStorage.removeItem('ygg_save_v1'); location.reload();
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  GAME (3D scene, loop, controls)
// ─────────────────────────────────────────────────────────────
const Game = {
  MOVE_SPEED:30.0, CAM_DIST:8, CAM_HEIGHT:5, MAP_RADIUS:130,
  _scene:null, _camera:null, _renderer:null, _clock:null,
  _terrainMeshes:[], _raycaster:null, _water:null, _waterTime:0,
  _loadedAssets:0,  _keys:{}, _camYaw:0, _camPitch:0.3,
  _joystick:{ x:0, y:0 },
  _ambientLight:null, _sunLight:null,

  init() {
    document.getElementById('s-game').style.display = 'block';
    document.getElementById('lv-b').textContent = 'Lv ' + S.lv;
    document.getElementById('h-nm').textContent = S.user;
    document.getElementById('wt-txt').textContent = WTYPES[S.wtype]?.name || 'Long Sword';

    UI.updateStatPointDot();
    FX.init();

    this._setupRenderer();
    this._setupDynamicSky();
    this._addGround();
    this._addOcean();
    this._loadCharacter(() => this._loadTown());
    this._setupControls();
    this._startLoop();

    OtherP.start();
    Chat.listenWorld();

    // Periodic regen sync to server
    setInterval(() => WS.regen(0.1), 100);
    // Position sync
    setInterval(() => {
      if (PM.group) WS.position(PM.group.position.x, PM.group.position.z);
    }, 200);
  },

  playSlash() {
    // Game-level slash (same as PM.playSlash, kept for backwards compat)
    PM.playSlash();
  },

  _setupRenderer() {
    const canvas = document.getElementById('game-canvas');
    this._clock   = new THREE.Clock();
    this._scene   = new THREE.Scene();
    this._raycaster = new THREE.Raycaster(); this._raycaster.near = 0.01; this._raycaster.far = 500;
    this._camera  = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 3000);
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setSize(innerWidth, innerHeight);
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this._renderer.outputEncoding    = THREE.sRGBEncoding;
    this._renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.25;
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { this._camera.aspect = innerWidth/innerHeight; this._camera.updateProjectionMatrix(); this._renderer.setSize(innerWidth, innerHeight); }, 100);
    });
  },

  _setupDynamicSky() {
    this._ambientLight = new THREE.AmbientLight(0xffffff, 1.0); this._scene.add(this._ambientLight);
    this._sunLight = new THREE.DirectionalLight(0xffaa44, 2.0);
    this._sunLight.position.set(100, 200, 100); this._sunLight.castShadow = true;
    this._sunLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this._sunLight.shadow.camera, { near:1, far:600, left:-150, right:150, top:150, bottom:-150 });
    this._sunLight.shadow.bias = -0.0005;
    this._scene.add(this._sunLight);
    const rgbeLoader = new THREE.RGBELoader();
    rgbeLoader.load('src/img/sky.hdr', texture => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this._scene.background = this._scene.environment = texture;
    });
    this._scene.fog = new THREE.FogExp2(0x87ceeb, 0.003);
  },

  _addGround() {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(600,600), new THREE.MeshStandardMaterial({ color:0x3a2010, roughness:0.95 }));
    g.rotation.x = -Math.PI/2; g.receiveShadow = true; g.position.y = -0.05;
    this._scene.add(g); this._terrainMeshes.push(g);
  },

  _addOcean() {
    const mat = new THREE.MeshPhongMaterial({ color:0x062a52, emissive:new THREE.Color(0x061a30), specular:new THREE.Color(0x6699cc), shininess:55, transparent:true, opacity:0.94 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6000,6000), mat);
    water.rotation.x = -Math.PI/2; water.position.y = -0.6;
    this._scene.add(water); this._water = water; this._waterTime = 0;
  },

  _loadCharacter(onDone) {
    const loader = this._makeLoader();
    loader.load('src/models/running.glb', (gltf) => {
      this._char = gltf.scene;
      this._char.updateMatrixWorld(true);
      let minY = Infinity, maxY = -Infinity;
      const wp = new THREE.Vector3();
      this._char.traverse(o => { o.getWorldPosition(wp); if (wp.y < minY) minY = wp.y; if (wp.y > maxY) maxY = wp.y; });
      const skelH = maxY - minY;
      const scale = skelH > 0.01 ? 1.8 / skelH : 2;
      this._char.scale.setScalar(scale);
      this._char.position.set(0, 0, 0);
      const skinColor = new THREE.Color(S.skin || '#fff0e6');
      this._char.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => { if (m.color) m.color.set(skinColor); });
        }
      });
      this._scene.add(this._char);
      if (gltf.animations?.length) {
        this._mixer = new THREE.AnimationMixer(this._char);
        this._runAction  = this._mixer.clipAction(gltf.animations[0]);
        this._runAction.timeScale = 0;
        this._runAction.play();
        this._curCharAnim = 'running';
        const idleLoader = this._makeLoader();
        idleLoader.load('src/models/idle.glb', (gltf2) => {
          if (gltf2.animations?.length) {
            this._idleAction = this._mixer.clipAction(gltf2.animations[0]);
            this._idleAction.play(); this._curCharAnim = 'idle'; this._runAction.stop();
          }
        }, null, () => {});
        const slashLoader = this._makeLoader();
        slashLoader.load('src/models/slash.glb', (gltf3) => {
          if (gltf3.animations?.length) {
            this._slashAction = this._mixer.clipAction(gltf3.animations[0]);
            this._slashAction.setLoop(THREE.LoopOnce, 1); this._slashAction.clampWhenFinished = true;
          }
        }, null, () => {});
      }
      this._updateCamera(true);
      this._showLoadStep('char');
      if (onDone) onDone();
    }, null, err => { console.error('[YGG] Char load error', err); this._showLoadStep('char'); if (onDone) onDone(); });
  },

  _loadTown() {
    const loader = this._makeLoader();
    loader.load('src/models/town.glb', (gltf) => {
      this._town = gltf.scene;
      this._town.updateMatrixWorld(true);
      const rawBox = new THREE.Box3().setFromObject(this._town);
      const rawSize = new THREE.Vector3(); rawBox.getSize(rawSize);
      const rawSpan = Math.max(rawSize.x, rawSize.z, 0.01);
      const s = 300 / rawSpan;
      this._town.scale.setScalar(s);
      this._town.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this._town);
      const center = new THREE.Vector3(); box.getCenter(center);
      this._town.position.x = -center.x; this._town.position.z = -center.z; this._town.position.y = -box.min.y;
      this._town.updateMatrixWorld(true);
      this._town.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
      this._scene.add(this._town);

      this._terrainMeshes = [];
      this._town.traverse(child => {
        if (child.isMesh) {
          const nm = child.name.toLowerCase();
          const isVeg = ['leaf','leave','foliage','branch','bush','card','autumn','hq_oak','lantern','billboard','bucket'].some(v => nm.includes(v));
          if (!isVeg) this._terrainMeshes.push(child);
        }
      });

      PM.build();
      const snap = setInterval(() => {
        if (PM.group) {
          clearInterval(snap);
          PM.group.position.set(0, 50, 0);
          this._snapToTerrain(PM.group, true);
          if (this._char) { this._char.position.copy(PM.group.position); this._char.rotation.copy(PM.group.rotation); }
        }
      }, 50);

      this._showLoadStep('town');
    }, null, err => { console.error('[YGG] Town error', err); this._showLoadStep('town'); });
  },

  _showLoadStep(which) {
    this._loadedAssets++;
    if (this._loadedAssets >= 2) {
      const ol = document.getElementById('loading-overlay');
      if (ol) { ol.style.opacity = '0'; setTimeout(() => { ol.style.display='none'; document.getElementById('ui')?.classList.remove('hidden'); }, 600); }
    }
  },

  _makeLoader() {
    const loader = new THREE.GLTFLoader();
    if (THREE.DRACOLoader) {
      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      loader.setDRACOLoader(draco);
    }
    return loader;
  },

  _setupControls() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this._keys[e.code] = true;
      const km = { KeyZ:0, KeyX:1, KeyC:2, KeyV:3 };
      if (e.code in km) Combat.skill(km[e.code]);
      if (e.code === 'KeyI') UI.toggleInv();
      if (e.code === 'Escape') { UI.closeShop(); document.getElementById('inv-panel')?.classList.remove('open'); }
    });
    document.addEventListener('keyup', e => { if (e.target.tagName !== 'INPUT') this._keys[e.code] = false; });

    const canvas = document.getElementById('game-canvas');
    let mDown = false, mLast = 0, mLastY = 0;
    canvas.addEventListener('mousedown', e => { mDown = true; mLast = e.clientX; mLastY = e.clientY; });
    window.addEventListener('mouseup', () => { mDown = false; });
    canvas.addEventListener('mousemove', e => {
      if (!mDown) return;
      this._camYaw   -= (e.clientX - mLast) * 0.004;
      this._camPitch  = Math.max(-0.3, Math.min(1.2, this._camPitch + (e.clientY - mLastY) * 0.003));
      mLast = e.clientX; mLastY = e.clientY;
    });
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.CAM_DIST = Math.max(2, Math.min(20, this.CAM_DIST + e.deltaY * 0.01)); }, { passive:false });
    this._setupTouch();
  },

  _setupTouch() {
    const joyZone = document.getElementById('joystick-zone');
    const camZone = document.getElementById('cam-rotate-zone');
    if (!joyZone || !camZone) return;
    const knob = document.getElementById('joystick-knob');
    const MAX_R = 44;
    let joyId = null, joyX0 = 0, joyY0 = 0;
    joyZone.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; joyId = t.identifier; joyX0 = t.clientX; joyY0 = t.clientY; }, { passive:false });
    joyZone.addEventListener('touchmove',  e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        const dx = t.clientX-joyX0, dy = t.clientY-joyY0, len = Math.sqrt(dx*dx+dy*dy)||1;
        const clamp = Math.min(len, MAX_R), nx = dx/len, ny = dy/len;
        this._joystick.x = nx*(clamp/MAX_R); this._joystick.y = ny*(clamp/MAX_R);
        if (knob) knob.style.transform = `translate(${nx*clamp}px,${ny*clamp}px)`;
      }
    }, { passive:false });
    const endJoy = e => { e.preventDefault(); this._joystick.x = 0; this._joystick.y = 0; if (knob) knob.style.transform='translate(0,0)'; joyId=null; };
    joyZone.addEventListener('touchend', endJoy, { passive:false });
    joyZone.addEventListener('touchcancel', endJoy, { passive:false });

    let pinchDist=0, camId=null, camLast=0, camLastY=0;
    camZone.addEventListener('touchstart', e => {
      e.preventDefault();
      if (e.touches.length===2) { const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY; pinchDist=Math.sqrt(dx*dx+dy*dy); }
      const t=e.changedTouches[0]; camId=t.identifier; camLast=t.clientX; camLastY=t.clientY;
    }, { passive:false });
    camZone.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length===2) {
        const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY, nd=Math.sqrt(dx*dx+dy*dy);
        this.CAM_DIST = Math.max(2, Math.min(20, this.CAM_DIST-(nd-pinchDist)*0.05)); pinchDist=nd;
      }
      for (const t of e.changedTouches) {
        if (t.identifier!==camId) continue;
        this._camYaw -= (t.clientX-camLast)*0.005;
        this._camPitch = Math.max(-0.3, Math.min(1.2, this._camPitch+(t.clientY-camLastY)*0.004));
        camLast=t.clientX; camLastY=t.clientY;
      }
    }, { passive:false });
    const endCam = e => { e.preventDefault(); camId=null; };
    camZone.addEventListener('touchend', endCam, { passive:false });
    camZone.addEventListener('touchcancel', endCam, { passive:false });
  },

  _startLoop() {
    let last = 0;
    const loop = (t) => {
      requestAnimationFrame(loop);
      const dt = Math.min((t-last)/1000, 0.05); last = t;
      this._update(dt, t);
      if (this._renderer && this._scene && this._camera) this._renderer.render(this._scene, this._camera);
    };
    loop(0);
  },

  _update(dt, t) {
    if (!PM.group) return;
    const pg = PM.group;

    const kW = this._keys['KeyW'] || this._keys['ArrowUp'];
    const kS = this._keys['KeyS'] || this._keys['ArrowDown'];
    const kA = this._keys['KeyA'] || this._keys['ArrowLeft'];
    const kD = this._keys['KeyD'] || this._keys['ArrowRight'];

    let ix = ((kD?1:0)-(kA?1:0)) + this._joystick.x;
    let iz = ((kS?1:0)-(kW?1:0)) + this._joystick.y;
    const inputLen = Math.sqrt(ix*ix+iz*iz);
    if (inputLen > 1) { ix /= inputLen; iz /= inputLen; }
    const isMoving = inputLen > 0.05;
    const mv = new THREE.Vector3();

    if (isMoving) {
      const sin = Math.sin(this._camYaw), cos = Math.cos(this._camYaw);
      const dx = (-iz*sin - ix*cos) * S.spd * dt;
      const dz = (-iz*cos + ix*sin) * S.spd * dt;
      mv.set(dx, 0, dz);
      let nx = Math.max(-this.MAP_RADIUS, Math.min(this.MAP_RADIUS, pg.position.x + dx));
      let nz = Math.max(-this.MAP_RADIUS, Math.min(this.MAP_RADIUS, pg.position.z + dz));
      pg.position.x = nx; pg.position.z = nz;
      const tYaw = Math.atan2(dx, dz);
      let diff = tYaw - pg.rotation.y;
      while (diff >  Math.PI) diff -= Math.PI*2;
      while (diff < -Math.PI) diff += Math.PI*2;
      pg.rotation.y += diff * Math.min(1, 5*dt);
    }

    this._snapToTerrain(pg);
    this._updateCamera(false, dt);
    PM.update(dt, mv);

    if (this._char) {
      this._char.position.copy(pg.position);
      this._char.rotation.y = pg.rotation.y;
      if (this._mixer) this._mixer.update(dt);
      if (isMoving) {
        if (this._curCharAnim !== 'running' && this._runAction) {
          if (this._idleAction) this._runAction.crossFadeFrom(this._idleAction, 0.25, true);
          this._runAction.reset().play(); this._runAction.timeScale = 1.2;
          if (this._idleAction) this._idleAction.stop(); this._curCharAnim = 'running';
        }
      } else {
        if (this._curCharAnim !== 'idle' && this._idleAction) {
          if (this._runAction) this._idleAction.crossFadeFrom(this._runAction, 0.25, true);
          this._idleAction.reset().play();
          if (this._runAction) this._runAction.timeScale = 0; this._curCharAnim = 'idle';
        }
      }
    }

    // Safe zone
    const safeNow = isSafe(pg.position.x, pg.position.z);
    if (safeNow !== _inSafe) {
      _inSafe = safeNow;
      const sb = document.getElementById('safe-b'); if (sb) sb.style.display = safeNow?'block':'none';
    }

    // Auto-target nearest
    if (!_target?.alive) {
      const near = _inSafe ? null : Ens.nearest(pg.position.x, pg.position.z);
      if (near) { _target = near; UI.target(); }
      else if (_target) { _target = null; UI.target(); }
    }

    // Attack cooldown display (mirrored from server HIT response)
    if (S.atkCd > 0) {
      S.atkCd -= dt;
      const cdEl = document.getElementById('cd-atk');
      const btn  = document.getElementById('sk-atk');
      if (S.atkCd > 0) { if (cdEl) cdEl.textContent = Math.ceil(S.atkCd); if (btn) btn.classList.add('oncd'); }
      else { S.atkCd = 0; if (cdEl) cdEl.textContent = ''; if (btn) btn.classList.remove('oncd'); }
    }

    // Skill cooldown display
    S.scd.forEach((cd, i) => {
      if (cd <= 0) return;
      S.scd[i] -= dt;
      const cdEl = document.getElementById('cd' + i);
      if (cdEl) cdEl.textContent = S.scd[i] > 0 ? Math.ceil(S.scd[i]) : '';
      if (S.scd[i] <= 0) { S.scd[i] = 0; document.getElementById('sk'+i)?.classList.remove('oncd'); }
    });

    // Bleed indicator (driven by server BLEED messages, just keep visible while stacks > 0)
    const bleedInd = document.getElementById('bleed-ind');
    if (bleedInd) bleedInd.style.display = (S.bleedStacks > 0) ? 'block' : 'none';

    // NPC proximity hint
    if (PM.group) {
      const px2 = PM.group.position.x, pz2 = PM.group.position.z;
      const npcNear = !Dialogue._open && Dialogue._npcs?.some(n => { const dx=n.x-px2,dz=n.z-pz2; return dx*dx+dz*dz<36; });
      const hint = document.getElementById('npc-hint');
      if (hint) hint.style.display = npcNear ? 'block' : 'none';
    }

    // Boss zone check
    if (!_inBoss && pg.position.z < -45 && Math.abs(pg.position.x) < 8) {
      _inBoss = true;
      WS.send({ type:'BOSS_ZONE' });
    }

    Ens.update(dt);
    FX.update(dt);
    OtherP._push && null; // handled by interval
    UI.hud();
    UI.minimap(pg.position.x, pg.position.z);

    if (this._water) {
      this._waterTime += dt;
      const wt = this._waterTime;
      this._water.material.emissive.setRGB(
        0.02 + Math.sin(wt*.4)*.01, 0.06 + Math.sin(wt*.27)*.02, 0.14 + Math.sin(wt*.35)*.04
      );
    }
  },

  _updateCamera(snap, dt) {
    const target = PM.group || this._char; if (!target) return;
    const hDist = this.CAM_DIST * Math.cos(this._camPitch);
    const vDist = this.CAM_DIST * Math.sin(this._camPitch);
    const tx = target.position.x - Math.sin(this._camYaw) * hDist;
    const ty = target.position.y + 1.1 + vDist;
    const tz = target.position.z - Math.cos(this._camYaw) * hDist;
    if (snap) { this._camera.position.set(tx, ty, tz); }
    else {
      this._camera.position.x = THREE.MathUtils.lerp(this._camera.position.x, tx, 1);
      this._camera.position.z = THREE.MathUtils.lerp(this._camera.position.z, tz, 1);
      this._camera.position.y = THREE.MathUtils.lerp(this._camera.position.y, ty, 0.03);
    }
    this._camera.lookAt(target.position.x, target.position.y + 1.1, target.position.z);
  },

  _snapToTerrain(obj, forceSnap = false) {
    if (!this._terrainMeshes.length) return;
    const origin = new THREE.Vector3(obj.position.x, obj.position.y + 10, obj.position.z);
    this._raycaster.set(origin, new THREE.Vector3(0,-1,0));
    const hits = this._raycaster.intersectObjects(this._terrainMeshes, false);
    if (hits.length > 0) {
      if (forceSnap) obj.position.y = hits[0].point.y;
      else           obj.position.y = THREE.MathUtils.lerp(obj.position.y, hits[0].point.y, 0.05);
    }
  },

  // PWA install bar (unchanged)
};

// ─────────────────────────────────────────────────────────────
//  PWA Install bar
// ─────────────────────────────────────────────────────────────
const PWA = {
  _prompt: null,
  init() {
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); this._prompt = e; document.getElementById('pwa-bar')?.style && (document.getElementById('pwa-bar').style.display='flex'); });
  },
  install()  { this._prompt?.prompt(); },
  dismiss()  { document.getElementById('pwa-bar').style.display = 'none'; },
};
PWA.init();
