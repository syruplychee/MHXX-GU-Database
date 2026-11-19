'use strict';

const QUEST_GROUPS = [
  ['', '全部'], ['village', '村', 13, 22], ['hub', '集会所', 23, 29], ['g', 'G 级', 30, 33],
  ['permit', '特殊许可', 34, 34], ['dlc', 'DLC', 36, 45],
];
const QUEST_TAGS = [['', '全部'], ['progress', '关键／紧急'], ['1', '仅关键'], ['2', '仅紧急'], ['talk', '对话标记']];
const QUEST_GUIDES = [['', '全部'], ['conditions', '有前置'], ['arts', '狩技'], ['food', '食材'], ['other', '其他解锁']];
const QUEST_UNLOCK_NAMES = { arts: '狩技', food: '食材', facilities: '设施', gear: '装备', companions: '随从', other: '其他' };
const QUEST_REPO = 'https://github.com/jestar719/mhgu';

function questHref(id, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value && (key !== 'page' || value > 1)) query.set(key, value);
  return '#/quests' + (id ? '/' + id : '') + (query.size ? '?' + query : '');
}

function questButtons(key, options) {
  return options.map(([value, label]) => `<button type="button" data-quest-filter="${key}" data-value="${esc(value)}">${esc(label)}</button>`).join('');
}

