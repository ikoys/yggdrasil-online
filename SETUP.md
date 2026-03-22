# 🍃 Yggdrasil Online — Setup Guide

## 📁 Project Files
```
yggdrasil-web/
├── index.html       ← Full game (all-in-one)
├── manifest.json    ← PWA config
├── sw.js            ← Service worker (offline support)
├── icons/           ← Add your app icons here
│   ├── icon-192.png
│   └── icon-512.png
└── SETUP.md         ← This file
```

---

## 🔥 Step 1 — Firebase Setup (Free)

### Create Firebase Project
1. Go to https://console.firebase.google.com
2. Click **Add project** → Name it `yggdrasil-online`
3. Disable Google Analytics (optional)
4. Click **Create project**

### Enable Authentication
1. Go to **Authentication** → **Get started**
2. Enable **Google** sign-in provider
3. Enable **Anonymous** sign-in (for guests)
4. Add your domain to **Authorized domains** (add localhost + your GitHub Pages domain)

### Enable Firestore (Player saves)
1. Go to **Firestore Database** → **Create database**
2. Choose **Start in test mode** (for development)
3. Pick any region

### Enable Realtime Database (World chat)
1. Go to **Realtime Database** → **Create database**
2. Choose **Start in test mode**
3. Pick US or nearby region

### Get your Config
1. Go to **Project Settings** (⚙️ gear icon)
2. Under **Your apps** → click **Web** (`</>`)
3. Register app as `yggdrasil-online`
4. Copy the `firebaseConfig` object

### Add Config to index.html
Open `index.html` and find this section near the top of the `<script>`:
```js
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",           // ← replace these
  authDomain: "YOUR_PROJECT...",
  ...
};
```
Replace with your copied config.

### Firestore Security Rules
In Firebase Console → Firestore → Rules, paste:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /players/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### Realtime DB Security Rules
In Firebase Console → Realtime Database → Rules, paste:
```json
{
  "rules": {
    "worldchat": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

---

## 🌐 Step 2 — Deploy to GitHub Pages (Free)

1. Create a GitHub account at https://github.com
2. Create a new **public** repository named `yggdrasil-online`
3. Upload all files (`index.html`, `manifest.json`, `sw.js`, `icons/`)
4. Go to **Settings** → **Pages**
5. Source: **Deploy from branch** → `main` → `/ (root)`
6. Click **Save**

Your game will be live at:
```
https://YOUR_USERNAME.github.io/yggdrasil-online/
```

### Add your GitHub Pages domain to Firebase
1. Firebase Console → Authentication → Settings → Authorized domains
2. Add: `YOUR_USERNAME.github.io`

---

## 🎮 App Icons

Create two PNG icons and place them in an `icons/` folder:
- `icon-192.png` — 192×192px (🍃 leaf on dark green background)
- `icon-512.png` — 512×512px (same, larger)

Free tool: https://www.canva.com or https://favicon.io

---

## 📱 Install as PWA

### Android (Chrome)
1. Open the game URL in Chrome
2. Tap the **⋮ menu** → **Add to Home screen**
3. Tap **Add** — icon appears on home screen
4. Opens fullscreen like a native app!

### iOS (Safari)
1. Open the game URL in Safari
2. Tap the **Share button** (box with arrow)
3. Tap **Add to Home Screen**
4. Tap **Add**

---

## 🗺 Current Content (Phase 1)

| Floor | Name | Enemies | Boss |
|---|---|---|---|
| 1 | Midgard's Edge | Draugr, Dark Elf | Draugr Warlord |
| 2 | Niflheim Border | Shadow Wraith, Ice Skeleton | Frostborn Jarl |
| 3 | Jötunn's Pass | Frost Scout, Warg Wolf | King Thrym |

### Classes
- 🪓 **Berserker** — Melee tank, AoE rage
- 🔮 **Seiðr** — Magic ranged, rune bolts
- 🏹 **Skald** — Swift archer, rapid fire

### Features
- ✅ Firebase Auth (Google + Guest)
- ✅ Cloud save (Firestore)
- ✅ World chat (Realtime DB)
- ✅ Character creation (name, class, appearance)
- ✅ 3 floors with unique environments
- ✅ Story NPCs with branching dialogue
- ✅ Quest system with objectives + rewards
- ✅ Floor bosses with intro cutscenes
- ✅ Leveling system (XP → stats)
- ✅ Inventory + equipment system
- ✅ Item drops
- ✅ PWA (installable on Android + iOS)

### Planned (Phase 2+)
- Party system + party chat
- DM chat
- Guild system
- Player-to-player trading
- Crafting system
- Equipment refining
- Production system
- More floors (4–10)
- More story + quests
- Customizable outfits
- Mount system

---

## 🎮 Controls

| Action | PC | Mobile |
|---|---|---|
| Move | WASD / Arrow keys | Joystick |
| Rotate camera | Mouse drag (right click) | Swipe right half |
| Skills 1-4 | Z X C V | Tap skill buttons |
| Talk to NPC | F / Space | Walk near + tap hint |
| Inventory | I | 🎒 button |
| Quest Log | Q | 📜 button |
| Close panel | Escape | ✕ button |

---

Built with Three.js · Firebase · PWA
Phase 1 — More content coming soon 🍃
