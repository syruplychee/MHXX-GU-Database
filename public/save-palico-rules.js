'use strict';

const SavePalicoRules = (() => {
  const columns = {
    moves: { learned: 'learnedMoves', pattern: 'movePattern', length: 'moveLength', raw: 'rawMoves', physical: 16 },
    skills: { learned: 'learnedSkills', pattern: 'skillPattern', length: 'skillLength', raw: 'rawSkills', physical: 12 },
  };

  function describe(cat, kind, catalog) {
    const fields = columns[kind];
    const native = catalog.palico.native;
    const moves = kind === 'moves';
    const scope = moves ? (cat.forte === 0 ? 'charisma_move' : 'normal_move') : 'skill';
    const prefix = moves ? '行动' : '技能';
    const fixed = native.valid_length[scope + '_fixed'];
    const transfer = native.valid_length[scope + '_transfer'];
    const sentinel = native.sentinels[moves ? 'support' : 'skill'];
    const patterns = native.patterns[scope];
    const knownPattern = patterns.find(([id]) => id === cat[fields.pattern]);
    const sequence = knownPattern?.[2] ?? '';
    const learned = cat[fields.learned];
    const abilities = catalog.palico[kind];
    const expected = fixed + sequence.length + transfer;
    const defects = [];
    const lead = native.fixed;
    const innate = moves ? [
      [lead.primary_support[cat.forte]],
      ...(cat.forte ? [lead.secondary_support[cat.forte] ?? []] : []),
      ...lead.common_support.map(id => [id]),
    ] : (lead.fixed_skills[cat.forte] ?? []).map(id => [id]);
    if (cat.forte > 7 || !knownPattern || learned.length !== expected || cat[fields.length] !== expected ||
        cat[fields.raw].slice(expected).some(id => id !== sentinel)) {
      defects.push(`${prefix}类型、有效长度或尾部填充值与原生表不符。`);
    }
    if (innate.some((choices, i) => !choices.includes(learned[i]))) defects.push(`${prefix}固有项与倾向不符。`);
    for (const [i, group] of [...sequence].entries()) {
      if (abilities[learned[fixed + i]]?.[1] !== group) defects.push(`${prefix}第 ${fixed + i + 1} 格应属于 ${group} 组。`);
    }
    const occupied = learned.filter(Boolean);
    if (new Set(occupied).size !== occupied.length) defects.push(`${prefix}已学项重复。`);
    let gap = false;
    for (const id of learned.slice(fixed + sequence.length)) {
      if (id === 0) gap = true;
      else if (gap || !abilities[id]?.[2]) {
        defects.push(`${prefix}传授栏有间隔或不可传授的项目。`);
        break;
      }
    }
    return { fields, prefix, fixed, transfer, sentinel, patterns, sequence, expected, defects };
  }

  function audit(cat, catalog) {
    return [...describe(cat, 'moves', catalog).defects, ...describe(cat, 'skills', catalog).defects];
  }

  function options(cat, kind, index, catalog, knownSpecial = []) {
    const rule = describe(cat, kind, catalog);
    const list = cat[rule.fields.learned];
    if (index < rule.fixed || index >= list.length || !rule.sequence || cat.forte > 7) return [];
    const group = rule.sequence[index - rule.fixed];
    const ids = Object.entries(catalog.palico[kind]).flatMap(([key, entry]) => {
      const id = Number(key);
      if (id < 1 || id >= rule.sentinel || list.some((other, i) => i !== index && other === id)) return [];
      if (group) return entry[1] === group ? [id] : [];
      return entry[2] && (entry[4] !== 'special' || id === list[index] || knownSpecial.includes(id)) ? [id] : [];
    });
    return group ? ids : [0, ...ids];
  }

  function changePattern(cat, kind, id, catalog) {
    const old = describe(cat, kind, catalog);
    const pattern = old.patterns.find(([key]) => key === id);
    if (!pattern || old.defects.length) throw new Error('这只艾露猫的原始组合无法按普通猫规则修改。');
    const current = cat[old.fields.learned];
    const fixed = current.slice(0, old.fixed);
    const taught = current.slice(-old.transfer);
    const candidates = Object.entries(catalog.palico[kind]);
    const used = new Set([...fixed, ...taught]);
    const rolled = [...pattern[2]].map(group => {
      const existing = current.slice(old.fixed, -old.transfer).find(id => !used.has(id) && catalog.palico[kind][id]?.[1] === group);
      const next = existing ?? Number(candidates.find(([key, row]) => row[1] === group && !used.has(Number(key)))[0]);
      used.add(next);
      return next;
    });
    const learned = [...fixed, ...rolled, ...taught];
    return { [old.fields.learned]: learned, [old.fields.pattern]: id, [old.fields.length]: learned.length,
      [old.fields.raw]: [...learned, ...Array(old.fields.physical - learned.length).fill(old.sentinel)] };
  }

  function capacity(level, equippedMoves, equippedSkills, catalog) {
    const [freeMoves, totalSkills] = catalog.palico.levels[level] ?? [0, 0];
    const limitMoves = freeMoves + 2 + Number(equippedSkills.includes(21));
    const costs = equippedSkills.map(id => catalog.palico.skills[id]?.[3]);
    return { usedMoves: equippedMoves.length, limitMoves, totalSkills,
      usedSkills: costs.every(Number.isInteger) ? costs.reduce((sum, cost) => sum + cost, 0) : null };
  }

  return { columns, describe, audit, options, changePattern, capacity };
})();

if (typeof module !== 'undefined') module.exports = SavePalicoRules;
