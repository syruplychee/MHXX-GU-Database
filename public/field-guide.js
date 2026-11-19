'use strict';

const GUIDE_RANKS = [['1', '下位'], ['2', '上位'], ['3', 'G 位']];

function guideOptions(rows, id, name) {
  return [...new Map(rows.map((row) => [row[id], row[name]])).entries()].sort(([a], [b]) => a - b);
}

function guideSelect(id, label, options, includeAll = true) {
  return `<label><span>${label}</span><select id="${id}">${includeAll ? '<option value="">全部</option>' : ''}${options.map(([value, name]) => `<option value="${value}">${esc(name)}</option>`).join('')}</select></label>`;
}

function guideItem(id, name) {
  return `<a class="guide-item" href="#/items/${id}">${itemIcon(id)}<span>${esc(name)}</span></a>`;
}

function locationHref(id, trades) {
  return `#/locations/${id}${trades ? '?tab=trades' : ''}`;
}

async function locationGuidePage({ parts, params, token }) {
  let selected = Number(parts[1]) || 1;
  let tradesTab = params.tab === 'trades' || parts[1] === 'trades';
  let area = '';
  let details;
  let request = 0;
  view.innerHTML = `<div class="armor-browser map-guide">
    <header class="armor-banner"><h1>地图采集与交换</h1></header>
    <div class="armor-columns">
      <aside class="armor-pane map-index"><header class="armor-heading"><h2>地图</h2></header><div id="mapIndex" class="armor-scroll"></div></aside>
      <section class="armor-pane"><header class="armor-heading"><h2 id="mapName">区域地图</h2></header><div id="mapArt" class="armor-scroll map-art"></div></section>
      <section class="armor-pane map-records" id="mapRecords"><header class="armor-heading guide-switch" id="mapTabs" role="group" aria-label="地图资料分类"><button type="button" data-map-tab="gather">地图采集</button><button type="button" data-map-tab="trades">山菜爷交换</button></header>
        <div class="guide-controls"><input id="mapItemSearch" type="search" aria-label="搜索道具" placeholder="搜索道具名称" autocomplete="off"><div id="mapControls" class="guide-selects"></div></div>
        <div class="armor-scroll guide-content" id="mapRows"><p class="armor-empty">正在读取地图资料…</p></div>
      </section>
    </div>
  </div>`;
  const mapIndex = $('#mapIndex');
  const art = $('#mapArt');
  const controls = $('#mapControls');
  const rows = $('#mapRows');
  const tabs = $('#mapTabs');
  const search = $('#mapItemSearch');
  const [locations, exchanges] = await Promise.all([api('/locations'), api('/locations/trades')]);
  if (token !== routeToken) return;
  const syncURL = () => history.replaceState(null, '', locationHref(selected, tradesTab));
  const tradeScopes = [['map', '当前地图'], ['unknown', '未指定地点'], ['all', '全部地点']];
  let tradeScope = parts[1] === 'trades' ? 'all' : 'map';
  let rank = '';
  let method = '';

  function syncMaps() {
    const chosen = details?.data.mapId;
    mapIndex.innerHTML = locations.rows.filter((location) => location.id === location.mapId).map((location) =>
      `<a class="guide-list-entry" href="${locationHref(location.id, tradesTab)}" data-map-id="${location.id}" ${location.id === chosen ? 'aria-current="true"' : ''}><b>${esc(location.name)}</b><small>${location.items ? `${num(location.items)} 条采集` : '区域地图'}</small></a>`).join('');
  }

  function renderRows() {
    if (!details) return;
    const q = search.value.trim().toLowerCase();
    if (tradesTab) {
      const matches = exchanges.rows.filter((row) => (tradeScope === 'all' || (tradeScope === 'unknown' ? row.locId < 0 : row.locId === details.data.mapId)) &&
        (!q || [row.give, row.receive].some((name) => name.toLowerCase().includes(q))));
      rows.innerHTML = `<p class="guide-count">${num(matches.length)} 条记录</p>${matches.length ? simpleTable(['交出', '获得', '概率', '地点'], matches.map((row) => `<tr><td>${row.giveId > 0 ? guideItem(row.giveId, row.give) : '<span class="armor-muted">无需交出道具</span>'}</td><td>${guideItem(row.getId, row.receive)}</td><td>${pct(row.pct)}</td><td>${row.locId > 0 ? esc(row.loc) : '未指定'}</td></tr>`)) : '<p class="armor-empty">没有符合条件的交换记录。</p>'}`;
    } else {
      const matches = details.rows.filter((row) => (!area || String(row.areaId) === area) && (!rank || String(row.rankId) === rank) &&
        (!method || String(row.methodId) === method) && (!q || row.name.toLowerCase().includes(q)));
      rows.innerHTML = `<p class="guide-count">${num(matches.length)} 条采集记录</p>${matches.length ? simpleTable(['道具', '区域', '方式', '等级'], matches.map((row) => `<tr><td>${guideItem(row.id, row.name)}</td><td>${esc(row.area)}</td><td>${esc(row.how)}</td><td>${esc(row.rank)}</td></tr>`)) : '<p class="armor-empty">没有符合条件的采集记录。</p>'}`;
    }
    rows.scrollTop = 0;
  }

  function renderControls() {
    for (const button of $$('[data-map-tab]', tabs)) button.setAttribute('aria-pressed', (button.dataset.mapTab === 'trades') === tradesTab);
    controls.innerHTML = tradesTab ? guideSelect('mapTradeScope', '交换地点', tradeScopes, false)
      : guideSelect('mapRank', '等级', GUIDE_RANKS) + guideSelect('mapMethod', '采集方式', guideOptions(details.rows, 'methodId', 'how'));
    if (tradesTab) $('#mapTradeScope').value = tradeScope;
    else { $('#mapRank').value = rank; $('#mapMethod').value = method; }
    renderRows();
  }

  async function openMap(id, save) {
    selected = id;
    const current = ++request;
    const result = await api('/locations/' + id);
    if (token !== routeToken || current !== request) return;
    details = result;
    area = method = '';
    if (save) syncURL();
    syncMaps();
    const map = result.data;
    $('#mapName').textContent = map.name;
    const image = iconUrl(map.image);
    const areas = guideOptions(result.rows, 'areaId', 'area');
    art.innerHTML = `<figure><a href="${image}" target="_blank" rel="noopener"><img src="${image}" alt="${esc(map.name)}区域示意图"></a>${map.id !== map.mapId ? '<figcaption>日夜变体共用地图和采集记录。</figcaption>' : ''}</figure>
      ${areas.length ? `<div class="map-areas" role="group" aria-label="采集区域"><button type="button" data-map-area="" aria-pressed="true">全部区域</button>${areas.map(([id, name]) => `<button type="button" data-map-area="${id}" aria-pressed="false">${esc(name)}</button>`).join('')}</div>` : ''}`;
    renderControls();
  }

  mapIndex.addEventListener('click', (event) => {
    const link = event.target.closest('[data-map-id]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openMap(Number(link.dataset.mapId), true).catch((error) => { rows.textContent = error.message; });
  });
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map-tab]');
    if (!button || !details) return;
    tradesTab = button.dataset.mapTab === 'trades';
    syncURL(); syncMaps(); renderControls();
  });
  art.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map-area]');
    if (!button) return;
    area = button.dataset.mapArea;
    for (const chip of $$('[data-map-area]', art)) chip.setAttribute('aria-pressed', chip === button);
    if (tradesTab) { tradesTab = false; syncURL(); syncMaps(); renderControls(); }
    else renderRows();
  });
  controls.addEventListener('change', (event) => {
    if (event.target.id === 'mapTradeScope') tradeScope = event.target.value;
    if (event.target.id === 'mapRank') rank = event.target.value;
    if (event.target.id === 'mapMethod') method = event.target.value;
    renderRows();
  });
  search.addEventListener('input', renderRows);
  await openMap(selected, false);
}

