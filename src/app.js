
/* ============================================================
   Yggdrasil Online — app.js  (Full Game Logic)
   ============================================================ */

// ─────────────────────────────────────────────────────────────
//  Firebase
// ─────────────────────────────────────────────────────────────
const FBCFG = {
  apiKey: "AIzaSyCUZKyN-sxLvJCXLAOUjZ_nsRghqUagcjs",
  authDomain: "yggdrasil-online.firebaseapp.com",
  projectId: "yggdrasil-online",
  storageBucket: "yggdrasil-online.firebasestorage.app",
  messagingSenderId: "445950943508",
  appId: "1:445950943508:web:b2597f9ce1f12b8cd6a201",
  measurementId: "G-HYQSK35JBZ"
};

let fbAuth = null, fbDb = null, fbRt = null, fbOK = false;
try {
  const app = firebase.initializeApp(FBCFG);
  fbAuth = firebase.auth();
  fbDb   = firebase.firestore();
  fbRt   = firebase.database();
  fbOK   = true;
} catch (e) { console.error('[YGG] Firebase init failed:', e); }

// ─────────────────────────────────────────────────────────────
//  Fullscreen + Landscape lock
// ─────────────────────────────────────────────────────────────
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
  function onFirst() { goFullscreen(); lockLandscape(); }
  document.addEventListener('click',      onFirst, { once: true });
  document.addEventListener('touchstart', onFirst, { once: true });
})();

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
function rnd(a, b) { return a + Math.random() * (b - a); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showNotif(txt, clr = '#e8e0c8') {
  const n = document.getElementById('notif');
  if (!n) return;
  n.textContent = txt;
  n.style.color   = clr;
  n.style.opacity = '1';
  clearTimeout(showNotif._t);
  showNotif._t = setTimeout(() => n.style.opacity = '0', 2600);
}

function showScreen(name) {
  // Clean the name: if user passed 's-game', change it to 'game'
  const activeName = name.startsWith('s-') ? name.replace('s-', '') : name;

  ['s-auth', 's-create', 's-game'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    
    // Check if this ID matches our active screen
    const isTarget = (id === 's-' + activeName);
    el.style.display = isTarget ? 'block' : 'none';
  });

  // Toggle UI overlay for the game screen
  const ui = document.getElementById('ui');
  if (ui) {
    if (activeName === 'game') ui.classList.remove('hidden');
    else ui.classList.add('hidden');

  }
  
}

// ─────────────────────────────────────────────────────────────
//  DATA  (weapons, items, enemies — floor 1 only)
// ─────────────────────────────────────────────────────────────
const WTYPES = {
  '1h':    { name:'Long Sword',    icon:'🗡️',  strScale:1.0, atkMult:1.0, spdMult:1.0, vsArmored:1.0, vsFast:1.0,  canShield:true,
    skills:[
      {name:'Power Strike',    icon:'⚔️',  sp:20, cd:6,  dmg:1.8, unlock:0},
      {name:'Shield Bash',     icon:'🛡️', sp:15, cd:5,  dmg:1.2, stun:0.3, unlock:80},
      {name:'Whirlwind',       icon:'🌀', sp:35, cd:10, dmg:1.4, aoe:true, aoeR:3.2, unlock:200},
      {name:'Blade Fury',      icon:'💢', sp:45, cd:14, dmg:1.1, multi:4, unlock:400},
    ]},
  '2h':    { name:'Greatsword',    icon:'⚔️',  strScale:1.5, atkMult:1.4, spdMult:0.85, vsArmored:1.4, vsFast:0.8, canShield:false,
    skills:[
      {name:'Cleave',          icon:'🗡️', sp:25, cd:7,  dmg:2.2, unlock:0},
      {name:'Ground Slam',     icon:'💥', sp:40, cd:12, dmg:2.0, aoe:true, aoeR:3.8, unlock:100},
      {name:'Berserk Blow',    icon:'😡', sp:50, cd:15, dmg:3.0, selfDmg:0.08, unlock:280},
      {name:'Titan Strike',    icon:'⚡', sp:60, cd:18, dmg:4.0, armorBreak:true, unlock:500},
    ]},
  'dagger':{ name:'Dagger',        icon:'🔪', strScale:0.7, atkMult:0.85, spdMult:1.35, vsArmored:0.7, vsFast:1.4, canShield:true,
    skills:[
      {name:'Backstab',        icon:'🔪', sp:15, cd:5,  dmg:2.5, bleed:true, unlock:0},
      {name:'Poison Jab',      icon:'☠️', sp:20, cd:7,  dmg:1.2, bleed:true, unlock:80},
      {name:'Fan of Blades',   icon:'🌟', sp:35, cd:11, dmg:1.0, multi:5, unlock:220},
      {name:'Shadowstep',      icon:'👥', sp:25, cd:9,  dmg:3.0, unlock:380},
    ]},
  'mace':  { name:'Mace',          icon:'🔨', strScale:1.1, atkMult:1.1, spdMult:0.9,  vsArmored:1.6, vsFast:0.75,canShield:true,
    skills:[
      {name:'Skull Crack',     icon:'💀', sp:22, cd:6,  dmg:1.9, stun:0.35, unlock:0},
      {name:'Bone Breaker',    icon:'💥', sp:32, cd:9,  dmg:2.0, armorBreak:true, unlock:120},
      {name:'Shockwave',       icon:'🌊', sp:40, cd:13, dmg:1.5, aoe:true, aoeR:3.0, stun:0.2, unlock:260},
      {name:'Earthquake',      icon:'🌍', sp:55, cd:16, dmg:2.2, aoe:true, aoeR:4.5, unlock:450},
    ]},
  'axe':   { name:'Battle Axe',    icon:'🪓', strScale:1.3, atkMult:1.2, spdMult:0.95, vsArmored:1.2, vsFast:1.1, canShield:false,
    skills:[
      {name:'Rend',            icon:'🩸', sp:20, cd:5,  dmg:1.7, bleed:true, unlock:0},
      {name:'Headhunter',      icon:'🪓', sp:30, cd:8,  dmg:2.4, unlock:100},
      {name:'Rampage',         icon:'💨', sp:45, cd:12, dmg:1.3, multi:3, bleed:true, unlock:240},
      {name:'Executioner',     icon:'⚡', sp:60, cd:18, dmg:4.5, unlock:500},
    ]},
  'dual':  { name:'Dual Blades',   icon:'⚔️', strScale:0.85,atkMult:0.9,  spdMult:1.5,  vsArmored:0.75,vsFast:1.5, canShield:false, agiReq:25,
    skills:[
      {name:'Twin Strike',     icon:'✦', sp:18, cd:4,  dmg:1.0, multi:2, unlock:0},
      {name:'Blade Dance',     icon:'💃', sp:30, cd:8,  dmg:0.9, multi:4, unlock:120},
      {name:'Starburst',       icon:'🌟', sp:50, cd:14, dmg:0.8, multi:16, unlock:300},
      {name:'Cross Slash',     icon:'✕', sp:40, cd:11, dmg:2.2, unlock:480},
    ]},
};

const DATA = {
  /*enemies: {
    draugr:     { name:'Draugr',       hp:80,  def:4,  atk:10, spd:2.0, xp:25, gold:[8,15],  sz:1.0, shp:'biped',  c:0x445566, type:'armored', aggr:8,  drops:[{i:'wolfsbane',ch:.15}] },
    forestWolf: { name:'Forest Wolf',  hp:55,  def:2,  atk:12, spd:3.5, xp:18, gold:[5,10],  sz:0.9, shp:'wolf',   c:0x5a4a3a, type:'fast',    aggr:9,  drops:[{i:'wolfsbane',ch:.25}] },
    goblin:     { name:'Goblin',       hp:45,  def:1,  atk:8,  spd:3.2, xp:14, gold:[4,9],   sz:0.75,shp:'biped',  c:0x4a7a2a, type:'fast',    aggr:7,  drops:[{i:'hpPotion',ch:.1}]  },
    darkKnight: { name:'Dark Knight',  hp:140, def:10, atk:18, spd:1.8, xp:55, gold:[20,35], sz:1.2, shp:'biped',  c:0x1a1a2a, type:'armored', aggr:7,  drops:[{i:'ironSword',ch:.05}] },
    treant:     { name:'Treant',       hp:200, def:8,  atk:20, spd:1.0, xp:70, gold:[25,45], sz:1.5, shp:'biped',  c:0x3a5a1a, type:'armored', aggr:5,  drops:[{i:'leatherArmor',ch:.08}] },
    elderDraugr:{ name:'Elder Draugr', hp:320, def:14, atk:28, spd:2.2, xp:120,gold:[40,70], sz:1.3, shp:'boss',   c:0x334455, type:'armored', aggr:12, boss:true, emoji:'💀',
                  drops:[{i:'chainMail',ch:.15},{i:'steelSword',ch:.1}] },
  },*/

  floor1: {
    enemies: ['draugr','forestWolf','goblin','darkKnight','treant'],
    boss:    'elderDraugr',
  },

  items: {
    hpPotion:   { n:'HP Potion',      ico:'🧪', type:'con',     ef:{hp:80},    rar:'c', desc:'Restores 80 HP',          price:30  },
    mpPotion:   { n:'SP Potion',      ico:'💧', type:'con',     ef:{sp:40},    rar:'c', desc:'Restores 40 SP',          price:25  },
    wolfsbane:  { n:'Wolfsbane',      ico:'🌿', type:'material',               rar:'c', desc:'Herb used in alchemy'               },
    basicSword: { n:'Basic Sword',    ico:'🗡️', type:'weapon', wtype:'1h',    st:{atk:8,spd:.15},  rar:'c', desc:'Starting blade', price:0 },
    ironSword:  { n:'Iron Sword',     ico:'🗡️', type:'weapon', wtype:'1h',    st:{atk:15,spd:.2},  rar:'c', desc:'Sturdy iron',    price:120 },
    steelSword: { n:'Steel Longsword',ico:'🗡️', type:'weapon', wtype:'1h',    st:{atk:24,spd:.3},  rar:'u', desc:'Well balanced',  price:280 },
    ironDagger: { n:'Iron Dagger',    ico:'🔪', type:'weapon', wtype:'dagger', st:{atk:8,spd:.4},   rar:'c', desc:'Quick blade',    price:90  },
    ironMace:   { n:'Iron Mace',      ico:'🔨', type:'weapon', wtype:'mace',   st:{atk:16,def:2},   rar:'c', desc:'Heavy mace',     price:130 },
    ironAxe:    { n:'Iron Battle Axe',ico:'🪓', type:'weapon', wtype:'axe',    st:{atk:20,def:1},   rar:'c', desc:'Reliable axe',   price:140 },
    leatherArmor:{ n:'Leather Armor', ico:'🥋', type:'armor',                  st:{def:4,maxHp:20}, rar:'c', desc:'Basic armor',    price:80  },
    chainMail:  { n:'Chain Mail',     ico:'🔗', type:'armor',                  st:{def:9,maxHp:35}, rar:'u', desc:'Iron rings',     price:220 },
    woodenShield:{ n:'Wooden Shield', ico:'🛡️', type:'accessory', shieldOnly:true, st:{def:4}, rar:'c', desc:'1H/Mace only',    price:60  },
    hpCharm:    { n:'HP Charm',       ico:'❤️', type:'accessory',              st:{maxHp:30},       rar:'c', desc:'Bolsters vitality',price:55 },
    speedBoots: { n:'Swift Boots',    ico:'👟', type:'accessory',              st:{spd:.4},         rar:'u', desc:'Light on feet',  price:150 },
  },

  shop1: { name:"Marta's Apothecary", items:['hpPotion','mpPotion','leatherArmor','woodenShield','ironSword','ironDagger','ironMace','ironAxe','hpCharm'] },
};

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
let S = {
  uid:null, user:'Wanderer', skin:'#d4a882',
  lv:1, xp:0, xpN:100,
  str:5, agi:5, vit:5, dex:5, statPts:0,
  maxHp:200, hp:200, maxSp:100, sp:100,
  atk:12, def:2, spd:4.2, crit:.05, critMult:1.5,
  gold:0,
  wtype:'1h',
  prof:{},
  bleedStacks:0, bleedTimer:0, bleedTarget:null,
  inv:[], eq:{ weapon:null, armor:null, accessory:null },
  target:null, atkCd:0, iF:0, scd:[0,0,0,0],
  inBoss:false, inSafe:false, chatTab:'world',
};
Object.keys(WTYPES).forEach(k => S.prof[k] = 0);

