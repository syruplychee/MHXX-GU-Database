'use strict';

const LOADOUT_TABS = [['', '自动配装'], ['charms', '护石库'], ['excluded', '排除装备'], ['favorites', '收藏'], ['manual', '手动配装']];
const loadoutControls = { borg: 1, morf: 1, weaponSlots: 0, charmId: 'any', targets: [] };
let lastLoadoutSearch = null;

function loadoutTabs(active) {
  return `<nav class="loadout-tabs" aria-label="配装器">${LOADOUT_TABS.map(([id, name]) =>
    `<a href="#/set${id ? '/' + id : ''}" ${active === id ? 'aria-current="page"' : ''}>${name}</a>`).join('')}</nav>`;
}

function loadoutCollection(key) {
  return JSON.parse(localStorage.getItem('mhxx-' + key) || '[]');
}

function saveLoadoutCollection(key, collection) {
  localStorage.setItem('mhxx-' + key, JSON.stringify(collection));
}

function loadoutOptions(items, getLabel, selected) {
  return items.map((item) => `<option value="${esc(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${esc(getLabel(item))}</option>`).join('');
}

function bindLoadoutSkillSearch(root, skills) {
  const reset = $$('[data-loadout-skill-search]', root).map((picker) => {
    const query = $('input[type="search"]', picker);
    const choice = $('select', picker);
    const empty = choice.options[0].outerHTML;
    const match = () => {
      const term = query.value.trim().toLowerCase();
      return skills.filter((skill) => skill.name.toLowerCase().includes(term));
    };
    const update = () => {
      const selected = choice.value;
      const matches = match();
      const current = skills.find((skill) => String(skill.id) === selected);
      const choices = current && !matches.includes(current) ? [current, ...matches] : matches;
      choice.innerHTML = empty + loadoutOptions(choices, (skill) => skill.name) +
        (matches.length ? '' : '<option disabled>没有匹配的技能</option>');
      choice.value = selected;
    };
    query.addEventListener('input', update);
    query.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      const matches = match();
      if (matches.length === 1) {
        choice.value = matches[0].id;
        choice.dispatchEvent(new Event('change', { bubbles: true }));
      }
      choice.focus();
    });
    return () => { query.value = ''; update(); };
  });
  return () => reset.forEach((clear) => clear());
}

function loadoutSlots(selected) {
  return loadoutOptions([0, 1, 2, 3].map((id) => ({ id })), (item) => `${item.id} 孔`, selected);
}

function loadoutCharmLabel(charm, nameOf = (skill) => skill.name) {
  if (!charm.id) return '无护石';
  return [...charm.skills.map((s) => `${nameOf(s)} ${signedSkillPoints(s.pt)}`), `${charm.slots} 孔`].join(' · ');
}

async function setWorkspacePage(ctx) {
  const page = ctx.parts[1] || '';
  if (page === 'manual') return setPage(ctx);
  view.innerHTML = `<div class="loadout-workspace"><header class="loadout-banner"><h1>配装器</h1>${loadoutTabs(page)}</header><div id="loadoutPage"><p class="loading">正在读取${page === 'excluded' ? '防具' : '技能'}资料…</p></div></div>`;
  if (page === 'excluded') {
    const catalog = await api('/armor/sets');
    if (ctx.token === routeToken) loadoutExclusionsPage($('#loadoutPage'), catalog.rows.flatMap((set) => set.pieces));
    return;
  }
  const catalog = await api('/set/skills');
  if (ctx.token !== routeToken) return;
  const charms = loadoutCollection('owned-charms');
  const favorites = loadoutCollection('favorite-builds');
  const skillTrees = catalog.rows.filter((row) => row.id !== 1).sort((a, b) => a.name.localeCompare(b.name));
  const treeNames = new Map(skillTrees.map((row) => [row.id, row.name]));
  const host = $('#loadoutPage');
  if (page === 'charms') return loadoutCharmPage(host, charms, skillTrees, treeNames);
  if (page === 'favorites') return loadoutFavoritesPage(host, favorites);
  loadoutSearchPage(host, catalog.levels, treeNames, charms, favorites, ctx.token);
}