async function questBrowserPage({ parts, params, token }) {
  const filters = { q: params.q || '', group: params.group || '', lv: params.lv || '', type: params.type || '', key: params.key || '', supplement: params.supplement || '' };
  const types = S.meta.questTypesByLang[S.lang].map((type) => [type.id, type.name]);
  const levels = S.meta.questLevelsByLang[S.lang].filter((level) => QUEST_GROUPS.slice(1).some(([, , low, high]) => level.id >= low && level.id <= high));
  let selected = Number(parts[1]) || 0;
  let page = Number(params.page) || 0;
  let listRequest = 0;
  let detailRequest = 0;
  let activeRow = null;
  let timer;

  view.innerHTML = `<div class="quest-browser">
    <header class="quest-banner"><h1>任务图鉴</h1><a href="${QUEST_REPO}" target="_blank" rel="noopener">解锁资料 · MHGU ↗</a></header>
    <div class="quest-columns">
      <section class="quest-pane quest-index" aria-label="任务列表">
        <div class="quest-filters">
          <div class="quest-search-row">
            <input type="search" id="questSearch" aria-label="搜索任务名称" placeholder="搜索任务名称" value="${esc(filters.q)}" autocomplete="off">
            <label><span class="quest-sr">任务类型</span><select id="questType"><option value="">全部类型</option>${types.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></label>
            <button type="button" id="questReset">重置</button>
          </div>
          <div class="quest-filter-row"><span>区域</span><div role="group" aria-label="任务区域">${questButtons('group', QUEST_GROUPS)}</div></div>
          <div class="quest-filter-row" id="questLevelRow"><span>星级</span><div role="group" aria-label="任务等级" id="questLevels"></div></div>
          <div class="quest-filter-row"><span>标签</span><div role="group" aria-label="任务标签">${questButtons('key', QUEST_TAGS)}</div></div>
          <div class="quest-filter-row"><span>解锁</span><div role="group" aria-label="解锁资料">${questButtons('supplement', QUEST_GUIDES)}</div></div>
        </div>
        <div class="quest-list-head"><span>任务／难度</span><span>类型／解锁</span></div>
        <div id="questRows" class="quest-scroll quest-rows"><p class="quest-message">正在读取任务…</p></div>
        <footer class="quest-footer"><span id="questCount" role="status"></span><div><button type="button" id="questPrev" disabled>上一页</button><span id="questPageNumber"></span><button type="button" id="questNext" disabled>下一页</button></div></footer>
      </section>
      <section class="quest-pane quest-detail" id="questDetailPane" aria-label="任务详情" tabindex="-1">
        <div id="questDetailHead" class="quest-detail-head"></div>
        <div class="quest-detail-tabs" id="questTabs" hidden>
          <button type="button" data-quest-tab="overview" aria-pressed="true">目标与解锁</button>
          <button type="button" data-quest-tab="rewards" aria-pressed="false" id="questRewardTab">结算报酬</button>
        </div>
        <div id="questDetailBody" class="quest-scroll quest-detail-body"><p class="quest-message">正在读取详情…</p></div>
      </section>
    </div>
  </div>`;

  const rows = $('#questRows');
  const search = $('#questSearch');
  const type = $('#questType');
  const prev = $('#questPrev');
  const next = $('#questNext');
  const detailPane = $('#questDetailPane');
  const detailHead = $('#questDetailHead');
  const body = $('#questDetailBody');
  const tabs = $('#questTabs');
  let currentTab = 'overview';
  let detail = null;
  let displayedGroup;
  type.value = filters.type;

  function renderFilters() {
    if (displayedGroup !== filters.group) {
      displayedGroup = filters.group;
      const group = QUEST_GROUPS.find(([key]) => key === filters.group);
      const levelsHost = $('#questLevels');
      if (group?.[2]) {
        const available = levels.filter((level) => level.id >= group[2] && level.id <= group[3]);
        $('#questLevelRow').hidden = available.length <= 1;
        levelsHost.innerHTML = questButtons('lv', [['', '全星级'], ...available.map((level) => [level.id, level.name.match(/(?:G\s*)?\d+★/)?.[0] || level.name])]);
      } else {
        $('#questLevelRow').hidden = false;
        levelsHost.innerHTML = `<select id="questLevelSelect" aria-label="任务等级"><option value="">全部星级</option>${levels.map((level) => `<option value="${level.id}">${esc(level.name)}</option>`).join('')}</select>`;
      }
    }
    const levelSelect = $('#questLevelSelect');
    if (levelSelect) levelSelect.value = filters.lv;
    for (const button of $$('[data-quest-filter]', view)) button.setAttribute('aria-pressed', filters[button.dataset.questFilter] === button.dataset.value);
  }

  function renderDetailTab() {
    for (const button of $$('[data-quest-tab]', tabs)) button.setAttribute('aria-pressed', button.dataset.questTab === currentTab);
    body.innerHTML = currentTab === 'rewards' ? questRewardHTML(detail.rewards) : questOverviewHTML(detail);
    body.scrollTop = 0;
  }

  async function showQuest(id, { reveal = false, save = false } = {}) {
    const wanted = ++detailRequest;
    selected = id;
    activeRow?.removeAttribute('aria-current');
    activeRow = id ? $(`[data-quest-id="${id}"]`, rows) : null;
    activeRow?.setAttribute('aria-current', 'true');
    if (save) history.replaceState(null, '', questHref(id, { ...filters, page }));
    tabs.hidden = true;
    detailHead.innerHTML = '';
    if (!id) {
      body.innerHTML = '<p class="quest-message">选中一项任务以查看详情。</p>';
      return;
    }
    body.innerHTML = '<p class="quest-message">正在读取详情…</p>';
    try {
      const result = await api('/quests/' + id);
      if (token !== routeToken || wanted !== detailRequest) return;
      detail = result;
      detailHead.innerHTML = questDetailHeading(detail.data);
      $('#questRewardTab').textContent = `结算报酬 ${detail.rewards.length}`;
      tabs.hidden = false;
      renderDetailTab();
      if (reveal && matchMedia('(max-width: 760px)').matches) {
        detailPane.scrollIntoView({ block: 'start' });
        detailPane.focus({ preventScroll: true });
      }
    } catch (error) {
      if (token === routeToken && wanted === detailRequest) body.innerHTML = `<p class="quest-message" role="alert">${esc(error.message)}</p>`;
    }
  }

  async function loadList({ focus = false, save = false } = {}) {
    const wanted = ++listRequest;
    rows.setAttribute('aria-busy', 'true');
    prev.disabled = next.disabled = true;
    try {
      const result = await api('/quests', { ...filters, selected: focus ? selected : '', size: 36, page: page || '' });
      if (token !== routeToken || wanted !== listRequest) return;
      page = result.page;
      rows.innerHTML = result.rows.length ? result.rows.map((quest) => questListRow(quest, { ...filters, page })).join('')
        : '<p class="quest-message">没有符合条件的任务。</p>';
      rows.scrollTop = 0;
      $('#questCount').textContent = `${num(result.total)} 项任务`;
      $('#questPageNumber').textContent = `${page} / ${result.pages}`;
      prev.disabled = page <= 1;
      next.disabled = page >= result.pages;
      const existing = result.rows.find((quest) => quest.id === selected);
      const target = existing?.id || (focus && selected) || result.rows[0]?.id || 0;
      showQuest(target, { save });
      if (focus && activeRow) rows.scrollTop += activeRow.getBoundingClientRect().top - rows.getBoundingClientRect().top - 55;
    } catch (error) {
      if (token === routeToken && wanted === listRequest) rows.innerHTML = `<p class="quest-message" role="alert">${esc(error.message)}</p>`;
    } finally {
      if (wanted === listRequest) rows.removeAttribute('aria-busy');
    }
  }

  function changeFilters(patch) {
    clearTimeout(timer);
    Object.assign(filters, { q: search.value.trim() }, patch);
    page = 0;
    renderFilters();
    loadList({ save: true });
  }

  $('.quest-filters', view).addEventListener('click', (event) => {
    const button = event.target.closest('[data-quest-filter]');
    if (!button) return;
    const { questFilter, value } = button.dataset;
    if (filters[questFilter] === value) return;
    changeFilters(questFilter === 'group' ? { group: value, lv: '' } : { [questFilter]: value });
  });
  $('.quest-filters', view).addEventListener('change', (event) => {
    if (event.target.id === 'questLevelSelect') changeFilters({ lv: event.target.value });
    if (event.target === type) changeFilters({ type: type.value });
  });
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (token === routeToken) changeFilters({}); }, 180);
  });
  $('#questReset').addEventListener('click', () => {
    search.value = type.value = '';
    changeFilters({ group: '', lv: '', type: '', key: '', supplement: '' });
  });
  prev.addEventListener('click', () => { page--; loadList({ save: true }); });
  next.addEventListener('click', () => { page++; loadList({ save: true }); });
  rows.addEventListener('click', (event) => {
    const link = event.target.closest('[data-quest-id]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showQuest(Number(link.dataset.questId), { save: true, reveal: true });
  });
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quest-tab]');
    if (!button) return;
    currentTab = button.dataset.questTab;
    renderDetailTab();
  });
  detailHead.addEventListener('click', (event) => {
    if (!event.target.closest('[data-quest-back]')) return;
    $('.quest-index', view).scrollIntoView({ block: 'start' });
    activeRow?.focus({ preventScroll: true });
  });
  renderFilters();
  await loadList({ focus: true });
}