// ─────────────────────────────────────────────────────────────
//  SAVE / LOAD
// ─────────────────────────────────────────────────────────────
const Save = {
  // Saves current state 'S' to both Local and Cloud (if logged in)
  save: function() {
    this.saveLocal();
    this.saveCloud();
  },

  saveLocal: function() {
    if (!S) return;
    localStorage.setItem('ygg_save_v1', JSON.stringify(S));
  },

  saveCloud: async function() {
    if (fbOK && fbAuth.currentUser && S) {
      try {
        await fbDb.collection('saves').doc(fbAuth.currentUser.uid).set(S);
      } catch (e) {
        console.error('[Save] Cloud sync failed:', e);
      }
    }
  },

  loadLocal: function() {
    const raw = localStorage.getItem('ygg_save_v1');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  },

  fromCloud: async function(uid) {
    try {
      const doc = await fbDb.collection('saves').doc(uid).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      console.error('[Save] Error fetching from cloud:', e);
      return null;
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  STAT CALCULATIONS
// ─────────────────────────────────────────────────────────────
const Stats = {
  recalc() {
    const wt  = WTYPES[S.wtype];
    const wpn = S.eq.weapon    ? DATA.items[S.eq.weapon]    : null;
    const arm = S.eq.armor     ? DATA.items[S.eq.armor]     : null;
    const acc = S.eq.accessory ? DATA.items[S.eq.accessory] : null;
    S.maxHp = 100 + (S.vit * 15) + (S.lv * 8) + (arm?.st?.maxHp || 0) + (acc?.st?.maxHp || 0);
    S.hp    = Math.min(S.hp, S.maxHp);
    S.maxSp = 60  + (S.dex * 4)  + (S.agi * 2);
    S.sp    = Math.min(S.sp, S.maxSp);
    const baseAtk = Math.floor(S.str * wt.strScale * 1.2);
    const wpnAtk  = (wpn?.st?.atk || 0) * wt.atkMult;
    S.atk = Math.floor(baseAtk + wpnAtk);
    const armDef = arm?.st?.def || 0;
    const accDef = acc?.st?.def || 0;
    S.def  = Math.floor(2 + (S.vit * .5) + armDef + accDef);
    const wpnSpd = (wpn?.st?.spd || 0) + (wt.spdMult - 1) * 1.2;
    S.spd  = 3.5 + (S.agi * .12) + wpnSpd;
    S.crit = 0.03 + (S.agi * .008) + (S.dex * .005);
    S.critMult = 1.5 + (S.dex * .02);
  },

  profGain(amt) {
    const bonus = 1 + (S.dex * .02);
    S.prof[S.wtype] = Math.min(1000, S.prof[S.wtype] + (amt * bonus));
    this.updateSkillButtons();
  },

  getUnlockedSkills() {
    const wt   = WTYPES[S.wtype];
    const prof = S.prof[S.wtype];
    return wt.skills.filter(sk => {
      if (sk.unlock > prof) return false;
      if (sk.agiReq && S.agi < sk.agiReq) return false;
      return true;
    });
  },

  updateSkillButtons() {
    const skills = this.getUnlockedSkills();
    for (let i = 0; i < 4; i++) {
      const sk = skills[i];
      const icon = document.getElementById('si' + i);
      const nm   = document.getElementById('sn' + i);
      const btn  = document.getElementById('sk' + i);
      if (icon) icon.textContent = sk ? sk.icon : '—';
      if (nm)   nm.textContent   = sk ? sk.name.substring(0, 8) : '';
      if (btn)  btn.style.opacity = sk ? '1' : '.25';
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  LEVEL UP
// ─────────────────────────────────────────────────────────────
const LvUp = {
  pending: 0, delta: { str:0, agi:0, vit:0, dex:0 },

  show(pts) {
    this.pending = pts;
    this.delta   = { str:0, agi:0, vit:0, dex:0 };
    const sub = document.getElementById('lv-sub');
    if (sub) sub.textContent = 'NOW LEVEL ' + S.lv;
    const pop = document.getElementById('lvup-popup');
    if (pop) pop.classList.add('show');
    this.render();
  },

  render() {
    const spent = Object.values(this.delta).reduce((a, b) => a + b, 0);
    const rem   = this.pending - spent;
    const pts   = document.getElementById('lv-pts');
    if (pts) pts.textContent = rem > 0 ? rem + ' point' + (rem > 1 ? 's' : '') + ' to spend' : 'All spent — confirm below';
    const confirm = document.getElementById('lv-confirm');
    if (confirm) confirm.disabled = rem > 0;
    const defs = {
      str:{ icon:'⚔️', name:'STR', desc:'ATK scaling · weapon power' },
      agi:{ icon:'💨', name:'AGI', desc:'SPD · Crit · Dual Wield unlock' },
      vit:{ icon:'❤️', name:'VIT', desc:'Max HP (+15 per point)' },
      dex:{ icon:'🎯', name:'DEX', desc:'Crit DMG · Proficiency speed' },
    };
    const rows = document.getElementById('stat-rows');
    if (!rows) return;
    rows.innerHTML = '';
    Object.entries(defs).forEach(([k, d]) => {
      const cur = S[k] + this.delta[k];
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `<div class="stat-ico">${d.icon}</div>
        <div class="stat-info"><div class="stat-name">${d.name} — ${cur}</div><div class="stat-desc">${d.desc}</div></div>
        <button class="stat-btn" onclick="LvUp.add('${k}',-1)" ${this.delta[k] <= 0 ? 'disabled' : ''}>−</button>
        <div class="stat-val">+${this.delta[k]}</div>
        <button class="stat-btn" onclick="LvUp.add('${k}',1)" ${rem <= 0 ? 'disabled' : ''}>+</button>`;
      rows.appendChild(row);
    });
  },

  add(stat, n) {
    const rem = this.pending - Object.values(this.delta).reduce((a, b) => a + b, 0);
    if (n > 0 && rem <= 0) return;
    if (n < 0 && this.delta[stat] <= 0) return;
    this.delta[stat] += n;
    this.render();
  },

  confirm() {
    Object.entries(this.delta).forEach(([k, v]) => S[k] += v);
    const pop = document.getElementById('lvup-popup');
    if (pop) pop.classList.remove('show');
    Stats.recalc();
    Stats.updateSkillButtons();
    if (S.agi >= 25 && !S._dualNotified) {
      S._dualNotified = true;
      const dn = document.getElementById('dual-notice');
      if (dn) { dn.style.display = 'block'; setTimeout(() => dn.style.display = 'none', 4000); }
    }
    Save.save();
  }
};

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────
const Auth = {
  // --- Google Login with Migration Logic ---
  google: async function() {
  console.log("Google Login Initiated...");
  const provider = new firebase.auth.GoogleAuthProvider();

  try {
    const result = await firebase.auth().signInWithPopup(provider);
    const user = result.user;
    console.log("Login Success:", user.displayName);

    // Check for existing cloud save first
    try {
      const doc = await fbDb.collection('saves').doc(user.uid).get();
      if (doc.exists) {
        console.log('[Auth] Existing save found, loading...');
        S = { ...doc.data(), uid: user.uid };
        showScreen('game');
        const waitForCanvas = setInterval(() => {
          const canvas = document.getElementById('game-canvas');
          if (canvas && canvas.clientWidth > 0) {
            clearInterval(waitForCanvas);
            try { Game.init(); } catch(e) { console.error('Game.init() failed:', e); }
          }
        }, 50);
        return;
      }
    } catch(e) {
      console.error('[Auth] Cloud load failed:', e);
    }

    // No save found — show character creation
    // No save found — show character creation
console.log('[Auth] No save found, showing character creation...');
if (window.CC) CC._renderer = null;

CC.show('google');

setTimeout(() => {
  const ni = document.getElementById('cc-ni');
  if (ni && user.displayName) ni.value = user.displayName.split(' ')[0];
  CC._buildUI();
  setTimeout(() => {
    if (CC._renderer === null) CC._initScene();
  }, 500);
}, 300);

  } catch(error) {
    console.error("Google Auth Error:", error.code, error.message);
    if (error.code !== 'auth/popup-closed-by-user') {
      alert("Login failed: " + error.message);
    }
  }
},

  guest: function() {
  const localData = Save.loadLocal();
  if (localData) {
    console.log("[Auth] Existing guest found. Loading...");
    S = localData;
    showScreen('s-game');
    const waitForCanvas = setInterval(() => {
  const canvas = document.getElementById('game-canvas');
  if (canvas && canvas.clientWidth > 0) {
    clearInterval(waitForCanvas);
    try { Game.init(); } catch(e) { console.error('Game.init() failed:', e); }
  }
}, 50); // Go straight to game
    // Initialize game world here (Load maps, etc.)
  } else {
    console.log("[Auth] No guest save. Moving to Character Creation.");
    // Reset state to defaults for a new player
    S = {
  uid: 'guest_' + Date.now(),
  isGuest: true,
  user: 'Wanderer',
  skin: '#d4a882',
  lv: 1, xp: 0, xpN: 100,
  hp: 200, maxHp: 200,
  sp: 100, maxSp: 100,
  str: 5, agi: 5, vit: 5, dex: 5,
  statPts: 0,
  gold: 0, wtype: '1h',
  prof: {},
  bleedStacks: 0, bleedTimer: 0, bleedTarget: null,
  inv: [], eq: { weapon: null, armor: null, accessory: null },
  target: null, atkCd: 0, iF: 0, scd: [0,0,0,0],
  inBoss: false, inSafe: false, chatTab: 'world',
};
Object.keys(WTYPES).forEach(k => S.prof[k] = 0);
    showScreen('s-create'); // Show the creation UI
    CC.show('guest');     // Start the 3D preview scene
  }
}
};

// ─────────────────────────────────────────────────────────────
//  CHARACTER CREATION
// ─────────────────────────────────────────────────────────────
const CC = {
  selectedColor: '#d4a882',
  authType:      'guest',
  _scene: null, _camera: null, _renderer: null, _model: null, _animId: null,

  show(type = 'guest') {
    this.authType = type;

    // 1. Show character creation screen
    const sc = document.getElementById('s-create');
    if (sc) {
      sc.classList.remove('hidden');
      sc.style.display = 'flex';
    }

    // 2. Hide auth screen
    const sa = document.getElementById('s-auth');
    if (sa) sa.style.display = 'none';

    // 3. Build the right panel UI
    this._buildUI();

    // 4. Start 3D engine after layout settles
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._initScene();
      });
    });
  },

  selectColor(el) {
    document.querySelectorAll('.cc-color').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    this.selectedColor = el.getAttribute('data-color');
    this._applyColor(this.selectedColor);
  },

  // This is the function your script currently has
  submit: function() {
    // 1. Updated 'char-name' to 'cc-ni' to match your HTML
    const nameEl = document.getElementById('cc-ni'); 
    const name   = nameEl ? nameEl.value.trim() : '';
    
    if (name.length < 2) { 
        // Using a simple alert if showNotif isn't ready yet
        if (window.showNotif) showNotif('Name must be 2–20 characters', '#e74c3c');
        else alert('Name must be 2-20 characters');
        return; 
    }

    // 2. Set the Global State (S)
    S.user  = name;
    S.skin  = this.selectedColor;
    S.uid  = fbAuth.currentUser ? fbAuth.currentUser.uid : 'guest_' + Date.now();
    S.wtype = '1h';
    S.str = 5; S.agi = 5; S.vit = 5; S.dex = 5;
    
    // Check if Stats object exists before calling recalc
    if (window.Stats) Stats.recalc();
    
    S.hp = S.maxHp || 200; 
    S.sp = S.maxSp || 100;
    S.inv = [{ id:'hpPotion', qty:3 }, { id:'basicSword', qty:1 }];

    // 3. Cleanup the 3D Character Preview
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }

    // 4. Firebase Save (If logged in)
    if (window.fbOK && window.fbDb && fbAuth.currentUser) {
      fbDb.collection('characters').doc(fbAuth.currentUser.uid)
        .set({ name: S.user, skin: S.skin })
        .catch((e) => console.error("Cloud save failed:", e));
    }
    
    // 5. Local Save
    if (window.Save) Save.save();

    // 6. Transition to Game
    showScreen('game');
const waitForCanvas = setInterval(() => {
  const canvas = document.getElementById('game-canvas');
  console.log('canvas check:', canvas?.clientWidth, canvas?.clientHeight);
  if (canvas && canvas.clientWidth > 0) {
    clearInterval(waitForCanvas);
    console.log('canvas ready, calling Game.init()');
    try {
      Game.init();
    } catch(e) {
      console.error('Game.init() failed:', e);
    }
  }
}, 50);
    },

    // THE LAZY FIX: This allows the HTML button calling CC.finish() to work!
    finish: function() {
    this.submit();
    },

    _initScene() {
    // 1. Prevent double-initialization
    if (this._renderer) { 
        if (!this._animId) this._startLoop(); 
        return; 
    }
  
    // 2. Target the correct canvas from your index.html
    const canvas = document.getElementById('cc-cv'); 
    if (!canvas) return;
    
    const viewport = canvas.parentElement;
    
    // 3. THE FIX: If clientWidth is 0, use window dimensions so the 3D scene actually has a size
    const w = viewport.clientWidth  || (window.innerWidth * 0.4); // Assume 40% width for left panel
    const h = viewport.clientHeight || (window.innerHeight * 0.8);

    this._scene  = new THREE.Scene();
    
    // 4. Camera Setup
    this._camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    this._camera.position.set(0, 0.9, 3.8);
    this._camera.lookAt(0, 0.9, 0);

    // 5. Renderer Setup
    this._renderer = new THREE.WebGLRenderer({ 
        canvas: canvas, 
        alpha: true, 
        antialias: true 
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(w, h);
    this._renderer.outputEncoding = THREE.sRGBEncoding;
    this._renderer.setClearColor(0x000000, 0);

    // 6. Resize Observer (Keeps the character centered if window changes)
    const ro = new ResizeObserver(() => {
        const nw = viewport.clientWidth, nh = viewport.clientHeight;
        if (!nw || !nh) return;
        this._camera.aspect = nw / nh;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(nw, nh);
    });
    ro.observe(viewport);

    // 7. Lighting
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 5);
    this._scene.add(key);

    // 8. Load the 3D Model
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
      this._model.traverse(o => {
        o.getWorldPosition(wp);
        if (wp.y < minY) minY = wp.y;
        if (wp.y > maxY) maxY = wp.y;
      });
      const skelH = maxY - minY;
      const scale = skelH > 0.01 ? 1.8 / skelH : 1.0;
      this._model.scale.setScalar(scale);
      this._model.position.y = -minY * scale;

      // Setup idle animation
      if (gltf.animations && gltf.animations.length) {
        const mixer  = new THREE.AnimationMixer(this._model);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
        this._mixer = mixer;
      }

      this._applyColor(this.selectedColor);
      this._startLoop();
    }, null, (err) => { console.error('[YGG] idle.glb error:', err); this._showFallback(); });
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
    let last = 0;
    const loop = (t) => {
      this._animId = requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.05); last = t;
      if (this._model)  this._model.rotation.y += 0.008;
      if (this._mixer)  this._mixer.update(dt);
      this._renderer.render(this._scene, this._camera);
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

  const colors = [
    { hex: '#ffe0bd', label: 'Pale'  },
    { hex: '#f1c27d', label: 'Light' },
    { hex: '#d4a882', label: 'Tan'   },
    { hex: '#c68642', label: 'Brown' },
    { hex: '#8d5524', label: 'Dark'  },
  ];

  const weapons = [
    { key: '1h',     label: '1-H Sword', icon: '🗡️' },
    { key: '2h',     label: 'Greatsword',icon: '⚔️'  },
    { key: 'dagger', label: 'Dagger',    icon: '🔪' },
    { key: 'mace',   label: 'Mace',      icon: '🔨' },
    { key: 'axe',    label: 'Battle Axe',icon: '🪓' },
  ];

  rows.innerHTML = `
    <div class="cc-section">
      <div class="cc-row-lbl">SKIN TONE</div>
      <div class="cc-colors">
        ${colors.map(c => `
          <div class="cc-color ${c.hex === this.selectedColor ? 'selected' : ''}"
               data-color="${c.hex}"
               style="background:${c.hex}"
               onclick="CC.selectColor(this)"
               title="${c.label}">
          </div>
        `).join('')}
      </div>
    </div>

    <div class="cc-section">
      <div class="cc-row-lbl">STARTING WEAPON</div>
      <div class="cc-wpns">
        ${weapons.map((w, i) => `
          <div class="cc-wpn ${i === 0 ? 'selected' : ''}"
               data-wtype="${w.key}"
               onclick="CC.selectWeapon(this)">
            <span class="cc-wpn-ico">${w.icon}</span>
            <span class="cc-wpn-nm">${w.label}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
},

// Add this alongside _buildUI:
selectWeapon(el) {
  document.querySelectorAll('.cc-wpn').forEach(w => w.classList.remove('selected'));
  el.classList.add('selected');
  S.wtype = el.getAttribute('data-wtype');
  const wt = document.getElementById('wt-txt');
  if (wt) wt.textContent = WTYPES[S.wtype].name;
},
};

