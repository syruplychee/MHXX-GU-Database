'use strict';

const questReference = require('../data/quest-reference.json');
const questSource = `https://github.com/jestar719/mhgu/blob/${questReference.commit}/app/src/main/assets/mhxx/`;
const questSupplementGroups = {
  conditions: (q) => q.request?.some((r) => r.title.includes('条件')) ||
    q.conditions?.some((part) => typeof part !== 'string' || !['初始任务', 'MHXX的み', '\n'].includes(part)),
  arts: (q) => q.arts || q.flags?.includes('arts'),
  food: (q) => q.food || q.flags?.includes('food'),
  other: (q) => q.extras || q.flags?.some((flag) => !['arts', 'food'].includes(flag)),
};
const questSupplementIds = Object.fromEntries(Object.entries(questSupplementGroups).map(([key, match]) => [
  key, JSON.stringify(Object.keys(questReference.quests).filter((id) => match(questReference.quests[id])).map(Number)),
]));
const questDependents = new Map();
for (const [id, note] of Object.entries(questReference.quests)) {
  const refs = [...(note.conditions || []), ...(note.request || []).filter((r) => r.title.includes('条件')).flatMap((r) => r.parts)];
  for (const prerequisite of new Set(refs.filter((r) => r.quest).map((r) => r.quest))) {
    if (prerequisite === Number(id)) continue;
    if (!questDependents.has(prerequisite)) questDependents.set(prerequisite, []);
    questDependents.get(prerequisite).push(Number(id));
  }
}

// ---------------------------------------------------------------- helpers

const LANGS = [
  { id: 0, code: 'en', label: 'English' },
  { id: 1, code: 'zh-CN', label: '简体中文' },
  { id: 2, code: 'zh-TW', label: '繁體中文' },
  { id: 3, code: 'ja', label: '日本語' },
  { id: 4, code: 'ko', label: '한국어' },
  { id: 5, code: 'de', label: 'Deutsch' },
  { id: 6, code: 'fr', label: 'Français' },
  { id: 7, code: 'it', label: 'Italiano' },
  { id: 8, code: 'es', label: 'Español' },
];

const WEAPON_TYPES = [
  { id: 1, name: '大剑', en: 'Great Sword', icon: 'Wpn_0101' },
  { id: 2, name: '太刀', en: 'Long Sword', icon: 'Wpn_0201' },
  { id: 3, name: '片手剑', en: 'Sword & Shield', icon: 'Wpn_0301' },
  { id: 4, name: '双剑', en: 'Dual Blades', icon: 'Wpn_0401' },
  { id: 5, name: '大锤', en: 'Hammer', icon: 'Wpn_0501' },
  { id: 6, name: '狩猎笛', en: 'Hunting Horn', icon: 'Wpn_0601' },
  { id: 7, name: '长枪', en: 'Lance', icon: 'Wpn_0701' },
  { id: 8, name: '铳枪', en: 'Gunlance', icon: 'Wpn_0801' },
  { id: 9, name: '斩击斧', en: 'Switch Axe', icon: 'Wpn_0901' },
  { id: 10, name: '充能斧', en: 'Charge Blade', icon: 'Wpn_1001' },
  { id: 11, name: '操虫棍', en: 'Insect Glaive', icon: 'Wpn_1101' },
  { id: 12, name: '轻弩', en: 'Light Bowgun', icon: 'Wpn_1201' },
  { id: 13, name: '重弩', en: 'Heavy Bowgun', icon: 'Wpn_1301' },
  { id: 14, name: '弓', en: 'Bow', icon: 'Wpn_1401' },
];

const ARMOR_PARTS = [
  { id: 1, name: '头部', en: 'Head' },
  { id: 2, name: '胸部', en: 'Chest' },
  { id: 3, name: '腕部', en: 'Arms' },
  { id: 4, name: '腰部', en: 'Waist' },
  { id: 5, name: '脚部', en: 'Legs' },
];

const RARITY_COLORS = ['#8a8f98', '#a8b0bd', '#7fb069', '#4f9dd9', '#a97fd4', '#d98a4f', '#d94f5c', '#e0b34f', '#7fd9d9', '#d97fc2'];

const clampLang = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 && n <= 8 ? n : 1;
};
const L = (base, lang) => `${base}_${lang}`;
const itemName = (lang) => L('n.Itm_Name', lang);
const int = (v, d = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (m) => '\\' + m);
}

function json(send, status, body) {
  return send(status, body);
}