function loadoutCharmPage(host, charms, skills, treeNames) {
  let editing = null;
  const row = (i) => `<div class="loadout-charm-skill">
    <div class="loadout-skill-fields" data-loadout-skill-search>
      <label>技能 ${i}<input type="search" placeholder="输入技能名搜索" autocomplete="off"></label>
      <select name="skill${i}" aria-label="选择技能 ${i}"><option value="">无</option>${loadoutOptions(skills, (s) => s.name)}</select>
    </div><label>点数<input name="points${i}" type="number" min="-99" max="99" step="1" value="0"></label></div>`;
  host.innerHTML = `<div class="loadout-columns"><section class="loadout-panel loadout-config"><h2 id="loadoutCharmHeading">录入护石</h2>
    <form id="loadoutCharmForm" class="loadout-form">
    <label>护石孔位<select name="slots">${loadoutSlots(0)}</select></label>${row(1)}${row(2)}
    <p class="loadout-note" id="loadoutCharmMessage" role="alert"></p><div class="loadout-actions"><button class="btn primary" type="submit">保存护石</button><button class="btn ghost" id="loadoutCharmCancel" type="button" hidden>取消编辑</button></div></form></section>
    <section class="loadout-panel"><h2>已有护石 <span id="loadoutCharmCount"></span></h2><div class="loadout-results" id="loadoutCharmRows"></div></section></div>`;
  const form = $('#loadoutCharmForm');
  const rows = $('#loadoutCharmRows');
  const cancel = $('#loadoutCharmCancel');
  const note = $('#loadoutCharmMessage');
  const resetSkillSearch = bindLoadoutSkillSearch(form, skills);
  function render() {
    $('#loadoutCharmCount').textContent = `${charms.length} 枚`;
    rows.innerHTML = charms.length ? charms.map((charm) => `<div class="loadout-charm-row"><div><b>${esc(loadoutCharmLabel(charm, (skill) => treeNames.get(skill.treeId)))}</b></div>
      <div class="loadout-actions"><button class="btn sm" type="button" data-charm-edit="${esc(charm.id)}">编辑</button><button class="btn sm ghost" type="button" data-charm-delete="${esc(charm.id)}">删除</button></div></div>`).join('')
      : '<p class="loadout-note">还没有录入护石。</p>';
  }
  function edit(charm) {
    editing = charm?.id || null;
    form.reset();
    resetSkillSearch();
    $('#loadoutCharmHeading').textContent = editing ? '编辑护石' : '录入护石';
    cancel.hidden = !editing;
    note.textContent = '';
    if (!charm) return;
    form.elements.slots.value = charm.slots;
    for (const [i, skill] of charm.skills.entries()) {
      form.elements['skill' + (i + 1)].value = skill.treeId;
      form.elements['points' + (i + 1)].value = skill.pt;
    }
    form.elements.slots.focus();
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const skills = [1, 2].map((i) => ({ treeId: Number(form.elements['skill' + i].value), pt: Number(form.elements['points' + i].value) })).filter((s) => s.treeId);
    if (skills.length === 2 && skills[0].treeId === skills[1].treeId) { note.textContent = '两个技能必须不同。'; return; }
    const charm = { id: editing || crypto.randomUUID(), slots: Number(form.elements.slots.value), skills };
    if (editing) charms[charms.findIndex((item) => item.id === editing)] = charm;
    else charms.push(charm);
    saveLoadoutCollection('owned-charms', charms);
    lastLoadoutSearch = null;
    edit(null); render();
  });
  rows.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button?.dataset.charmEdit) edit(charms.find((charm) => charm.id === button.dataset.charmEdit));
    if (button?.dataset.charmDelete) {
      const id = button.dataset.charmDelete;
      charms.splice(charms.findIndex((charm) => charm.id === id), 1);
      saveLoadoutCollection('owned-charms', charms);
      lastLoadoutSearch = null;
      if (id === editing) edit(null);
      render();
    }
  });
  cancel.addEventListener('click', () => edit(null));
  render();
}