function questListRow(q, params) {
  const flags = q.flags.map((key) => `<span class="quest-label quest-unlock">${QUEST_UNLOCK_NAMES[key]}</span>`).join('');
  return `<a class="quest-row" href="${esc(questHref(q.id, params))}" data-quest-id="${q.id}">
    ${iconForQuest(q.icon)}<span class="quest-row-name"><b>${esc(q.name)}</b><small>${esc([q.lv, q.loc].filter(Boolean).join(' · '))}</small></span>
    <span class="quest-row-tags"><span class="quest-label">${esc(q.type || '—')}</span>${q.key ? `<span class="quest-label quest-key">${esc(q.key)}</span>` : ''}${flags}</span>
  </a>`;
}

function questDetailHeading(q) {
  return `<button class="quest-mobile-back" type="button" data-quest-back>↑ 返回任务列表</button>
    <div class="quest-detail-title">${iconForQuest(q.QstIcon)}<div><h2>${esc(q.name)}</h2><span>${esc([q.lv, q.type, q.loc].filter(Boolean).join(' · '))}</span></div>${q.key ? `<span class="quest-label quest-key">${esc(q.key)}</span>` : ''}</div>
    <dl class="quest-stats">${[['报酬', `${num(q.Reward)} z`], ['HRP', num(q.HRP)], ['参加费', `${num(q.Fee)} z`], ['限时', `${num(q.Time)} 分`]].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function questReferenceParts(parts, source) {
  return parts.map((part) => {
    if (typeof part === 'string') return part === '\n' ? '<br>' : esc(part);
    if (part.quest) return `<a href="${questHref(part.quest)}">${esc(part.label)}</a>`;
    return `<a href="${esc(source + part.path)}" target="_blank" rel="noopener">${esc(part.label)} ↗</a>`;
  }).join(' ');
}

function questBlock(title, content) {
  return `<section class="quest-block"><h3>${title}</h3><div>${content}</div></section>`;
}

function questArtLinks(parts, source) {
  const lines = [[]];
  for (const part of parts) {
    if (part === '\n') lines.push([]);
    else lines.at(-1).push(part);
  }
  return `<div class="quest-art-list">${lines.filter((line) => line.length).map((line) => `<div>${questReferenceParts(line, source)}</div>`).join('')}</div>`;
}

function questOverviewHTML(d) {
  const q = d.data;
  const ref = d.reference;
  const render = (parts) => questReferenceParts(parts, d.questSource);
  const request = (ref?.request || []).map((row) => `<div class="quest-detail-line"><span>${esc(row.title)}</span><div>${render(row.parts)}</div></div>`).join('');
  const unlocked = Object.entries(QUEST_UNLOCK_NAMES).flatMap(([key, label]) => {
    const named = key === 'arts' || key === 'food' ? ref?.[key] : null;
    if (named) return [`<div class="quest-detail-line"><span>${label}</span><div>${key === 'arts' ? questArtLinks(named, d.questSource) : render(named)}</div></div>`];
    if (ref?.flags?.includes(key) && !ref.extras?.some((row) => row.title.includes(label))) return [`<div class="quest-detail-line"><span>${label}</span><div class="quest-muted">来源标记了此类解锁，未列具体项目。</div></div>`];
    return [];
  });
  const extras = (ref?.extras || []).map((row) => `<div class="quest-detail-line"><span>${esc(row.title === '入手' ? '委托奖励' : row.title)}</span><div>${render(row.parts)}</div></div>`);
  const guide = ref ? `${questBlock('前置与受注', (ref.conditions ? `<div class="quest-info">${render(ref.conditions)}</div>` : '') + request || '<p class="quest-muted">来源未提供具体前置条件。</p>')}
    ${questBlock('完成后解锁与委托奖励', [...unlocked, ...extras].join('') || '<p class="quest-muted">来源未提供具体解锁项目。</p>')}`
    : questBlock('前置与解锁', '<p class="quest-muted">这项任务尚未与 MHGU 资料页匹配。</p>');
  return `${questBlock('任务目标', `<div class="quest-detail-line"><span>主要</span><b>${esc(q.goal1 || '—')}</b></div>
    <div class="quest-detail-line"><span>副目标</span><div>${esc(q.goal2 || '—')}${q.Reward2 > 0 ? ` <small>${num(q.Reward2)} z · HRP ${num(q.HRP2)}</small>` : ''}</div></div>`)}
    ${guide}
    ${d.dependents.length ? questBlock('引用本任务的后续任务', `<div class="quest-linked">${d.dependents.map((quest) => `<a href="${questHref(quest.id)}">${esc(quest.name)}</a>`).join('')}</div>`) : ''}
    ${d.monsters.length ? questBlock('出现怪物', `<div class="quest-linked">${d.monsters.map((m) => `<a href="#/monsters/${m.id}">${monIcon(m.id)}${esc(m.name)}</a>`).join('')}</div>`) : ''}
    ${ref ? `<div class="quest-source"><a href="${esc(d.questSource + ref.path)}" target="_blank" rel="noopener">查看 MHGU 对应资料页 ↗</a></div>` : ''}`;
}

function questRewardHTML(rewards) {
  if (!rewards.length) return '<p class="quest-message">没有已记录的结算报酬。</p>';
  const groups = Map.groupBy(rewards, (row) => row.line);
  return [...groups].map(([line, items]) => questBlock(`报酬 ${esc(line || '—')}`, `<table class="quest-reward-table"><thead><tr><th>道具</th><th>数量</th><th>概率</th></tr></thead><tbody>
    ${items.map((item) => `<tr><td><a href="#/items/${item.id}">${itemIcon(item.id)}${esc(item.name)}</a></td><td>${num(item.qty)}</td><td>${pct(item.pct)}</td></tr>`).join('')}</tbody></table>`)).join('');
}