// ─────────────────────────────────────────────────────────────
//  INVENTORY
// ─────────────────────────────────────────────────────────────
const Inv = {
  add(id, qty = 1) {
    const ex = S.inv.find(i => i.id === id);
    if (ex) ex.qty += qty;
    else    S.inv.push({ id, qty });
  },
  remove(id, qty = 1) {
    const ex = S.inv.find(i => i.id === id);
    if (!ex) return false;
    ex.qty -= qty;
    if (ex.qty <= 0) S.inv = S.inv.filter(i => i.id !== id);
    return true;
  },
  count(id) { return (S.inv.find(i => i.id === id) || { qty:0 }).qty; },
  use(id) {
    const item = DATA.items[id];
    if (!item) return;
    if (item.type === 'con') {
      if (item.ef?.hp) { S.hp = Math.min(S.maxHp, S.hp + item.ef.hp); showNotif('+' + item.ef.hp + ' HP', '#4caf50'); }
      if (item.ef?.sp) { S.sp = Math.min(S.maxSp, S.sp + item.ef.sp); showNotif('+' + item.ef.sp + ' SP', '#5dade2'); }
      this.remove(id, 1);
    } else if (['weapon','armor','accessory'].includes(item.type)) {
      this.equip(id);
    }
    UI.renderInv();
  },
  equip(id) {
    const item = DATA.items[id];
    if (!item) return;
    if (item.shieldOnly) {
      const wt = WTYPES[S.wtype];
      if (!wt.canShield) { showNotif('Cannot use shield with ' + wt.name, '#e74c3c'); return; }
    }
    if (item.wtype === 'dual' && S.agi < 25) { showNotif('Dual Wield requires AGI 25+', '#e74c3c'); return; }
    const slot = item.type;
    if (S.eq[slot]) {
      Inv.add(S.eq[slot], 1);
      const old = DATA.items[S.eq[slot]];
      if (old?.st) Object.entries(old.st).forEach(([k, v]) => { if (k !== 'wtype') S[k] -= v; });
    }
    S.eq[slot] = id;
    this.remove(id, 1);
    if (item.st) Object.entries(item.st).forEach(([k, v]) => { if (k !== 'wtype') S[k] += v; });
    if (item.wtype) {
      S.wtype = item.wtype;
      const wt = document.getElementById('wt-txt');
      if (wt) wt.textContent = WTYPES[S.wtype].name;
      PM.rebuildWeapon();
      Stats.updateSkillButtons();
    }
    Stats.recalc();
    showNotif('Equipped: ' + item.n, '#e8c96a');
    UI.renderEquip();
  }
};

// ─────────────────────────────────────────────────────────────
//  PLAYER LEVEL
// ─────────────────────────────────────────────────────────────
const Player = {
  lvCheck() {
    while (S.xp >= S.xpN) {
      S.xp -= S.xpN;
      S.lv++;
      S.xpN = Math.floor(100 * Math.pow(1.3, S.lv - 1));
      S.statPts += 5;
      const lb = document.getElementById('lv-b');
      if (lb) lb.textContent = 'Lv ' + S.lv;
      showNotif('🍃 LEVEL UP! Lv.' + S.lv + ' — Spend your stat points!', '#e8c96a');
      LvUp.show(5);
      Save.save();
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  FX (particles + floating damage numbers + projectiles)
// ─────────────────────────────────────────────────────────────
const FX = {
  projs: [], parts: [],
  PM: {
    rune:  new THREE.MeshBasicMaterial({ color:0x44ff88 }),
    arrow: new THREE.MeshBasicMaterial({ color:0xd4a844 }),
  },
  PG: new THREE.SphereGeometry(0.15, 5, 5),
  PC: [0xffcc44, 0xff8822, 0x88ff88, 0xffffff, 0xc0392b],

  fireProj(from, enemy, dmg, clr) {
    const m = new THREE.Mesh(this.PG, this.PM[clr] || this.PM.rune);
    m.position.copy(from); m.position.y = 1;
    Game._scene.add(m);
    const dir = new THREE.Vector3().subVectors(enemy.mesh.position, from).normalize();
    this.projs.push({ mesh:m, dir, target:enemy, dmg, spd:20, life:1.8 });
  },

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
    const ui = document.getElementById('ui');
    if (ui) ui.appendChild(d);
    setTimeout(() => d.remove(), 950);
  },

  update(dt) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      p.life -= dt;
      if (p.life <= 0 || !p.target.alive) { Game._scene.remove(p.mesh); this.projs.splice(i, 1); continue; }
      p.mesh.position.addScaledVector(p.dir, p.spd * dt);
      const dx = p.mesh.position.x - p.target.mesh.position.x;
      const dz = p.mesh.position.z - p.target.mesh.position.z;
      if (Math.sqrt(dx*dx + dz*dz) < 0.85) {
        Combat.deal(p.target, p.dmg);
        this.hit(p.mesh.position.clone());
        Game._scene.remove(p.mesh);
        this.projs.splice(i, 1);
      }
    }
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
  }
};