function loadoutExclusionsPage(host, pieces) {
  const excluded = new Set(loadoutCollection('excluded-armor'));
  const armorById = new Map(pieces.map((piece) => [piece.id, piece]));
  const normalize = (name) => name.normalize('NFKC').toLowerCase();
  const searchable = pieces.map((piece) => ({ piece, name: normalize(piece.name) }));
  host.innerHTML = `<div class="loadout-columns loadout-exclusion-columns">
    <section class="loadout-panel"><h2>选择防具 <span id="loadoutArmorCount"></span></h2>
      <div class="loadout-form loadout-armor-filters"><label>防具名称<input type="search" id="loadoutArmorQuery" autocomplete="off"></label>
        <label>部位<select id="loadoutArmorPart"><option value="">全部部位</option>${loadoutOptions(S.meta.armorParts, (part) => part.name)}</select></label></div>
      <div class="loadout-results loadout-armor-list" id="loadoutArmorChoices"></div></section>
    <section class="loadout-panel"><h2>已排除 <span id="loadoutExcludedCount"></span></h2>
      <div class="loadout-results loadout-armor-list" id="loadoutExcludedRows"></div></section></div>`;
  const query = $('#loadoutArmorQuery');
  const part = $('#loadoutArmorPart');
  const choices = $('#loadoutArmorChoices');
  const selected = $('#loadoutExcludedRows');
  const pieceLabel = (piece) => `${armorPartName(piece.part)} · ${borgName(piece.borg)} · ${morfName(piece.morf)}`;
  function buttonState(button, isExcluded) {
    button.textContent = isExcluded ? '恢复' : '排除';
    button.classList.toggle('ghost', isExcluded);
  }
  const row = (piece) => `<div class="loadout-charm-row"><div><b>${esc(piece.name)}</b><small>${esc(pieceLabel(piece))}</small></div>
    <button class="btn sm${excluded.has(piece.id) ? ' ghost' : ''}" type="button" data-armor-id="${piece.id}">${excluded.has(piece.id) ? '恢复' : '排除'}</button></div>`;
  function renderChoices() {
    const term = normalize(query.value.trim());
    const filtered = searchable.filter((entry) => (!part.value || entry.piece.part === Number(part.value)) && entry.name.includes(term));
    $('#loadoutArmorCount').textContent = `${num(filtered.length)} 件`;
    choices.innerHTML = filtered.length ? filtered.map(({ piece }) => row(piece)).join('') : '<p class="loadout-note">没有找到符合条件的防具。</p>';
    choices.scrollTop = 0;
  }
  function renderSelected() {
    const rows = [...excluded].map((id) => armorById.get(id)).filter(Boolean);
    $('#loadoutExcludedCount').textContent = `${rows.length} 件`;
    selected.innerHTML = rows.length ? rows.map(row).join('') : '<p class="loadout-note">还没有排除任何防具。</p>';
  }
  host.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-armor-id]');
    if (!button) return;
    const id = Number(button.dataset.armorId);
    if (!excluded.delete(id)) excluded.add(id);
    saveLoadoutCollection('excluded-armor', [...excluded]);
    lastLoadoutSearch = null;
    const choice = $(`button[data-armor-id="${id}"]`, choices);
    if (choice) buttonState(choice, excluded.has(id));
    if (selected.contains(button)) {
      const nextId = (button.parentElement.nextElementSibling || button.parentElement.previousElementSibling)?.querySelector('button').dataset.armorId;
      renderSelected();
      ($(`button[data-armor-id="${nextId}"]`, selected) || choice || query).focus();
    } else {
      renderSelected();
    }
  });
  query.addEventListener('input', renderChoices);
  part.addEventListener('change', renderChoices);
  renderChoices();
  renderSelected();
}

