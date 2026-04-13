"""
Yggdrasil Online — Authoritative Game Server
FastAPI + WebSockets

All combat math, stat recalc, skill validation, inventory,
shop, XP, leveling, and saves happen HERE — never in the client.

Run:
    pip install fastapi uvicorn firebase-admin
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import json
import math
import random
import time
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

# ── Optional: Firebase Admin SDK ─────────────────────────────────────────────
# Comment out if not using Firebase save/auth verification
try:
    import firebase_admin
    from firebase_admin import credentials, firestore, auth as fb_auth
    if not firebase_admin._apps:
        # Place your serviceAccountKey.json in the same folder as server.py
        cred = credentials.Certificate("serviceAccountKey.json")
        firebase_admin.initialize_app(cred)
    _db = firestore.client()
    FIREBASE_OK = True
except Exception as e:
    print(f"[Server] Firebase Admin not available: {e}")
    FIREBASE_OK = False
    _db = None

# ─────────────────────────────────────────────────────────────────────────────
#  GAME DATA  (mirrored from app.js — single source of truth is now here)
# ─────────────────────────────────────────────────────────────────────────────
WTYPES = {
    "1h":     {"name": "Long Sword",   "strScale": 1.0,  "atkMult": 1.0,  "spdMult": 1.0,  "vsArmored": 1.0,  "vsFast": 1.0,  "canShield": True,
               "skills": [
                   {"name": "Power Strike", "icon": "⚔️",  "sp": 20, "cd": 6,  "dmg": 1.8, "unlock": 0},
                   {"name": "Shield Bash",  "icon": "🛡️", "sp": 15, "cd": 5,  "dmg": 1.2, "stun": 0.3, "unlock": 80},
                   {"name": "Whirlwind",    "icon": "🌀", "sp": 35, "cd": 10, "dmg": 1.4, "aoe": True, "aoeR": 3.2, "unlock": 200},
                   {"name": "Blade Fury",   "icon": "💢", "sp": 45, "cd": 14, "dmg": 1.1, "multi": 4, "unlock": 400},
               ]},
    "2h":     {"name": "Greatsword",   "strScale": 1.5,  "atkMult": 1.4,  "spdMult": 0.85, "vsArmored": 1.4,  "vsFast": 0.8,  "canShield": False,
               "skills": [
                   {"name": "Cleave",       "icon": "🗡️", "sp": 25, "cd": 7,  "dmg": 2.2, "unlock": 0},
                   {"name": "Ground Slam",  "icon": "💥", "sp": 40, "cd": 12, "dmg": 2.0, "aoe": True, "aoeR": 3.8, "unlock": 100},
                   {"name": "Berserk Blow", "icon": "😡", "sp": 50, "cd": 15, "dmg": 3.0, "selfDmg": 0.08, "unlock": 280},
                   {"name": "Titan Strike", "icon": "⚡", "sp": 60, "cd": 18, "dmg": 4.0, "armorBreak": True, "unlock": 500},
               ]},
    "dagger": {"name": "Dagger",       "strScale": 0.7,  "atkMult": 0.85, "spdMult": 1.35, "vsArmored": 0.7,  "vsFast": 1.4,  "canShield": True,
               "skills": [
                   {"name": "Backstab",     "icon": "🔪", "sp": 15, "cd": 5,  "dmg": 2.5, "bleed": True, "unlock": 0},
                   {"name": "Poison Jab",   "icon": "☠️", "sp": 20, "cd": 7,  "dmg": 1.2, "bleed": True, "unlock": 80},
                   {"name": "Fan of Blades","icon": "🌟", "sp": 35, "cd": 11, "dmg": 1.0, "multi": 5, "unlock": 220},
                   {"name": "Shadowstep",   "icon": "👥", "sp": 25, "cd": 9,  "dmg": 3.0, "unlock": 380},
               ]},
    "mace":   {"name": "Mace",         "strScale": 1.1,  "atkMult": 1.1,  "spdMult": 0.9,  "vsArmored": 1.6,  "vsFast": 0.75, "canShield": True,
               "skills": [
                   {"name": "Skull Crack",  "icon": "💀", "sp": 22, "cd": 6,  "dmg": 1.9, "stun": 0.35, "unlock": 0},
                   {"name": "Bone Breaker", "icon": "💥", "sp": 32, "cd": 9,  "dmg": 2.0, "armorBreak": True, "unlock": 120},
                   {"name": "Shockwave",    "icon": "🌊", "sp": 40, "cd": 13, "dmg": 1.5, "aoe": True, "aoeR": 3.0, "stun": 0.2, "unlock": 260},
                   {"name": "Earthquake",   "icon": "🌍", "sp": 55, "cd": 16, "dmg": 2.2, "aoe": True, "aoeR": 4.5, "unlock": 450},
               ]},
    "axe":    {"name": "Battle Axe",   "strScale": 1.3,  "atkMult": 1.2,  "spdMult": 0.95, "vsArmored": 1.2,  "vsFast": 1.1,  "canShield": False,
               "skills": [
                   {"name": "Rend",         "icon": "🩸", "sp": 20, "cd": 5,  "dmg": 1.7, "bleed": True, "unlock": 0},
                   {"name": "Headhunter",   "icon": "🪓", "sp": 30, "cd": 8,  "dmg": 2.4, "unlock": 100},
                   {"name": "Rampage",      "icon": "💨", "sp": 45, "cd": 12, "dmg": 1.3, "multi": 3, "bleed": True, "unlock": 240},
                   {"name": "Executioner",  "icon": "⚡", "sp": 60, "cd": 18, "dmg": 4.5, "unlock": 500},
               ]},
    "dual":   {"name": "Dual Blades",  "strScale": 0.85, "atkMult": 0.9,  "spdMult": 1.5,  "vsArmored": 0.75, "vsFast": 1.5,  "canShield": False, "agiReq": 25,
               "skills": [
                   {"name": "Twin Strike",  "icon": "✦", "sp": 18, "cd": 4,  "dmg": 1.0, "multi": 2, "unlock": 0},
                   {"name": "Blade Dance",  "icon": "💃", "sp": 30, "cd": 8,  "dmg": 0.9, "multi": 4, "unlock": 120},
                   {"name": "Starburst",    "icon": "🌟", "sp": 50, "cd": 14, "dmg": 0.8, "multi": 16, "unlock": 300},
                   {"name": "Cross Slash",  "icon": "✕", "sp": 40, "cd": 11, "dmg": 2.2, "unlock": 480},
               ]},
}

ENEMIES = {
    "draugr":      {"name": "Draugr",       "hp": 80,  "def": 4,  "atk": 10, "spd": 2.0, "xp": 25, "gold": [8,15],   "sz": 1.0, "shp": "biped", "type": "armored", "aggr": 8,  "drops": [{"i": "wolfsbane", "ch": 0.15}]},
    "forestWolf":  {"name": "Forest Wolf",  "hp": 55,  "def": 2,  "atk": 12, "spd": 3.5, "xp": 18, "gold": [5,10],   "sz": 0.9, "shp": "wolf",  "type": "fast",    "aggr": 9,  "drops": [{"i": "wolfsbane", "ch": 0.25}]},
    "goblin":      {"name": "Goblin",       "hp": 45,  "def": 1,  "atk": 8,  "spd": 3.2, "xp": 14, "gold": [4,9],    "sz": 0.75,"shp": "biped", "type": "fast",    "aggr": 7,  "drops": [{"i": "hpPotion",  "ch": 0.1}]},
    "darkKnight":  {"name": "Dark Knight",  "hp": 140, "def": 10, "atk": 18, "spd": 1.8, "xp": 55, "gold": [20,35],  "sz": 1.2, "shp": "biped", "type": "armored", "aggr": 7,  "drops": [{"i": "ironSword", "ch": 0.05}]},
    "treant":      {"name": "Treant",       "hp": 200, "def": 8,  "atk": 20, "spd": 1.0, "xp": 70, "gold": [25,45],  "sz": 1.5, "shp": "biped", "type": "armored", "aggr": 5,  "drops": [{"i": "leatherArmor", "ch": 0.08}]},
    "elderDraugr": {"name": "Elder Draugr", "hp": 320, "def": 14, "atk": 28, "spd": 2.2, "xp": 120,"gold": [40,70],  "sz": 1.3, "shp": "boss",  "type": "armored", "aggr": 12, "boss": True, "emoji": "💀",
                    "drops": [{"i": "chainMail", "ch": 0.15}, {"i": "steelSword", "ch": 0.1}]},
}

ITEMS = {
    "hpPotion":    {"n": "HP Potion",       "ico": "🧪", "type": "con",      "ef": {"hp": 80},          "rar": "c", "desc": "Restores 80 HP",      "price": 30},
    "mpPotion":    {"n": "SP Potion",        "ico": "💧", "type": "con",      "ef": {"sp": 40},          "rar": "c", "desc": "Restores 40 SP",      "price": 25},
    "wolfsbane":   {"n": "Wolfsbane",        "ico": "🌿", "type": "material",                             "rar": "c", "desc": "Herb used in alchemy"},
    "basicSword":  {"n": "Basic Sword",      "ico": "🗡️", "type": "weapon",  "wtype": "1h",    "st": {"atk": 8,  "spd": 0.15}, "rar": "c", "desc": "Starting blade", "price": 0},
    "ironSword":   {"n": "Iron Sword",       "ico": "🗡️", "type": "weapon",  "wtype": "1h",    "st": {"atk": 15, "spd": 0.2},  "rar": "c", "desc": "Sturdy iron",    "price": 120},
    "steelSword":  {"n": "Steel Longsword",  "ico": "🗡️", "type": "weapon",  "wtype": "1h",    "st": {"atk": 24, "spd": 0.3},  "rar": "u", "desc": "Well balanced",  "price": 280},
    "ironDagger":  {"n": "Iron Dagger",      "ico": "🔪", "type": "weapon",  "wtype": "dagger","st": {"atk": 8,  "spd": 0.4},  "rar": "c", "desc": "Quick blade",    "price": 90},
    "ironMace":    {"n": "Iron Mace",        "ico": "🔨", "type": "weapon",  "wtype": "mace",  "st": {"atk": 16, "def": 2},    "rar": "c", "desc": "Heavy mace",     "price": 130},
    "ironAxe":     {"n": "Iron Battle Axe",  "ico": "🪓", "type": "weapon",  "wtype": "axe",   "st": {"atk": 20, "def": 1},    "rar": "c", "desc": "Reliable axe",   "price": 140},
    "leatherArmor":{"n": "Leather Armor",    "ico": "🥋", "type": "armor",                     "st": {"def": 4, "maxHp": 20},  "rar": "c", "desc": "Basic armor",    "price": 80},
    "chainMail":   {"n": "Chain Mail",       "ico": "🔗", "type": "armor",                     "st": {"def": 9, "maxHp": 35},  "rar": "u", "desc": "Iron rings",     "price": 220},
    "woodenShield":{"n": "Wooden Shield",    "ico": "🛡️", "type": "accessory","shieldOnly": True,"st": {"def": 4},             "rar": "c", "desc": "1H/Mace only",  "price": 60},
    "hpCharm":     {"n": "HP Charm",         "ico": "❤️", "type": "accessory",                 "st": {"maxHp": 30},            "rar": "c", "desc": "Bolsters vitality","price": 55},
    "speedBoots":  {"n": "Swift Boots",      "ico": "👟", "type": "accessory",                 "st": {"spd": 0.4},             "rar": "u", "desc": "Light on feet",  "price": 150},
}

SHOP1 = {"name": "Marta's Apothecary", "items": ["hpPotion","mpPotion","leatherArmor","woodenShield","ironSword","ironDagger","ironMace","ironAxe","hpCharm"]}

FLOOR1_ENEMIES = ["draugr","forestWolf","goblin","darkKnight","treant"]
FLOOR1_BOSS    = "elderDraugr"

# ─────────────────────────────────────────────────────────────────────────────
#  PLAYER STATE
# ─────────────────────────────────────────────────────────────────────────────
def default_state(uid: str, is_guest=False) -> dict:
    s = {
        "uid": uid, "isGuest": is_guest, "user": "Wanderer", "skin": "#d4a882",
        "lv": 1, "xp": 0, "xpN": 100,
        "str": 5, "agi": 5, "vit": 5, "dex": 5, "statPts": 0,
        "maxHp": 200, "hp": 200, "maxSp": 100, "sp": 100,
        "atk": 12, "def": 2, "spd": 4.2, "crit": 0.05, "critMult": 1.5,
        "gold": 0, "wtype": "1h",
        "prof": {k: 0 for k in WTYPES},
        "inv": [{"id": "hpPotion", "qty": 3}, {"id": "basicSword", "qty": 1}],
        "eq": {"weapon": None, "armor": None, "accessory": None},
        "bleedStacks": 0, "bleedTimer": 0,
        "scd": [0, 0, 0, 0],
        "atkCd": 0,
        "inBoss": False, "chatTab": "world",
    }
    recalc(s)
    s["hp"] = s["maxHp"]
    s["sp"] = s["maxSp"]
    return s


def recalc(s: dict):
    """Recompute all derived stats from base stats + equipment."""
    wt  = WTYPES[s["wtype"]]
    wpn = ITEMS.get(s["eq"]["weapon"])   if s["eq"]["weapon"]    else None
    arm = ITEMS.get(s["eq"]["armor"])    if s["eq"]["armor"]     else None
    acc = ITEMS.get(s["eq"]["accessory"])if s["eq"]["accessory"] else None

    s["maxHp"] = 100 + (s["vit"] * 15) + (s["lv"] * 8) + (arm["st"].get("maxHp", 0) if arm else 0) + (acc["st"].get("maxHp", 0) if acc else 0)
    s["hp"]    = min(s["hp"], s["maxHp"])
    s["maxSp"] = 60 + (s["dex"] * 4) + (s["agi"] * 2)
    s["sp"]    = min(s["sp"], s["maxSp"])

    base_atk = math.floor(s["str"] * wt["strScale"] * 1.2)
    wpn_atk  = ((wpn["st"].get("atk", 0) if wpn else 0) * wt["atkMult"])
    s["atk"]  = math.floor(base_atk + wpn_atk)

    arm_def = arm["st"].get("def", 0) if arm else 0
    acc_def = acc["st"].get("def", 0) if acc else 0
    s["def"] = math.floor(2 + (s["vit"] * 0.5) + arm_def + acc_def)

    wpn_spd = ((wpn["st"].get("spd", 0) if wpn else 0) + (wt["spdMult"] - 1) * 1.2)
    s["spd"] = 3.5 + (s["agi"] * 0.12) + wpn_spd
    s["crit"]     = 0.03 + (s["agi"] * 0.008) + (s["dex"] * 0.005)
    s["critMult"] = 1.5 + (s["dex"] * 0.02)


def get_unlocked_skills(s: dict) -> list:
    wt   = WTYPES[s["wtype"]]
    prof = s["prof"].get(s["wtype"], 0)
    return [sk for sk in wt["skills"] if sk["unlock"] <= prof and (not sk.get("agiReq") or s["agi"] >= sk["agiReq"])]


# ─────────────────────────────────────────────────────────────────────────────
#  ENEMY STATE  (server owns all enemy HP and positions)
# ─────────────────────────────────────────────────────────────────────────────
_enemy_id_counter = 0

def new_enemy_id():
    global _enemy_id_counter
    _enemy_id_counter += 1
    return f"e{_enemy_id_counter}"

SPAWN_POINTS = [
    [18,2],[-18,14],[10,24],[-24,-18],[30,30],[-34,22],[14,-28],[34,-14],
    [-14,34],[24,-34],[-30,-30],[40,8],[-40,-8],[2,40],[2,-40],[44,20],[-44,20],[18,-44]
]

def spawn_enemy(tid: str, si: int) -> dict:
    td = ENEMIES[tid]
    sp = SPAWN_POINTS[si % len(SPAWN_POINTS)]
    ex = sp[0] + random.uniform(-3, 3)
    ez = sp[1] + random.uniform(-3, 3)
    eid = new_enemy_id()
    return {
        "id": eid, "tid": tid,
        "x": ex, "z": ez,
        "hp": td["hp"], "maxHp": td["hp"],
        "alive": True,
        "isBoss": td.get("boss", False),
        "armorBroken": False,
        "stunT": 0.0,
        # AI runtime state
        "state": "idle",
        "idleT": random.uniform(0.8, 2.5),
        "atkCd": 0.0,
        "aggrR": float(td.get("aggr", 8)),
        "atkR":  td["sz"] * (1.4 if td["shp"] == "wolf" else 1.2),
        "ox": ex, "oz": ez,
        "pTgt": [ex + random.uniform(-9, 9), ez + random.uniform(-9, 9)],
    }

def build_enemies() -> list:
    enemies = []
    for i in range(14):
        tid = random.choice(FLOOR1_ENEMIES)
        enemies.append(spawn_enemy(tid, i))
    return enemies


# ─────────────────────────────────────────────────────────────────────────────
#  COMBAT ENGINE
# ─────────────────────────────────────────────────────────────────────────────
def deal_damage(s: dict, enemy: dict, raw_dmg: float, opts: dict = None) -> dict:
    """
    Compute final damage, apply to enemy HP, return result dict
    so the server can notify the client of visual FX.
    """
    if opts is None:
        opts = {}

    td       = ENEMIES[enemy["tid"]]
    wt       = WTYPES[s["wtype"]]
    eff_mult = 1.0
    if td["type"] == "armored":
        eff_mult = wt["vsArmored"]
    elif td["type"] == "fast":
        eff_mult = wt["vsFast"]

    eff_def   = math.floor(td["def"] * 0.6) if enemy.get("armorBroken") else td["def"]
    is_crit   = random.random() < s["crit"]
    crit_m    = s["critMult"] if is_crit else 1.0
    final_dmg = max(1, math.floor(raw_dmg * eff_mult * crit_m - eff_def))

    enemy["hp"] -= final_dmg

    result = {
        "enemyId": enemy["id"],
        "damage":  final_dmg,
        "crit":    is_crit,
        "effMult": eff_mult,
        "x": enemy["x"], "z": enemy["z"],
    }

    # Side effects
    if opts.get("bleed"):
        s["bleedStacks"] = min(5, s.get("bleedStacks", 0) + 1)
        s["bleedTimer"]  = 4.0
        s["bleedTargetId"] = enemy["id"]

    if opts.get("stun") and random.random() < opts["stun"]:
        enemy["stunT"] = 1.2 + random.random() * 0.8

    if opts.get("armorBreak"):
        enemy["armorBroken"] = True

    if opts.get("selfDmg"):
        sd = math.floor(s["maxHp"] * opts["selfDmg"])
        s["hp"] = max(1, s["hp"] - sd)

    return result


def kill_enemy(s: dict, enemy: dict) -> dict:
    """Award XP and gold, process drops."""
    enemy["alive"] = False
    td  = ENEMIES[enemy["tid"]]
    gd  = math.floor(random.uniform(td["gold"][0], td["gold"][1]))
    s["gold"] += gd
    s["xp"]   += td["xp"]

    drops = []
    for d in td.get("drops", []):
        if random.random() < d["ch"]:
            inv_add(s, d["i"], 1)
            drops.append(d["i"])

    # Proficiency
    prof_gain = random.uniform(2, 5)
    bonus     = 1 + s["dex"] * 0.02
    s["prof"][s["wtype"]] = min(1000, s["prof"][s["wtype"]] + prof_gain * bonus)

    return {"xp": td["xp"], "gold": gd, "drops": drops, "isBoss": enemy.get("isBoss", False)}


def level_check(s: dict) -> list:
    """Process pending XP gains, return list of level-up events."""
    events = []
    while s["xp"] >= s["xpN"]:
        s["xp"]    -= s["xpN"]
        s["lv"]    += 1
        s["xpN"]    = math.floor(100 * (1.3 ** (s["lv"] - 1)))
        s["statPts"] += 5
        events.append({"lv": s["lv"]})
    return events


# ─────────────────────────────────────────────────────────────────────────────
#  INVENTORY
# ─────────────────────────────────────────────────────────────────────────────
def inv_add(s: dict, item_id: str, qty: int = 1):
    for slot in s["inv"]:
        if slot["id"] == item_id:
            slot["qty"] += qty
            return
    s["inv"].append({"id": item_id, "qty": qty})


def inv_remove(s: dict, item_id: str, qty: int = 1) -> bool:
    for slot in s["inv"]:
        if slot["id"] == item_id:
            slot["qty"] -= qty
            if slot["qty"] <= 0:
                s["inv"] = [i for i in s["inv"] if i["id"] != item_id]
            return True
    return False


def inv_count(s: dict, item_id: str) -> int:
    for slot in s["inv"]:
        if slot["id"] == item_id:
            return slot["qty"]
    return 0


def inv_use(s: dict, item_id: str) -> dict:
    item = ITEMS.get(item_id)
    if not item:
        return {"ok": False, "msg": "Unknown item"}

    if item["type"] == "con":
        if inv_count(s, item_id) < 1:
            return {"ok": False, "msg": "No items left"}
        if item.get("ef", {}).get("hp"):
            heal = item["ef"]["hp"]
            s["hp"] = min(s["maxHp"], s["hp"] + heal)
        if item.get("ef", {}).get("sp"):
            restore = item["ef"]["sp"]
            s["sp"] = min(s["maxSp"], s["sp"] + restore)
        inv_remove(s, item_id, 1)
        return {"ok": True, "msg": f"+{item.get('ef', {}).get('hp', item.get('ef', {}).get('sp', '?'))} {item['n']}"}

    elif item["type"] in ("weapon", "armor", "accessory"):
        return inv_equip(s, item_id)

    return {"ok": False, "msg": "Cannot use this item"}


def inv_equip(s: dict, item_id: str) -> dict:
    item = ITEMS.get(item_id)
    if not item:
        return {"ok": False, "msg": "Unknown item"}

    if item.get("shieldOnly"):
        wt = WTYPES[s["wtype"]]
        if not wt.get("canShield"):
            return {"ok": False, "msg": f"Cannot use shield with {wt['name']}"}

    if item.get("wtype") == "dual" and s["agi"] < 25:
        return {"ok": False, "msg": "Dual Wield requires AGI 25+"}

    slot = item["type"]

    # Unequip current
    if s["eq"][slot]:
        old_id   = s["eq"][slot]
        old_item = ITEMS.get(old_id)
        if old_item and old_item.get("st"):
            for k, v in old_item["st"].items():
                if k not in ("wtype",):
                    s[k] = s.get(k, 0) - v
        inv_add(s, old_id, 1)

    # Equip new
    s["eq"][slot] = item_id
    inv_remove(s, item_id, 1)
    if item.get("st"):
        for k, v in item["st"].items():
            if k not in ("wtype",):
                s[k] = s.get(k, 0) + v
    if item.get("wtype"):
        s["wtype"] = item["wtype"]

    recalc(s)
    return {"ok": True, "msg": f"Equipped: {item['n']}", "wtype": s["wtype"]}


# ─────────────────────────────────────────────────────────────────────────────
#  SAVE / LOAD
# ─────────────────────────────────────────────────────────────────────────────
def _clean_state(s: dict) -> dict:
    """Return a Firestore-safe snapshot (no runtime fields)."""
    skip = {"bleedTargetId", "bleedTarget", "iF", "inSafe"}
    return {k: v for k, v in s.items() if k not in skip}


async def save_cloud(s: dict):
    if not FIREBASE_OK or not _db or s.get("isGuest"):
        return
    try:
        _db.collection("saves").document(s["uid"]).set(_clean_state(s))
    except Exception as e:
        print(f"[Save] Cloud save failed: {e}")


async def load_cloud(uid: str) -> Optional[dict]:
    if not FIREBASE_OK or not _db:
        return None
    try:
        doc = _db.collection("saves").document(uid).get()
        return doc.to_dict() if doc.exists else None
    except Exception as e:
        print(f"[Save] Cloud load failed: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  FIREBASE AUTH VERIFICATION
# ─────────────────────────────────────────────────────────────────────────────
def verify_token(id_token: str) -> Optional[str]:
    """Returns uid if token valid, None otherwise."""
    if not FIREBASE_OK:
        return None
    try:
        decoded = fb_auth.verify_id_token(id_token)
        return decoded["uid"]
    except Exception as e:
        print(f"[Auth] Token verify failed: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  GAME SESSION
# ─────────────────────────────────────────────────────────────────────────────
class GameSession:
    def __init__(self, ws: WebSocket, state: dict):
        self.ws      = ws
        self.state   = state
        self.enemies = build_enemies()
        self._last_save = time.time()

    # ── Send helpers ─────────────────────────────────────────────────────────
    async def send(self, msg: dict):
        try:
            await self.ws.send_text(json.dumps(msg))
        except Exception:
            pass

    async def send_state(self):
        """Push full authoritative state to client."""
        await self.send({
            "type":    "STATE",
            "state":   _clean_state(self.state),
            "enemies": [{"id": e["id"], "tid": e["tid"], "x": e["x"], "z": e["z"],
                         "hp": e["hp"], "maxHp": e["maxHp"], "alive": e["alive"],
                         "isBoss": e.get("isBoss", False)}
                        for e in self.enemies],
        })

    async def notif(self, text: str, color: str = "#e8e0c8"):
        await self.send({"type": "NOTIF", "text": text, "color": color})

    # ── Debounced cloud save ──────────────────────────────────────────────────
    async def maybe_save(self, force=False):
        now = time.time()
        if force or (now - self._last_save > 5):
            self._last_save = now
            await save_cloud(self.state)

    # ── Message router ────────────────────────────────────────────────────────
    async def handle(self, raw: str):
        try:
            msg = json.loads(raw)
        except Exception:
            return

        t = msg.get("type", "")

        if t == "PING":
            await self.send({"type": "PONG"})

        elif t == "GET_STATE":
            await self.send_state()

        elif t == "ATTACK":
            await self._handle_attack(msg)

        elif t == "SKILL":
            await self._handle_skill(msg)

        elif t == "USE_ITEM":
            await self._handle_use_item(msg)

        elif t == "BUY":
            await self._handle_buy(msg)

        elif t == "STAT_DIST":
            await self._handle_stat_dist(msg)

        elif t == "SET_NAME":
            name = str(msg.get("name", "")).strip()[:16]
            if len(name) >= 2:
                self.state["user"] = name
                await self.send({"type": "NAME_OK", "name": name})

        elif t == "SET_SKIN":
            self.state["skin"] = str(msg.get("skin", "#d4a882"))

        elif t == "SET_WTYPE":
            # Only allowed during character creation
            wtype = msg.get("wtype", "1h")
            if wtype in WTYPES:
                self.state["wtype"] = wtype
                recalc(self.state)

        elif t == "POSITION":
            # Client reports position; server accepts it (could add speed-hack check here)
            self.state["_px"] = msg.get("x", 0)
            self.state["_pz"] = msg.get("z", 0)

        elif t == "REGEN":
            # Client sends a regen tick (dt) — server applies regen
            dt = min(float(msg.get("dt", 0)), 0.1)
            s  = self.state
            s["hp"] = min(s["maxHp"], s["hp"] + 2 * dt)
            s["sp"] = min(s["maxSp"], s["sp"] + 10 * dt)

        elif t == "SAVE":
            await self.maybe_save(force=True)
            await self.send({"type": "SAVED"})

        elif t == "BOSS_ZONE":
            await self._handle_boss_zone()

    # ── Attack handler ────────────────────────────────────────────────────────
    async def _handle_attack(self, msg: dict):
        s        = self.state
        enemy_id = msg.get("enemyId")
        enemy    = self._find_enemy(enemy_id)

        if not enemy:
            await self.notif("No target", "#e74c3c")
            return

        # Cooldown check (server-side)
        if s["atkCd"] > 0:
            await self.notif("⏱ Not ready yet", "#c9a84c")
            return

        raw_dmg = math.floor(s["atk"] * (0.9 + random.random() * 0.2))
        opts    = {}
        if s["wtype"] in ("dagger", "axe") and random.random() < 0.2:
            opts["bleed"] = True
        if s["wtype"] == "mace":
            opts["stun"] = 0.15

        result  = deal_damage(s, enemy, raw_dmg, opts)
        atk_spd = 1.0 / max(0.5, s["spd"] * 0.18)
        s["atkCd"] = atk_spd

        # Prof gain
        if random.random() < 0.15:
            bonus = 1 + s["dex"] * 0.02
            s["prof"][s["wtype"]] = min(1000, s["prof"][s["wtype"]] + bonus)

        # Dual wield second hit
        if s["wtype"] == "dual":
            second = deal_damage(s, enemy, math.floor(s["atk"] * (0.9 + random.random() * 0.2)), {})
            await self.send({"type": "HIT", **second})

        # Kill?
        kill_evt = None
        if enemy["hp"] <= 0:
            kill_evt = kill_enemy(s, enemy)
            lvup     = level_check(s)
            if lvup:
                for ev in lvup:
                    await self.send({"type": "LEVEL_UP", "lv": ev["lv"], "statPts": s["statPts"]})

        await self.send({
            "type":    "HIT",
            "atkCd":   s["atkCd"],
            "hp":      s["hp"],
            "sp":      s["sp"],
            "gold":    s["gold"],
            "xp":      s["xp"],
            "xpN":     s["xpN"],
            "prof":    s["prof"],
            **result,
            "killed":  kill_evt,
        })

        await self.send({"type": "ENEMY_HP", "enemyId": enemy["id"],
                         "hp": enemy["hp"], "maxHp": enemy["maxHp"], "alive": enemy["alive"]})

        if kill_evt:
            # Respawn after delay (handled client-side via RESPAWN message)
            asyncio.create_task(self._respawn_enemy(enemy["tid"], 8))

        await self.maybe_save()

    # ── Skill handler ─────────────────────────────────────────────────────────
    async def _handle_skill(self, msg: dict):
        s     = self.state
        idx   = int(msg.get("index", 0))
        px    = s.get("_px", 0)
        pz    = s.get("_pz", 0)

        skills = get_unlocked_skills(s)
        if idx >= len(skills):
            await self.notif("Skill not unlocked", "#e74c3c")
            return

        sk = skills[idx]

        if s["scd"][idx] > 0:
            await self.notif("Recharging…", "#c9a84c")
            return

        if s["sp"] < sk["sp"]:
            await self.notif("Not enough SP", "#5dade2")
            return

        s["sp"]     = max(0, s["sp"] - sk["sp"])
        s["scd"][idx] = sk["cd"]

        hits   = []
        opts   = {
            "bleed":      sk.get("bleed", False),
            "stun":       sk.get("stun", 0),
            "armorBreak": sk.get("armorBreak", False),
            "selfDmg":    sk.get("selfDmg", 0),
        }

        if sk.get("aoe"):
            aoe_r = sk["aoeR"]
            for e in self.enemies:
                if not e["alive"]:
                    continue
                dx = e["x"] - px
                dz = e["z"] - pz
                if math.sqrt(dx*dx + dz*dz) < aoe_r:
                    base_d = math.floor(s["atk"] * sk["dmg"] * (0.85 + random.random() * 0.3))
                    result = deal_damage(s, e, base_d, opts)
                    hits.append(result)
                    if e["hp"] <= 0:
                        kill_evt = kill_enemy(s, e)
                        lvup = level_check(s)
                        for ev in lvup:
                            await self.send({"type": "LEVEL_UP", "lv": ev["lv"], "statPts": s["statPts"]})
                        asyncio.create_task(self._respawn_enemy(e["tid"], 8))

        elif sk.get("multi"):
            enemy_id = msg.get("enemyId")
            enemy    = self._find_enemy(enemy_id)
            if not enemy:
                await self.notif("No target", "#e74c3c")
                return
            for _ in range(sk["multi"]):
                if enemy["alive"]:
                    base_d = math.floor(s["atk"] * sk["dmg"] * (0.9 + random.random() * 0.2))
                    result = deal_damage(s, enemy, base_d, opts)
                    hits.append(result)
            if enemy["hp"] <= 0:
                kill_evt = kill_enemy(s, enemy)
                lvup = level_check(s)
                for ev in lvup:
                    await self.send({"type": "LEVEL_UP", "lv": ev["lv"], "statPts": s["statPts"]})
                asyncio.create_task(self._respawn_enemy(enemy["tid"], 8))

        else:
            enemy_id = msg.get("enemyId")
            enemy    = self._find_enemy(enemy_id)
            if not enemy:
                await self.notif("No target", "#e74c3c")
                return
            base_d = math.floor(s["atk"] * sk["dmg"] * (0.85 + random.random() * 0.3))
            result = deal_damage(s, enemy, base_d, opts)
            hits.append(result)
            if enemy["hp"] <= 0:
                kill_evt = kill_enemy(s, enemy)
                lvup = level_check(s)
                for ev in lvup:
                    await self.send({"type": "LEVEL_UP", "lv": ev["lv"], "statPts": s["statPts"]})
                asyncio.create_task(self._respawn_enemy(enemy["tid"], 8))

        await self.send({
            "type":   "SKILL_RESULT",
            "index":  idx,
            "skill":  sk["name"],
            "icon":   sk["icon"],
            "hits":   hits,
            "sp":     s["sp"],
            "scd":    s["scd"],
            "hp":     s["hp"],
            "gold":   s["gold"],
            "xp":     s["xp"],
            "xpN":    s["xpN"],
        })

        # Send updated enemy HP for all hit enemies
        for hit in hits:
            e = self._find_enemy(hit["enemyId"])
            if e:
                await self.send({"type": "ENEMY_HP", "enemyId": e["id"],
                                 "hp": e["hp"], "maxHp": e["maxHp"], "alive": e["alive"]})

        await self.maybe_save()

    # ── Item use handler ──────────────────────────────────────────────────────
    async def _handle_use_item(self, msg: dict):
        s       = self.state
        item_id = msg.get("id", "")
        result  = inv_use(s, item_id)

        await self.send({
            "type":  "ITEM_RESULT",
            "ok":    result["ok"],
            "msg":   result["msg"],
            "hp":    s["hp"],
            "sp":    s["sp"],
            "inv":   s["inv"],
            "eq":    s["eq"],
            "wtype": s["wtype"],
            "atk":   s["atk"],
            "def":   s["def"],
        })

        if result["ok"]:
            await self.maybe_save()

    # ── Shop buy handler ──────────────────────────────────────────────────────
    async def _handle_buy(self, msg: dict):
        s       = self.state
        item_id = msg.get("id", "")
        item    = ITEMS.get(item_id)

        if not item:
            await self.notif("Unknown item", "#e74c3c")
            return

        price = item.get("price", 0)
        if s["gold"] < price:
            await self.notif("Not enough gold", "#e74c3c")
            return

        # Verify item is in shop (server validates, not client)
        if item_id not in SHOP1["items"]:
            await self.notif("Item not available", "#e74c3c")
            return

        s["gold"] -= price
        inv_add(s, item_id, 1)

        await self.send({
            "type":  "BUY_OK",
            "id":    item_id,
            "gold":  s["gold"],
            "inv":   s["inv"],
        })
        await self.notif(f"Bought: {item['n']}", "#e8c96a")
        await self.maybe_save()

    # ── Stat distribution handler ─────────────────────────────────────────────
    async def _handle_stat_dist(self, msg: dict):
        s       = self.state
        changes = msg.get("changes", {})  # e.g. {"str": 2, "vit": 1}
        total   = sum(changes.values())

        if total <= 0:
            return
        if total > s.get("statPts", 0):
            await self.notif("Not enough stat points", "#e74c3c")
            return

        valid_stats = {"str", "agi", "vit", "dex"}
        for stat, amount in changes.items():
            if stat not in valid_stats or amount < 0:
                await self.notif("Invalid stat", "#e74c3c")
                return
            s[stat] = s.get(stat, 0) + amount

        s["statPts"] -= total
        recalc(s)

        await self.send({
            "type":    "STAT_OK",
            "state":   _clean_state(s),
        })
        await self.notif("Stats updated!", "#4caf50")
        await self.maybe_save()

    # ── Boss zone ─────────────────────────────────────────────────────────────
    async def _handle_boss_zone(self):
        s = self.state
        if s.get("inBoss"):
            return
        s["inBoss"] = True
        bid = FLOOR1_BOSS
        td  = ENEMIES[bid]
        # Spawn the boss
        e = {
            "id":    new_enemy_id(),
            "tid":   bid,
            "x":     0.0,
            "z":     -54.0,
            "hp":    td["hp"],
            "maxHp": td["hp"],
            "alive": True,
            "isBoss": True,
            "armorBroken": False,
            "stunT": 0.0,
            "state": "idle",
            "aggrR": 22.0,
            "atkR":  4.5,
            "ox": 0.0, "oz": -54.0,
        }
        self.enemies.append(e)
        await self.send({
            "type":  "BOSS_SPAWN",
            "enemy": {"id": e["id"], "tid": e["tid"], "x": e["x"], "z": e["z"],
                      "hp": e["hp"], "maxHp": e["maxHp"], "alive": True, "isBoss": True},
            "name":  td["name"],
            "emoji": td.get("emoji", "💀"),
        })

    # ── Server-side AI + bleed tick loop (runs per session) ───────────────────
    async def _ai_loop(self):
        """
        Ticks at ~20 Hz. Handles:
          - Enemy AI movement (idle/patrol/chase)
          - Enemy attacks on player
          - Bleed DoT
          - Pushes ENEMY_MOVE batches to client (~4 Hz)
        """
        TICK       = 0.05     # 20 Hz
        MOVE_EVERY = 0.25     # broadcast positions 4x/sec
        _move_acc  = 0.0
        _last      = time.time()

        SAFE_X, SAFE_Z, SAFE_R = 0.0, -10.0, 26.0

        def in_safe(x, z):
            dx, dz = x - SAFE_X, z - SAFE_Z
            return dx*dx + dz*dz < SAFE_R * SAFE_R

        try:
            while True:
                await asyncio.sleep(TICK)
                now = time.time()
                dt  = min(now - _last, 0.1)
                _last = now

                s  = self.state
                px = s.get("_px", 0.0)
                pz = s.get("_pz", 0.0)

                # ── Tick attack cooldown ──────────────────────────────────────
                if s.get("atkCd", 0) > 0:
                    s["atkCd"] = max(0.0, s["atkCd"] - dt)

                # ── Tick skill cooldowns ──────────────────────────────────────
                for i in range(4):
                    if s["scd"][i] > 0:
                        s["scd"][i] = max(0.0, s["scd"][i] - dt)

                # ── Bleed DoT ─────────────────────────────────────────────────
                if s.get("bleedStacks", 0) > 0:
                    bid = s.get("bleedTargetId")
                    btgt = self._find_enemy(bid) if bid else None
                    if btgt and btgt.get("alive"):
                        s["bleedTimer"] = s.get("bleedTimer", 0) - dt
                        if s["bleedTimer"] <= 0:
                            s["bleedStacks"] = 0
                            del s["bleedTargetId"]
                        else:
                            if not s.get("_bleedTick"):
                                s["_bleedTick"] = 0.0
                            s["_bleedTick"] += dt
                            if s["_bleedTick"] >= 1.0:
                                s["_bleedTick"] = 0.0
                                dmg = max(1, math.floor(s["atk"] * 0.12 * s["bleedStacks"]))
                                btgt["hp"] -= dmg
                                await self.send({
                                    "type":    "BLEED",
                                    "enemyId": btgt["id"],
                                    "damage":  dmg,
                                    "x": btgt["x"], "z": btgt["z"],
                                    "hp": btgt["hp"], "maxHp": btgt["maxHp"],
                                    "alive": btgt["hp"] > 0,
                                })
                                if btgt["hp"] <= 0:
                                    kill_evt = kill_enemy(s, btgt)
                                    lvup = level_check(s)
                                    for ev in lvup:
                                        await self.send({"type": "LEVEL_UP", "lv": ev["lv"], "statPts": s["statPts"]})
                                    asyncio.create_task(self._respawn_enemy(btgt["tid"], 8))
                    else:
                        s["bleedStacks"] = 0

                # ── Enemy AI ──────────────────────────────────────────────────
                player_in_safe = in_safe(px, pz)

                for e in self.enemies:
                    if not e.get("alive"):
                        continue

                    td      = ENEMIES[e["tid"]]
                    ex, ez  = e["x"], e["z"]
                    dx, dz  = px - ex, pz - ez
                    dist    = math.sqrt(dx*dx + dz*dz) or 0.001
                    aggr_r  = e.get("aggrR", td.get("aggr", 8))
                    atk_r   = e.get("atkR",  td["sz"] * 1.3)

                    # Stun
                    if e.get("stunT", 0) > 0:
                        e["stunT"] = max(0.0, e["stunT"] - dt)
                        continue

                    # Don't chase into safe zone
                    if in_safe(ex, ez) and not e.get("isBoss"):
                        e["state"] = "idle"
                        continue

                    state_e = e.get("state", "idle")

                    if state_e == "idle":
                        e["idleT"] = e.get("idleT", 0) - dt
                        if e["idleT"] <= 0:
                            e["state"]  = "patrol"
                            e["pTgt"]   = [e.get("ox", ex) + random.uniform(-10, 10),
                                           e.get("oz", ez) + random.uniform(-10, 10)]
                        if dist < aggr_r and not player_in_safe:
                            e["state"] = "chase"

                    elif state_e == "patrol":
                        tgt = e.get("pTgt", [ex, ez])
                        tdx, tdz = tgt[0] - ex, tgt[1] - ez
                        pd = math.sqrt(tdx*tdx + tdz*tdz) or 0.001
                        if pd < 0.8:
                            e["state"] = "idle"
                            e["idleT"] = random.uniform(0.8, 2.5)
                        else:
                            spd = td["spd"] * 0.5
                            e["x"] += tdx/pd * spd * dt
                            e["z"] += tdz/pd * spd * dt
                        if dist < aggr_r and not player_in_safe:
                            e["state"] = "chase"

                    elif state_e == "chase":
                        if player_in_safe:
                            e["state"] = "idle"
                            e["idleT"] = 2.0
                            continue
                        if dist < atk_r:
                            e["state"] = "attack"
                        elif dist > aggr_r * 2.8:
                            e["state"] = "idle"
                            e["idleT"] = random.uniform(0.8, 2.0)
                        else:
                            e["x"] += dx/dist * td["spd"] * dt
                            e["z"] += dz/dist * td["spd"] * dt

                    elif state_e == "attack":
                        if player_in_safe or dist > atk_r * 1.8:
                            e["state"] = "chase"
                            continue
                        # Enemy attacks player
                        e["atkCd"] = e.get("atkCd", 0) - dt
                        if e["atkCd"] <= 0:
                            raw_dmg  = max(1, td["atk"] - math.floor(s["def"] * 0.5))
                            final    = max(1, math.floor(raw_dmg * random.uniform(0.85, 1.15)))
                            s["hp"]  = max(0, s["hp"] - final)
                            e["atkCd"] = 2.0 / max(0.5, td["spd"] * 0.3)
                            await self.send({
                                "type":   "PLAYER_HIT",
                                "damage": final,
                                "hp":     s["hp"],
                                "maxHp":  s["maxHp"],
                                "by":     td["name"],
                            })
                            if s["hp"] <= 0:
                                # Death — respawn at safe zone
                                s["hp"] = math.floor(s["maxHp"] * 0.4)
                                s["_px"], s["_pz"] = 0.0, 0.0
                                s["bleedStacks"] = 0
                                await self.send({"type": "PLAYER_DEATH"})

                # ── Broadcast enemy positions ─────────────────────────────────
                _move_acc += dt
                if _move_acc >= MOVE_EVERY:
                    _move_acc = 0.0
                    moves = [
                        {"id": e["id"], "x": round(e["x"], 2), "z": round(e["z"], 2),
                         "state": e.get("state", "idle")}
                        for e in self.enemies if e.get("alive")
                    ]
                    if moves:
                        await self.send({"type": "ENEMY_MOVE", "moves": moves})

        except asyncio.CancelledError:
            pass
        except Exception as err:
            print(f"[AI] Loop error: {err}")

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _find_enemy(self, eid: str) -> Optional[dict]:
        return next((e for e in self.enemies if e["id"] == eid and e["alive"]), None)

    async def _respawn_enemy(self, tid: str, delay: int):
        await asyncio.sleep(delay)
        si = random.randint(0, len(SPAWN_POINTS) - 1)
        e  = spawn_enemy(tid, si)
        self.enemies.append(e)
        await self.send({
            "type":   "ENEMY_SPAWN",
            "enemy":  {"id": e["id"], "tid": e["tid"], "x": e["x"], "z": e["z"],
                       "hp": e["hp"], "maxHp": e["maxHp"], "alive": True, "isBoss": False},
        })


# ─────────────────────────────────────────────────────────────────────────────
#  FASTAPI APP
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Yggdrasil Online Game Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # restrict to your domain in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active sessions: uid → GameSession
_sessions: Dict[str, GameSession] = {}


@app.get("/health")
def health():
    return {"status": "ok", "players": len(_sessions)}


@app.websocket("/ws")
async def ws_endpoint(
    ws: WebSocket,
    token: Optional[str] = Query(None),   # Firebase ID token
    uid:   Optional[str] = Query(None),   # fallback for guest (unverified)
):
    await ws.accept()

    # ── Auth ─────────────────────────────────────────────────────────────────
    verified_uid = None
    is_guest     = False

    if token:
        verified_uid = verify_token(token)
        if not verified_uid:
            await ws.send_text(json.dumps({"type": "AUTH_FAIL", "msg": "Invalid token"}))
            await ws.close()
            return
    elif uid and uid.startswith("guest_"):
        verified_uid = uid
        is_guest     = True
    else:
        await ws.send_text(json.dumps({"type": "AUTH_FAIL", "msg": "No credentials"}))
        await ws.close()
        return

    # ── Load or create state ─────────────────────────────────────────────────
    state      = None
    new_player = False
    if not is_guest:
        state = await load_cloud(verified_uid)
    if state is None:
        state      = default_state(verified_uid, is_guest)
        new_player = True

    # ── Create session ────────────────────────────────────────────────────────
    session = GameSession(ws, state)
    _sessions[verified_uid] = session

    await session.send({"type": "AUTH_OK", "uid": verified_uid,
                        "isGuest": is_guest, "newPlayer": new_player})
    await session.send_state()

    print(f"[WS] Connected: {verified_uid} (guest={is_guest}, new={new_player})")

    # ── Start server-side AI game loop for this session ───────────────────────
    ai_task = asyncio.create_task(session._ai_loop())

    # ── Message loop ──────────────────────────────────────────────────────────
    try:
        while True:
            raw = await ws.receive_text()
            await session.handle(raw)
    except WebSocketDisconnect:
        print(f"[WS] Disconnected: {verified_uid}")
    except Exception as e:
        print(f"[WS] Error ({verified_uid}): {e}")
    finally:
        ai_task.cancel()
        await session.maybe_save(force=True)
        _sessions.pop(verified_uid, None)