// ─────────────────────────────────────────────────────────────
//  COMBAT
// ─────────────────────────────────────────────────────────────
const Combat = {
  deal(enemy, rawDmg, opts = {}) {
    if (!enemy?.alive) return;
    const wt = WTYPES[S.wtype];
    let effMult = 1;
    if (enemy.type.type === 'armored') effMult = wt.vsArmored;
    else if (enemy.type.type === 'fast') effMult = wt.vsFast;
    const effDef   = enemy.armorBroken ? Math.floor(enemy.def * .6) : enemy.def;
    const isCrit   = Math.random() < S.crit;
    const critM    = isCrit ? S.critMult : 1;
    const finalDmg = Math.max(1, Math.floor(rawDmg * effMult * critM - effDef));
    enemy.hp -= finalDmg;
    Ens.updBar(enemy);
    const clr   = isCrit ? '#ffdd00' : effMult > 1 ? '#ff8844' : effMult < 1 ? '#aaaaaa' : '#e8e0c8';
    const label = isCrit ? '✦' + finalDmg : (effMult > 1 ? '▲' + finalDmg : '' + finalDmg);
    FX.floatAt(label, clr, enemy.mesh.position);
    if (S.target === enemy) UI.target();
    const bb = document.getElementById('boss-bf');
    if (enemy.isBoss && bb) bb.style.width = (Math.max(0, enemy.hp / enemy.maxHp) * 100) + '%';
    if (opts.bleed) { S.bleedTarget = enemy; S.bleedStacks = Math.min(5, (S.bleedStacks || 0) + 1); S.bleedTimer = 4; }
    if (opts.stun && Math.random() < opts.stun) enemy.stunT = 1.2 + Math.random() * .8;
    if (opts.armorBreak) enemy.armorBroken = true;
    if (opts.selfDmg) { const sd = Math.floor(S.maxHp * opts.selfDmg); S.hp = Math.max(1, S.hp - sd); }
    if (enemy.hp <= 0) Ens.kill(enemy);
  },

  skill(i) {
    const skills = Stats.getUnlockedSkills();
    const sk = skills[i];
    if (!sk) return;
    if (S.scd[i] > 0) { showNotif('Recharging…', '#c9a84c'); return; }
    if (S.sp < sk.sp) { showNotif('Not enough SP', '#5dade2'); return; }
    S.sp = Math.max(0, S.sp - sk.sp);
    const baseD = Math.floor(S.atk * sk.dmg * (0.85 + Math.random() * .3));
    const opts  = { bleed:!!sk.bleed, stun:sk.stun || 0, armorBreak:!!sk.armorBreak, selfDmg:sk.selfDmg || 0 };

    if (sk.aoe) {
      let h = 0;
      const pg = PM.group.position;
      Ens.list.forEach(e => {
        if (!e.alive) return;
        const dx = e.mesh.position.x - pg.x, dz = e.mesh.position.z - pg.z;
        if (Math.sqrt(dx*dx + dz*dz) < sk.aoeR) { this.deal(e, baseD, opts); h++; }
      });
      FX.hit(pg.clone(), 22);
      showNotif(sk.icon + ' ' + sk.name + ' — ' + h + ' hit', '#c9a84c');
    } else if (sk.proj || sk.ranged) {
      if (!S.target?.alive) { showNotif('No target', '#e74c3c'); return; }
      const count = sk.multi || 1;
      for (let m = 0; m < count; m++) {
        setTimeout(() => {
          if (S.target?.alive) FX.fireProj(PM.group.position.clone(), S.target, Math.floor(S.atk * sk.dmg * (0.85 + Math.random() * .3)), 'rune');
        }, m * 120);
      }
      showNotif(sk.icon + ' ' + sk.name, '#c9a84c');
    } else if (sk.multi) {
      if (!S.target?.alive) { showNotif('No target', '#e74c3c'); return; }
      for (let m = 0; m < sk.multi; m++) {
        setTimeout(() => {
          if (S.target?.alive) this.deal(S.target, Math.floor(S.atk * sk.dmg * (0.9 + Math.random() * .2)), opts);
        }, m * 100);
      }
      showNotif(sk.icon + ' ' + sk.name + ' x' + sk.multi, '#c9a84c');
    } else {
      if (!S.target?.alive) { showNotif('No target', '#e74c3c'); return; }
      this.deal(S.target, baseD, opts);
      showNotif(sk.icon + ' ' + sk.name, '#c9a84c');
    }
    if (sk.name === 'Starburst') showNotif('🌟 STARBURST STREAM! 16-HIT BURST! rawwwrrr', '#fa00ed');
    S.scd[i] = sk.cd;
    const btn = document.getElementById('sk' + i);
    if (btn) btn.classList.add('oncd');
    PM.playSlash();
    Game.playSlash();
  },

  death() {
    S.hp = Math.floor(S.maxHp * .4);
    S.bleedStacks = 0;
    if (PM.group) PM.group.position.set( 15.347, 36.205, 102.491);
    S.target = null;
    const thud = document.getElementById('thud');
    if (thud) thud.style.display = 'none';
    showNotif('💀 You fell — returned to the World Tree', '#e74c3c');
  }
};

// Bleed DoT
function tickBleed(dt) {
  if (!S.bleedStacks || !S.bleedTarget?.alive) return;
  S.bleedTimer -= dt;
  if (S.bleedTimer <= 0) {
    S.bleedStacks = 0;
    const bi = document.getElementById('bleed-ind');
    if (bi) bi.style.display = 'none';
    return;
  }
  if (!S._bleedTick) S._bleedTick = 0;
  S._bleedTick += dt;
  if (S._bleedTick >= 1) {
    S._bleedTick = 0;
    const dmg = Math.floor(S.atk * .12 * S.bleedStacks);
    if (S.bleedTarget.alive) {
      Combat.deal(S.bleedTarget, dmg);
      FX.floatAt('🩸' + dmg, '#c0392b', S.bleedTarget.mesh.position);
    }
  }
  const bi = document.getElementById('bleed-ind');
  if (bi) bi.style.display = 'block';
}