function loadoutSearchPage(host, levels, treeNames, charms, favorites, token) {
  const state = loadoutControls;
  const excludedArmor = loadoutCollection('excluded-armor');
  if (!charms.some((charm) => charm.id === state.charmId) && state.charmId !== 'none') state.charmId = 'any';
  const available = levels.slice().sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(levels.map((skill) => [skill.id, skill]));
  const goalLabel = (skill) => {
    const tree = treeNames.get(skill.treeId);
    return tree ? `${skill.name}（${tree}）` : skill.name;
  };
  host.innerHTML = `<div class="loadout-columns"><section class="loadout-panel loadout-config"><h2>配装条件</h2>
    <form id="autoLoadoutForm" class="loadout-form">
      <div class="loadout-form-pair"><label>职业<select name="borg"><option value="1">剑士</option><option value="2">枪手</option></select></label><label>性别<select name="morf"><option value="1">男性</option><option value="2">女性</option></select></label></div>
      <div class="loadout-form-pair"><label>武器孔位<select name="weaponSlots">${loadoutSlots(state.weaponSlots)}</select></label><label>护石<select name="charmId"><option value="any">全部已录入（含无护石）</option><option value="none">不使用</option>${loadoutOptions(charms, (c) => loadoutCharmLabel(c, (s) => treeNames.get(s.treeId)), state.charmId)}</select></label></div>
      <div class="loadout-actions"><a class="loadout-inline-link" href="#/set/charms">管理护石（${charms.length}）</a><a class="loadout-inline-link" href="#/set/excluded">排除装备（${excludedArmor.length}）</a></div>
      <fieldset class="loadout-targets"><legend>目标技能</legend><label>搜索技能<input type="search" id="loadoutSkillQuery" placeholder="例如：弱点特效" autocomplete="off"></label>
        <div class="loadout-picker"><select id="loadoutSkillChoice" aria-label="技能等级"></select><button type="button" id="loadoutAddSkill" class="btn sm">添加</button></div><div id="loadoutTargetRows" class="loadout-target-list"></div></fieldset>
      <div class="loadout-actions"><button class="btn primary" id="loadoutRun" type="submit">搜索配装</button><button class="btn ghost" id="loadoutStop" type="button" hidden>停止</button></div>
    </form></section>
    <section class="loadout-panel"><h2>配装结果</h2><p role="status" class="loadout-search-note" id="loadoutStatus"></p><div class="loadout-results" id="loadoutRows"></div></section></div>`;
  const form = $('#autoLoadoutForm');
  const query = $('#loadoutSkillQuery');
  const choice = $('#loadoutSkillChoice');
  const selected = $('#loadoutTargetRows');
  const rows = $('#loadoutRows');
  const status = $('#loadoutStatus');
  const run = $('#loadoutRun');
  const stop = $('#loadoutStop');
  for (const key of ['borg', 'morf', 'charmId']) form.elements[key].value = state[key];
  let search;
  let builds = lastLoadoutSearch?.lang === S.lang ? lastLoadoutSearch.results : [];
  const naming = loadoutNameDialog(host);

  function pickChoices() {
    const q = query.value.trim().toLowerCase();
    const options = available.filter((skill) => `${skill.name} ${treeNames.get(skill.treeId)}`.toLowerCase().includes(q));
    choice.innerHTML = options.length ? loadoutOptions(options, (s) => `${goalLabel(s)} · ${s.pt} 点`) : '<option value="">没有符合条件的技能</option>';
    $('#loadoutAddSkill').disabled = !options.length;
  }
  function renderTargets() {
    selected.innerHTML = state.targets.length ? state.targets.map((id) => {
      const label = esc(goalLabel(byId.get(id)));
      return `<button type="button" class="loadout-target" data-remove-target="${id}" aria-label="移除${label}">${label} <span aria-hidden="true">×</span></button>`;
    }).join('')
      : '<p class="loadout-note">至少添加一项想发动的技能。</p>';
  }
  function addTarget() {
    const skill = byId.get(Number(choice.value));
    if (!skill) return;
    state.targets = [...state.targets.filter((id) => byId.get(id).treeId !== skill.treeId), skill.id];
    renderTargets();
  }
  function renderResults(report) {
    if (!report) { status.textContent = '选好目标技能后，点击搜索配装。'; return; }
    builds = report.results;
    status.textContent = report.timedOut ? (builds.length ? `本轮搜索时间已到，已验证 ${builds.length} 组配装。` : '本轮在时限内没有找到配装，仍可能有其他组合。') :
      builds.length ? `找到 ${builds.length} 组配装，按最大防御排列${builds.length === report.limit ? `（最多列出 ${report.limit} 组）` : ''}。` : '没有满足这些条件的配装。';
    rows.innerHTML = builds.map((result, index) => loadoutResultHTML(result, `组合 ${index + 1}`, `<button class="btn sm" type="button" data-save-build="${index}">收藏</button>`, index === 0)).join('');
  }

  query.addEventListener('input', pickChoices);
  query.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addTarget(); } });
  $('#loadoutAddSkill').addEventListener('click', addTarget);
  selected.addEventListener('click', (event) => {
    const id = Number(event.target.closest('[data-remove-target]')?.dataset.removeTarget);
    if (!id) return;
    state.targets = state.targets.filter((value) => value !== id); renderTargets();
  });
  form.addEventListener('change', (event) => {
    const key = event.target.name;
    if (['borg', 'morf', 'weaponSlots'].includes(key)) state[key] = Number(event.target.value);
    if (key === 'charmId') state.charmId = event.target.value;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (search) return;
    if (!state.targets.length) { status.textContent = '请先添加目标技能。'; return; }
    const controller = search = new AbortController();
    run.disabled = true; stop.hidden = false;
    status.textContent = '正在搜索满足目标技能的组合…'; rows.innerHTML = '';
    try {
      const response = await fetch('/api/set/search', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...state, lang: S.lang, charms, excludedArmor,
          charmId: state.charmId === 'any' ? null : state.charmId === 'none' ? '' : state.charmId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || response.statusText);
      if (token !== routeToken) return;
      lastLoadoutSearch = { ...result, lang: S.lang };
      renderResults(result);
    } catch (error) {
      if (token === routeToken) status.textContent = error.name === 'AbortError' ? '已停止搜索。' : `搜索失败：${error.message}`;
    } finally {
      search = null;
      if (token === routeToken) { run.disabled = false; stop.hidden = true; }
    }
  });
  stop.addEventListener('click', () => search?.abort());
  rows.addEventListener('click', (event) => {
    const button = event.target.closest('[data-save-build]');
    if (!button) return;
    const build = builds[Number(button.dataset.saveBuild)];
    naming('收藏配装', build.goals.map((skill) => skill.name).join(' + ').slice(0, 80), (name) => {
      favorites.unshift({ id: crypto.randomUUID(), name, build });
      saveLoadoutCollection('favorite-builds', favorites);
      button.textContent = '已收藏';
    });
  });
  renderTargets(); pickChoices();
  renderResults(lastLoadoutSearch?.lang === S.lang ? lastLoadoutSearch : null);
}

