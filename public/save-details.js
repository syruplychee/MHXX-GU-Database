'use strict';

const saveHunterParts = ['武器', '头部', '胸部', '腕部', '腰部', '腿部', '护石'];
const saveWeaponIcons = { 7: 1, 8: 3, 9: 5, 10: 7, 11: 13, 13: 12, 14: 2, 15: 9, 16: 8, 17: 14, 18: 4, 19: 6, 20: 11, 21: 10 };
const saveLookLabels = { voice: '语音', eyes: '眼型', clothes: '衣服', coat: '花纹', ears: '耳朵', tail: '尾巴' };
const saveColorLabels = { coat: '毛色', rightEye: '右眼颜色', leftEye: '左眼颜色', clothes: '衣服颜色' };

function saveOptions(options, current) {
  const matching = options.some(([id]) => Number(id) === current);
  return (matching ? '' : `<option value="${current}" selected>原值 #${current}</option>`) +
    options.map(([id, label]) => `<option value="${id}" ${Number(id) === current ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

function saveNumber(name, title, value, min, max) {
  return `<label class="save-field"><span>${title}</span><input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="1" required></label>`;
}

function saveSelect(name, title, options, current) {
  return `<label class="save-field"><span>${title}</span><select name="${name}">${saveOptions(options, current)}</select></label>`;
}

async function renderSaveCatalogPage(host, state, changed, render) {
  host.innerHTML = '<p class="save-panel">正在读取存档资料…</p>';
  try {
    const catalog = await loadSaveCatalog();
    if (host.isConnected) render(host, state, changed, catalog);
  } catch (error) {
    host.innerHTML = `<p class="save-panel" data-tone="error">${esc(error.message)}</p>`;
  }
}

function saveGearName(catalog, record) {
  return record?.type ? catalog.gear[record.type]?.[record.id]?.name || `装备 #${record.id}` : '未装备';
}

function renderSaveStatus(host, state, _changed, catalog) {
  const status = state.source.playerStatus(state.slot);
  const cat = status.companions[0];
  const style = ['公会', '强袭', '空战', '武士道', '炼金', '勇气'][status.style] ?? `#${status.style}`;
  const time = [Math.floor(status.playTime / 3600), Math.floor(status.playTime / 60) % 60, status.playTime % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
  const points = new Map();
  function add(rows = []) {
    for (const [id, value] of rows) points.set(id, (points.get(id) ?? 0) + value);
  }
  for (const record of status.equipment.filter(Boolean)) {
    add(catalog.gear[record.type]?.[record.id]?.skills);
    if (record.type === 6) add(record.skills.map((id, i) => [id, record.points[i]]).filter(([id]) => id));
    for (const jewel of record.jewels) add(catalog.jewels[jewel]?.skills);
  }
  const skills = [...points.entries()].filter(([, value]) => value).map(([id, value]) => {
    const active = (catalog.thresholds[id] ?? []).filter(([threshold]) =>
      threshold > 0 ? value >= threshold : value <= threshold).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))[0];
    return { name: catalog.skills[id] ?? `技能 #${id}`, active, value };
  }).sort((a, b) => Number(!!b.active) - Number(!!a.active) || b.value - a.value);
  const equipmentStats = [0, 0, 0, 0, 0, 0];
  for (const record of status.equipment.filter(Boolean)) {
    catalog.gear[record.type]?.[record.id]?.status?.forEach((value, i) => { equipmentStats[i] += value; });
  }
  const gearRow = (part, record) => {
    const look = record?.appearance && catalog.gear[record.type]?.[record.appearance]?.name;
    const icon = saveWeaponIcons[record?.type];
    return `<li><span>${part}</span><strong>${icon ? typeIcon(icon) : ''}${esc(saveGearName(catalog, record))}</strong>
      ${record?.type ? `<small>${record.type !== 6 && record.type < 22 ? `Lv ${record.level} · ` : ''}箱 ${record.index + 1}${look ? ` · 幻化 ${esc(look)}` : ''}</small>` : ''}</li>`;
  };
  const catGear = (cat ? cat.gear.slice(0, 3) : []).map(index => index < SaveEditorCore.boxes.palico.count
    ? { index, ...state.source.equipment(state.slot, 'palico', index) } : null);
  host.innerHTML = `
    <section class="save-panel save-profile">
      <div><p class="save-help">槽 ${state.slot + 1} · ${status.prowler ? '猫猎人模式' : '猎人模式'}</p>
        <h2>${esc(status.name || '未命名角色')}</h2><p class="save-help">${status.gender === 0 ? '男性' : status.gender === 1 ? '女性' : '性别未知'} · ${style}风格</p></div>
      <dl class="save-metrics">${[['选档 HR', status.hr], ['集会所进度', `${status.hub} ★`], ['村进度', `${status.village} ★`],
        ['金币', num(status.funds)], ['龙历院点数', num(status.academy)], ['游玩时间', time], ['HR 点数', num(status.points)]]
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    </section>
    <div class="save-status-columns">
      ${status.prowler && cat ? `<section class="save-panel save-section">
        <div class="save-section-head"><h2>当前猫猎人</h2><button class="btn sm" data-save-tab="palico" data-status-cat="${cat.index}">编辑艾露猫</button></div>
        <strong>${esc(cat.name)} · Lv ${cat.level} · ${esc(catalog.palico.fortes[cat.forte] ?? '未知倾向')}</strong>
        <ul class="save-gear-lines">${catGear.map((record, i) => gearRow(saveHunterParts[i], record)).join('')}</ul>
        <div class="save-tag-list">${cat.equippedMoves.map(id => chip(catalog.palico.moves[id]?.[0] ?? `行动 #${id}`)).join('')}
          ${cat.equippedSkills.map(id => chip(catalog.palico.skills[id]?.[0] ?? `技能 #${id}`, 'gold')).join('')}</div>
      </section>` : ''}
      <section class="save-panel save-section">
        <div class="save-section-head"><h2>${status.prowler ? '猎人配装' : '当前穿戴'}</h2><button class="btn sm" data-save-tab="gear" data-status-hunter>打开装备箱</button></div>
        <ul class="save-gear-lines">${status.equipment.map((record, i) => gearRow(saveHunterParts[i], record)).join('')}</ul>
        <div class="save-tag-list">${['装备基础防御', '火', '水', '雷', '冰', '龙'].map((label, i) => chip(`${label} ${equipmentStats[i]}`)).join('')}</div>
        <div class="save-tag-list">${status.arts.filter(id => id && id !== 0xFFFF)
    .map(id => chip(catalog.arts[id] ?? `狩技 #${id}`)).join('')}</div>
      </section>
      <section class="save-panel save-section">
        <div class="save-section-head"><h2>猎人配装技能</h2><span class="dim">含装备、护石和装饰珠</span></div>
        ${skills.length ? `<ul class="save-gear-lines">${skills.map(skill =>
    `<li><span>${esc(skill.name)}</span><strong>${skill.value > 0 ? '+' : ''}${skill.value}</strong>${skill.active ? `<small>${esc(skill.active[1])}</small>` : ''}</li>`).join('')}</ul>` : '<p class="save-help">没有装备技能点。</p>'}
      </section>
      <section class="save-panel save-section"><h2>随行编组</h2>
        <ul class="save-gear-lines">${status.companions.map((current, i) =>
    `<li><span>${['猫猎人', '随从一', '随从二'][i]}</span><strong>${esc(current?.name ?? '未选择')}</strong>
      ${current ? `<small>Lv ${current.level} · ${esc(catalog.palico.fortes[current.forte] ?? '未知倾向')}</small>` : ''}</li>`).join('')}</ul>
      </section>
    </div>`;
}

function usableSaveGear(catalog, source, type, id) {
  const name = catalog.gear[type]?.[id]?.name ?? '';
  return name && !/dummy|ダミー/i.test(name) &&
    (source.format !== 'switch-gu' || !SaveEditorCore.unavailableInGu(type, Number(id)));
}

function renderSaveEquipment(host, state, changed, catalog) {
  const { source, slot } = state;
  const charms = state.tab === 'charms';
  const box = charms ? 'hunter' : state.gearBox;
  const count = SaveEditorCore.boxes[box].count;
  const rows = Array.from({ length: count }, (_, i) => source.equipment(slot, box, i));
  const types = charms ? [6] : Object.keys(catalog.gear).map(Number).filter(type => box === 'hunter' ? type <= 21 : type >= 22);
  const chosen = state.gearIndex;
  const firstFilled = rows.findIndex(row => charms ? row.type === 6 : row.type);
  let selected = chosen !== null && chosen < count && (!charms || [0, 6].includes(rows[chosen].type))
    ? chosen : Math.max(0, firstFilled >= 0 ? firstFilled : rows.findIndex(row => !row.type));
  let page = 0;
  const pageSize = 14;
  host.innerHTML = `<div class="save-item-columns">
    <section class="save-panel save-section">
      <div class="save-section-head"><h2>${charms ? '护石' : '装备箱'}</h2>
        ${charms ? '<span class="dim">猎人装备箱中的护石</span>' : `<select id="saveGearBox" aria-label="装备箱类型">
        <option value="hunter" ${box === 'hunter' ? 'selected' : ''}>猎人装备箱</option>
        <option value="palico" ${box === 'palico' ? 'selected' : ''}>艾露猫装备箱</option></select>`}</div>
      <label class="save-field"><span>搜索箱内${charms ? '护石' : '装备'}</span><input type="search" id="saveGearQuery" placeholder="名称、部位或存档 ID"></label>
      <div class="save-table-scroll"><table class="save-items"><thead><tr><th>格位</th><th>名称</th><th>等级</th><th>操作</th></tr></thead>
        <tbody id="saveGearRows"></tbody></table></div>
      <div id="saveGearPages" class="save-actions"></div>
    </section>
    <form class="save-panel save-section" id="saveGearForm">
      <div class="save-section-head"><h2>编辑${charms ? '护石' : '装备'}</h2><button class="btn sm" type="button" id="saveGearEmpty">定位空格</button></div>
      ${saveNumber('position', '格位', selected + 1, 1, count)}
      <div id="saveGearFields"></div>
      <div class="save-actions"><button class="btn primary" type="submit">应用${charms ? '护石' : '装备'}修改</button>
        <button class="btn ghost" type="button" id="saveGearClear">清空本格</button></div>
      <p class="save-form-note" role="status"></p>
    </form>
  </div>`;
  const form = $('#saveGearForm', host);
  const fields = $('#saveGearFields', host);
  const note = $('.save-form-note', form);
  const table = $('#saveGearRows', host);
  const pages = $('#saveGearPages', host);
  const query = $('#saveGearQuery', host);
  const gearChoices = type => Object.entries(catalog.gear[type] ?? {}).filter(([id]) => usableSaveGear(catalog, source, type, id))
    .map(([id, entry]) => [id, `${entry.name} · #${id}`]);
  const isArmor = type => type >= 1 && type <= 5 || type >= 23;

  function list() {
    const term = query.value.trim().toLowerCase();
    const entries = rows.map((record, index) => ({ record, index })).filter(({ record }) => record.type &&
      (!charms || record.type === 6) &&
      (!term || `${saveGearName(catalog, record)} ${SaveEditorCore.typeNames[record.type]} #${record.id}`.toLowerCase().includes(term)));
    const total = Math.max(1, Math.ceil(entries.length / pageSize));
    page = Math.min(page, total - 1);
    table.innerHTML = entries.slice(page * pageSize, (page + 1) * pageSize).map(({ record, index }) =>
      `<tr class="${index === selected ? 'save-selected' : ''}"><td>${index + 1}</td><td>${esc(saveGearName(catalog, record))}
      <small class="dim">#${record.id}</small></td><td>${record.type === 6 ? `${record.slots} 孔` : record.level}</td>
      <td><button type="button" class="btn sm" data-save-gear="${index}">编辑</button></td></tr>`).join('')
      || '<tr><td colspan="4">没有匹配的装备。</td></tr>';
    pages.innerHTML = `<button class="btn sm" type="button" data-gear-page="-1" ${page ? '' : 'disabled'}>上一页</button>
      <span class="dim">${page + 1} / ${total} · ${num(entries.length)} 件</span>
      <button class="btn sm" type="button" data-gear-page="1" ${page + 1 < total ? '' : 'disabled'}>下一页</button>`;
  }

  function options(type, id, old) {
    const entry = catalog.gear[type]?.[id];
    const same = old.type === type && old.id === id;
    const level = same ? old.level : 1;
    const selectLevel = entry?.levels
      ? saveSelect('level', '强化等级', Object.entries(entry.levels).map(([num, sockets]) => [num, `Lv ${num} · ${sockets} 孔`]), level)
      : type >= 1 && type <= 5 ? `<p class="save-help">当前强化 Lv ${level} · ${entry?.slots ?? '未知'} 孔</p>` : '';
    const appearance = isArmor(type)
      ? saveSelect('appearance', '幻化外观', [[0, '原外观'], ...gearChoices(type)], same ? old.appearance : 0) : '';
    const inHunterBox = type <= 21;
    const jewelOptions = inHunterBox ? [[0, '空'], ...Object.entries(catalog.jewels)
      .filter(([key]) => source.format !== 'switch-gu' || !SaveEditorCore.xxOnlyItems.has(Number(key)))
      .map(([key, jewel]) => [key, `${jewel.name} · ${jewel.cost} 孔`])] : [];
    const jewels = inHunterBox ? [0, 1, 2].map(i => saveSelect(`jewel${i}`, `装饰珠 ${i + 1}`, jewelOptions, same ? old.jewels[i] : 0)).join('') : '';
    const charm = type === 6 ? [0, 1].map(i => {
      const rules = Object.entries(catalog.charmLimits[id] ?? {}).filter(([, rule]) => rule[2 * i] || rule[2 * i + 1]);
      const choices = [[0, '无'], ...rules.map(([skill, rule]) =>
        [skill, `${catalog.skills[skill]} · ${rule[2 * i]}～${rule[2 * i + 1]}`])];
      return saveSelect(`skill${i}`, `技能 ${i + 1}`, choices, same ? old.skills[i] : 0) +
        saveNumber(`points${i}`, `技能 ${i + 1} 点数`, same ? old.points[i] : 0, -128, 127);
    }).join('') + saveNumber('slots', '护石孔数', same ? old.slots : 0, 0, entry?.charm?.[1] ?? 3) : '';
    $('#saveGearOptions', fields).innerHTML = `<div class="save-fields">${selectLevel}${appearance}${charm}${jewels}</div>`;
  }

  function edit(index) {
    selected = index;
    state.gearIndex = index;
    form.elements.position.value = index + 1;
    const old = rows[index];
    const type = types.includes(old.type) ? old.type : types[0];
    const choices = gearChoices(type);
    const id = old.type === type ? old.id : Number(choices[0]?.[0] ?? 0);
    const refs = old.type ? source.gearReferences(slot, box, index) : { worn: [], sets: 0 };
    const used = [refs.worn.length && '穿戴中', refs.sets && `${refs.sets} 套预设引用`].filter(Boolean).join(' · ');
    fields.innerHTML = `<div class="save-fields">
      ${saveSelect('gearType', '类别', types.map(key => [key, SaveEditorCore.typeNames[key]]), type)}
      <label class="save-field"><span>搜索装备目录</span><input type="search" id="saveGearPicker" placeholder="名称或存档 ID"></label>
      ${saveSelect('gearId', '装备', choices, id)}
    </div>${used ? `<p class="save-help">${used}</p>` : ''}<div id="saveGearOptions"></div>`;
    options(type, id, old);
    note.textContent = '';
    list();
  }

  function filterPicker(reset) {
    const type = Number(form.elements.gearType.value);
    const term = $('#saveGearPicker', fields).value.trim().toLowerCase();
    const choices = gearChoices(type).filter(([, label]) => label.toLowerCase().includes(term));
    const previous = Number(form.elements.gearId.value);
    const id = !reset && choices.some(([key]) => Number(key) === previous) ? previous : Number(choices[0]?.[0] ?? 0);
    form.elements.gearId.innerHTML = choices.length ? saveOptions(choices, id) : '<option value="0">没有匹配装备</option>';
    if (id !== previous || reset) options(type, id, rows[selected]);
  }

  const switchBox = $('#saveGearBox', host);
  if (switchBox) switchBox.addEventListener('change', () => {
    state.gearBox = switchBox.value;
    state.gearIndex = null;
    renderSaveEquipment(host, state, changed, catalog);
  });
  pages.addEventListener('click', event => { if (event.target.dataset.gearPage) { page += Number(event.target.dataset.gearPage); list(); } });
  query.addEventListener('input', () => { page = 0; list(); });
  table.addEventListener('click', event => { if (event.target.dataset.saveGear) edit(Number(event.target.dataset.saveGear)); });
  form.elements.position.addEventListener('change', () => {
    const input = form.elements.position;
    if (input.checkValidity()) {
      const target = input.valueAsNumber - 1;
      if (charms && rows[target].type && rows[target].type !== 6) {
        input.value = selected + 1;
        note.textContent = '所选格位存放的是其他装备。';
        note.dataset.tone = 'error';
      } else edit(target);
    }
  });
  fields.addEventListener('change', event => {
    if (event.target.name === 'gearType') { $('#saveGearPicker', fields).value = ''; filterPicker(true); }
    if (event.target.name === 'gearId') options(Number(form.elements.gearType.value), Number(event.target.value), rows[selected]);
  });
  fields.addEventListener('input', event => { if (event.target.id === 'saveGearPicker') filterPicker(false); });
  $('#saveGearEmpty', host).addEventListener('click', () => {
    const index = rows.findIndex((record, i) => {
      if (record.type) return false;
      const refs = source.gearReferences(slot, box, i);
      return !refs.worn.length && !refs.sets;
    });
    if (index === -1) note.textContent = '没有可用的空格。';
    else edit(index);
  });
  function apply(record) {
    try {
      if (charms && rows[selected].type && rows[selected].type !== 6) throw new Error('请先选择护石或空格。');
      const updated = source.setEquipment(slot, box, selected, record, catalog);
      rows[selected] = source.equipment(slot, box, selected);
      edit(selected);
      note.textContent = updated ? '装备已更新。' : '装备与存档一致。';
      note.dataset.tone = 'ok';
      if (updated) changed();
    } catch (error) {
      note.textContent = error.message;
      note.dataset.tone = 'error';
    }
  }
  $('#saveGearClear', host).addEventListener('click', () => apply({ type: 0, id: 0 }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const n = key => Number(form.elements[key]?.value ?? 0);
    const type = n('gearType');
    const id = n('gearId');
    const old = rows[selected];
    apply({ type, id, level: n('level') || 1, appearance: form.elements.appearance ? n('appearance') : old.type === type && old.id === id ? old.appearance : 0,
      jewels: [n('jewel0'), n('jewel1'), n('jewel2')], skills: [n('skill0'), n('skill1')],
      points: [n('points0'), n('points1')], slots: n('slots') });
  });
  edit(selected);
}

