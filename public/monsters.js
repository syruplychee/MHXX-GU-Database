'use strict';

const MONSTER_TYPES = [['large', '大型怪物'], ['small', '小型怪物']];
const MONSTER_RANKS = [['1', '下位'], ['2', '上位'], ['3', 'G 位'], ['special', '特殊许可']];
const MONSTER_BODY_TABS = [['parts', '肉质'], ['status', '状态与陷阱'], ['quests', '相关任务']];
const MONSTER_REFERENCE = 'https://github.com/jestar719/mhgu/blob/fb8878ea2e0ff4c2848d7d9599ceb2f1279700ff/app/src/main/assets/mhxx/data/';
const MONSTER_REFERENCE_PAGES = { 124: 2879, 127: 2993, 128: 2994, 129: 2995 };
// Matched the desktop icons and numeric records against the MHXX/MHGU monster tables.
const MONSTER_AILMENTS = { 6: '中毒', 7: '麻痹', 8: '睡眠', 9: '爆破', 10: '眩晕', 11: '减气', 12: '跳跃', 13: '乘骑' };
const MONSTER_TRAPS = { 1: '闪光弹', 2: '麻痹陷阱', 3: '落穴陷阱', 4: '音爆弹', 5: '陷阱肉' };

function monsterHref(id, kind = '', q = '', form = '') {
  const query = new URLSearchParams();
  if (kind) query.set('kind', kind);
  if (q) query.set('q', q);
  if (form) query.set('form', form);
  return '#/monsters' + (id ? `/${id}` : '') + (query.size ? `?${query}` : '');
}

function monsterButtons(options, key, active) {
  return options.map(([value, label, disabled]) => `<button type="button" data-monster-${key}="${value}" aria-pressed="${value === active}" ${disabled ? 'disabled' : ''}>${label}</button>`).join('');
}