// ─────────────────────────────────────────────────────────────
//  ENEMIES
// ─────────────────────────────────────────────────────────────
const Ens = {
  list: [],
  spts: [[18,2],[-18,14],[10,24],[-24,-18],[30,30],[-34,22],[14,-28],[34,-14],[-14,34],[24,-34],[-30,-30],[40,8],[-40,-8],[2,40],[2,-40],[44,20],[-44,20],[18,-44]],

  build() {
    this.list.forEach(e => Game._scene.remove(e.mesh));
    this.list = [];
    const enemies = DATA.floor1.enemies;
    for (let i = 0; i < 14; i++) {
      this.spawn(enemies[Math.floor(Math.random() * enemies.length)], i);
    }
  },

  spawn(tid, si) {
    const td = DATA.enemies[tid];
    if (!td) return;
    const sp = this.spts[si % this.spts.length];
    const sx = sp[0] + rnd(-3, 3), sz = sp[1] + rnd(-3, 3);
    const mesh = this._mk(td);
    mesh.position.set(sx, 500, sz);
    Game._scene.add(mesh);
    // Snap to terrain
    const origin = new THREE.Vector3(sx, 500, sz);
    Game._raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    const hits = Game._raycaster.intersectObjects(Game._terrainMeshes, false);
    if (hits.length > 0) mesh.position.y = hits[0].point.y;
    else mesh.position.y = 0;
    this.list.push({
      id:tid, mesh, type:td, hp:td.hp, maxHp:td.hp, def:td.def,
      state:'idle', atkCd:0, idleT:rnd(.8, 2.5), alive:true,
      aggrR:td.aggr, atkR:td.sz * (td.shp === 'wolf' ? 1.4 : 1.2),
      ox:sx, oz:sz, wobble:0, stunT:0, armorBroken:false,
      pTgt: new THREE.Vector3(sx + rnd(-9, 9), 0, sz + rnd(-9, 9))
    });
  },

  spawnBoss(tid) {
  const td = DATA.enemies[tid];
  if (!td) return null;

  const mesh = this._mk(td);
  mesh.scale.setScalar(1.2);

  // Snap to terrain
  const bossX = 0, bossZ = -54;
  mesh.position.set(bossX, 500, bossZ);
  Game._scene.add(mesh);

  const origin = new THREE.Vector3(bossX, 500, bossZ);
  Game._raycaster.set(origin, new THREE.Vector3(0, -1, 0));
  const hits = Game._raycaster.intersectObjects(Game._terrainMeshes, false);
  const groundY = hits.length > 0 ? hits[0].point.y : 0;
  mesh.position.set(bossX, groundY, bossZ);

  const e = {
    id:tid, mesh, type:td, hp:td.hp, maxHp:td.hp, def:td.def,
    state:'idle', atkCd:0, idleT:1, alive:true,
    aggrR:22, atkR:4.5, ox:bossX, oz:bossZ,
    wobble:0, stunT:0, isBoss:true, armorBroken:false,
    pTgt: new THREE.Vector3(bossX, groundY, bossZ)
  };

  this.list.push(e);
  return e;
},

  _mk(td) {
    const g   = new THREE.Group();
    const s   = td.sz;
    const mat = new THREE.MeshLambertMaterial({ color:td.c });
    const em  = new THREE.MeshBasicMaterial({ color: td.boss ? 0xff0000 : 0xff4400 });

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
      // biped
      const bd = new THREE.Mesh(new THREE.BoxGeometry(.55*s,.9*s,.38*s), mat); bd.position.y = .45*s; bd.castShadow = true;
      const hd = new THREE.Mesh(new THREE.BoxGeometry(.44*s,.44*s,.44*s), mat); hd.position.y = 1.12*s;
      const e1 = new THREE.Mesh(new THREE.SphereGeometry(.055,4,4), em); e1.position.set(-.1*s,.88*s,.26*s);
      const e2 = e1.clone(); e2.position.x = .1*s;
      g.add(bd, hd, e1, e2);
    }

    // Health bar
    const hb   = new THREE.Group();
    const ht   = td.sz * (td.shp === 'boss' ? 1.8 : td.shp === 'wolf' ? .8 : 1.2) + .5;
    const bg   = new THREE.Mesh(new THREE.PlaneGeometry(1,.1), new THREE.MeshBasicMaterial({ color:0x111111, side:THREE.DoubleSide, depthTest:false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1,.1), new THREE.MeshBasicMaterial({ color:0xe74c3c, side:THREE.DoubleSide, depthTest:false }));
    fill.position.z = .001; bg.add(fill); hb.userData.fill = fill; hb.add(bg);
    hb.position.y = ht; g.userData.hpBar = hb; g.add(hb);
    return g;
  },

  updBar(e) {
    const f = e.mesh.userData.hpBar?.userData?.fill;
    if (!f) return;
    const r = Math.max(0, e.hp / e.maxHp);
    f.scale.x = r; f.position.x = -(1 - r) * .5;
  },

  kill(e) {
    e.alive = false;
    Game._scene.remove(e.mesh);
    const gd = Math.floor(rnd(e.type.gold[0], e.type.gold[1]));
    S.gold += gd; S.xp += e.type.xp;
    (e.type.drops || []).forEach(d => { if (Math.random() < d.ch) Inv.add(d.i, 1); });
    UI.killLog('+' + e.type.xp + ' XP  +' + gd + '🪙  ' + e.type.name);
    Stats.profGain(rnd(2, 5));
    Player.lvCheck();
    FX.floatAt(e.type.xp, '#e8c96a', e.mesh.position);
    if (e.isBoss) {
      S.inBoss = false;
      const bb = document.getElementById('bossbar');
      if (bb) bb.style.display = 'none';
      setTimeout(() => onBossDefeated(), 1500);
    } else {
      setTimeout(() => {
        if (this.list.filter(x => x.alive && !x.isBoss).length < 14)
          this.spawn(e.id, Math.floor(Math.random() * this.spts.length));
      }, 8000);
    }
  },

  nearest(px, pz, md = 5.5) {
    let best = null, bd = md;
    this.list.forEach(e => {
      if (!e.alive) return;
      const dx = e.mesh.position.x - px, dz = e.mesh.position.z - pz;
      const d  = Math.sqrt(dx*dx + dz*dz);
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  },

  update(dt, px, pz, t) {
    const inSafe = isSafe(px, pz);
    this.list.forEach(e => {
      if (!e.alive) return;
      if (e.stunT > 0) { e.stunT -= dt; return; }
      if (isSafe(e.mesh.position.x, e.mesh.position.z) && !e.isBoss) { e.state = 'idle'; e.idleT = 2; return; }
      const dx   = px - e.mesh.position.x, dz = pz - e.mesh.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (e.state === 'idle') {
        e.idleT -= dt;
        if (e.idleT <= 0) { e.state = 'patrol'; e.pTgt.set(e.ox + rnd(-10,10), 0, e.oz + rnd(-10,10)); }
        if (dist < e.aggrR && !inSafe) e.state = 'chase';
      } else if (e.state === 'patrol') {
        const tx = e.pTgt.x - e.mesh.position.x, tz = e.pTgt.z - e.mesh.position.z;
        const pd = Math.sqrt(tx*tx + tz*tz);
        if (pd < .8) { e.state = 'idle'; e.idleT = rnd(.8, 2.5); }
        else { e.mesh.position.x += tx/pd*e.type.spd*.5*dt; e.mesh.position.z += tz/pd*e.type.spd*.5*dt; e.mesh.rotation.y = Math.atan2(tx, tz); }
        if (dist < e.aggrR && !inSafe) e.state = 'chase';
      } else if (e.state === 'chase') {
        if (inSafe) { e.state = 'idle'; e.idleT = 2; return; }
        if (dist < e.atkR) e.state = 'attack';
        else if (dist > e.aggrR * 2.8) { e.state = 'idle'; e.idleT = rnd(.8, 2); }
        else { e.mesh.position.x += dx/dist*e.type.spd*dt; e.mesh.position.z += dz/dist*e.type.spd*dt; e.mesh.rotation.y = Math.atan2(dx, dz); }
      } else {
        if (inSafe || dist > e.atkR * 1.8) { e.state = 'chase'; return; }
        e.atkCd -= dt;
        if (e.atkCd <= 0) {
          e.atkCd = 1.5 + Math.random() * .8;
          if (S.iF <= 0) {
            const dmg = Math.max(1, Math.floor(e.type.atk * (0.8 + Math.random() * .4)) - S.def);
            S.hp = Math.max(0, S.hp - dmg);
            FX.floatAt(dmg, '#e74c3c', { x:px, y:0, z:pz });
            S.iF = .5;
            if (S.hp <= 0) Combat.death();
          }
        }
      }
      e.wobble += dt * 2.5;
      const bc = e.mesh.children[0];
      if (bc?.position) bc.position.y = (e.type.shp === 'wolf' ? .5*e.type.sz : .45*e.type.sz) + Math.sin(e.wobble) * .04;
      if (e.mesh.userData.hpBar && Game._camera) e.mesh.userData.hpBar.lookAt(Game._camera.position);
    });
  }
};

// ─────────────────────────────────────────────────────────────
//  SAFE ZONE + BOSS ZONE
// ─────────────────────────────────────────────────────────────
const SAFE_ZONE = { x:0, z:-10, r:26 };
function isSafe(px, pz) {
  const dx = px - SAFE_ZONE.x, dz = pz - SAFE_ZONE.z;
  return dx*dx + dz*dz < SAFE_ZONE.r * SAFE_ZONE.r;
}

function checkBoss(px, pz) {
  if (S.inBoss) return;
  if (pz < -45 && Math.abs(px) < 8) {
    S.inBoss = true;
    startBoss(DATA.floor1.boss);
  }
}

async function startBoss(bid) {
  const bd  = DATA.enemies[bid];
  const bi_em = document.getElementById('bi-em');
  const bi_nm = document.getElementById('bi-nm');
  if (bi_em) bi_em.textContent = bd.emoji || '💀';
  if (bi_nm) bi_nm.textContent = bd.name.toUpperCase();
  // show boss intro overlay briefly
  const bi = document.getElementById('s-boss');
  if (bi) { bi.style.display = 'flex'; await sleep(2000); bi.style.display = 'none'; }
  const e   = Ens.spawnBoss(bid);
  const bnm = document.getElementById('boss-nm');
  const bb  = document.getElementById('bossbar');
  const bf  = document.getElementById('boss-bf');
  if (bnm) bnm.textContent = '⚠ ' + bd.name.toUpperCase();
  if (bf)  bf.style.width  = '100%';
  if (bb)  bb.style.display = 'block';
  showNotif('☠ ' + bd.name + ' has appeared!', '#e74c3c');
}

function onBossDefeated() {
  showNotif('🏆 Floor 1 CLEARED! All floors complete — more coming soon.', '#e8c96a');
  Save.save();
}

// ─────────────────────────────────────────────────────────────
//  PLAYER MESH (GLB with animations)
// ─────────────────────────────────────────────────────────────
const PM = {
  group: null, mixer: null, clips: {}, actions: {},
  _curAnim: 'idle', _loaded: false, _weap: null,
  _fallback: false,

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

      // Apply skin color
      if (S.skin) {
        const col = new THREE.Color(S.skin);
        model.traverse(c => {
          if (c.isMesh && c.material) {
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach(m => { if (m.color) m.color.set(col); });
          }
        });
      }

      this.group.add(model);
      this._loaded = true;
      this.mixer = new THREE.AnimationMixer(model);
      if (gltf.animations.length > 0) {
        this.clips.idle   = gltf.animations[0];
        this.actions.idle = this.mixer.clipAction(this.clips.idle);
        this.actions.idle.play();
      }
      this._loadAnim('src/models/running.glb', 'running');
      this._loadAnim('src/models/slash.glb',   'slash');
      this._addWeapon(model);
    }, null, (err) => { console.warn('GLB load failed, fallback', err); this._buildFallback(); });
  },

  _loadAnim(url, name) {
    const loader = this._makeLoader();
    loader.load(url, (gltf) => {
      if (gltf.animations.length > 0) {
        const clip = gltf.animations[0];
        clip.name  = name;
        this.clips[name]   = clip;
        this.actions[name] = this.mixer.clipAction(clip);
        if (name === 'running') this.actions[name].timeScale = 1.2;
      }
    }, null, () => { console.warn('Could not load anim:', name); });
  },

  _addWeapon(model) {
    let rightHand = null;
    model.traverse(c => {
      if (c.isBone && (c.name === 'mixamorigRightHand' || c.name.includes('RightHand'))) rightHand = c;
    });
    const g  = new THREE.Group();
    const wm = new THREE.MeshLambertMaterial({ color:0xc0c8d0 });
    const gm = new THREE.MeshLambertMaterial({ color:0xc9a84c });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.02,.55,.018), wm); blade.position.y = .28;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(.1,.025,.025), gm);
    const grip  = new THREE.Mesh(new THREE.BoxGeometry(.018,.12,.018), new THREE.MeshLambertMaterial({ color:0x2a1a08 })); grip.position.y = -.08;
    g.add(blade, guard, grip);
    if (rightHand) { g.position.set(0,.1,0); g.rotation.x = Math.PI*.5; rightHand.add(g); }
    else           { g.position.set(.38,.9,.1); this.group.add(g); }
    this._weap = g;
  },

  _buildFallback() {
    this._fallback = true;
    const bm = new THREE.MeshLambertMaterial({ color:0x8a6040 });
    const hm = new THREE.MeshLambertMaterial({ color: new THREE.Color(S.skin || '#d4a882') });
    const body = new THREE.Mesh(new THREE.BoxGeometry(.55,.92,.4), bm); body.position.y = .46; body.castShadow = true; this._body = body;
    const head = new THREE.Mesh(new THREE.BoxGeometry(.48,.48,.48), hm); head.position.y = 1.16;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(.5,.14,.5), new THREE.MeshLambertMaterial({ color:0x3a2010 })); hair.position.y = 1.4;
    const wg   = this._weaponMesh(); wg.position.set(.42,.76,0); this._weap = wg;
    this.group.add(body, head, hair, wg);
    this._loaded = true;
  },

  _weaponMesh() {
    const g     = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.07,.75,.06), new THREE.MeshLambertMaterial({ color:0x8a7a6a })); blade.position.y = .05;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(.22,.07,.07), new THREE.MeshLambertMaterial({ color:0xc9a84c })); guard.position.y = -.32;
    g.add(blade, guard);
    return g;
  },

  play(name, crossfade = 0.25) {
    if (this._curAnim === name || !this.mixer) return;
    const next = this.actions[name];
    const cur  = this.actions[this._curAnim];
    if (!next) return;
    this._curAnim = name;
    next.reset().play();
    if (cur && crossfade > 0) next.crossFadeFrom(cur, crossfade, true);
  },

  rebuildWeapon() { /* weapons are bone-attached; no rebuild needed */ },

  playSlash() {
  if (!this._mixer || !this._slashAction) return;
  console.log('[YGG] playSlash called');
  this._slashAction.reset().play();
  this._curCharAnim = 'slash';
  const dur = (this._slashAction.getClip().duration || 0.8) * 1000;
  setTimeout(() => {
    this._slashAction.stop();
    this._curCharAnim = 'idle';
    if (this._idleAction) this._idleAction.reset().play();
  }, dur * 0.9);
},

  update(dt, mv) {
    if (!this.group) return;
    if (this.mixer) this.mixer.update(dt);
    if (!this._fallback) {
      if (mv.lengthSq() > .04) this.play('running');
      else                      this.play('idle');
    } else {
      if (this._body && mv.lengthSq() > .01) this._body.rotation.x = Math.sin(Date.now() * .009) * .08;
      else if (this._body)                    this._body.rotation.x *= .88;
    }
  },

  _makeLoader() {
    const draco = new THREE.DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/');
    const loader = new THREE.GLTFLoader();
    loader.setDRACOLoader(draco);
    return loader;
  }
};