function renderSavePalico(host, state, changed, catalog) {
  const { source, slot } = state;
  const { palico } = catalog;
  const cats = Array.from({ length: SaveEditorCore.catCount }, (_, i) => source.palico(slot, i));
  const selected = cats[state.catIndex] ? state.catIndex : cats.findIndex(Boolean);
  if (selected < 0) {
    host.innerHTML = '<p class="save-panel">此角色还没有雇用艾露猫。</p>';
    return;
  }
  state.catIndex = selected;
  const cat = cats[selected];
  const legality = SaveEditorCore.palicoRules;
  let draft = { ...cat };
  const originalIssues = legality.audit(cat, catalog);
  const fixedProfile = cat.dlc || originalIssues.length > 0;
  const knownSpecial = source.knownSpecialSkills(slot, catalog);
  const names = kind => id => palico[kind][id]?.[0] ?? `#${id}`;
  host.innerHTML = `<div class="save-cat-columns">
    <section class="save-panel save-section"><div class="save-section-head"><h2>已雇用艾露猫</h2><span class="dim">${cats.filter(Boolean).length} 只</span></div>
      <div class="save-cat-list">${cats.map((entry, index) => entry ? `<button type="button" class="save-slot" data-save-cat="${index}" aria-pressed="${index === selected}">
      <b>${esc(entry.name)}</b><span>Lv ${entry.level} · ${esc(palico.fortes[entry.forte] ?? '未知倾向')}</span></button>` : '').join('')}</div>
    </section>
    <form class="save-panel save-section" id="savePalicoForm">
      <div class="save-section-head"><h2>编辑艾露猫</h2><span class="dim">${esc(palico.fortes[cat.forte] ?? '未知倾向')}</span></div>
      <div class="save-fields">
        <label class="save-field"><span>名字</span><input name="catName" value="${esc(cat.name)}" required></label>
        ${saveNumber('catLevel', '等级', cat.level, 1, 99)}
        ${saveNumber('catExp', '经验', cat.exp, 0, 0xFFFFFFFF)}
        ${saveSelect('catTarget', '目标偏好', Object.entries(palico.targets), cat.target)}
      </div>
      <label class="save-field"><span>问候语</span><input name="catGreeting" value="${esc(cat.greeting)}"></label>
      <details><summary>外观与颜色</summary><div class="save-fields">
        ${Object.entries(SaveEditorCore.lookFields).map(([key, [, first, last]]) =>
    saveSelect(key, saveLookLabels[key], Array.from({ length: last - first + 1 }, (_, i) => [i + first, i + 1]), cat.looks[key])).join('')}
        ${Object.entries(cat.colors).map(([key, color]) => `<label class="save-field"><span>${saveColorLabels[key]}</span>
          <input type="color" name="color-${key}" value="${color}"></label>`).join('')}
      </div></details>
      <details open><summary>装备行动与技能</summary><p class="save-help" id="saveCatCapacity"></p><div class="save-cat-abilities" id="saveCatEquipped"></div></details>
      <details><summary>已学行动与技能</summary>
        <p class="save-help">${fixedProfile ? '本猫使用配信或特殊组合，已学栏保留原始数据。' : '生成栏按原生 A/B/C 组合筛选，传授栏单独填写。'}</p>
        ${originalIssues.length ? `<p class="save-help">${esc(originalIssues[0])}</p>` : ''}
        <div class="save-cat-abilities" id="saveCatLearned"></div></details>
      <div class="save-actions"><button class="btn primary" type="submit">应用艾露猫修改</button><span class="save-form-note" role="status"></span></div>
    </form>
  </div>`;
  const form = $('#savePalicoForm', host);
  const note = $('.save-form-note', form);
  const equipped = $('#saveCatEquipped', form);
  const learnedBox = $('#saveCatLearned', form);
  const kinds = ['moves', 'skills'];
  let abilitiesEdited = false;
  const getLearned = kind => $$('[data-cat-learned="' + kind + '"]', form).map(select => Number(select.value));
  const getEquipped = kind => $$('input[name="' + kind + '"]:checked', equipped).map(input => Number(input.value));
  function showCapacity() {
    const result = legality.capacity(form.elements.catLevel.valueAsNumber, getEquipped('moves'), getEquipped('skills'), catalog);
    const label = $('#saveCatCapacity', form);
    label.textContent = `行动 ${result.usedMoves} / ${result.limitMoves} · 技能 ${result.usedSkills ?? '未知'} / ${result.totalSkills} 槽`;
    label.dataset.tone = result.usedMoves > result.limitMoves || result.usedSkills === null || result.usedSkills > result.totalSkills ? 'error' : '';
  }
  function drawLearned() {
    learnedBox.innerHTML = kinds.map(kind => {
      const rule = legality.describe(draft, kind, catalog);
      const list = draft[rule.fields.learned];
      const choices = rule.patterns.map(([id, , sequence]) => [id, sequence]);
      return `<section><h3>已学${rule.prefix}</h3>
        <label class="save-field"><span>生成类型</span><select data-cat-pattern="${kind}" ${fixedProfile ? 'disabled' : ''}>
        ${saveOptions(choices, draft[rule.fields.pattern])}</select></label>
        <div class="save-learned-list">${list.map((id, index) => {
    const options = fixedProfile ? [] : legality.options(draft, kind, index, catalog, knownSpecial);
    const label = index < rule.fixed ? '固有' : rule.sequence[index - rule.fixed] || '传授';
    return `<label class="save-field"><span>${label}</span><select data-cat-learned="${kind}" ${options.length ? '' : 'disabled'}>
      ${saveOptions((options.length ? options : [id]).map(value => [value, value === 0 ? '空' : names(kind)(value)]), id)}</select></label>`;
  }).join('')}</div></section>`;
    }).join('');
  }
  function drawAbilities(moves, skills) {
    equipped.innerHTML = ['moves', 'skills'].map((kind, group) => {
      const current = group ? skills : moves;
      const learned = getLearned(kind);
      const ids = [...new Set([...current, ...learned])].filter(id => id && id < (group ? 96 : 57));
      return `<section><h3>${group ? '技能' : '支援行动'}</h3><div class="save-checklist">${ids.map(id =>
        `<label><input type="checkbox" name="${kind}" value="${id}" ${current.includes(id) ? 'checked' : ''}>
          <span>${esc(names(kind)(id))}${group && palico.skills[id]?.[3] != null ? ` · ${palico.skills[id][3]} 槽` : ''}</span></label>`).join('') || '没有可装备的条目'}</div></section>`;
    }).join('');
    showCapacity();
  }
  drawLearned();
  drawAbilities(cat.equippedMoves, cat.equippedSkills);
  form.addEventListener('change', event => {
    if (event.target.name === 'moves' || event.target.name === 'skills') {
      abilitiesEdited = true;
      showCapacity();
    }
    if (event.target.name === 'catLevel') showCapacity();
    const type = event.target.dataset.catPattern;
    if (type) {
      try {
        Object.assign(draft, legality.changePattern(draft, type, Number(event.target.value), catalog));
      } catch (error) {
        note.textContent = error.message;
        note.dataset.tone = 'error';
        drawLearned();
        return;
      }
      drawLearned();
    }
    const learned = event.target.dataset.catLearned;
    if (learned) {
      const fields = legality.columns[learned];
      const rule = legality.describe(draft, learned, catalog);
      const entries = getLearned(learned);
      const taught = entries.slice(-rule.transfer).filter(Boolean);
      const packed = [...entries.slice(0, -rule.transfer), ...taught, ...Array(rule.transfer - taught.length).fill(0)];
      draft[fields.learned] = packed;
      draft[fields.raw] = [...packed, ...draft[fields.raw].slice(draft[fields.length])];
      drawLearned();
    }
    if (type || learned) {
      abilitiesEdited = true;
      drawAbilities(...kinds.map(kind => getEquipped(kind).filter(id => getLearned(kind).includes(id))));
    }
  });
  $('.save-cat-list', host).addEventListener('click', event => {
    const button = event.target.closest('[data-save-cat]');
    if (!button) return;
    state.catIndex = Number(button.dataset.saveCat);
    renderSavePalico(host, state, changed, catalog);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const updated = source.setPalico(slot, selected, {
        name: form.elements.catName.value, greeting: form.elements.catGreeting.value,
        level: form.elements.catLevel.valueAsNumber, exp: form.elements.catExp.valueAsNumber, target: Number(form.elements.catTarget.value),
        looks: Object.fromEntries(Object.keys(cat.looks).map(key => [key, Number(form.elements[key].value)])),
        colors: Object.fromEntries(Object.keys(cat.colors).map(key => [key, form.elements['color-' + key].value])),
        ...(abilitiesEdited && { movePattern: draft.movePattern, skillPattern: draft.skillPattern,
          learnedMoves: getLearned('moves'), learnedSkills: getLearned('skills'),
          equippedMoves: getEquipped('moves'), equippedSkills: getEquipped('skills') }),
      }, catalog);
      if (updated) {
        changed();
        renderSavePalico(host, state, changed, catalog);
      }
      const resultNote = updated ? $('.save-form-note', host) : note;
      resultNote.textContent = updated ? '艾露猫已更新。' : '数值与存档一致。';
      resultNote.dataset.tone = 'ok';
    } catch (error) {
      note.textContent = error.message;
      note.dataset.tone = 'error';
    }
  });
}