async function monsterBrowserPage({ parts, params, token }) {
  const roster = [['', '全部'], ...MONSTER_TYPES];
  let kind = roster.some(([id]) => id === params.kind) ? params.kind : '';
  let query = params.q || '';
  let selected = Number(parts[1]) || 0;
  let form = selected === 39 && params.form === 'mech' ? 'mech' : '';
  let tab = 'parts';
  let preferredRank = '1';
  let detail;
  let detailRequest = 0;
  const typeName = (value) => MONSTER_TYPES.find(([id]) => id === value)?.[1] || '任务标记';

  view.innerHTML = `<div class="monster-browser">
    <header class="monster-banner"><h1>怪物图鉴</h1></header>
    <div class="monster-columns">
      <section class="monster-pane monster-index" aria-labelledby="monsterIndexTitle">
        <header class="monster-heading"><h2 id="monsterIndexTitle">怪物列表</h2><span id="monsterCount" role="status"></span></header>
        <div class="monster-filters"><input type="search" id="monsterSearch" aria-label="搜索怪物名称" placeholder="搜索怪物名称" value="${esc(query)}" autocomplete="off">
          <div class="monster-buttons" id="monsterTypes" aria-label="怪物分类" role="group">${monsterButtons(roster, 'kind', kind)}</div></div>
        <div id="monsterRows" class="monster-scroll monster-rows"><p class="monster-empty">正在读取怪物…</p></div>
      </section>
      <section class="monster-pane monster-body" id="monsterBody" aria-label="怪物详情" tabindex="-1">
        <header id="monsterProfile" class="monster-profile" hidden></header>
        <div class="monster-buttons monster-body-tabs" id="monsterTabs" role="group" aria-label="怪物详情分类" hidden>${monsterButtons(MONSTER_BODY_TABS, 'tab', tab)}</div>
        <div class="monster-scroll monster-content" id="monsterDetail"><p class="monster-empty">正在读取详情…</p></div>
      </section>
      <section class="monster-pane monster-loot" id="monsterLoot" aria-labelledby="monsterLootTitle">
        <header class="monster-heading"><h2 id="monsterLootTitle">掉落素材</h2><span id="monsterLootCount" role="status"></span></header>
        <div class="monster-buttons monster-ranks" id="monsterRanks" role="group" aria-label="素材等级" hidden></div>
        <div class="monster-scroll monster-content" id="monsterDrops"><p class="monster-empty">正在读取素材…</p></div>
      </section>
    </div>
  </div>`;

  const list = $('#monsterRows');
  const profile = $('#monsterProfile');
  const types = $('#monsterTypes');
  const tabs = $('#monsterTabs');
  const ranks = $('#monsterRanks');
  const body = $('#monsterDetail');
  const drops = $('#monsterDrops');
  const detailPane = $('#monsterBody');
  const lootCount = $('#monsterLootCount');
  const result = await api('/monsters', { size: 200 });
  if (token !== routeToken) return;

  const entries = result.rows.flatMap((m) => m.id === 39 ? [m, { ...m, name: `${m.name}·机甲`, form: 'mech' }] : [m]);
  const syncURL = () => history.replaceState(null, '', monsterHref(selected, kind, query, form));
  const rowFor = (id, variant) => $(`[data-monster-id="${id}"][data-monster-form="${variant}"]`, list);

  function renderTab() {
    for (const button of $$('[data-monster-tab]', tabs)) button.setAttribute('aria-pressed', button.dataset.monsterTab === tab);
    if (tab === 'parts') body.innerHTML = monsterParts(detail, form);
    if (tab === 'status') body.innerHTML = monsterStatus(detail);
    if (tab === 'quests') body.innerHTML = monsterQuests(detail.quests);
    body.scrollTop = 0;
  }

  function renderLoot() {
    const tierOf = (row) => row.rankId > 3 ? 'special' : String(row.rankId);
    const byTier = Map.groupBy(detail.drops, tierOf);
    const choices = MONSTER_RANKS.filter(([id]) => id !== 'special' || byTier.has(id));
    const current = byTier.has(preferredRank) ? preferredRank : choices.find(([id]) => byTier.has(id))?.[0];
    const rows = byTier.get(current) || [];
    ranks.hidden = !detail.drops.length;
    ranks.innerHTML = monsterButtons(choices.map(([id, label]) => [id, label, !byTier.has(id)]), 'rank', current);
    lootCount.textContent = current ? `${num(rows.length)} 条` : '';
    drops.innerHTML = monsterDropRows(rows);
    drops.scrollTop = 0;
  }

  function renderProfile() {
    const m = detail.data;
    const name = form === 'mech' ? `${m.name}·机甲` : m.name;
    profile.innerHTML = `${monBig(m.id)}<div><h2>${esc(name)}</h2><span>${typeName(m.kind)} · ${num(detail.quests.length)} 项相关任务</span></div>
      <div class="monster-mobile-actions"><button type="button" data-monster-jump="list">列表 ↑</button><button type="button" data-monster-jump="loot">素材 ↓</button></div>`;
  }

  async function selectMonster(id, { reveal = false, save = false, variant = '' } = {}) {
    const changedForm = form !== variant;
    form = variant;
    selected = id;
    if (changedForm) tab = 'parts';
    for (const row of $$('[aria-current]', list)) row.removeAttribute('aria-current');
    rowFor(id, form)?.setAttribute('aria-current', 'true');
    if (save) syncURL();
    if (id === detail?.data.id) {
      if (changedForm) { renderProfile(); renderTab(); }
      return;
    }
    const request = ++detailRequest;
    detail = null;
    profile.hidden = tabs.hidden = ranks.hidden = true;
    lootCount.textContent = '';
    body.innerHTML = id ? '<p class="monster-empty">正在读取详情…</p>' : '<p class="monster-empty">选中怪物后查看详情。</p>';
    drops.innerHTML = id ? '<p class="monster-empty">正在读取素材…</p>' : '';
    if (!id) return;
    try {
      const data = await api('/monsters/' + id);
      if (token !== routeToken || request !== detailRequest) return;
      detail = data;
      renderProfile();
      profile.hidden = tabs.hidden = false;
      renderTab();
      renderLoot();
      if (reveal && matchMedia('(max-width: 1000px)').matches) detailPane.scrollIntoView({ block: 'start' });
    } catch (error) {
      if (token !== routeToken || request !== detailRequest) return;
      body.innerHTML = `<p class="monster-empty" role="alert">${esc(error.message)}</p>`;
      drops.innerHTML = '';
    }
  }

  function renderList({ initial = false } = {}) {
    const keyword = query.toLowerCase();
    const rows = entries.filter((m) => (!kind || m.kind === kind) && m.name.toLowerCase().includes(keyword));
    const count = (records) => new Set(records.map((m) => m.id)).size;
    $('#monsterCount').textContent = `${num(count(rows))} 只`;
    list.innerHTML = rows.length ? MONSTER_TYPES.map(([id, name]) => {
      const entries = rows.filter((m) => m.kind === id);
      return entries.length ? `<h3>${name} <small>${count(entries)}</small></h3>${entries.map((m) =>
        `<a class="monster-entry${m.form ? ' monster-entry-variant' : ''}" href="${esc(monsterHref(m.id, kind, query, m.form))}" data-monster-id="${m.id}" data-monster-form="${m.form || ''}">${monIcon(m.id)}<span>${esc(m.name)}</span></a>`).join('')}` : '';
    }).join('') : '<p class="monster-empty">没有符合条件的怪物。</p>';
    list.scrollTop = 0;
    const current = rows.find((m) => m.id === selected && (m.form || '') === form);
    const target = initial && selected ? { id: selected, form } : current || rows[0];
    selectMonster(target?.id || 0, { save: !initial, variant: target?.form || '' });
    if (initial && target?.id === Number(parts[1])) {
      const active = rowFor(target.id, target.form || '');
      if (active) list.scrollTop = active.getBoundingClientRect().top - list.getBoundingClientRect().top - 38;
    }
  }

  types.addEventListener('click', (event) => {
    const button = event.target.closest('[data-monster-kind]');
    if (!button || kind === button.dataset.monsterKind) return;
    kind = button.dataset.monsterKind;
    for (const element of $$('[data-monster-kind]', types)) element.setAttribute('aria-pressed', element.dataset.monsterKind === kind);
    renderList();
  });
  $('#monsterSearch').addEventListener('input', (event) => { query = event.target.value.trim(); renderList(); });
  list.addEventListener('click', (event) => {
    const link = event.target.closest('[data-monster-id]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const id = Number(link.dataset.monsterId);
    if (id === detail?.data.id && matchMedia('(max-width: 1000px)').matches) detailPane.scrollIntoView({ block: 'start' });
    selectMonster(id, { reveal: true, save: true, variant: link.dataset.monsterForm });
  });
  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-monster-form-pick]');
    if (!button || button.dataset.monsterFormPick === form) return;
    const variant = button.dataset.monsterFormPick;
    selectMonster(39, { save: true, variant });
    $(`[data-monster-form-pick="${variant}"]`, body)?.focus({ preventScroll: true });
  });
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-monster-tab]');
    if (!button) return;
    tab = button.dataset.monsterTab;
    renderTab();
  });
  ranks.addEventListener('click', (event) => {
    const button = event.target.closest('[data-monster-rank]');
    if (!button || button.disabled) return;
    preferredRank = button.dataset.monsterRank;
    renderLoot();
    $(`[data-monster-rank="${preferredRank}"]`, ranks)?.focus({ preventScroll: true });
  });
  profile.addEventListener('click', (event) => {
    const jump = event.target.closest('[data-monster-jump]')?.dataset.monsterJump;
    if (jump) (jump === 'loot' ? $('#monsterLoot') : $('.monster-index', view)).scrollIntoView({ block: 'start' });
  });
  renderList({ initial: true });
}