function loadoutNameDialog(host) {
  host.insertAdjacentHTML('beforeend', `<dialog class="loadout-name-dialog" aria-labelledby="loadoutNameHeading"><form class="loadout-form" method="dialog"><h2 id="loadoutNameHeading"></h2><label>配装名称<input name="name" maxlength="80" required autofocus></label><p class="loadout-note" role="alert"></p><div class="loadout-actions"><button class="btn primary" type="submit">保存名称</button><button class="btn ghost" type="button">取消</button></div></form></dialog>`);
  const dialog = $('.loadout-name-dialog', host);
  const form = $('form', dialog);
  let onSave;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) { $('p', form).textContent = '请输入配装名称。'; return; }
    onSave(name); dialog.close();
  });
  $('button[type="button"]', form).addEventListener('click', () => dialog.close());
  return (title, name, save) => {
    onSave = save;
    $('h2', form).textContent = title;
    $('p', form).textContent = '';
    form.elements.name.value = name;
    dialog.showModal(); form.elements.name.select();
  };
}

function loadoutFavoritesPage(host, favorites) {
  host.innerHTML = `<section class="loadout-panel"><h2>收藏的配装</h2><div class="loadout-results" id="loadoutFavoriteRows"></div></section>`;
  const rows = $('#loadoutFavoriteRows');
  const naming = loadoutNameDialog(host);
  function render() {
    rows.innerHTML = favorites.length ? favorites.map(({ id, name, build }, index) => loadoutResultHTML(build, name,
      `<button class="btn sm" type="button" data-rename-build="${esc(id)}">重命名</button><button class="btn sm ghost" type="button" data-delete-build="${esc(id)}">删除</button>`, index === 0)).join('')
      : '<p class="loadout-note">还没有收藏。可以从自动配装的搜索结果中收藏组合。</p>';
  }
  rows.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const rename = button?.dataset.renameBuild;
    const remove = button?.dataset.deleteBuild;
    if (rename) {
      const item = favorites.find((entry) => entry.id === rename);
      naming('重命名配装', item.name, (name) => { item.name = name; saveLoadoutCollection('favorite-builds', favorites); render(); });
    }
    if (remove) {
      favorites.splice(favorites.findIndex((entry) => entry.id === remove), 1);
      saveLoadoutCollection('favorite-builds', favorites); render();
    }
  });
  render();
}

function loadoutResultHTML(build, name, actions, open) {
  const jewels = (gear) => gear.jewels.map((jewel) => `<a href="#/jewels/${jewel.id}">${esc(jewel.name)}</a>`).join('、') || '—';
  const position = (label, gear, equipment) => `<tr><th>${label}</th><td>${equipment}</td><td>${gear.used}/${gear.slots}</td><td>${jewels(gear)}</td></tr>`;
  return `<article class="loadout-solution"><details ${open ? 'open' : ''}><summary><b>${esc(name)}</b><span>${borgName(build.borg)} · ${morfName(build.morf)} · 最大防御 ${num(build.maxDef)}</span></summary>
      <div class="loadout-solution-body"><div class="loadout-active">${build.active.map((skill) => chip(`${skill.name} ${signedSkillPoints(skill.pt)}`, skill.negative ? 'red' : build.goals.some((target) => target.treeId === skill.treeId) ? 'gold' : '')).join('')}</div>
      ${simpleTable(['部位', '装备', '已用／孔', '装饰品'], [
        ...build.armor.map((gear) => position(armorPartName(gear.part), gear, `<a href="#/armor/${gear.id}">${esc(gear.name)}</a>`)),
        position('护石', build.charm, esc(loadoutCharmLabel(build.charm))),
        ...(build.weapon.slots ? [position('武器', build.weapon, '任意符合孔位的武器')] : []),
      ])}${build.torso ? `<p class="loadout-note">身体系统加倍：胸甲和其中的装饰品按 ${build.torso + 1} 倍计点。</p>` : ''}
      </div></details><div class="loadout-solution-actions">${actions}</div></article>`;
}