// ─────────────────────────────────────────────────────────────
//  OTHER PLAYERS (multiplayer presence)
// ─────────────────────────────────────────────────────────────
const OtherP = {
  ps: {},
  start() {
    if (!fbOK || !S.uid) return;
    setInterval(() => this._push(), 900);
    this._listen();
  },
  _push() {
    if (!PM.group || !fbOK) return;
    const p = PM.group.position;
    fbRt.ref('presence/' + S.uid).set({
      uid:S.uid, name:S.user, wtype:S.wtype, skin:S.skin,
      x: Math.round(p.x*10)/10, z: Math.round(p.z*10)/10,
      lv:S.lv, t: Date.now()
    }).catch(() => {});
  },
  _listen() {
    if (!fbOK) return;
    fbRt.ref('presence').on('value', snap => {
      const all = snap.val() || {};
      const now = Date.now();
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
    const bd = new THREE.Mesh(new THREE.BoxGeometry(.52,.88,.38), new THREE.MeshLambertMaterial({ color:0x8a6040 })); bd.position.y = .44; bd.castShadow = true;
    const hd = new THREE.Mesh(new THREE.BoxGeometry(.46,.46,.46), new THREE.MeshLambertMaterial({ color: d.skin ? new THREE.Color(d.skin).getHex() : 0xd4a882 })); hd.position.y = 1.1;
    g.add(bd, hd);
    g.position.set(d.x, 0, d.z);
    g.userData.isOP = true;
    Game._scene.add(g);
    this.ps[uid] = { mesh:g, data:d };
  },
  _upd(uid, d) {
    const p = this.ps[uid];
    if (!p) return;
    p.data = d;
    p.mesh.position.x += (d.x - p.mesh.position.x) * .25;
    p.mesh.position.z += (d.z - p.mesh.position.z) * .25;
  },
  _rm(uid) {
    const p = this.ps[uid];
    if (p) Game._scene.remove(p.mesh);
    delete this.ps[uid];
  },
  update() {}
};

// ─────────────────────────────────────────────────────────────
//  CHAT
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
    if (fbOK && fbRt) fbRt.ref('wc').push(e).catch(() => {});
  },
  addMsg({ name, msg, wtype }, own = false) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const d   = document.createElement('div');
    d.className = 'cm';
    const ico = wtype ? WTYPES[wtype]?.icon || '⚔️' : '⚔️';
    d.innerHTML = `<span class="cn cy">${ico}${name}:</span> ${msg}`;
    log.appendChild(d);
    while (log.children.length > 30) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  },
  listenWorld() {
    if (!fbOK || !fbRt) return;
    fbRt.ref('wc').limitToLast(15).on('child_added', snap => {
      const d = snap.val();
      if (d && d.name !== S.user) this.addMsg(d);
    });
  }
};

// ─────────────────────────────────────────────────────────────
//  UI
// ─────────────────────────────────────────────────────────────
const UI = {
  toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    const req = el.requestFullscreen 
      || el.webkitRequestFullscreen 
      || el.mozRequestFullScreen;
    if (req) req.call(el).catch(() => {});
    document.getElementById('fullscreen-btn').textContent = '✕';
  } else {
    const ex = document.exitFullscreen 
      || document.webkitExitFullscreen 
      || document.mozCancelFullScreen;
    if (ex) ex.call(document).catch(() => {});
    document.getElementById('fullscreen-btn').textContent = '⛶';
    }
    },
  hud() {
    const hpF = document.getElementById('hp-f');
    const hpT = document.getElementById('hp-t');
    const spF = document.getElementById('sp-f');
    const spT = document.getElementById('sp-t');
    const xpF = document.getElementById('xp-f');
    const xpT = document.getElementById('xp-t');
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
    if (!S.target?.alive) { if (thud) thud.style.display = 'none'; return; }
    const td   = S.target.type;
    const tnm  = document.getElementById('t-nm');
    const thf  = document.getElementById('t-hf');
    const ttyp = document.getElementById('t-type');
    if (thud) thud.style.display = 'block';
    if (tnm)  tnm.textContent = (S.target.isBoss ? '⚠ ' : '') + td.name;
    if (thf)  thf.style.width = (Math.max(0, S.target.hp / S.target.maxHp) * 100) + '%';
    if (ttyp) {
      const wt  = WTYPES[S.wtype];
      const eff = td.type === 'armored' ? wt.vsArmored : td.type === 'fast' ? wt.vsFast : 1;
      const effT = eff > 1.2 ? '⚔ Effective!' : eff < 0.8 ? '✗ Weak' : 'Neutral';
      ttyp.textContent = td.type.toUpperCase() + ' · ' + effT;
      ttyp.style.color = eff > 1.2 ? '#e8c96a' : eff < 0.8 ? '#e74c3c' : 'rgba(232,224,200,.35)';
    }
  },

  killLog(txt) {
    const kl = document.getElementById('klog');
    if (!kl) return;
    const d  = document.createElement('div');
    d.className = 'kl';
    d.textContent = txt;
    kl.appendChild(d);
    setTimeout(() => d.remove(), 4000);
    while (kl.children.length > 4) kl.removeChild(kl.firstChild);
  },

  minimap(px, pz) {
    const c = document.getElementById('mm-c');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, W, H);
    // safe zone
    ctx.fillStyle = 'rgba(76,175,80,.15)';
    ctx.beginPath();
    ctx.arc(W/2 + (SAFE_ZONE.x - px) * W/200, H/2 + (SAFE_ZONE.z - pz) * H/200, SAFE_ZONE.r * W/200, 0, Math.PI*2);
    ctx.fill();
    // enemies
    Ens.list.forEach(e => {
      if (!e.alive) return;
      const ex = W/2 + (e.mesh.position.x - px) * W/200;
      const ez = H/2 + (e.mesh.position.z - pz) * H/200;
      if (ex < 0 || ex > W || ez < 0 || ez > H) return;
      ctx.fillStyle = e.isBoss ? '#e74c3c' : '#ff8822';
      ctx.beginPath(); ctx.arc(ex, ez, e.isBoss ? 3 : 2, 0, Math.PI*2); ctx.fill();
    });
    // player dot
    ctx.fillStyle = '#44ff88';
    ctx.beginPath(); ctx.arc(W/2, H/2, 3, 0, Math.PI*2); ctx.fill();
  },

  openShop(shopId) {
    const shop = DATA[shopId] || DATA.shop1;
    const box  = document.getElementById('shop-panel');
    if (!box) return;
    box.classList.add('open');
    const gold = document.getElementById('sh-gold-t');
    if (gold) gold.textContent = '🪙 ' + S.gold;
    const list = document.getElementById('sh-list');
    if (!list) return;
    list.innerHTML = '';
    shop.items.forEach(id => {
      const item = DATA.items[id];
      if (!item) return;
      const div = document.createElement('div');
      div.className = 'sh-item';
      const rarCls = { c:'rc', u:'ru', r:'rr', e:'re' }[item.rar] || '';
      div.classList.add(rarCls);
      div.innerHTML = `<span class="sh-ico">${item.ico}</span><div class="sh-inf"><div class="sh-nm">${item.n}</div><div class="sh-desc">${item.desc||''}</div>${item.st?'<div class="sh-stat">'+Object.entries(item.st).map(([k,v])=>k+':+'+v).join(' ')+'</div>':''}</div><span class="sh-price">${item.price||0}🪙</span>`;
      div.onclick = () => this.buyItem(id, item);
      list.appendChild(div);
    });
  },

  buyItem(id, item) {
    const price = item.price || 0;
    if (S.gold < price) { showNotif('Not enough gold', '#e74c3c'); return; }
    S.gold -= price;
    Inv.add(id, 1);
    const gT = document.getElementById('gold-t');
    if (gT) gT.textContent = S.gold;
    const sg = document.getElementById('sh-gold-t');
    if (sg) sg.textContent = '🪙 ' + S.gold;
    showNotif('Bought: ' + item.n, '#e8c96a');
    Save.save();
  },

  closeShop() {
    const box = document.getElementById('shop-panel');
    if (box) box.classList.remove('open');
  },

  renderInv() {
    const grid = document.getElementById('inv-grid');
    if (!grid) return;
    grid.innerHTML = '';
    S.inv.forEach(slot => {
      const item = DATA.items[slot.id];
      if (!item) return;
      const div = document.createElement('div');
      div.className = 'inv-item';
      div.innerHTML = `<div class="inv-ico">${item.ico}</div><div class="inv-nm">${item.n}</div>${slot.qty > 1 ? '<div class="inv-ct">×'+slot.qty+'</div>' : ''}`;
      div.onclick = () => { Inv.use(slot.id); };
      grid.appendChild(div);
    });
  },

  renderEquip() {
    const slots = ['weapon','armor','accessory'];
    slots.forEach(slot => {
      const el  = document.getElementById('eq-' + slot);
      const id  = S.eq[slot];
      const item = id ? DATA.items[id] : null;
      if (!el) return;
      el.innerHTML = item ? `<div class="eq-lbl">${slot.toUpperCase()}</div><div class="eq-ico">${item.ico}</div><div class="eq-nm">${item.n}</div>` : `<div class="eq-lbl">${slot.toUpperCase()}</div><div class="eq-ico">—</div>`;
    });
  },

  toggleInv() {
    const p = document.getElementById('inv-panel');
    if (!p) return;
    const open = p.classList.toggle('open');
    if (open) { this.renderInv(); this.renderEquip(); }
  },

  showStatPanel() {
    const p = document.getElementById('stat-panel');
    if (!p) return;
    p.classList.add('open');
    const rows = document.getElementById('stat-panel-rows');
    if (!rows) return;
    rows.innerHTML = [
      ['STR', S.str], ['AGI', S.agi], ['VIT', S.vit], ['DEX', S.dex],
      ['ATK', S.atk], ['DEF', S.def], ['SPD', S.spd.toFixed(1)],
      ['CRIT', (S.crit * 100).toFixed(1) + '%'],
      ['Gold', S.gold + '🪙'],
    ].map(([k, v]) => `<div class="stat-panel-row"><span>${k}</span><span class="stat-panel-val">${v}</span></div>`).join('');
  }
};