function monsterSection(title, html) {
  return `<section class="monster-block"><h3>${title}</h3>${html}</section>`;
}

function monsterParts(d, form) {
  const m = d.data;
  const isAhtal = m.id === 39;
  const mech = form === 'mech';
  const rows = isAhtal ? d.weak.filter((row) => mech ? row.num >= 8 : row.num < 8) : d.weak;
  const sourceLink = (id) => `<a class="monster-source-link" href="${MONSTER_REFERENCE}${id}.html" target="_blank" rel="noopener">MHGU 资料页 ↗</a>`;
  const forms = isAhtal ? `<div class="monster-buttons monster-forms" role="group" aria-label="阁螳螂形态">${monsterButtons([['', '本体'], ['mech', '机甲']], 'form-pick', form)}${sourceLink(mech ? 3002 : 2992)}</div>` : '';
  const columns = [['切', 'cut', '切断'], ['打', 'impact', '打击'], ['弹', 'shot', '射击'], ['火', 'fir'], ['水', 'wtr'], ['雷', 'thd'], ['冰', 'ice'], ['龙', 'drg'], ['晕', 'diz', '眩晕']];
  const artUrl = m.diagram && !mech ? `${iconUrl(m.diagram)}?v=original` : '';
  const diagram = artUrl ? `<figure class="monster-diagram"><a href="${artUrl}" target="_blank" rel="noopener" aria-label="查看${esc(m.name)}原版肉质示意图"><img src="${artUrl}" class="monster-part-image" alt="" decoding="async"></a><figcaption>按编号对照肉质表 · <a href="${artUrl}" target="_blank" rel="noopener">查看大图 ↗</a></figcaption></figure>`
    : mech ? '<p class="monster-empty">两套资料均未收录机甲的编号示意图，部位肉质见下表。</p>'
      : m.kind === 'large' ? `<p class="monster-empty">桌面版未收录这只怪物的部位示意图。${MONSTER_REFERENCE_PAGES[m.id] ? ' ' + sourceLink(MONSTER_REFERENCE_PAGES[m.id]) : ''}</p>` : '';
  if (!d.weak.length) return `${diagram}<p class="monster-empty">没有已记录的肉质数据。</p>`;
  return monsterSection('部位肉质', `${forms}${diagram}<div class="monster-table-wrap"><table class="monster-table monster-hitzones">
    <thead><tr><th scope="col">#</th><th scope="col">部位</th>${columns.map(([label, , title]) => `<th scope="col" title="${title || label}">${label}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((row) => `<tr><td class="monster-number">${row.num}</td><th scope="row">${esc(row.part || '—')}${row.condition && row.condition !== '---' ? `<small>${esc(row.condition)}</small>` : ''}</th>${columns.map(([, key]) => {
      const value = row[key];
      return `<td class="${value >= 45 && key !== 'diz' ? 'monster-high' : ''}">${value == null || value < 0 ? '—' : value}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`);
}

function monsterStatus(d) {
  const info = [];
  if (d.ailments.length) info.push(monsterSection('状态异常耐性', simpleTable(['状态', '初始', '增加', '上限', '持续', '伤害'], d.ailments.map((r) => `<tr>
    <td><div class="cell-name">${r.stat === 12 ? '' : ic('Stat_' + String(r.stat).padStart(2, '0'))}<span>${MONSTER_AILMENTS[r.stat]}</span></div></td>
    <td>${num(r.initial)}</td><td>${num(r.inc)}</td><td>${num(r.max)}</td><td>${r.duration < 0 ? '—' : num(r.duration)}</td><td>${r.damage < 0 ? '—' : num(r.damage)}</td></tr>`))));
  if (d.traps.length) info.push(monsterSection('陷阱效果', simpleTable(['陷阱', '有效', '通常', '愤怒', '疲劳'], d.traps.map((r) => `<tr>
    <td><div class="cell-name">${ic('Trap_' + r.trap)}<span>${MONSTER_TRAPS[r.trap]}</span></div></td><td>${r.effect > 0 ? '有效' : '无效'}</td>
    ${[r.duration, r.enraged, r.fatigued].map((value) => `<td>${value > 0 ? value + 's' : '—'}</td>`).join('')}</tr>`))));
  return info.join('') || '<p class="monster-empty">没有已记录的状态或陷阱数据。</p>';
}

function monsterQuests(rows) {
  return rows.length ? `<div class="monster-task-list">${rows.map((row) => `<a href="#/quests/${row.id}"><b>${esc(row.name)}</b><span>${esc(row.lv || '—')}</span></a>`).join('')}</div>`
    : '<p class="monster-empty">没有已记录的相关任务。</p>';
}

function monsterDropRows(rows) {
  if (!rows.length) return '<p class="monster-empty">没有已记录的掉落素材。</p>';
  const groups = Map.groupBy(rows, (row) => (row.how || '其他') + (row.rankId > 3 ? ` · ${row.rank}` : ''));
  return [...groups].map(([group, items]) => monsterSection(esc(group), `<table class="monster-table monster-drop-table"><thead><tr><th scope="col">素材</th><th scope="col">数量</th><th scope="col">概率</th></tr></thead><tbody>
    ${items.map((row) => `<tr><td><a href="#/items/${row.id}">${itemIcon(row.id)}<span>${esc(row.name)}</span></a></td><td>${num(row.qty)}</td><td>${pct(row.pct)}</td></tr>`).join('')}</tbody></table>`)).join('');
}