function createLibraryApi(db, hasIcon) {
  function paged(req, res, { countSql, countParams, listSql, listParams, map, focusPage, maxSize = 200 }) {
    const url = new URL(req.url, 'http://x');
    const page = Math.max(1, int(url.searchParams.get('page'), focusPage || 1));
    const size = Math.min(maxSize, Math.max(1, int(url.searchParams.get('size'), 40)));
    const total = db.prepare(countSql).get(...countParams).n;
    const rows = db.prepare(listSql).all(...listParams, size, (page - 1) * size).map(map || ((r) => r));
    json(res, 200, { total, page, size, pages: Math.max(1, Math.ceil(total / size)), rows });
  }

  // ---------------------------------------------------------------- meta

  function meta() {
    const one = (sql) => db.prepare(sql).get().n;
    return {
      app: 'MHXX资料库',
      langs: LANGS,
      weaponTypes: WEAPON_TYPES,
      armorParts: ARMOR_PARTS,
      questLevelsByLang: LANGS.map((l) =>
        db.prepare(`SELECT Qst_Lv_ID id, ${L('Qst_Lv', l.id)} name FROM ID_Qst_Lv WHERE Qst_Lv_ID > 0 ORDER BY Qst_Lv_ID`).all()
      ),
      questTypesByLang: LANGS.map((l) =>
        db.prepare(`SELECT Qst_Type_ID id, ${L('Qst_Type', l.id)} name FROM ID_Qst_Type WHERE Qst_Type_ID > 0 ORDER BY Qst_Type_ID`).all()
      ),
      counts: {
        items: one('SELECT COUNT(*) n FROM DB_Itm WHERE Itm_ID > 0'),
        weapons: one('SELECT COUNT(*) n FROM DB_Wpn WHERE Wpn_ID > 0'),
        armor: one('SELECT COUNT(*) n FROM DB_Amr WHERE Amr_ID > 0'),
        monsters: one('SELECT COUNT(*) n FROM ID_Mon_Name WHERE Mon_ID BETWEEN 1 AND 129'),
        quests: one('SELECT COUNT(*) n FROM DB_Qst'),
        skills: one('SELECT COUNT(DISTINCT SklTree_ID) n FROM DB_Skl'),
        jewels: one('SELECT COUNT(*) n FROM DB_Jew'),
        combos: one('SELECT COUNT(*) n FROM DB_ItmtoCbo'),
        horns: one('SELECT COUNT(*) n FROM DB_HHSong'),
        kinsects: one('SELECT COUNT(*) n FROM DB_ISKinsect'),
        palicoWeapons: one('SELECT COUNT(*) n FROM DB_PeliWpn'),
        palicoArmor: one('SELECT COUNT(*) n FROM DB_PeliAmr'),
        arena: one('SELECT COUNT(*) n FROM DB_Ara'),
        awards: one("SELECT COUNT(*) n FROM ID_Awd_Name WHERE Awd_ID > 0"),
        locations: one("SELECT COUNT(*) n FROM ID_Loc_Name WHERE Loc_ID > 0"),
      },
    };
  }

  // ---------------------------------------------------------------- items

  function listItems(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const rarity = url.searchParams.get('rarity');
    const sort = ['Itm_ID', 'Rare', 'Sell', 'Buy'].includes(url.searchParams.get('sort'))
      ? url.searchParams.get('sort')
      : 'Itm_ID';
    const nc = itemName(lang);
    const where = ['i.Itm_ID > 0'];
    const params = [];
    if (q) {
      where.push(`n.${nc.replace('n.', '')} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    if (rarity !== null && rarity !== '' && rarity !== 'all') {
      where.push('i.Rare = ?');
      params.push(int(rarity));
    }
    const w = where.join(' AND ');
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM DB_Itm i JOIN ID_Itm_Name n ON n.Itm_ID = i.Itm_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT i.Itm_ID id, n.${nc.replace('n.', '')} name, i.Rare rare, i.Max max, i.Sell sell, i.Buy buy, i.Hex hex
                FROM DB_Itm i JOIN ID_Itm_Name n ON n.Itm_ID = i.Itm_ID
                WHERE ${w} ORDER BY i.${sort} LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  function itemDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const nc = L('Itm_Name', lang);
    const base = db
      .prepare(
        `SELECT i.Itm_ID id, n.${nc} name, i.Rare rare, i.Max max, i.Sell sell, i.Buy buy, i.Hex hex
         FROM DB_Itm i JOIN ID_Itm_Name n ON n.Itm_ID = i.Itm_ID WHERE i.Itm_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });

    const monsters = db
      .prepare(
        `SELECT m.Mon_ID monId, n.${L('Mon_Name', lang)} mon, t.${L('Mon_GetItmType', lang)} how,
                m.Qty qty, m.Pct pct, r.${L('Rank', lang)} rank
         FROM DB_ItmtoMon m
         JOIN ID_Mon_Name n ON n.Mon_ID = m.Mon_ID
         LEFT JOIN ID_Mon_GetItmType t ON t.Mon_GetItmType_ID = m.Mon_GetItmType_ID
         LEFT JOIN ID_Rank r ON r.Rank_ID = m.Rank_ID
         WHERE m.Itm_ID = ? ORDER BY m.Mon_ID, m.Rank_ID, m.Mon_GetItmType_ID LIMIT 200`
      )
      .all(id);

    const maps = db
      .prepare(
        `SELECT x.Loc_ID locId, ln.${L('Loc_Name', lang)} loc, a.${L('Loc_Ara', lang)} area,
                g.${L('Loc_GetType', lang)} how, r.${L('Rank', lang)} rank
         FROM DB_ItmtoLoc x
         JOIN ID_Loc_Name ln ON ln.Loc_ID = x.Loc_ID
         LEFT JOIN ID_Loc_Ara a ON a.Loc_Ara_ID = x.Loc_Ara_ID
         LEFT JOIN ID_Loc_GetType g ON g.Loc_GetType_ID = x.Loc_GetType_ID
         LEFT JOIN ID_Rank r ON r.Rank_ID = x.Rank_ID
         WHERE x.Itm_ID = ? ORDER BY x.Loc_ID, x.Loc_Ara_ID, x.Loc_GetType_ID LIMIT 300`
      )
      .all(id);

    const quests = db
      .prepare(
        `SELECT q.Qst_ID qstId, n.${L('Qst_Name', lang)} name, x.Type line, x.Qty qty, x.Pct pct
         FROM DB_ItmtoQst x JOIN DB_Qst q ON q.Qst_ID = x.Qst_ID
         JOIN ID_Qst_Name n ON n.Qst_ID = q.Qst_ID
         WHERE x.Itm_ID = ? ORDER BY x.Qst_ID, x.Type LIMIT 200`
      )
      .all(id);

    const combos = db
      .prepare(
        `SELECT c.Cbo_ID id, c.Succ succ, c.Qty qty, na.${L('Itm_Name', lang)} a, c.ItmA_ID aId,
                nb.${L('Itm_Name', lang)} b, c.ItmB_ID bId, nc2.${L('Itm_Name', lang)} c, c.ItmC_ID cId
         FROM DB_ItmtoCbo c
         JOIN ID_Itm_Name na ON na.Itm_ID = c.ItmA_ID
         JOIN ID_Itm_Name nb ON nb.Itm_ID = c.ItmB_ID
         JOIN ID_Itm_Name nc2 ON nc2.Itm_ID = c.ItmC_ID
         WHERE c.ItmA_ID = ? OR c.ItmB_ID = ? OR c.ItmC_ID = ? ORDER BY c.Cbo_ID LIMIT 120`
      )
      .all(id, id, id);

    const weapons = db
      .prepare(
        `SELECT w.Wpn_ID id, n.${L('Wpn_Name', lang)} name, w.Wpn_Type_ID type, x.Qty qty, x.Type kind
         FROM DB_ItmtoWpn x JOIN DB_Wpn w ON w.Wpn_ID = x.Wpn_ID
         JOIN ID_Wpn_Name n ON n.Wpn_ID = w.Wpn_ID ORDER BY x.Type,
         CASE WHEN x.Wpn_ID = ? THEN 0 ELSE 1 END, x.Wpn_ID LIMIT 100`
      )
      .all(id);

    const armors = db
      .prepare(
        `SELECT a.Amr_ID id, n.${L('Amr_Name', lang)} name, a.Part part, x.Qty qty
         FROM DB_ItmtoAmr x JOIN DB_Amr a ON a.Amr_ID = x.Amr_ID
         JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID WHERE x.Itm_ID = ? ORDER BY a.Amr_ID LIMIT 150`
      )
      .all(id);

    const jewels = db
      .prepare(
        `SELECT j.Jew_ID id, n.${L('Itm_Name', lang)} name, j.Slot slot, x.Qty qty
         FROM DB_ItmtoJew x JOIN DB_Jew j ON j.Jew_ID = x.Jew_ID
         JOIN ID_Itm_Name n ON n.Itm_ID = j.Itm_ID WHERE x.Itm_ID = ? ORDER BY j.Jew_ID LIMIT 100`
      )
      .all(id);

    const vet = db
      .prepare(
        `SELECT x.Vet_ID id, o.${L('Itm_Name', lang)} give, i.${L('Itm_Name', lang)} get, x.Pct pct, l.${L('Loc_Name', lang)} loc
         FROM DB_ItmtoVet x
         JOIN ID_Itm_Name o ON o.Itm_ID = x.ItmOut_ID
         JOIN ID_Itm_Name i ON i.Itm_ID = x.ItmIn_ID
         LEFT JOIN ID_Loc_Name l ON l.Loc_ID = x.Loc_ID
         WHERE x.ItmOut_ID = ? OR x.ItmIn_ID = ? ORDER BY x.Vet_ID LIMIT 100`
      )
      .all(id, id);

    const palico = db
      .prepare(
        `SELECT x.PeliTeam_ID id, i.${L('Itm_Name', lang)} name, x.Qty qty, x.Pct pct, r.${L('Rank', lang)} rank,
                z.${L('PeliTeam_Zone', lang)} zone
         FROM DB_ItmtoPeliTeam x
         JOIN ID_Itm_Name i ON i.Itm_ID = x.Itm_ID
         LEFT JOIN ID_Rank r ON r.Rank_ID = x.Rank_ID
         LEFT JOIN ID_PeliTeam_Zone z ON z.PeliTeam_Zone_ID = x.Zone_ID
         WHERE x.Itm_ID = ? LIMIT 100`
      )
      .all(id);

    json(res, 200, {
      data: base,
      monsters,
      maps,
      quests,
      combos,
      weapons,
      armors,
      jewels,
      vet,
      palico,
    });
  }

  // ---------------------------------------------------------------- weapons

  function weaponTypeOf(id) {
    return WEAPON_TYPES.find((t) => t.id === id) || null;
  }

  function decodeSharpness(raw, canExtend) {
    const colors = ['#d0021b', '#f07a1b', '#f5d327', '#63c132', '#2f7fe0', '#e8f4ff', '#a06bd6'];
    // The desktop app reads decimal pairs stored from purple to red at maximum extension.
    const values = raw.match(/\d{2}/g).map(Number).reverse();
    const trim = (remaining) => {
      const segments = values.slice();
      for (let i = segments.length - 1; i >= 0 && remaining > 0; i--) {
        const removed = Math.min(segments[i], remaining);
        segments[i] -= removed;
        remaining -= removed;
      }
      return segments.map((value, i) => ({ color: colors[i], value }));
    };
    return canExtend ? [trim(10), trim(5), trim(0)] : [trim(0)];
  }

  // DB_Wpn has no parent column: `Child` is the number of child weapons and rows are
  // stored in preorder (Wpn_ID ascending), so the upgrade forest is rebuilt exactly by
  // consuming `Child`-many subtrees after each node. Verified edge-for-edge against the
  // hardcoded TreeNode construction in the original FrmWeapon form (10,117 edges, 0 diff).
  function weaponForest(typeId, lang) {
    const rows = db
      .prepare(
        `SELECT w.Wpn_ID id, w.Child child, w.Rare rare, w.Atk atk, w.Affinity aff, w.Def def, w.Slot slot,
                w.SpAtk1_ID el1, w.SpAtk1_Pt el1pt, e.${L('Wpn_SpAtk', lang)} el1name,
                n.${L('Wpn_Name', lang)} name, w.ImgFile img
         FROM DB_Wpn w
         JOIN ID_Wpn_Name n ON n.Wpn_ID = w.Wpn_ID
         LEFT JOIN ID_Wpn_SpAtk e ON e.Wpn_SpAtk_ID = w.SpAtk1_ID
         WHERE w.Wpn_Type_ID = ? ORDER BY w.Wpn_ID`
      )
      .all(typeId);
    let i = 0;
    const build = () => {
      const node = rows[i++];
      node.children = [];
      for (let k = 0; k < node.child; k++) node.children.push(build());
      return node;
    };
    const roots = [];
    while (i < rows.length) roots.push(build());
    return roots;
  }

  function weaponsTree(req, res) {
    const url = new URL(req.url, 'http://x');
    const type = int(url.searchParams.get('type'), 1);
    const lang = clampLang(url.searchParams.get('lang'));
    const roots = weaponForest(type, lang);
    const countNodes = (list) => list.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
    const typeMeta = weaponTypeOf(type);
    json(res, 200, { type, typeName: typeMeta ? typeMeta.name : '', total: countNodes(roots), roots });
  }

  function weaponRelation(typeId, lang, id) {
    const pick = (n) => ({
      id: n.id, name: n.name, rare: n.rare, atk: n.atk,
      el1: n.el1, el1pt: n.el1pt, el1name: n.el1name, img: n.img,
    });
    let found = null;
    const walk = (node, parent, ancestors) => {
      if (found) return;
      if (node.id === id) {
        found = { node, parent, ancestors: ancestors.slice() };
        return;
      }
      for (const child of node.children) walk(child, node, [...ancestors, node]);
    };
    for (const root of weaponForest(typeId, lang)) {
      walk(root, null, []);
      if (found) break;
    }
    if (!found) return null;
    return {
      root: pick(found.ancestors.length ? found.ancestors[0] : found.node),
      ancestors: found.ancestors.map(pick),
      parent: found.parent ? pick(found.parent) : null,
      children: found.node.children.map(pick),
      depth: found.ancestors.length,
    };
  }

  function listWeapons(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const type = url.searchParams.get('type');
    const rarity = url.searchParams.get('rarity');
    const recipe = url.searchParams.get('recipe');
    const sort = ['Wpn_ID', 'Rare', 'Atk', 'Affinity'].includes(url.searchParams.get('sort'))
      ? url.searchParams.get('sort')
      : 'Wpn_ID';
    const nc = L('Wpn_Name', lang);
    const where = ['w.Wpn_ID > 0'];
    const params = [];
    if (q) {
      where.push(`n.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    if (type && type !== 'all') {
      where.push('w.Wpn_Type_ID = ?');
      params.push(int(type));
    }
    if (rarity && rarity !== 'all') {
      where.push('w.Rare = ?');
      params.push(int(rarity));
    }
    if (recipe === 'production') where.push('w.ProPx > 0');
    if (recipe === 'upgrade') where.push('w.LvUpPx > 0');
    const w = where.join(' AND ');
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM DB_Wpn w JOIN ID_Wpn_Name n ON n.Wpn_ID = w.Wpn_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT w.Wpn_ID id, n.${nc} name, w.Wpn_Type_ID type, w.Rare rare, w.Atk atk, w.Affinity aff,
                       w.Def def, w.Slot slot, w.SpAtk1_ID el1, w.SpAtk1_Pt el1pt, w.SpAtk2_ID el2, w.SpAtk2_Pt el2pt,
                       w.ImgFile img, w.ProPx productionPrice, w.LvUpPx upgradePrice, e.${L('Wpn_SpAtk', lang)} el1name
                FROM DB_Wpn w
                JOIN ID_Wpn_Name n ON n.Wpn_ID = w.Wpn_ID
                LEFT JOIN ID_Wpn_SpAtk e ON e.Wpn_SpAtk_ID = w.SpAtk1_ID
                WHERE ${w} ORDER BY w.${sort} LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  function weaponDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const nc = L('Wpn_Name', lang);
    const base = db
      .prepare(
        `SELECT w.*, n.${nc} name,
                e1.${L('Wpn_SpAtk', lang)} el1name, e2.${L('Wpn_SpAtk', lang)} el2name,
                gl.${L('Wpn_ShotType', lang)} glname,
                ax.${L('Wpn_AxePhial', lang)} axename,
                gr.${L('Wpn_GunReloadSpd', lang)} reloadname,
                gs.${L('Wpn_GunSteadiness', lang)} steadyname,
                grc.${L('Wpn_GunRecoil', lang)} recoilname,
                bs.${L('Wpn_BowShot', lang)} bowname,
                bs1.${L('Wpn_ShotType', lang)} bow1name, bs2.${L('Wpn_ShotType', lang)} bow2name,
                bs3.${L('Wpn_ShotType', lang)} bow3name, bs4.${L('Wpn_ShotType', lang)} bow4name,
                ki.${L('Wpn_ISKinsectType', lang)} kinname
         FROM DB_Wpn w
         JOIN ID_Wpn_Name n ON n.Wpn_ID = w.Wpn_ID
         LEFT JOIN ID_Wpn_SpAtk e1 ON e1.Wpn_SpAtk_ID = w.SpAtk1_ID
         LEFT JOIN ID_Wpn_SpAtk e2 ON e2.Wpn_SpAtk_ID = w.SpAtk2_ID
         LEFT JOIN ID_Wpn_ShotType gl ON gl.Wpn_ShotType_ID = w.GLShotType_ID
         LEFT JOIN ID_Wpn_AxePhial ax ON ax.Wpn_AxePhial_ID = w.AxePhial_ID
         LEFT JOIN ID_Wpn_GunReloadSpd gr ON gr.Wpn_GunReloadSpd_ID = w.GunReloadSpd_ID
         LEFT JOIN ID_Wpn_GunSteadiness gs ON gs.Wpn_GunSteadiness_ID = w.GunSteadiness_ID
         LEFT JOIN ID_Wpn_GunRecoil grc ON grc.Wpn_GunRecoil_ID = w.GunRecoil_ID
         LEFT JOIN ID_Wpn_BowShot bs ON bs.Wpn_BowShot_ID = w.BowShot_ID
         LEFT JOIN ID_Wpn_ShotType bs1 ON bs1.Wpn_ShotType_ID = w.BowShotType1_ID
         LEFT JOIN ID_Wpn_ShotType bs2 ON bs2.Wpn_ShotType_ID = w.BowShotType2_ID
         LEFT JOIN ID_Wpn_ShotType bs3 ON bs3.Wpn_ShotType_ID = w.BowShotType3_ID
         LEFT JOIN ID_Wpn_ShotType bs4 ON bs4.Wpn_ShotType_ID = w.BowShotType4_ID
         LEFT JOIN ID_Wpn_ISKinsectType ki ON ki.Wpn_ISKinsectType_ID = w.ISKinsectType_ID
         WHERE w.Wpn_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });

    const materials = db
      .prepare(
        `SELECT x.Type kind, x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty
         FROM DB_ItmtoWpn x JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID
         WHERE x.Wpn_ID = ? ORDER BY x.Type, x.ID`
      )
      .all(id);

    const isBowgun = base.Wpn_Type_ID === 12 || base.Wpn_Type_ID === 13;
    const ammo = db
      .prepare(
        `SELECT g.Itm_ID id, n.${L('Itm_Name', lang)} name, g.LoadQty qty, g.LoadQtyP unlockQty, g.Max max, g.SpFireQty sp,
                g.RapidFireGap_ID gap, r.${L('Wpn_RapidFireGap', lang)} gapName
         FROM DB_Wpn_Gun g JOIN ID_Itm_Name n ON n.Itm_ID = g.Itm_ID
         LEFT JOIN ID_Wpn_RapidFireGap r ON r.Wpn_RapidFireGap_ID = g.RapidFireGap_ID
         WHERE g.Wpn_ID = ? AND (g.LoadQty > 0 OR (? AND g.LoadQtyP > 0)) ORDER BY g.ID`
      )
      .all(id, Number(isBowgun))
      .map((row) => {
        if (!isBowgun) return row;
        const name = (lang === 1 || lang === 2) && [2896, 2902].includes(row.id) ? row.name.replace(/^LV1/, 'LV2') : row.name;
        // Built-in shots occupy a separate item ID range. Max is also used for ordinary ammo.
        return { ...row, name, internal: row.id >= 2881 && row.id <= 2921,
          fireMode: row.sp > 0 ? (base.Wpn_Type_ID === 12 ? 'rapid' : 'crouch') : null };
      });

    const songs = db
      .prepare(
        `SELECT s.HHSong_ID id, s.Note1_ID n1, s.Note2_ID n2, s.Note3_ID n3, s.Note4_ID n4,
                e1.${L('Wpn_RecitalEffect', lang)} eff1, e2.${L('Wpn_RecitalEffect', lang)} eff2,
                s.Duration dur, s.Duration_M durM, s.Reload reload, s.Reload_M reloadM
         FROM DB_HHSongtoWpn x JOIN DB_HHSong s ON s.HHSong_ID = x.HHSong_ID
         LEFT JOIN ID_Wpn_RecitalEffect e1 ON e1.Wpn_RecitalEffect_ID = s.RecitalEffect_ID
         LEFT JOIN ID_Wpn_RecitalEffect e2 ON e2.Wpn_RecitalEffect_ID = s.RecitalEffect2_ID
         WHERE x.Wpn_ID = ? ORDER BY s.HHSong_ID`
      )
      .all(id);

    const upgrades = db
      .prepare(
        `SELECT w.Wpn_ID id, n.${L('Wpn_Name', lang)} name, w.Rare rare, w.Atk atk, w.Child child
         FROM DB_Wpn w JOIN ID_Wpn_Name n ON n.Wpn_ID = w.Wpn_ID
         WHERE w.Wpn_Type_ID = ? AND w.Wpn_ID BETWEEN ? AND ? AND w.Wpn_ID <> ?
         ORDER BY w.Wpn_ID LIMIT 40`
      )
      .all(base.Wpn_Type_ID, id - 12, id + 12, id);

    const [sharpness = [], ...sharpnessExtensions] = base.Wpn_Type_ID <= 11 ? decodeSharpness(base.Sharp, base.SharpP1 === 1) : [];
    json(res, 200, {
      data: { ...base, sharpness, sharpnessExtensions, typeName: weaponTypeOf(base.Wpn_Type_ID) },
      materials,
      ammo,
      songs,
      upgrades,
      tree: weaponRelation(base.Wpn_Type_ID, lang, id),
    });
  }

  // ---------------------------------------------------------------- armor

  const armorSetsByLanguage = new Map();

  function armorSeriesName(pieces, lang) {
    if (pieces.length === 1) return pieces[0].name;
    const names = pieces.map((piece) => piece.name.normalize('NFKC').replace(/套[装裝]/g, ''));
    let prefix = names[0];
    for (const name of names.slice(1)) {
      while (prefix && !name.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    if (![1, 2, 3, 4].includes(lang)) prefix = prefix.replace(/\S+$/, '');
    prefix = prefix.replace(/[\s・·-]+$/, '');
    if (lang === 1 || lang === 2) prefix = prefix.replace(/之$/, '');
    if (!prefix) return pieces[0].name;

    const ranks = names.map((name) => name.match(/(?:^|[^A-Za-z])([A-Z]{1,2})$/)?.[1]);
    const rank = ranks[0];
    if (rank && ranks.every((value) => value === rank) && !prefix.endsWith(rank)) {
      prefix += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(prefix) ? rank : ` ${rank}`;
    }
    return prefix;
  }

  function armorSetCatalog(lang) {
    if (armorSetsByLanguage.has(lang)) return armorSetsByLanguage.get(lang);
    const pieces = db.prepare(
      `SELECT a.Amr_ID id, n.${L('Amr_Name', lang)} name, a.Part part, a.BorG borg, a.MorF morf, a.Rare rare,
              a.Slot slot, a.Def def, a.MaxDef maxdef, a.Amr_ImgFile img
       FROM DB_Amr a JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID WHERE a.Amr_ID > 0 ORDER BY a.Amr_ID`
    ).all();
    const skills = db.prepare(
      `SELECT s.Amr_ID id, s.SklTree_ID treeId, t.${L('SklTree_Name', lang)} name, s.Pt pt
       FROM DB_SklTreetoAmr s JOIN ID_SklTree_Name t ON t.SklTree_ID = s.SklTree_ID`
    ).all();
    const skillsByPiece = Map.groupBy(skills, (skill) => skill.id);
    // Every image ID has at most one piece per slot, including shared heads in class-specific sets.
    const sets = [...Map.groupBy(pieces, (piece) => piece.img).values()].map((entries) => {
      const first = entries[0];
      const totals = new Map();
      for (const piece of entries) {
        for (const { treeId, name, pt } of skillsByPiece.get(piece.id) || []) {
          const total = totals.get(treeId);
          if (total) total.pt += pt;
          else totals.set(treeId, { treeId, name, pt });
        }
      }
      return {
        id: first.id, img: first.img, name: armorSeriesName(entries, lang), rare: first.rare,
        borg: Math.max(...entries.map((piece) => piece.borg)), morf: Math.max(...entries.map((piece) => piece.morf)),
        pieces: entries.sort((a, b) => a.part - b.part),
        skills: [...totals.values()].sort((a, b) => b.pt - a.pt || a.treeId - b.treeId),
      };
    });
    armorSetsByLanguage.set(lang, sets);
    return sets;
  }

  function listArmorSets(req, res) {
    const p = new URL(req.url, 'http://x').searchParams;
    const lang = clampLang(p.get('lang'));
    const q = (p.get('q') || '').trim().normalize('NFKC').toLowerCase().replace(/套[装裝]/g, '');
    const borg = p.get('borg');
    const morf = p.get('morf');
    const rare = p.get('rarity');
    const skill = int(p.get('skill'));
    const part = p.get('part');
    const slot = p.get('slot');
    const valid = (raw) => raw !== null && raw !== '' && raw !== 'all';
    const matchesName = (name) => name.normalize('NFKC').toLowerCase().replace(/套[装裝]/g, '').includes(q);
    const compatible = (setValue, filter) => !valid(filter) || setValue === 0 || setValue === Number(filter);

    const rows = [];
    for (const set of armorSetCatalog(lang)) {
      if (!compatible(set.borg, borg) || !compatible(set.morf, morf)) continue;
      if (valid(rare) && set.rare !== Number(rare)) continue;
      if (skill && !set.skills.some((s) => s.treeId === skill && s.pt > 0)) continue;
      const wholeName = !q || matchesName(set.name);
      const matches = set.pieces.filter((piece) => (wholeName || matchesName(piece.name)) &&
        (!valid(part) || piece.part === Number(part)) && (!valid(slot) || piece.slot === Number(slot))).map((piece) => piece.id);
      if (matches.length) rows.push({ ...set, matches });
    }

    json(res, 200, { total: rows.length, rows });
  }

  function listArmor(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const part = url.searchParams.get('part');
    const rarity = url.searchParams.get('rarity');
    const borg = url.searchParams.get('borg');
    const morf = url.searchParams.get('morf');
    const slot = url.searchParams.get('slot');
    const sort = ['Amr_ID', 'Def', 'Rare', 'Price'].includes(url.searchParams.get('sort'))
      ? url.searchParams.get('sort')
      : 'Amr_ID';
    const nc = L('Amr_Name', lang);
    const where = ['a.Amr_ID > 0'];
    const params = [];
    if (q) {
      where.push(`n.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    if (part && part !== 'all') {
      where.push('a.Part = ?');
      params.push(int(part));
    }
    if (rarity && rarity !== 'all') {
      where.push('a.Rare = ?');
      params.push(int(rarity));
    }
    if (borg && borg !== 'all') {
      where.push('a.BorG = ?');
      params.push(int(borg));
    }
    if (morf && morf !== 'all') {
      where.push('a.MorF = ?');
      params.push(int(morf));
    }
    if (slot && slot !== 'all') {
      where.push('a.Slot = ?');
      params.push(int(slot));
    }
    const w = where.join(' AND ');
    const skillsSql = (a) =>
      `(SELECT GROUP_CONCAT(t.${L('SklTree_Name', lang)} || ' ' || (CASE WHEN s.Pt >= 0 THEN '+' ELSE '' END) || s.Pt, ' · ')
        FROM DB_SklTreetoAmr s JOIN ID_SklTree_Name t ON t.SklTree_ID = s.SklTree_ID WHERE s.Amr_ID = ${a}.Amr_ID)`;
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM DB_Amr a JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT a.Amr_ID id, n.${nc} name, a.Part part, a.BorG borg, a.MorF morf, a.Rare rare,
                       a.Slot slot, a.Def def, a.MaxDef maxdef, a.Price price,
                       a.Res_Fire fir, a.Res_Water wtr, a.Res_Thunder thd, a.Res_Ice ice, a.Res_Dragon drg,
                       a.Amr_ImgFile img, ${skillsSql('a')} skills
                FROM DB_Amr a JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID
                WHERE ${w} ORDER BY a.${sort} LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  function armorDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const nc = L('Amr_Name', lang);
    const base = db
      .prepare(
        `SELECT a.*, n.${nc} name FROM DB_Amr a JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID WHERE a.Amr_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });

    const skills = db
      .prepare(
        `SELECT s.SklTree_ID treeId, t.${L('SklTree_Name', lang)} name, s.Pt pt
         FROM DB_SklTreetoAmr s JOIN ID_SklTree_Name t ON t.SklTree_ID = s.SklTree_ID
         WHERE s.Amr_ID = ? ORDER BY s.Pt DESC`
      )
      .all(id);

    const materials = db
      .prepare(
        `SELECT x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty
         FROM DB_ItmtoAmr x JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID
         WHERE x.Amr_ID = ? ORDER BY x.ID`
      )
      .all(id);

    const family = db
      .prepare(
        `SELECT a.Amr_ID id, n.${L('Amr_Name', lang)} name, a.Part part, a.Rare rare
         FROM DB_Amr a JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID
         WHERE a.Amr_ImgFile = ?
         ORDER BY a.Part, a.Amr_ID`
      )
      .all(base.Amr_ImgFile);

    json(res, 200, { data: base, skills, materials, family });
  }

  // ---------------------------------------------------------------- skills

  function listSkills(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const nc = L('SklTree_Name', lang);
    const where = ['1 = 1'];
    const params = [];
    if (q) {
      where.push(`t.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    const w = where.join(' AND ');
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM (SELECT s.SklTree_ID FROM DB_Skl s JOIN ID_SklTree_Name t ON t.SklTree_ID = s.SklTree_ID WHERE ${w} GROUP BY s.SklTree_ID)`,
      countParams: params,
      listSql: `SELECT s.SklTree_ID id, t.${nc} name, COUNT(*) levels, MIN(s.Pt) minPt, MAX(s.Pt) maxPt
                FROM DB_Skl s JOIN ID_SklTree_Name t ON t.SklTree_ID = s.SklTree_ID
                WHERE ${w} GROUP BY s.SklTree_ID ORDER BY s.SklTree_ID LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  function skillDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const levels = db
      .prepare(
        `SELECT s.Skl_ID id, sn.${L('Skl_Name', lang)} name, s.Pt pt, d.${L('Skl_Des', lang)} des
         FROM DB_Skl s
         LEFT JOIN ID_Skl_Name sn ON sn.Skl_ID = s.Skl_ID
         LEFT JOIN ID_Skl_Des d ON d.Skl_ID = s.Skl_ID
         WHERE s.SklTree_ID = ? ORDER BY s.Pt`
      )
      .all(id);
    if (!levels.length) return json(res, 404, { error: 'not found' });
    const tree = db.prepare(`SELECT t.${L('SklTree_Name', lang)} name FROM ID_SklTree_Name t WHERE t.SklTree_ID = ?`).get(id);
    const armor = db
      .prepare(
        `SELECT a.Amr_ID id, n.${L('Amr_Name', lang)} name, a.Part part, a.Rare rare, a.Slot slot, s.Pt pt
         FROM DB_SklTreetoAmr s JOIN DB_Amr a ON a.Amr_ID = s.Amr_ID
         JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID WHERE s.SklTree_ID = ?
         ORDER BY s.Pt DESC, a.Amr_ID LIMIT 200`
      )
      .all(id);
    const jewels = db
      .prepare(
        `SELECT j.Jew_ID id, n.${L('Itm_Name', lang)} name, j.Slot slot, s.Pt pt
         FROM DB_SklTreetoJew s JOIN DB_Jew j ON j.Jew_ID = s.Jew_ID
         JOIN ID_Itm_Name n ON n.Itm_ID = j.Itm_ID WHERE s.SklTree_ID = ?
         ORDER BY s.Pt DESC, j.Jew_ID LIMIT 120`
      )
      .all(id);
    json(res, 200, { data: { id, name: tree ? tree.name : '' }, levels, armor, jewels });
  }

  // ---------------------------------------------------------------- jewels

  function listJewels(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const slot = url.searchParams.get('slot');
    const nc = L('Itm_Name', lang);
    const where = ['1 = 1'];
    const params = [];
    if (q) {
      where.push(`n.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    if (slot && slot !== 'all') {
      where.push('j.Slot = ?');
      params.push(int(slot));
    }
    const w = where.join(' AND ');
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM DB_Jew j JOIN ID_Itm_Name n ON n.Itm_ID = j.Itm_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT j.Jew_ID id, n.${nc} name, j.Slot slot, j.Price price, j.Itm_ID itm,
                       t1.${L('SklTree_Name', lang)} t1name, j.SklTree1_Pt p1,
                       t2.${L('SklTree_Name', lang)} t2name, j.SklTree2_Pt p2
                FROM DB_Jew j JOIN ID_Itm_Name n ON n.Itm_ID = j.Itm_ID
                LEFT JOIN ID_SklTree_Name t1 ON t1.SklTree_ID = j.SklTree1_ID
                LEFT JOIN ID_SklTree_Name t2 ON t2.SklTree_ID = j.SklTree2_ID
                WHERE ${w} ORDER BY j.Slot, j.Jew_ID LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  function jewelDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const base = db
      .prepare(
        `SELECT j.*, n.${L('Itm_Name', lang)} name, t1.${L('SklTree_Name', lang)} t1name,
                t2.${L('SklTree_Name', lang)} t2name, i.Rare rare, i.Sell sell, i.Buy buy
         FROM DB_Jew j JOIN ID_Itm_Name n ON n.Itm_ID = j.Itm_ID
         LEFT JOIN ID_SklTree_Name t1 ON t1.SklTree_ID = j.SklTree1_ID
         LEFT JOIN ID_SklTree_Name t2 ON t2.SklTree_ID = j.SklTree2_ID
         LEFT JOIN DB_Itm i ON i.Itm_ID = j.Itm_ID WHERE j.Jew_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });
    const materials = db
      .prepare(
        `SELECT x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty
         FROM DB_ItmtoJew x JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID
         WHERE x.Jew_ID = ? ORDER BY x.ID`
      )
      .all(id);
    json(res, 200, { data: base, materials });
  }

  // ---------------------------------------------------------------- quests

  function listQuests(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const lv = url.searchParams.get('lv');
    const type = url.searchParams.get('type');
    const group = url.searchParams.get('group');
    const key = url.searchParams.get('key');
    const supplement = url.searchParams.get('supplement');
    const nc = L('Qst_Name', lang);
    const where = ['1 = 1'];
    const params = [];
    if (q) {
      where.push(`n.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    if (lv && lv !== 'all') {
      where.push('q.Qst_Lv_ID = ?');
      params.push(int(lv));
    }
    if (type && type !== 'all') {
      where.push('q.Qst_Type_ID = ?');
      params.push(int(type));
    }
    const groups = { village: [13, 22], hub: [23, 29], g: [30, 33], permit: [34, 34], dlc: [36, 45] };
    if (Object.hasOwn(groups, group)) {
      where.push('q.Qst_Lv_ID BETWEEN ? AND ?');
      params.push(...groups[group]);
    }
    if (key === 'progress') where.push('q.Qst_Key_ID IN (1, 2)');
    if (key === '1' || key === '2') {
      where.push('q.Qst_Key_ID = ?');
      params.push(Number(key));
    }
    if (key === 'talk') where.push('q.QstTalk = 1');
    if (Object.hasOwn(questSupplementIds, supplement)) {
      where.push('q.Qst_ID IN (SELECT value FROM json_each(?))');
      params.push(questSupplementIds[supplement]);
    }
    const w = where.join(' AND ');
    const selected = int(url.searchParams.get('selected'));
    const size = Math.min(200, Math.max(1, int(url.searchParams.get('size'), 40)));
    const scope = `FROM DB_Qst q JOIN ID_Qst_Name n ON n.Qst_ID = q.Qst_ID WHERE ${w}`;
    let focusPage;
    if (selected && !url.searchParams.has('page') && db.prepare(`SELECT 1 ${scope} AND q.Qst_ID = ?`).get(...params, selected)) {
      const { n } = db.prepare(`SELECT COUNT(*) n ${scope} AND q.Qst_ID < ?`).get(...params, selected);
      focusPage = Math.floor(n / size) + 1;
    }
    paged(req, res, {
      focusPage,
      countSql: `SELECT COUNT(*) n ${scope}`,
      countParams: params,
      listSql: `SELECT q.Qst_ID id, n.${nc} name, lv.${L('Qst_Lv', lang)} lv, ty.${L('Qst_Type', lang)} type,
                       k.${L('Qst_Key', lang)} key, l.${L('Loc_Name', lang)} loc, q.Reward reward, q.HRP hrp,
                       q.Fee fee, q.Time time, q.QstIcon icon, q.QstTalk talk
                FROM DB_Qst q
                JOIN ID_Qst_Name n ON n.Qst_ID = q.Qst_ID
                LEFT JOIN ID_Qst_Lv lv ON lv.Qst_Lv_ID = q.Qst_Lv_ID
                LEFT JOIN ID_Qst_Type ty ON ty.Qst_Type_ID = q.Qst_Type_ID
                LEFT JOIN ID_Qst_Key k ON k.Qst_Key_ID = q.Qst_Key_ID
                LEFT JOIN ID_Loc_Name l ON l.Loc_ID = q.Loc_ID
                WHERE ${w} ORDER BY q.Qst_ID LIMIT ? OFFSET ?`,
      listParams: params,
      map: (row) => ({ ...row, flags: questReference.quests[row.id]?.flags || [] }),
    });
  }

  function questDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const base = db
      .prepare(
        `SELECT q.*, n.${L('Qst_Name', lang)} name, lv.${L('Qst_Lv', lang)} lv, ty.${L('Qst_Type', lang)} type,
                k.${L('Qst_Key', lang)} key, l.${L('Loc_Name', lang)} loc,
                g1.${L('Qst_Goal', lang)} goal1, g2.${L('Qst_Goal2', lang)} goal2
         FROM DB_Qst q
         JOIN ID_Qst_Name n ON n.Qst_ID = q.Qst_ID
         LEFT JOIN ID_Qst_Lv lv ON lv.Qst_Lv_ID = q.Qst_Lv_ID
         LEFT JOIN ID_Qst_Type ty ON ty.Qst_Type_ID = q.Qst_Type_ID
         LEFT JOIN ID_Qst_Key k ON k.Qst_Key_ID = q.Qst_Key_ID
         LEFT JOIN ID_Loc_Name l ON l.Loc_ID = q.Loc_ID
         LEFT JOIN ID_Qst_Goal g1 ON g1.Qst_ID = q.Qst_ID
         LEFT JOIN ID_Qst_Goal2 g2 ON g2.Qst_ID = q.Qst_ID
         WHERE q.Qst_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });
    const rewards = db
      .prepare(
        `SELECT x.Type line, x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty, x.Pct pct
         FROM DB_ItmtoQst x JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID
         WHERE x.Qst_ID = ? ORDER BY x.Type, x.ID`
      )
      .all(id);
    const monsters = [];
    for (let i = 1; i <= 8; i++) {
      const mid = base['Mon' + i + '_ID'];
      if (mid === undefined || mid === null || mid < 0) continue;
      const m = db
        .prepare(`SELECT Mon_ID id, ${L('Mon_Name', lang)} name FROM ID_Mon_Name WHERE Mon_ID = ?`)
        .get(mid);
      monsters.push(m || { id: mid, name: '' });
    }
    const note = questReference.quests[id];
    const dependents = (questDependents.get(id) || []).map((quest) => db.prepare(
      `SELECT Qst_ID id, ${L('Qst_Name', lang)} name FROM ID_Qst_Name WHERE Qst_ID = ?`
    ).get(quest));
    json(res, 200, { data: base, rewards, monsters, reference: note || null, questSource, dependents });
  }

  // ---------------------------------------------------------------- monsters

  // The original roster ends at 129. Entry 130 is the unstable-quest marker.
  const monsterType = (id) => id <= 36 ? 'small' : id <= 129 ? 'large' : 'marker';
  const monsterQuestCondition = (ref) => Array.from({ length: 8 }, (_, i) => `q.Mon${i + 1}_ID = ${ref}`).join(' OR ');

  function listMonsters(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const nc = L('Mon_Name', lang);
    const where = ['m.Mon_ID BETWEEN 1 AND 129'];
    const params = [];
    if (q) {
      where.push(`m.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    const kind = url.searchParams.get('kind');
    if (kind === 'small') where.push('m.Mon_ID <= 36');
    if (kind === 'large') where.push('m.Mon_ID >= 37');
    const w = where.join(' AND ');
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM ID_Mon_Name m WHERE ${w}`,
      countParams: params,
      listSql: `SELECT m.Mon_ID id, m.${nc} name,
                       (SELECT COUNT(DISTINCT q.Qst_ID) FROM DB_Qst q
                         WHERE ${monsterQuestCondition('m.Mon_ID')}) quests
                FROM ID_Mon_Name m WHERE ${w} ORDER BY m.Mon_ID LIMIT ? OFFSET ?`,
      listParams: params,
      map: (row) => ({ ...row, kind: monsterType(row.id) }),
    });
  }

  function monsterDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const base = db.prepare(`SELECT Mon_ID id, ${L('Mon_Name', lang)} name FROM ID_Mon_Name WHERE Mon_ID = ?`).get(id);
    if (!base) return json(res, 404, { error: 'not found' });

    const kind = monsterType(id);
    const partArt = `MonPart_${String(id).padStart(3, '0')}`;
    const diagram = kind === 'large' && hasIcon(partArt) ? partArt : null;

    const weak = db
      .prepare(
        `SELECT w.MonPart_ID partId, p.${L('Mon_Part', lang)} part, c.${L('Mon_PartCond', lang)} condition, w.MonPart_Num num,
                w.Cut cut, w.Impact impact, w.Shot shot, w.Fir fir, w.Wtr wtr, w.Ice ice, w.Thd thd, w.Drg drg, w.Diz diz
         FROM DB_Mon_Weak w LEFT JOIN ID_Mon_Part p ON p.Mon_Part_ID = w.MonPart_ID
         LEFT JOIN ID_Mon_PartCond c ON c.Mon_Part_ID = w.MonPart_ID
         WHERE w.Mon_ID = ? ORDER BY w.MonPart_ID`
      )
      .all(id);

    const ailments = db
      .prepare(
        `SELECT Stat_ID stat, TolInitial initial, TolIncrease inc, TolMax max, Duration duration, Damage damage
         FROM DB_Mon_Ail WHERE Mon_ID = ? ORDER BY Stat_ID`
      )
      .all(id);

    const traps = db
      .prepare(
        `SELECT Trap_ID trap, IsEffect effect, Duration duration, DurationEnraged enraged, DurationFatigued fatigued
         FROM DB_Mon_Trap WHERE Mon_ID = ? ORDER BY Trap_ID`
      )
      .all(id);

    const drops = db
      .prepare(
        `SELECT t.${L('Mon_GetItmType', lang)} how, r.${L('Rank', lang)} rank, x.Rank_ID rankId, x.Itm_ID id,
                n.${L('Itm_Name', lang)} name, x.Qty qty, x.Pct pct
         FROM DB_ItmtoMon x
         JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID
         LEFT JOIN ID_Mon_GetItmType t ON t.Mon_GetItmType_ID = x.Mon_GetItmType_ID
         LEFT JOIN ID_Rank r ON r.Rank_ID = x.Rank_ID
         WHERE x.Mon_ID = ? ORDER BY x.Mon_GetItmType_ID, x.Rank_ID, x.ID`
      )
      .all(id);

    const quests = db
      .prepare(
        `SELECT q.Qst_ID id, n.${L('Qst_Name', lang)} name, lv.${L('Qst_Lv', lang)} lv
         FROM DB_Qst q JOIN ID_Qst_Name n ON n.Qst_ID = q.Qst_ID
         LEFT JOIN ID_Qst_Lv lv ON lv.Qst_Lv_ID = q.Qst_Lv_ID
         WHERE ${monsterQuestCondition('?1')}
         ORDER BY q.Qst_ID`
      )
      .all(id);

    json(res, 200, { data: { ...base, kind, diagram }, weak, ailments, traps, drops, quests });
  }

  // ---------------------------------------------------------------- combos

  function listCombos(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const nc = L('Itm_Name', lang);
    const where = ['1 = 1'];
    const params = [];
    if (q) {
      where.push(`(na.${nc} LIKE ? ESCAPE '\\' OR nb.${nc} LIKE ? ESCAPE '\\' OR c2.${nc} LIKE ? ESCAPE '\\')`);
      const like = `%${escapeLike(q)}%`;
      params.push(like, like, like);
    }
    const w = where.join(' AND ');
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM DB_ItmtoCbo c
                 JOIN ID_Itm_Name na ON na.Itm_ID = c.ItmA_ID
                 JOIN ID_Itm_Name nb ON nb.Itm_ID = c.ItmB_ID
                 JOIN ID_Itm_Name c2 ON c2.Itm_ID = c.ItmC_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT c.Cbo_ID id, c.Succ succ, c.Qty qty, c.ItmA_ID aId, na.${nc} a,
                       c.ItmB_ID bId, nb.${nc} b, c.ItmC_ID cId, c2.${nc} c
                FROM DB_ItmtoCbo c
                JOIN ID_Itm_Name na ON na.Itm_ID = c.ItmA_ID
                JOIN ID_Itm_Name nb ON nb.Itm_ID = c.ItmB_ID
                JOIN ID_Itm_Name c2 ON c2.Itm_ID = c.ItmC_ID
                WHERE ${w} ORDER BY c.Cbo_ID LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  // ---------------------------------------------------------------- horns

  function listHorns(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const where = ['1 = 1'];
    const params = [];
    if (q) {
      where.push(`e1.${L('Wpn_RecitalEffect', lang)} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    const w = where.join(' AND ');
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM DB_HHSong s LEFT JOIN ID_Wpn_RecitalEffect e1 ON e1.Wpn_RecitalEffect_ID = s.RecitalEffect_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT s.HHSong_ID id, s.HHSongRank_ID rank, s.Note1_ID n1, s.Note2_ID n2, s.Note3_ID n3, s.Note4_ID n4,
                       e1.${L('Wpn_RecitalEffect', lang)} eff1, e2.${L('Wpn_RecitalEffect', lang)} eff2,
                       s.Duration dur, s.Duration_M durM, s.Reload reload, s.Reload_M reloadM,
                       c1.${L('Wpn_HHSongCategory', lang)} cat1, c2.${L('Wpn_HHSongCategory', lang)} cat2,
                       (SELECT COUNT(*) FROM DB_HHSongtoWpn x WHERE x.HHSong_ID = s.HHSong_ID) weapons
                FROM DB_HHSong s
                LEFT JOIN ID_Wpn_RecitalEffect e1 ON e1.Wpn_RecitalEffect_ID = s.RecitalEffect_ID
                LEFT JOIN ID_Wpn_RecitalEffect e2 ON e2.Wpn_RecitalEffect_ID = s.RecitalEffect2_ID
                LEFT JOIN ID_Wpn_HHSongCategory c1 ON c1.Wpn_HHSongCategory_ID = s.Category1_ID
                LEFT JOIN ID_Wpn_HHSongCategory c2 ON c2.Wpn_HHSongCategory_ID = s.Category2_ID
                WHERE ${w} ORDER BY s.HHSong_ID LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  // ---------------------------------------------------------------- kinsects

  function listKinsects(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const nc = L('ISKinsect_Name', lang);
    const where = ['k.ISKinsect_ID > 0'];
    const params = [];
    if (q) {
      where.push(`n.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    const w = where.join(' AND ');
    paged(req, res, {
      countSql: `SELECT COUNT(*) n FROM DB_ISKinsect k JOIN ID_ISKinsect_Name n ON n.ISKinsect_ID = k.ISKinsect_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT k.ISKinsect_ID id, n.${nc} name, k.Type type, k.Rare rare, k.ImgFile img,
                       (SELECT COUNT(*) FROM DB_ISKinsectBugSkill b WHERE b.ISKinsect_ID = k.ISKinsect_ID) bugSkills,
                       (SELECT COUNT(*) FROM DB_ISKinsectExtractSkill b WHERE b.ISKinsect_ID = k.ISKinsect_ID) extractSkills
                FROM DB_ISKinsect k JOIN ID_ISKinsect_Name n ON n.ISKinsect_ID = k.ISKinsect_ID
                WHERE ${w} ORDER BY k.ISKinsect_ID LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  function kinsectDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const base = db
      .prepare(
        `SELECT k.*, n.${L('ISKinsect_Name', lang)} name FROM DB_ISKinsect k
         JOIN ID_ISKinsect_Name n ON n.ISKinsect_ID = k.ISKinsect_ID WHERE k.ISKinsect_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });
    const bugSkills = db
      .prepare(
        `SELECT b.ISKinsect_BugSkill_ID id, n.${L('ISKinsect_BugSkill', lang)} name
         FROM DB_ISKinsectBugSkill b JOIN ID_ISKinsect_BugSkill n ON n.ISKinsect_BugSkill_ID = b.ISKinsect_BugSkill_ID
         WHERE b.ISKinsect_ID = ?`
      )
      .all(id);
    const extractSkills = db
      .prepare(
        `SELECT b.ISKinsect_ExtractSkill_ID id, n.${L('ISKinsect_ExtractSkill', lang)} name
         FROM DB_ISKinsectExtractSkill b JOIN ID_ISKinsect_ExtractSkill n ON n.ISKinsect_ExtractSkill_ID = b.ISKinsect_ExtractSkill_ID
         WHERE b.ISKinsect_ID = ?`
      )
      .all(id);
    const materials = db
      .prepare(
        `SELECT x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty FROM DB_ItmtoISKinsect x
         JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID WHERE x.ISKinsect_ID = ?`
      )
      .all(id);
    json(res, 200, { data: base, bugSkills, extractSkills, materials });
  }

  // ---------------------------------------------------------------- palico

  function listPalicoWeapons(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const type = url.searchParams.get('type');
    const nc = L('PeliWpn_Name', lang);
    const where = ['p.PeliWpn_ID > 0'];
    const params = [];
    if (q) {
      where.push(`n.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    if (type && type !== 'all') {
      where.push('p.PeliWpn_Type_ID = ?');
      params.push(int(type));
    }
    const w = where.join(' AND ');
    paged(req, res, {
      maxSize: 2000,
      countSql: `SELECT COUNT(*) n FROM DB_PeliWpn p JOIN ID_PeliWpn_Name n ON n.PeliWpn_ID = p.PeliWpn_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT p.PeliWpn_ID id, n.${nc} name, p.Part part, p.Rare rare, p.PeliWpn_Type_ID type,
                       t.${L('PeliWpn_Type', lang)} typeName, p.AtkD atkD, p.AtkI atkI,
                       p.AtkD_Affinity affinityD, p.AtkI_Affinity affinityI, p.Sharp_ID sharp,
                       p.Def def, p.Price price, p.ImgFile img
                FROM DB_PeliWpn p JOIN ID_PeliWpn_Name n ON n.PeliWpn_ID = p.PeliWpn_ID
                LEFT JOIN ID_PeliWpn_Type t ON t.PeliWpn_Type_ID = p.PeliWpn_Type_ID
                WHERE ${w} ORDER BY p.PeliWpn_ID LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  function palicoWeaponDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const base = db
      .prepare(
        `SELECT p.*, n.${L('PeliWpn_Name', lang)} name, t.${L('PeliWpn_Type', lang)} typeName, e.${L('Wpn_SpAtk', lang)} element
         FROM DB_PeliWpn p JOIN ID_PeliWpn_Name n ON n.PeliWpn_ID = p.PeliWpn_ID
         LEFT JOIN ID_PeliWpn_Type t ON t.PeliWpn_Type_ID = p.PeliWpn_Type_ID
         LEFT JOIN ID_Wpn_SpAtk e ON e.Wpn_SpAtk_ID = p.SpAtk_ID
         WHERE p.PeliWpn_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });
    const materials = db
      .prepare(
        `SELECT x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty FROM DB_ItmtoPeliWpn x
         JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID WHERE x.PeliWpn_ID = ?`
      )
      .all(id);
    json(res, 200, { data: base, materials });
  }

  function listPalicoArmor(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    const part = url.searchParams.get('part');
    const nc = L('PeliAmr_Name', lang);
    const where = ['a.PeliAmr_ID > 0'];
    const params = [];
    if (q) {
      where.push(`n.${nc} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(q)}%`);
    }
    if (part && part !== 'all') {
      where.push('a.Part = ?');
      params.push(int(part));
    }
    const w = where.join(' AND ');
    paged(req, res, {
      maxSize: 2000,
      countSql: `SELECT COUNT(*) n FROM DB_PeliAmr a JOIN ID_PeliAmr_Name n ON n.PeliAmr_ID = a.PeliAmr_ID WHERE ${w}`,
      countParams: params,
      listSql: `SELECT a.PeliAmr_ID id, n.${nc} name, a.Part part, a.Rare rare, a.Def def,
                       a.Res_Fire fir, a.Res_Water wtr, a.Res_Thunder thd, a.Res_Ice ice, a.Res_Dragon drg,
                       a.Price price, a.ImgFile img
                FROM DB_PeliAmr a JOIN ID_PeliAmr_Name n ON n.PeliAmr_ID = a.PeliAmr_ID
                WHERE ${w} ORDER BY a.PeliAmr_ID LIMIT ? OFFSET ?`,
      listParams: params,
    });
  }

  function palicoArmorDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const base = db
      .prepare(
        `SELECT a.*, n.${L('PeliAmr_Name', lang)} name FROM DB_PeliAmr a
         JOIN ID_PeliAmr_Name n ON n.PeliAmr_ID = a.PeliAmr_ID WHERE a.PeliAmr_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });
    const materials = db
      .prepare(
        `SELECT x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty FROM DB_ItmtoPeliAmr x
         JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID WHERE x.PeliAmr_ID = ?`
      )
      .all(id);
    json(res, 200, { data: base, materials });
  }

  function palicoTeam(req, res) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const rows = db
      .prepare(
        `SELECT x.PeliTeam_ID id, x.Icon icon, x.Qty qty, x.Pct pct, x.Rank_ID rankId, x.Zone_ID zoneId,
                i.Itm_ID itmId, i.${L('Itm_Name', lang)} item,
                r.${L('Rank', lang)} rank, z.${L('PeliTeam_Zone', lang)} zone, m.${L('Mon_Name', lang)} monster
         FROM DB_ItmtoPeliTeam x
         JOIN ID_Itm_Name i ON i.Itm_ID = x.Itm_ID
         LEFT JOIN ID_Rank r ON r.Rank_ID = x.Rank_ID
         LEFT JOIN ID_PeliTeam_Zone z ON z.PeliTeam_Zone_ID = x.Zone_ID
         LEFT JOIN ID_Mon_Name m ON m.Mon_ID = x.Icon AND x.Icon BETWEEN 1 AND 129
         ORDER BY x.PeliTeam_ID`
      )
      .all();
    json(res, 200, { rows });
  }

  // ---------------------------------------------------------------- arena

  function listArena(req, res) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const rows = db
      .prepare(
        `SELECT a.Ara_ID id, n.${L('Ara_Name', lang)} name, l.${L('Loc_Name', lang)} loc,
                a.Reward reward, a.Player player, a.TimeS timeS, a.TimeA timeA, a.TimeB timeB, a.QstIcon icon
         FROM DB_Ara a JOIN ID_Ara_Name n ON n.Ara_ID = a.Ara_ID
         LEFT JOIN ID_Loc_Name l ON l.Loc_ID = a.Loc_ID
         WHERE a.Ara_ID > 0 ORDER BY a.Ara_ID`
      )
      .all();
    json(res, 200, { total: rows.length, rows });
  }

  function arenaDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const base = db
      .prepare(
        `SELECT a.*, n.${L('Ara_Name', lang)} name, l.${L('Loc_Name', lang)} loc
         FROM DB_Ara a JOIN ID_Ara_Name n ON n.Ara_ID = a.Ara_ID
         LEFT JOIN ID_Loc_Name l ON l.Loc_ID = a.Loc_ID WHERE a.Ara_ID = ?`
      )
      .get(id);
    if (!base) return json(res, 404, { error: 'not found' });
    const weapons = db
      .prepare(
        `SELECT x.Wpn_ID id, n.${L('Wpn_Name', lang)} name, x.Type kind FROM DB_Ara_Wpn x
         JOIN ID_Wpn_Name n ON n.Wpn_ID = x.Wpn_ID WHERE x.Ara_ID = ? ORDER BY x.ID`
      )
      .all(id);
    const armors = db
      .prepare(
        `SELECT a.Amr_ID id, n.${L('Amr_Name', lang)} name, a.Part part, x.Type kind FROM DB_Ara_Amr x
         JOIN DB_Amr a ON a.Amr_ID = x.Amr_ID JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID
         WHERE x.Ara_ID = ? ORDER BY x.ID`
      )
      .all(id);
    const items = db
      .prepare(
        `SELECT x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty, x.Pct pct FROM DB_Ara_Itm x
         JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID WHERE x.Ara_ID = ? ORDER BY x.ID`
      )
      .all(id);
    const box = db
      .prepare(
        `SELECT x.Itm_ID id, n.${L('Itm_Name', lang)} name, x.Qty qty, x.Type kind FROM DB_Ara_ItmBox x
         JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID WHERE x.Ara_ID = ? ORDER BY x.ID`
      )
      .all(id);
    const monsters = [];
    for (let i = 1; i <= 5; i++) {
      const mid = base['Mon' + i + '_ID'];
      if (mid === undefined || mid === null || mid < 0) continue;
      monsters.push(db.prepare(`SELECT Mon_ID id, ${L('Mon_Name', lang)} name FROM ID_Mon_Name WHERE Mon_ID = ?`).get(mid) || { id: mid, name: '' });
    }
    json(res, 200, { data: base, weapons, armors, items, box, monsters });
  }

  // ---------------------------------------------------------------- locations

  const locationMapId = (id) => id >= 28 && id <= 35 ? Math.floor((id - 28) / 2) + 1 : id;

  function listLocations(req, res) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const rows = db
      .prepare(
        `SELECT l.Loc_ID id, l.${L('Loc_Name', lang)} name,
                (SELECT COUNT(*) FROM DB_ItmtoLoc x WHERE x.Loc_ID = l.Loc_ID) items,
                (SELECT COUNT(*) FROM DB_ItmtoVet x WHERE x.Loc_ID = l.Loc_ID) trades
         FROM ID_Loc_Name l WHERE l.Loc_ID > 0 ORDER BY l.Loc_ID`
      )
      .all();
    json(res, 200, { total: rows.length, rows: rows.map((row) => ({ ...row, mapId: locationMapId(row.id) })) });
  }

  function locationDetail(req, res, id) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const base = db.prepare(`SELECT Loc_ID id, ${L('Loc_Name', lang)} name FROM ID_Loc_Name WHERE Loc_ID = ?`).get(id);
    if (!base) return json(res, 404, { error: 'not found' });
    const mapId = locationMapId(id);
    const rows = db
      .prepare(
        `SELECT x.Itm_ID id, n.${L('Itm_Name', lang)} name, a.${L('Loc_Ara', lang)} area,
                x.Loc_Ara_ID areaId, x.Loc_GetType_ID methodId, x.Rank_ID rankId,
                g.${L('Loc_GetType', lang)} how, r.${L('Rank', lang)} rank
         FROM DB_ItmtoLoc x
         JOIN ID_Itm_Name n ON n.Itm_ID = x.Itm_ID
         LEFT JOIN ID_Loc_Ara a ON a.Loc_Ara_ID = x.Loc_Ara_ID
         LEFT JOIN ID_Loc_GetType g ON g.Loc_GetType_ID = x.Loc_GetType_ID
         LEFT JOIN ID_Rank r ON r.Rank_ID = x.Rank_ID
         WHERE x.Loc_ID = ? ORDER BY x.Loc_Ara_ID, x.Loc_GetType_ID, x.Rank_ID, x.ID`
      )
      .all(mapId);
    json(res, 200, { data: { ...base, mapId, image: `Loc_${String(mapId).padStart(2, '0')}` }, rows });
  }

  function veggieTrades(req, res) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const rows = db.prepare(
      `SELECT x.Vet_ID id, x.Loc_ID locId, l.${L('Loc_Name', lang)} loc,
              x.ItmOut_ID giveId, o.${L('Itm_Name', lang)} give, x.ItmIn_ID getId, i.${L('Itm_Name', lang)} receive, x.Pct pct
       FROM DB_ItmtoVet x JOIN ID_Itm_Name o ON o.Itm_ID = x.ItmOut_ID
       JOIN ID_Itm_Name i ON i.Itm_ID = x.ItmIn_ID LEFT JOIN ID_Loc_Name l ON l.Loc_ID = x.Loc_ID ORDER BY x.Vet_ID`
    ).all();
    json(res, 200, { total: rows.length, rows });
  }

  // ---------------------------------------------------------------- awards

  function listAwards(req, res) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const rows = db
      .prepare(
        `SELECT a.Awd_ID id, a.${L('Awd_Name', lang)} name, d.${L('Awd_Des', lang)} des
         FROM ID_Awd_Name a LEFT JOIN ID_Awd_Des d ON d.Awd_ID = a.Awd_ID
         WHERE a.Awd_ID > 0 ORDER BY a.Awd_ID`
      )
      .all();
    json(res, 200, { total: rows.length, rows });
  }

  // ---------------------------------------------------------------- hunters for hire

  function listHfh(req, res) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const rows = db
      .prepare(
        `SELECT h.Hfh_ID id, n.${L('Hfh_Name', lang)} name, h.Lv_ID lv, l.${L('Loc_Name', lang)} loc,
                h.Succ succ, h.BigSucc bigSucc, h.Fee fee, h.FeeMargin margin
         FROM DB_Hfh h JOIN ID_Hfh_Name n ON n.Hfh_ID = h.Hfh_ID
         LEFT JOIN ID_Loc_Name l ON l.Loc_ID = h.Loc_ID
         WHERE h.Hfh_ID > 0 ORDER BY h.Hfh_ID LIMIT 400`
      )
      .all();
    json(res, 200, { total: rows.length, rows });
  }

  // ---------------------------------------------------------------- search

  function search(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return json(res, 200, { q, groups: [] });
    const like = `%${escapeLike(q)}%`;
    const groups = [];
    groups.push({
      type: 'items',
      label: '道具',
      rows: db
        .prepare(
          `SELECT i.Itm_ID id, n.${L('Itm_Name', lang)} name, i.Rare rare FROM DB_Itm i
           JOIN ID_Itm_Name n ON n.Itm_ID = i.Itm_ID WHERE i.Itm_ID > 0 AND n.${L('Itm_Name', lang)} LIKE ? ESCAPE '\\'
           ORDER BY i.Itm_ID LIMIT 8`
        )
        .all(like),
    });
    groups.push({
      type: 'weapons',
      label: '武器',
      rows: db
        .prepare(
          `SELECT w.Wpn_ID id, n.${L('Wpn_Name', lang)} name, w.Wpn_Type_ID type, w.Rare rare FROM DB_Wpn w
           JOIN ID_Wpn_Name n ON n.Wpn_ID = w.Wpn_ID WHERE w.Wpn_ID > 0 AND n.${L('Wpn_Name', lang)} LIKE ? ESCAPE '\\'
           ORDER BY w.Wpn_ID LIMIT 8`
        )
        .all(like),
    });
    groups.push({
      type: 'armor',
      label: '防具',
      rows: db
        .prepare(
          `SELECT a.Amr_ID id, n.${L('Amr_Name', lang)} name, a.Part part, a.Rare rare FROM DB_Amr a
           JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID WHERE a.Amr_ID > 0 AND n.${L('Amr_Name', lang)} LIKE ? ESCAPE '\\'
           ORDER BY a.Amr_ID LIMIT 8`
        )
        .all(like),
    });
    groups.push({
      type: 'monsters',
      label: '怪物',
      rows: db
        .prepare(
          `SELECT Mon_ID id, ${L('Mon_Name', lang)} name FROM ID_Mon_Name WHERE Mon_ID > 0 AND ${L('Mon_Name', lang)} LIKE ? ESCAPE '\\' ORDER BY Mon_ID LIMIT 8`
        )
        .all(like),
    });
    groups.push({
      type: 'quests',
      label: '任务',
      rows: db
        .prepare(
          `SELECT q.Qst_ID id, n.${L('Qst_Name', lang)} name, q.Qst_Lv_ID lv FROM DB_Qst q
           JOIN ID_Qst_Name n ON n.Qst_ID = q.Qst_ID WHERE n.${L('Qst_Name', lang)} LIKE ? ESCAPE '\\' ORDER BY q.Qst_ID LIMIT 8`
        )
        .all(like),
    });
    groups.push({
      type: 'skills',
      label: '技能',
      rows: db
        .prepare(
          `SELECT t.SklTree_ID id, t.${L('SklTree_Name', lang)} name FROM ID_SklTree_Name t
           WHERE t.${L('SklTree_Name', lang)} LIKE ? ESCAPE '\\' ORDER BY t.SklTree_ID LIMIT 8`
        )
        .all(like),
    });
    json(res, 200, { q, groups: groups.filter((g) => g.rows.length) });
  }

  // ---------------------------------------------------------------- set builder

  function setArmor(req, res) {
    const url = new URL(req.url, 'http://x');
    const lang = clampLang(url.searchParams.get('lang'));
    const part = int(url.searchParams.get('part'), 0);
    const borg = int(url.searchParams.get('borg'), 1);
    const morf = int(url.searchParams.get('morf'), 1);
    const rows = db
      .prepare(
        `SELECT a.Amr_ID id, n.${L('Amr_Name', lang)} name, a.Slot slot, a.Def def, a.MaxDef maxdef, a.Rare rare,
                a.Res_Fire fir, a.Res_Water wtr, a.Res_Thunder thd, a.Res_Ice ice, a.Res_Dragon drg,
                a.Amr_ImgFile img,
                (SELECT json_group_array(json_object('t', t.SklTree_ID, 'n', t.${L('SklTree_Name', lang)}, 'p', s.Pt))
                   FROM DB_SklTreetoAmr s JOIN ID_SklTree_Name t ON t.SklTree_ID = s.SklTree_ID
                   WHERE s.Amr_ID = a.Amr_ID) skills
         FROM DB_Amr a JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID
         WHERE a.Amr_ID > 0 AND a.Part = ? AND (a.BorG = ? OR a.BorG = 0) AND (a.MorF = ? OR a.MorF = 0)
         ORDER BY a.Rare DESC, a.Def DESC, a.Amr_ID`
      )
      .all(part, borg, morf)
      .map((r) => ({ ...r, skills: JSON.parse(r.skills || '[]') }));
    json(res, 200, { rows });
  }

  function setJewels(req, res) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const rows = db
      .prepare(
        `SELECT j.Jew_ID id, n.${L('Itm_Name', lang)} name, j.Slot slot, j.Price price,
                j.SklTree1_ID t1, t1.${L('SklTree_Name', lang)} t1name, j.SklTree1_Pt p1,
                j.SklTree2_ID t2, t2.${L('SklTree_Name', lang)} t2name, j.SklTree2_Pt p2
         FROM DB_Jew j JOIN ID_Itm_Name n ON n.Itm_ID = j.Itm_ID
         LEFT JOIN ID_SklTree_Name t1 ON t1.SklTree_ID = j.SklTree1_ID
         LEFT JOIN ID_SklTree_Name t2 ON t2.SklTree_ID = j.SklTree2_ID
         WHERE j.Slot > 0 ORDER BY j.Slot, j.Jew_ID`
      )
      .all();
    json(res, 200, { rows });
  }

  function setSkills(req, res) {
    const lang = clampLang(new URL(req.url, 'http://x').searchParams.get('lang'));
    const rows = db
      .prepare(
        `SELECT t.SklTree_ID id, t.${L('SklTree_Name', lang)} name, MAX(s.Pt) maxPt
         FROM ID_SklTree_Name t JOIN DB_Skl s ON s.SklTree_ID = t.SklTree_ID
         GROUP BY t.SklTree_ID ORDER BY t.SklTree_ID`
      )
      .all();
    const levels = db.prepare(`SELECT s.Skl_ID id, s.SklTree_ID treeId, s.Pt pt, n.${L('Skl_Name', lang)} name
      FROM DB_Skl s JOIN ID_Skl_Name n USING (Skl_ID) WHERE s.Pt > 0 AND s.SklTree_ID > 1 ORDER BY s.SklTree_ID,s.Pt`).all();
    json(res, 200, { rows, levels });
  }

  function computeSet(res, body) {
    const lang = clampLang(body.lang);
    const borg = int(body.borg, 1);
    const morf = int(body.morf, 1);
    const parts = body.parts || {};
    const pieceIds = ['head', 'body', 'arms', 'waist', 'legs']
      .map((k) => (parts[k] && parts[k].amrId ? int(parts[k].amrId) : null))
      .filter(Boolean);

    const pieces = pieceIds.length
      ? db
          .prepare(
            `SELECT a.Amr_ID id, n.${L('Amr_Name', lang)} name, a.Part part, a.Slot slot, a.Def def, a.MaxDef maxdef,
                    a.Res_Fire fir, a.Res_Water wtr, a.Res_Thunder thd, a.Res_Ice ice, a.Res_Dragon drg, a.Amr_ImgFile img
             FROM DB_Amr a JOIN ID_Amr_Name n ON n.Amr_ID = a.Amr_ID WHERE a.Amr_ID IN (${pieceIds.map(() => '?').join(',')})`
          )
          .all(...pieceIds)
      : [];

    const skills = new Map();
    const addSkill = (treeId, name, pt) => {
      if (!treeId || pt === 0 || treeId < 0) return;
      const cur = skills.get(treeId) || { treeId, name, pt: 0 };
      cur.pt += pt;
      skills.set(treeId, cur);
    };

    const armorSkills = pieceIds.length
      ? db
          .prepare(
            `SELECT s.Amr_ID amr, s.SklTree_ID tree, t.${L('SklTree_Name', lang)} name, s.Pt pt
             FROM DB_SklTreetoAmr s JOIN ID_SklTree_Name t ON t.SklTree_ID = s.SklTree_ID
             WHERE s.Amr_ID IN (${pieceIds.map(() => '?').join(',')})`
          )
          .all(...pieceIds)
      : [];
    for (const s of armorSkills) addSkill(s.tree, s.name, s.pt);

    const jewelUses = [];
    const totalSlots = pieces.reduce((sum, p) => sum + (p.slot || 0), 0);
    let usedSlots = 0;
    for (const key of ['head', 'body', 'arms', 'waist', 'legs']) {
      const sel = parts[key];
      if (!sel || !sel.amrId) continue;
      const jewelIds = (sel.jewels || []).map((j) => int(j)).filter(Boolean);
      for (const jid of jewelIds) {
        const jw = db
          .prepare(
            `SELECT j.Jew_ID id, n.${L('Itm_Name', lang)} name, j.Slot slot, j.SklTree1_ID t1, j.SklTree1_Pt p1,
                    j.SklTree2_ID t2, j.SklTree2_Pt p2,
                    t1.${L('SklTree_Name', lang)} t1name, t2.${L('SklTree_Name', lang)} t2name
             FROM DB_Jew j JOIN ID_Itm_Name n ON n.Itm_ID = j.Itm_ID
             LEFT JOIN ID_SklTree_Name t1 ON t1.SklTree_ID = j.SklTree1_ID
             LEFT JOIN ID_SklTree_Name t2 ON t2.SklTree_ID = j.SklTree2_ID
             WHERE j.Jew_ID = ?`
          )
          .get(jid);
        if (!jw) continue;
        usedSlots += jw.slot || 0;
        addSkill(jw.t1, jw.t1name, jw.p1);
        addSkill(jw.t2, jw.t2name, jw.p2);
        jewelUses.push({ key, jewel: jw.name, size: jw.slot });
      }
    }

    const talisman = body.talisman || {};
    for (const s of talisman.skills || []) {
      if (!s || !s.treeId) continue;
      const t = db.prepare(`SELECT ${L('SklTree_Name', lang)} name FROM ID_SklTree_Name WHERE SklTree_ID = ?`).get(int(s.treeId));
      if (!t) continue;
      addSkill(int(s.treeId), t.name, int(s.pt));
    }

    const rows = db.prepare('SELECT Skl_ID id, SklTree_ID tree, Pt pt FROM DB_Skl').all();
    const byTree = new Map();
    for (const r of rows) {
      if (!byTree.has(r.tree)) byTree.set(r.tree, []);
      byTree.get(r.tree).push(r);
    }
    const active = [];
    for (const s of skills.values()) {
      const levels = (byTree.get(s.treeId) || []).sort((a, b) => a.pt - b.pt);
      let matched = null;
      const positives = levels.filter((l) => l.pt > 0 && s.pt >= l.pt);
      if (positives.length) matched = positives[positives.length - 1];
      const negatives = levels.filter((l) => l.pt < 0 && s.pt <= l.pt);
      if (!matched && negatives.length) matched = negatives[negatives.length - 1];
      active.push({
        treeId: s.treeId,
        name: s.name,
        pt: s.pt,
        skill: matched ? db.prepare(`SELECT ${L('Skl_Name', lang)} name FROM ID_Skl_Name WHERE Skl_ID = ?`).get(matched.id).name : null,
        threshold: matched ? matched.pt : null,
      });
    }
    active.sort((a, b) => Math.abs(b.pt) - Math.abs(a.pt));

    json(res, 200, {
      pieces,
      totals: {
        def: pieces.reduce((s, p) => s + (p.def || 0), 0),
        maxdef: pieces.reduce((s, p) => s + (p.maxdef || 0), 0),
        fir: pieces.reduce((s, p) => s + (p.fir || 0), 0),
        wtr: pieces.reduce((s, p) => s + (p.wtr || 0), 0),
        thd: pieces.reduce((s, p) => s + (p.thd || 0), 0),
        ice: pieces.reduce((s, p) => s + (p.ice || 0), 0),
        drg: pieces.reduce((s, p) => s + (p.drg || 0), 0),
        slots: totalSlots,
        usedSlots,
        borg,
        morf,
      },
      active,
      jewels: jewelUses,
    });
  }

  // ---------------------------------------------------------------- routing

  const routes = [
    [/^\/api\/meta$/, (req, res) => json(res, 200, meta())],
    [/^\/api\/items$/, listItems],
    [/^\/api\/items\/(\d+)$/, (req, res, m) => itemDetail(req, res, int(m[1]))],
    [/^\/api\/weapons\/tree$/, weaponsTree],
    [/^\/api\/weapons$/, listWeapons],
    [/^\/api\/weapons\/(\d+)$/, (req, res, m) => weaponDetail(req, res, int(m[1]))],
    [/^\/api\/armor$/, listArmor],
    [/^\/api\/armor\/sets$/, listArmorSets],
    [/^\/api\/armor\/(\d+)$/, (req, res, m) => armorDetail(req, res, int(m[1]))],
    [/^\/api\/skills$/, listSkills],
    [/^\/api\/skills\/(\d+)$/, (req, res, m) => skillDetail(req, res, int(m[1]))],
    [/^\/api\/jewels$/, listJewels],
    [/^\/api\/jewels\/(\d+)$/, (req, res, m) => jewelDetail(req, res, int(m[1]))],
    [/^\/api\/quests$/, listQuests],
    [/^\/api\/quests\/(\d+)$/, (req, res, m) => questDetail(req, res, int(m[1]))],
    [/^\/api\/monsters$/, listMonsters],
    [/^\/api\/monsters\/(\d+)$/, (req, res, m) => monsterDetail(req, res, int(m[1]))],
    [/^\/api\/combos$/, listCombos],
    [/^\/api\/horns$/, listHorns],
    [/^\/api\/kinsects$/, listKinsects],
    [/^\/api\/kinsects\/(\d+)$/, (req, res, m) => kinsectDetail(req, res, int(m[1]))],
    [/^\/api\/palico\/weapons$/, listPalicoWeapons],
    [/^\/api\/palico\/weapons\/(\d+)$/, (req, res, m) => palicoWeaponDetail(req, res, int(m[1]))],
    [/^\/api\/palico\/armor$/, listPalicoArmor],
    [/^\/api\/palico\/armor\/(\d+)$/, (req, res, m) => palicoArmorDetail(req, res, int(m[1]))],
    [/^\/api\/palico\/team$/, palicoTeam],
    [/^\/api\/arena$/, listArena],
    [/^\/api\/arena\/(\d+)$/, (req, res, m) => arenaDetail(req, res, int(m[1]))],
    [/^\/api\/locations$/, listLocations],
    [/^\/api\/locations\/trades$/, veggieTrades],
    [/^\/api\/locations\/(\d+)$/, (req, res, m) => locationDetail(req, res, int(m[1]))],
    [/^\/api\/awards$/, listAwards],
    [/^\/api\/hfh$/, listHfh],
    [/^\/api\/search$/, search],
    [/^\/api\/set\/armor$/, setArmor],
    [/^\/api\/set\/jewels$/, setJewels],
    [/^\/api\/set\/skills$/, setSkills],
  ];

  function handleApi(req, send, pathname, body) {
    if (req.method === 'POST' && pathname === '/api/set/compute') return computeSet(send, body);
    for (const [pattern, handler] of routes) {
      const match = pathname.match(pattern);
      if (match) return handler(req, send, match);
    }
    return json(send, 404, { error: 'no such api' });
  }

  return handleApi;
}

module.exports = { createLibraryApi, clampLang };