// ─────────────────────────────────────────────────────────────
//  GAME WORLD (preserves existing renderer, sky, town GLB)
// ─────────────────────────────────────────────────────────────
const Game = {
  playSlash() {
  if (!this._mixer || !this._slashAction) return;
  this._slashAction.reset().play();
  this._curCharAnim = 'slash';
  const dur = (this._slashAction.getClip().duration || 0.8) * 1000;
  setTimeout(() => {
    this._slashAction.stop();
    this._curCharAnim = 'idle';
    if (this._idleAction) this._idleAction.reset().play();
  }, dur * 0.9);
},
  CHAR_SCALE : 1.0,
  TOWN_SCALE : 1.0,
  MOVE_SPEED : 30.0,
  CAM_DIST   : 8,
  CAM_HEIGHT : 5,
  CAM_LERP   : 0.06,
  MAP_RADIUS : 130,

  _scene:    null,
  _camera:   null,
  _renderer: null,
  _clock:    null,
  _animId:   null,
  _char:     null,
  _town:     null,
  _terrainMeshes:   [],
  _collisionMeshes: [],
  _raycaster: null,
  _water:     null,
  _waterTime: 0,
  _loadedAssets: 0,
  _loadTimeout: null,
  _keys: {},
  _camYaw:    0,
  _camPitch:  0.3,
  _mouseDown: false,
  _joystick:  { x:0, y:0 },

  init() {
  const sg = document.getElementById('s-game');
    if (sg) sg.style.display = 'block';

  // Update HUD
  const lb = document.getElementById('lv-b');
    if (lb) lb.textContent = 'Lv ' + S.lv;
  const hn2 = document.getElementById('h-nm');
    if (hn2) hn2.textContent = S.user;
  const wt = document.getElementById('wt-txt');
    if (wt) wt.textContent = WTYPES[S.wtype]?.name || 'Long Sword';

  Stats.recalc();
  Stats.updateSkillButtons();

  this._loadedAssets = 0;
  this._loadTimeout = setTimeout(() => {
    const ol = document.getElementById('loading-overlay');
      if (ol) { ol.style.opacity = '0'; ol.style.display = 'none'; }
    const ui = document.getElementById('ui');
      if (ui) ui.classList.remove('hidden');
        }, 30000);

  // Setup must happen in this exact order
  this._setupRenderer();   // creates this._scene first
  this._setupDynamicSky();
  this._addGround();
  this._addOcean();
  this._loadCharacter(() => this._loadTown()); // scene exists now
  this._setupControls();
  this._startLoop();

  OtherP.start();
  Chat.listenWorld();


  document.addEventListener('keydown', () => {
    const h = document.getElementById('controls-hint');
      if (h) h.style.opacity = '0';
  }, { once: true });
    },

  // ── Renderer ────────────────────────────────────────────────
  _setupRenderer() {
    const canvas = document.getElementById('game-canvas');
    this._clock    = new THREE.Clock();
    this._scene    = new THREE.Scene();
    this._raycaster = new THREE.Raycaster();
    this._raycaster.near = 0.01;
    this._raycaster.far  = 500;
    this._camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);

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
    resizeTimer = setTimeout(() => {
    this._camera.aspect = innerWidth / innerHeight;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(innerWidth, innerHeight);
  }, 100);
  });
  },

  // ── Sunset sky (unchanged from original app.js) ─────────────
  _setupDynamicSky() {
  // Lights
  this._ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  this._scene.add(this._ambientLight);

  this._sunLight = new THREE.DirectionalLight(0xffaa44, 2.0);
  this._sunLight.position.set(100, 200, 100);
  this._sunLight.castShadow = true;
  this._sunLight.shadow.mapSize.set(2048, 2048);
  this._sunLight.shadow.camera.near   = 1;
  this._sunLight.shadow.camera.far    = 600;
  this._sunLight.shadow.camera.left   = -150;
  this._sunLight.shadow.camera.right  = 150;
  this._sunLight.shadow.camera.top    = 150;
  this._sunLight.shadow.camera.bottom = -150;
  this._sunLight.shadow.bias = -0.0005;
  this._scene.add(this._sunLight);

  // 360 sky texture
  // HDR sky
  const rgbeLoader = new THREE.RGBELoader();
rgbeLoader.load('src/img/sky.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  this._scene.background = texture;
  this._scene.environment = texture; // also adds realistic lighting
});

  // Fog
  this._scene.fog = new THREE.FogExp2(0x87ceeb, 0.003);

},

  _addGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color:0x3a2010, roughness:0.95, metalness:0.0 })
    );
    ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; ground.position.y = -0.05;
    this._scene.add(ground);
    this._terrainMeshes.push(ground);
  },

  _addOcean() {
    const geo = new THREE.PlaneGeometry(6000, 6000);
    const mat = new THREE.MeshPhongMaterial({ color:0x062a52, emissive:new THREE.Color(0x061a30), specular:new THREE.Color(0x6699cc), shininess:55, transparent:true, opacity:0.94 });
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI/2; water.position.y = -0.6;
    this._scene.add(water);
    this._water = water; this._waterTime = 0;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.MAP_RADIUS + 2, this.MAP_RADIUS + 40, 64),
      new THREE.MeshBasicMaterial({ color:0xff5500, transparent:true, opacity:0.08, side:THREE.DoubleSide, depthWrite:false, blending:THREE.AdditiveBlending })
    );
    ring.rotation.x = -Math.PI/2; ring.position.y = -0.3; this._scene.add(ring);
  },

 // ── Load character (running.glb) ─────────────────────────────
_loadCharacter(onDone) {
  const slashLoader = this._makeLoader();
slashLoader.load('src/models/slash.glb', (gltf3) => {
  if (gltf3.animations?.length) {
    const slashClip = gltf3.animations[0];
    this._slashAction = this._mixer.clipAction(slashClip);
    this._slashAction.setLoop(THREE.LoopOnce, 1);
    this._slashAction.clampWhenFinished = true;
  }
}, null, () => { console.warn('[YGG] slash.glb not found'); });
  const loader = this._makeLoader();
  loader.load('src/models/running.glb', (gltf) => {
    this._char = gltf.scene;
    this._char.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity;
    const wp = new THREE.Vector3();
    this._char.traverse(o => { o.getWorldPosition(wp); if (wp.y < minY) minY = wp.y; if (wp.y > maxY) maxY = wp.y; });
    const skelH = maxY - minY;
    const finalScale = (skelH > 0.01 ? 1.8 / skelH : 2) * this.CHAR_SCALE;
    this._char.scale.setScalar(finalScale);
    this._char.position.set(-107.89, 14.64, 92.24); //change PM.group.position.set(0, 0, 0); too
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
  this._mixer      = new THREE.AnimationMixer(this._char);
  this._runAction  = this._mixer.clipAction(gltf.animations[0]);
  this._curCharAnim = 'running';
  this._runAction.play();
  this._runAction.timeScale = 0;
}

// Load idle animation separately
const idleLoader = this._makeLoader();
idleLoader.load('src/models/idle.glb', (gltf2) => {
  if (gltf2.animations?.length) {
    const idleClip = gltf2.animations[0];
    this._idleAction = this._mixer.clipAction(idleClip);
    this._idleAction.play();
    this._curCharAnim = 'idle';
    this._runAction.stop();
  }
}, null, () => { console.warn('[YGG] idle.glb not found for char'); });
    this._updateCamera(true);
    this._showLoadStep('char');
    if (onDone) onDone();
  }, null, err => { console.error('[YGG] Character load error:', err); this._showLoadStep('char'); if (onDone) onDone(); });
},

// ── Load town.glb ────────────────────────────────────────────
_loadTown() {
  const loader = this._makeLoader();
  loader.load('src/models/town.glb', (gltf) => {

    this._town = gltf.scene;
    this._town.updateMatrixWorld(true);

    // Get raw size before scaling
    const rawBox  = new THREE.Box3().setFromObject(this._town);
    const rawSize = new THREE.Vector3();
    rawBox.getSize(rawSize);
    const rawSpan = Math.max(rawSize.x, rawSize.z, 0.01);

    console.log('[YGG] Town raw size:', rawSize, 'rawSpan:', rawSpan);

    // Scale town to fit the map
    const s = (300 / rawSpan) * this.TOWN_SCALE;
    this._town.scale.setScalar(s);
    this._town.updateMatrixWorld(true);

    // Re-measure after scaling then center it
    const box    = new THREE.Box3().setFromObject(this._town);
    const center = new THREE.Vector3();
    box.getCenter(center);
    this._town.position.x = -center.x;
    this._town.position.z = -center.z;
    this._town.position.y = -box.min.y; // sit on ground

    this._town.updateMatrixWorld(true);

    // Shadows
    this._town.traverse(child => {
      if (child.isMesh) {
        child.castShadow    = true;
        child.receiveShadow = true;
      }
    });

    this._scene.add(this._town);
    console.log('[YGG] Town loaded. Scale:', s, 'RawSpan:', rawSpan, 'FinalBox:', new THREE.Box3().setFromObject(this._town));

    // Terrain meshes for snap (exclude trees/leaves)
    this._terrainMeshes = [];
this._town.traverse(child => {
  if (child.isMesh) {
    const nm = child.name.toLowerCase();
    const isVegetation = 
      nm.includes('leaf') ||
      nm.includes('leave') ||
      nm.includes('foliage') ||
      nm.includes('branch') ||
      nm.includes('bush') ||
      nm.includes('card') ||
      nm.includes('autumn') ||
      nm.includes('hq_oak') ||
      nm.includes('lantern') ||
      nm.includes('billboard') ||
      nm.includes('bucket');
    if (!isVegetation) this._terrainMeshes.push(child);
  }
});
console.log('[YGG] Terrain only meshes:', this._terrainMeshes.map(m => m.name));

    // Collision meshes
    this._collisionMeshes = [];
this._town.traverse(child => {
  if (child.isMesh) {
    const nm = child.name.toLowerCase();
    const isTree = nm.includes('leaf') ||
                   nm.includes('leave') ||
                   nm.includes('foliage') ||
                   nm.includes('branch') ||
                   nm.includes('oak') ||
                   nm.includes('bush') ||
                   nm.includes('card') ||
                   nm.includes('hq_oak');
    if (!isTree) this._collisionMeshes.push(child);
  }
});

    console.log('[YGG] Terrain meshes:', this._terrainMeshes.length, 'Collision meshes:', this._collisionMeshes.length);

    // Build player mesh
    PM.build();

    // Wait for PM.group to exist then snap to terrain
    const snapInterval = setInterval(() => {
  if (PM.group) {
    clearInterval(snapInterval);
    PPM.group.position.set(0, 50, 0);
this._snapToTerrain(PM.group, true);
    if (this._char) {
      this._char.position.copy(PM.group.position);
      this._char.rotation.copy(PM.group.rotation);
    }
  }
}, 50);

    // Build enemies
    Ens.build();

    this._showLoadStep('town');

  }, 
  (xhr) => {
    // Progress
    const pct = Math.round(xhr.loaded / xhr.total * 100);
    console.log('[YGG] Town loading:', pct + '%');
  },
  (err) => {
    console.error('[YGG] Town load error:', err);
    this._showLoadStep('town');
  });
},

_showLoadStep(which) {
  this._loadedAssets++;
  if (this._loadedAssets >= 2) {
    const ol = document.getElementById('loading-overlay');
    if (ol) {
      ol.style.opacity = '0';
      setTimeout(() => {
        ol.style.display = 'none';
        // Show UI only after both assets are fully loaded
        const ui = document.getElementById('ui');
        if (ui) ui.classList.remove('hidden');
      }, 600);
    }
    clearTimeout(this._loadTimeout);
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
  // ── Controls ─────────────────────────────────────────────────
  _setupControls() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this._keys[e.code] = true;
      // skill hotkeys
      const km = { KeyZ:0, KeyX:1, KeyC:2, KeyV:3 };
      if (e.code in km) Combat.skill(km[e.code]);
      if (e.code === 'KeyI') UI.toggleInv();
      if (e.code === 'Escape') {
        UI.closeShop();
        const ip = document.getElementById('inv-panel'); if (ip) ip.classList.remove('open');
        const lp = document.getElementById('lvup-popup'); if (lp) lp.classList.remove('show');
      }
    });
    document.addEventListener('keyup', e => { if (e.target.tagName !== 'INPUT') this._keys[e.code] = false; });

    const canvas = document.getElementById('game-canvas');
    let mDown = false, mLast = 0, mLastY = 0;
