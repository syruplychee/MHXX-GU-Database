'use strict';

const TORSO_UP = 1;
const RESULT_LIMIT = 100;
const SEARCH_MS = 5000;
const integer = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;

function searchLoadouts(db, input, lang) {
  const { borg, morf, weaponSlots, targets, charms, charmId = null, excludedArmor = [] } = input || {};
  if (![1, 2].includes(borg) || ![1, 2].includes(morf) || !integer(weaponSlots, 0, 3) ||
      !Array.isArray(targets) || !targets.length || !Array.isArray(charms)) return { error: '请选择职业、性别和至少一项目标技能。' };
  if (!Array.isArray(excludedArmor) || excludedArmor.some((id) => !Number.isSafeInteger(id) || id <= 0)) return { error: '排除清单必须由有效的防具编号组成。' };
  const excluded = new Set(excludedArmor);

  const skillRows = db.prepare(`SELECT s.Skl_ID id, s.SklTree_ID treeId, s.Pt pt, n.Skl_Name_${lang} name
    FROM DB_Skl s JOIN ID_Skl_Name n USING (Skl_ID) ORDER BY s.Pt`).all();
  const skillsById = new Map(skillRows.map((skill) => [skill.id, skill]));
  const levelsByTree = Map.groupBy(skillRows, (skill) => skill.treeId);
  if (targets.some((id) => !skillsById.has(id) || skillsById.get(id).pt <= 0 || skillsById.get(id).treeId === TORSO_UP)) {
    return { error: '目标必须是可发动的正面技能。' };
  }
  const targetByTree = new Map();
  for (const id of targets) {
    const skill = skillsById.get(id);
    if (!(targetByTree.get(skill.treeId)?.pt >= skill.pt)) targetByTree.set(skill.treeId, skill);
  }
  const goal = [...targetByTree.values()];
  const index = new Map(goal.map((skill, i) => [skill.treeId, i]));
  const zeros = () => new Array(goal.length).fill(0);
  const need = goal.map((skill) => skill.pt);
  const project = (points) => {
    const vector = zeros();
    for (const { treeId, pt } of points) if (index.has(treeId)) vector[index.get(treeId)] += pt;
    return vector;
  };
  const owned = [{ id: '', slots: 0, skills: [] }];
  for (const charm of charms) {
    if (!charm || typeof charm.id !== 'string' || !charm.id ||
        !integer(charm.slots, 0, 3) || !Array.isArray(charm.skills) || charm.skills.length > 2 ||
        charm.skills.some((s) => !s || s.treeId === TORSO_UP || !levelsByTree.has(s.treeId) || !integer(s.pt, -99, 99))) {
      return { error: '护石需要 0–3 个孔位，以及最多两项有效的技能点。' };
    }
    if (new Set(charm.skills.map((s) => s.treeId)).size !== charm.skills.length) return { error: '同一枚护石的两个技能必须不同。' };
    owned.push({ id: charm.id, slots: charm.slots, skills: charm.skills });
  }
  const allowedCharms = charmId === null ? owned : owned.filter((charm) => charm.id === charmId);
  if (!allowedCharms.length) return { error: '指定的护石不在护石列表里。' };

  const treeNames = new Map(db.prepare(`SELECT SklTree_ID id, SklTree_Name_${lang} name FROM ID_SklTree_Name`).all().map((r) => [r.id, r.name]));
  const pieces = db.prepare(`SELECT a.Amr_ID id, n.Amr_Name_${lang} name, a.Part part, a.Slot slots, a.Def def, a.MaxDef maxDef
    FROM DB_Amr a JOIN ID_Amr_Name n USING (Amr_ID)
    WHERE a.BorG IN (0, ?) AND a.MorF IN (0, ?) ORDER BY a.Amr_ID`).all(borg, morf)
    .filter((piece) => !excluded.has(piece.id));
  const armorPoints = Map.groupBy(db.prepare('SELECT Amr_ID id, SklTree_ID treeId, Pt pt FROM DB_SklTreetoAmr').all(), (s) => s.id);
  for (const piece of pieces) piece.skills = armorPoints.get(piece.id) || [];
  const jewels = db.prepare(`SELECT j.Jew_ID id, n.Itm_Name_${lang} name, j.Slot slots, j.SklTree1_ID t1, j.SklTree1_Pt p1,
    j.SklTree2_ID t2, j.SklTree2_Pt p2 FROM DB_Jew j JOIN ID_Itm_Name n USING (Itm_ID) WHERE j.Slot BETWEEN 1 AND 3 ORDER BY j.Jew_ID`).all();
  const jewelOptions = jewels.map((jewel) => {
    const skills = [{ treeId: jewel.t1, pt: jewel.p1 }, { treeId: jewel.t2, pt: jewel.p2 }].filter((s) => s.treeId > 0 && s.pt);
    return { id: jewel.id, name: jewel.name, slots: jewel.slots, skills, vector: project(skills) };
  }).filter((jewel) => jewel.vector.some((pt) => pt > 0));

  // Generate legal packs per item, so two holes on different items never fit a two-hole jewel.
  const deadline = performance.now() + SEARCH_MS;
  let timedOut = false;
  let visits = 0;
  function expired() {
    if ((++visits & 1023) === 0 && performance.now() > deadline) timedOut = true;
    return timedOut;
  }
  const packs = Array.from({ length: 4 }, () => new Map());
  function pack(start, left, vector, chosen) {
    if (expired()) return;
    const used = 3 - left;
    const key = vector.join(',');
    for (let cap = used; cap <= 3; cap++) {
      if (!packs[cap].has(key) || packs[cap].get(key).used > used) packs[cap].set(key, { vector, jewels: chosen, used });
    }
    for (let i = start; i < jewelOptions.length; i++) {
      const jewel = jewelOptions[i];
      if (jewel.slots <= left) pack(i, left - jewel.slots, vector.map((v, j) => v + jewel.vector[j]), [...chosen, jewel]);
    }
  }
  pack(0, 3, zeros(), []);

  const weight = (vector) => vector.reduce((sum, v, i) => sum + v / need[i], 0);
  function options(gears, multiplier = 1) {
    const representatives = new Map();
    for (const gear of gears) {
      const base = project(gear.skills);
      const torso = gear.skills.some((s) => s.treeId === TORSO_UP && s.pt > 0) ? 1 : 0;
      for (const decoration of packs[gear.slots].values()) {
        if (expired()) return [];
        const vector = base.map((pt, i) => (pt + decoration.vector[i]) * multiplier);
        const option = { gear, vector, torso, jewels: decoration.jewels, used: decoration.used, weight: weight(vector) };
        const key = `${torso}:${vector.join(',')}`;
        const old = representatives.get(key);
        if (!old || (gear.maxDef || 0) > (old.gear.maxDef || 0) ||
            (gear.maxDef === old.gear.maxDef && option.used < old.used)) representatives.set(key, option);
      }
    }
    return [...representatives.values()].sort((a, b) => b.weight - a.weight || (b.gear.maxDef || 0) - (a.gear.maxDef || 0) || a.used - b.used);
  }

  const byPart = Map.groupBy(pieces, (piece) => piece.part);
  const armorGroups = [1, 3, 4, 5].map((part) => options(byPart.get(part) || []));
  const charmOptions = options(allowedCharms);
  const weaponOptions = options([{ id: '', slots: weaponSlots, skills: [] }]);
  const results = [];
  const seen = new Set();

  function record(picked, torso) {
    const key = JSON.stringify(picked.slice(0, 6).map((o) => o.gear.id));
    if (seen.has(key)) return;
    seen.add(key);
    const points = zeros();
    for (const option of picked) for (const [i, pt] of option.vector.entries()) points[i] += pt;
    const fitted = picked.map((o) => ({ ...o, jewels: o.jewels.slice() }));
    // Try freeing weapon and charm slots first while keeping every selected skill active.
    for (let i = fitted.length - 1; i >= 0; i--) {
      const o = fitted[i];
      const scale = i === 1 ? torso + 1 : 1;
      for (let j = o.jewels.length - 1; j >= 0; j--) {
        const jewel = o.jewels[j];
        if (need.some((pt, n) => points[n] - jewel.vector[n] * scale < pt)) continue;
        for (const [n, pt] of jewel.vector.entries()) points[n] -= pt * scale;
        o.jewels.splice(j, 1);
        o.used -= jewel.slots;
      }
    }
    const armor = fitted.slice(0, 5);
    const charm = fitted[5];
    const weapon = fitted[6];
    const totals = new Map();
    const accumulate = (points, scale) => {
      for (const { treeId, pt } of points) {
        if (treeId > TORSO_UP) totals.set(treeId, (totals.get(treeId) || 0) + pt * scale);
      }
    };
    for (const [i, option] of fitted.entries()) {
      const scale = i === 1 ? torso + 1 : 1;
      accumulate(option.gear.skills, scale);
      for (const jewel of option.jewels) accumulate(jewel.skills, scale);
    }
    const active = [...totals].flatMap(([treeId, pt]) => {
      const levels = levelsByTree.get(treeId) || [];
      const level = pt < 0 ? levels.find((s) => s.pt < 0 && pt <= s.pt) : levels.findLast((s) => s.pt > 0 && pt >= s.pt);
      return level ? [{ treeId, pt, name: level.name || treeNames.get(treeId), negative: level.pt < 0 }] : [];
    }).sort((a, b) => Number(a.negative) - Number(b.negative) || a.treeId - b.treeId);
    const placement = (o) => ({ slots: o.gear.slots, used: o.used, jewels: o.jewels.map(({ id, name, slots }) => ({ id, name, slots })) });
    results.push({ key, borg, morf, torso, active, goals: goal.map((skill) => ({ ...skill, total: totals.get(skill.treeId) })),
      armor: armor.map((o) => ({ id: o.gear.id, name: o.gear.name, part: o.gear.part, ...placement(o) })),
      charm: { ...charm.gear, ...placement(charm), skills: charm.gear.skills.map((s) => ({ ...s, name: treeNames.get(s.treeId) })) },
      weapon: placement(weapon), def: armor.reduce((sum, o) => sum + o.gear.def, 0), maxDef: armor.reduce((sum, o) => sum + o.gear.maxDef, 0) });
  }

  for (let torso = 0; torso <= 4 && !timedOut && results.length < RESULT_LIMIT; torso++) {
    const groups = [armorGroups[0], options(byPart.get(2) || [], torso + 1), ...armorGroups.slice(1), charmOptions, weaponOptions]
      .map((choices, id) => ({ id, choices })).sort((a, b) => a.choices.length - b.choices.length);
    const bounds = Array.from({ length: groups.length + 1 }, () => new Array(torso + 1).fill(null));
    bounds.at(-1)[0] = { vector: zeros(), weight: 0 };
    for (let depth = groups.length - 1; depth >= 0; depth--) {
      const byTorso = Map.groupBy(groups[depth].choices, (o) => o.torso);
      const groupMax = [...byTorso].map(([count, choices]) => [count, {
        vector: goal.map((_, i) => choices.reduce((max, o) => Math.max(max, o.vector[i]), -Infinity)), weight: choices[0].weight,
      }]);
      for (let left = 0; left <= torso; left++) {
        for (const [count, max] of groupMax) {
          const next = bounds[depth + 1][left - count];
          if (!next) continue;
          const best = bounds[depth][left];
          const vector = max.vector.map((pt, i) => Math.max(pt + next.vector[i], best?.vector[i] ?? -Infinity));
          bounds[depth][left] = { vector, weight: Math.max(max.weight + next.weight, best?.weight ?? -Infinity) };
        }
      }
    }

    const dead = new Set();
    const picked = [];
    function visit(depth, left, vector, score) {
      if (expired() || results.length >= RESULT_LIMIT) return false;
      const bound = bounds[depth][left];
      if (!bound || score + bound.weight < goal.length - 1e-9 || need.some((pt, i) => vector[i] + bound.vector[i] < pt)) return false;
      if (depth === groups.length) { record(picked, torso); return true; }
      const state = `${depth}:${left}:${vector.join(',')}`;
      if (dead.has(state)) return false;
      let found = false;
      const { id, choices } = groups[depth];
      for (const o of choices) {
        if (o.torso > left) continue;
        if (timedOut || results.length >= RESULT_LIMIT) break;
        picked[id] = o;
        if (visit(depth + 1, left - o.torso, vector.map((pt, i) => pt + o.vector[i]), score + o.weight)) found = true;
      }
      if (!found) dead.add(state);
      return found;
    }
    visit(0, torso, zeros(), 0);
  }
  results.sort((a, b) => b.maxDef - a.maxDef || b.def - a.def);
  return { results, timedOut, limit: RESULT_LIMIT };
}

module.exports = { searchLoadouts };