const TEAM_SOURCES = { 901: '虫', 902: '鱼', 903: '草', 904: '蘑菇', 905: '种子与果实', 906: '骨', 907: '蜂蜜', 908: '矿石', 909: '猎虫饵料', 910: '稀有素材' };

function teamSource(row) {
  if (row.monster) return { value: 'monster', label: row.monster, image: monIcon(row.icon) };
  if (TEAM_SOURCES[row.icon]) return { value: String(row.icon), label: TEAM_SOURCES[row.icon], image: ic(`PeliTeam_${row.icon}`) };
  return { value: 'other', label: '其他奖励', image: '' };
}

async function teamGuidePage({ params, token }) {
  const data = await api('/palico/team');
  if (token !== routeToken) return;
  const all = data.rows.map((row) => ({ ...row, source: teamSource(row) }));
  const sourceOptions = [['monster', '怪物素材'], ...Object.entries(TEAM_SOURCES), ['other', '其他奖励']];
  const zones = guideOptions(all, 'zoneId', 'zone').map(([id, name]) => [id, id < 0 ? '未指定地区' : name]);
  view.innerHTML = `<div class="armor-browser team-guide">
    <header class="armor-banner"><h1>随从队伍</h1></header>
    <div class="team-columns">
      <aside class="armor-pane"><header class="armor-heading"><h2>奖励筛选</h2><button type="button" id="teamReset">重置</button></header>
        <div class="armor-filters armor-scroll" id="teamFilters">
          <label class="armor-control"><span>道具名称</span><input id="teamSearch" type="search" placeholder="搜索奖励道具" value="${esc(params.q || '')}"></label>
          <fieldset class="armor-control"><legend>等级</legend><div class="team-pills">${teamChecks('rank', GUIDE_RANKS)}</div></fieldset>
          <fieldset class="armor-control"><legend>区域</legend><div class="team-pills">${teamChecks('zone', zones)}</div></fieldset>
          <fieldset class="armor-control"><legend>来源图标</legend><div class="team-pills">${teamChecks('source', sourceOptions)}</div></fieldset>
          ${guideSelect('teamOrder', '排列', [['id', '原版顺序'], ['pct', '概率从高到低'], ['qty', '数量从多到少']], false)}
        </div>
      </aside>
      <section class="armor-pane"><header class="armor-heading"><h2>随从队伍奖励 <span id="teamCount" role="status"></span></h2></header><div class="armor-scroll guide-content" id="teamRows"></div></section>
    </div>
  </div>`;
  const filters = $('#teamFilters');
  const search = $('#teamSearch');
  const rows = $('#teamRows');
  function render() {
    const selected = Map.groupBy($$('input:checked', filters), (input) => input.name);
    const match = (key, value) => !selected.has(key) || selected.get(key).some((input) => input.value === String(value));
    const q = search.value.trim().toLowerCase();
    const result = all.filter((row) => (!q || row.item.toLowerCase().includes(q)) && match('rank', row.rankId) && match('zone', row.zoneId) && match('source', row.source.value));
    const order = $('#teamOrder').value;
    if (order !== 'id') result.sort((a, b) => b[order] - a[order] || a.id - b.id);
    $('#teamCount').textContent = `${num(result.length)} / ${num(all.length)} 条`;
    rows.innerHTML = result.length ? simpleTable(['来源', '奖励道具', '区域', '等级', '数量', '概率'], result.map((row) => `<tr>
      <td>${row.monster ? `<a class="guide-item" href="#/monsters/${row.icon}">${row.source.image}${esc(row.source.label)}</a>` : `<span class="guide-item">${row.source.image}${esc(row.source.label)}</span>`}</td>
      <td>${guideItem(row.itmId, row.item)}</td><td>${row.zoneId < 0 ? '—' : esc(row.zone)}</td><td>${esc(row.rank)}</td><td>${num(row.qty)}</td><td>${pct(row.pct)}</td></tr>`))
      : '<p class="armor-empty">没有符合条件的奖励。</p>';
    rows.scrollTop = 0;
  }
  filters.addEventListener('change', render);
  search.addEventListener('input', render);
  $('#teamReset').addEventListener('click', () => { for (const input of $$('input:checked', filters)) input.checked = false; search.value = ''; $('#teamOrder').value = 'id'; render(); });
  render();
}

function teamChecks(key, options) {
  return options.map(([value, label]) => `<label><input type="checkbox" name="${key}" value="${value}"><span>${key === 'source' && TEAM_SOURCES[value] ? ic(`PeliTeam_${value}`) : ''}${esc(label)}</span></label>`).join('');
}