canvas.addEventListener('mousedown', e => { mDown = true; this._mouseDown = true; mLast = e.clientX; mLastY = e.clientY; });
    window.addEventListener('mouseup', () => { mDown = false; this._mouseDown = false; });
    canvas.addEventListener('mousemove', e => {
  if (!mDown) return;
  this._camYaw -= (e.clientX - mLast) * .004;
  this._camPitch = Math.max(-0.3, Math.min(1.2, this._camPitch + (e.clientY - mLastY) * .003));
  mLast = e.clientX;
  mLastY = e.clientY;
});
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.CAM_DIST = Math.max(2, Math.min(20, this.CAM_DIST + e.deltaY * .01)); }, { passive:false });
    canvas.addEventListener('mouseleave', () => { mDown = false; this._mouseDown = false; });
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
        const dx = t.clientX - joyX0, dy = t.clientY - joyY0;
        const len   = Math.sqrt(dx*dx + dy*dy) || 1;
        const clamp = Math.min(len, MAX_R);
        const nx = dx/len, ny = dy/len;
        this._joystick.x = nx * (clamp / MAX_R);
        this._joystick.y = ny * (clamp / MAX_R);
        if (knob) knob.style.transform = `translate(${nx*clamp}px,${ny*clamp}px)`;
      }
    }, { passive:false });
    const endJoy = e => { e.preventDefault(); this._joystick.x = 0; this._joystick.y = 0; if (knob) knob.style.transform = 'translate(0,0)'; joyId = null; };
    joyZone.addEventListener('touchend',    endJoy, { passive:false });
    joyZone.addEventListener('touchcancel', endJoy, { passive:false });

    let pinchDist = 0, camId = null, camLast = 0, camLastY = 0;
    camZone.addEventListener('touchstart', e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDist = Math.sqrt(dx*dx + dy*dy);
      }
      this._mouseDown = true;
      const t = e.changedTouches[0]; camId = t.identifier; camLast = t.clientX; camLastY = t.clientY;
    }, { passive:false });
    camZone.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const nd = Math.sqrt(dx*dx + dy*dy);
        this.CAM_DIST = Math.max(2, Math.min(20, this.CAM_DIST - (nd - pinchDist) * .05));
        pinchDist = nd;
      }
      for (const t of e.changedTouches) {
        if (t.identifier !== camId) continue;
        this._camYaw -= (t.clientX - camLast) * .005;
this._camPitch = Math.max(-0.3, Math.min(1.2, this._camPitch + (t.clientY - camLastY) * .004));
camLast = t.clientX;
camLastY = t.clientY;
      }
    }, { passive:false });
    const endCam = e => { e.preventDefault(); camId = null; this._mouseDown = false; };
    camZone.addEventListener('touchend',    endCam, { passive:false });
    camZone.addEventListener('touchcancel', endCam, { passive:false });
  },

  // ── Main loop ────────────────────────────────────────────────
  _startLoop() {
    let last = 0;
    const loop = (t) => {
      this._animId = requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.05); last = t;
      this._update(dt, t);
      
      if (this._renderer && this._scene && this._camera) this._renderer.render(this._scene, this._camera);
    };
    loop(0);
  },

  // ── Update ───────────────────────────────────────────────────
  _update(dt, t) {
    if (!PM.group) return;
    const pg = PM.group;

    // Movement input
    const kW = this._keys['KeyW'] || this._keys['ArrowUp'];
    const kS = this._keys['KeyS'] || this._keys['ArrowDown'];
    const kA = this._keys['KeyA'] || this._keys['ArrowLeft'];
    const kD = this._keys['KeyD'] || this._keys['ArrowRight'];

    let ix = ((kD ? 1 : 0) - (kA ? 1 : 0)) + this._joystick.x;
    let iz = ((kS ? 1 : 0) - (kW ? 1 : 0)) + this._joystick.y;
    const inputLen = Math.sqrt(ix*ix + iz*iz);
    if (inputLen > 1) { ix /= inputLen; iz /= inputLen; }
    const isMoving = inputLen > 0.05;

    const mv = new THREE.Vector3();

    if (isMoving) {
  const sin = Math.sin(this._camYaw), cos = Math.cos(this._camYaw);
  const dx = (-iz * sin - ix * cos) * S.spd * dt;
const dz = (-iz * cos + ix * sin) * S.spd * dt;
  mv.set(dx, 0, dz);

      let nx = pg.position.x + dx, nz = pg.position.z + dz;
      nx = Math.max(-this.MAP_RADIUS, Math.min(this.MAP_RADIUS, nx));
      nz = Math.max(-this.MAP_RADIUS, Math.min(this.MAP_RADIUS, nz));
      pg.position.x = nx; pg.position.z = nz;

      const targetYaw = Math.atan2(dx, dz);
      let diff = targetYaw - pg.rotation.y;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      pg.rotation.y += diff * Math.min(1, 5 * dt);
    }

    this._snapToTerrain(pg);
    this._collide();
    this._updateCamera(false, dt);
    PM.update(dt, mv);

    // Also move the running.glb char to match PM group position
    if (this._char) {
  this._char.position.copy(pg.position);
  this._char.rotation.y = pg.rotation.y;
  if (this._mixer) this._mixer.update(dt);

  if (isMoving) {
    // Switch to running
    if (this._curCharAnim !== 'running' && this._runAction) {
      if (this._idleAction) this._runAction.crossFadeFrom(this._idleAction, 0.25, true);
      this._runAction.reset().play();
      this._runAction.timeScale = 1.2;
      if (this._idleAction) this._idleAction.stop();
      this._curCharAnim = 'running';
    }
  } else {
    // Switch to idle
    if (this._curCharAnim !== 'idle' && this._idleAction) {
      if (this._runAction) this._idleAction.crossFadeFrom(this._runAction, 0.25, true);
      this._idleAction.reset().play();
      this._runAction.timeScale = 0;
      this._curCharAnim = 'idle';
    }
  }
}

    // Stats regen
    S.hp = Math.min(S.maxHp, S.hp + 2 * dt);
    S.sp = Math.min(S.maxSp, S.sp + 10 * dt);
    if (S.iF > 0) S.iF -= dt;

    tickBleed(dt);

    // Safe zone
    const inSafeNow = isSafe(pg.position.x, pg.position.z);
    if (inSafeNow !== S.inSafe) {
      S.inSafe = inSafeNow;
      const sb = document.getElementById('safe-b');
      if (sb) sb.style.display = inSafeNow ? 'block' : 'none';
    }

    // Auto target
    if (!S.target?.alive) {
      const nb = inSafeNow ? null : Ens.nearest(pg.position.x, pg.position.z);
      if (nb) { S.target = nb; UI.target(); }
      else if (S.target) { S.target = null; UI.target(); }
    }

    // Auto melee
    if (S.atkCd > 0) S.atkCd -= dt;
    if (!inSafeNow && S.target?.alive && S.atkCd <= 0) {
      const dx = S.target.mesh.position.x - pg.position.x;
      const dz = S.target.mesh.position.z - pg.position.z;
      const atkRange = WTYPES[S.wtype]?.atkMult > 1.5 ? 2.8 : 3.2;
      if (Math.sqrt(dx*dx + dz*dz) < atkRange) {
        const dmg = Math.floor(S.atk * (0.9 + Math.random() * .2));
        const opts = {};
        if (S.wtype === 'dagger' || S.wtype === 'axe') opts.bleed = Math.random() < .2;
        if (S.wtype === 'mace') opts.stun = .15;
        Combat.deal(S.target, dmg, opts);
        FX.hit(S.target.mesh.position.clone());
        Game.playSlash();
        if (S.wtype === 'dual') {
          setTimeout(() => {
            if (S.target?.alive) { const d2 = Math.floor(S.atk * (0.9 + Math.random() * .2)); Combat.deal(S.target, d2, {}); FX.hit(S.target.mesh.position.clone()); }
          }, 120);
        }
        const atkSpd = 1.0 / Math.max(.5, S.spd * .18);
        S.atkCd = atkSpd;
        if (Math.random() < .15) Stats.profGain(1);
      }
    }

    // Skill cooldowns
    S.scd.forEach((cd, i) => {
      if (cd <= 0) return;
      S.scd[i] -= dt;
      const cdEl = document.getElementById('cd' + i);
      const r = Math.ceil(S.scd[i]);
      if (cdEl) cdEl.textContent = r > 0 ? r : '';
      if (S.scd[i] <= 0) {
        S.scd[i] = 0;
        const btn = document.getElementById('sk' + i);
        if (btn) { btn.classList.remove('oncd'); }
        if (cdEl) cdEl.textContent = '';
      }
    });

    checkBoss(pg.position.x, pg.position.z);

    Ens.update(dt, pg.position.x, pg.position.z, t);
    FX.update(dt);
    OtherP.update();
    UI.hud();
    UI.minimap(pg.position.x, pg.position.z);

    // Water animation
    if (this._water) {
      this._waterTime += dt;
      const wt2 = this._waterTime;
      this._water.material.emissive.setRGB(
        0.02 + Math.sin(wt2 * .4) * .01,
        0.06 + Math.sin(wt2 * .27) * .02,
        0.14 + Math.sin(wt2 * .35) * .04
      );
    }
  },

 _updateCamera(snap, dt) {
  const target = PM.group || this._char;
  if (!target) return;

  const hDist = this.CAM_DIST * Math.cos(this._camPitch);
  const vDist = this.CAM_DIST * Math.sin(this._camPitch);

  const tx = target.position.x - Math.sin(this._camYaw) * hDist;
  const ty = target.position.y + 1.1 + vDist;
  const tz = target.position.z - Math.cos(this._camYaw) * hDist;

  if (snap) {
    this._camera.position.set(tx, ty, tz);
  } else {
    this._camera.position.x = THREE.MathUtils.lerp(this._camera.position.x, tx, 1);
    this._camera.position.z = THREE.MathUtils.lerp(this._camera.position.z, tz, 1);
    this._camera.position.y = THREE.MathUtils.lerp(this._camera.position.y, ty, 0.03);
  }

  this._camera.lookAt(target.position.x, target.position.y + 1.1, target.position.z);
},
  _collide() {
    
  },

 _snapToTerrain(obj, forceSnap = false) {
  if (!this._terrainMeshes.length) return;
  const origin = new THREE.Vector3(obj.position.x, obj.position.y + 10, obj.position.z);
  this._raycaster.set(origin, new THREE.Vector3(0, -1, 0));
  const hits = this._raycaster.intersectObjects(this._terrainMeshes, false);
  if (hits.length > 0) {
    const groundY = hits[0].point.y;
    if (forceSnap) {
      obj.position.y = groundY;
    } else {
      obj.position.y = THREE.MathUtils.lerp(obj.position.y, groundY, 0.05);
    }
  }
},
};
// DEV MODE — comment this out before going live
(function devAutoLogin() {
  const saved = localStorage.getItem('ygg_save_v1');
  if (saved) {
    S = JSON.parse(saved);
  } else {
    S = {
      uid: 'dev_test',
      user: 'DevPlayer',
      skin: '#d4a882',
      lv: 10,
      xp: 0, xpN: 100,
      hp: 200, maxHp: 200,
      sp: 100, maxSp: 100,
      str: 15, agi: 15, vit: 15, dex: 15,
      statPts: 0,
      gold: 9999,
      wtype: '1h',
      prof: {},
      bleedStacks: 0, bleedTimer: 0, bleedTarget: null,
      inv: [
        { id: 'hpPotion', qty: 10 },
        { id: 'basicSword', qty: 1 },
        { id: 'ironSword', qty: 1 },
        { id: 'leatherArmor', qty: 1 },
      ],
      eq: { weapon: null, armor: null, accessory: null },
      target: null, atkCd: 0, iF: 0, scd: [0,0,0,0],
      inBoss: false, inSafe: false, chatTab: 'world',
    };
    Object.keys(WTYPES).forEach(k => S.prof[k] = 0);
  }

  // Skip straight to game
  showScreen('game');
  const waitForCanvas = setInterval(() => {
    const canvas = document.getElementById('game-canvas');
    if (canvas && canvas.clientWidth > 0) {
      clearInterval(waitForCanvas);
      try { Game.init(); } catch(e) { console.error('Game.init() failed:', e); }
    }
  }, 50);
})();