'use strict';

const palicoPart = (part) => ({ 11: '头部', 12: '身体', 21: '斩击', 22: '打击' })[part] || '—';

function palicoGroups(rows, weapon) {
  if (weapon) return [...Map.groupBy(rows, (row) => `${row.img}-${row.part}`).values()];
  const groups = [];
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i];
    const next = rows[i + 1];
    // Look for the adjacent head/body pair, because the same image can appear in several ranks and sets.
    if (first.part === 11 && next?.part === 12 && next.id === first.id + 1 && next.img === first.img && next.rare === first.rare) {
      groups.push([first, next]); i++;
    } else groups.push([first]);
  }
  return groups;
}

function palicoGroupName(group, weapon) {
  const first = group[0].name;
  if (weapon || group.length === 1) return first;
  const second = group[1].name;
  let common = first;
  while (common && !second.startsWith(common)) common = common.slice(0, -1);
  common = common.replace(/[\s【（(・-]+$/, '');
  return common ? `${common}套装` : first;
}

function palicoGearHref(kind, id, filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  return `#/palico/${kind}${id ? '/' + id : ''}${query.size ? '?' + query : ''}`;
}

async function palicoGearPage({ parts, params, token }) {
  const weapon = parts[1] === 'weapons';
  const kind = weapon ? 'weapons' : 'armor';
  let selected = Number(parts[2]) || 0;
  let latest = 0;
  const openGroups = new Set();
  const filters = { q: params.q || '', part: params.part || '', type: params.type || '', rarity: params.rarity || '' };
  const { rows } = await api(`/palico/${kind}`, { size: 2000 });
  if (token !== routeToken) return;
  const groups = palicoGroups(rows, weapon);
  const status = weapon ? '武器' : '防具';
  view.innerHTML = `<div class="armor-browser palico-gear">
    <header class="armor-banner"><h1>随从${status}</h1></header>
    <div class="armor-columns">
      <aside class="armor-pane"><header class="armor-heading"><h2>筛选</h2><button type="button" id="palicoReset">重置</button></header>
        <div class="armor-filters" id="palicoFilters">
          <label class="armor-control"><span>名称</span><input id="palicoSearch" type="search" placeholder="搜索随从${status}" value="${esc(filters.q)}" autocomplete="off"></label>
          ${armorSelect('part', weapon ? '攻击方式' : '部位', '全部', (weapon ? [21, 22] : [11, 12]).map((id) => [id, palicoPart(id)]))}
          ${weapon ? armorSelect('type', '特化类型', '全部类型', guideOptions(rows, 'type', 'typeName')) : ''}
          ${armorSelect('rarity', '稀有度', '全部稀有度', guideOptions(rows, 'rare', 'rare').map(([value]) => [value, 'R' + value]))}
        </div>
      </aside>
      <section class="armor-pane armor-index" id="palicoIndex"><header class="armor-heading"><h2>${weapon ? '武器 · 按外观分组' : '防具套装'} <span id="palicoCount" role="status"></span></h2><div class="armor-actions"><button id="palicoExpand" type="button">展开全部</button><button id="palicoCollapse" type="button">折叠全部</button></div></header><div class="armor-rows armor-scroll" id="palicoRows"></div></section>
      <section class="armor-pane armor-details" id="palicoDetailPane" tabindex="-1" aria-label="单件详情"><header class="armor-heading"><h2>单件详情</h2><button id="palicoReturn" class="palico-return" type="button">返回列表 ↑</button></header><div class="armor-piece-detail armor-scroll" id="palicoDetail"></div></section>
    </div>
  </div>`;
  const list = $('#palicoRows');
  const pane = $('#palicoDetailPane');
  const detail = $('#palicoDetail');
  const search = $('#palicoSearch');
  const controls = $('#palicoFilters');
  let displayed = 0;
  const sync = () => history.replaceState(null, '', palicoGearHref(kind, selected, filters));
  const rowFor = (id) => $(`[data-palico-piece="${id}"]`, list);

  async function show(id, { save = false, focus = false, mobile = false } = {}) {
    selected = id;
    for (const element of $$('[aria-current]', list)) element.removeAttribute('aria-current');
    const active = rowFor(id);
    if (active) {
      active.setAttribute('aria-current', 'true');
      const group = active.closest('details');
      $('summary', group).setAttribute('aria-current', 'true');
      if (focus) { group.open = true; list.scrollTop += group.getBoundingClientRect().top - list.getBoundingClientRect().top; }
    }
    if (save) sync();
    if (id && displayed === id) {
      if (mobile && matchMedia('(max-width: 770px)').matches) pane.scrollIntoView({ block: 'start' });
      return;
    }
    displayed = 0;
    const request = ++latest;
    detail.innerHTML = `<p class="armor-empty">${id ? '正在读取装备…' : '选中一件装备后查看详情。'}</p>`;
    if (!id) return;
    try {
      const data = await api(`/palico/${kind}/${id}`);
      if (request !== latest || token !== routeToken) return;
      displayed = id;
      detail.innerHTML = palicoGearDetail(data, weapon);
      detail.scrollTop = 0;
      if (mobile && matchMedia('(max-width: 770px)').matches) pane.scrollIntoView({ block: 'start' });
    } catch (error) {
      if (request === latest && token === routeToken) detail.innerHTML = `<p class="armor-empty" role="alert">${esc(error.message)}</p>`;
    }
  }

  function render(initial = false) {
    const q = filters.q.toLowerCase();
    const matches = groups.map((group) => {
      const label = palicoGroupName(group, weapon);
      const visible = group.filter((row) => (!q || label.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)) &&
        (!filters.part || String(row.part) === filters.part) && (!filters.type || !weapon || String(row.type) === filters.type) &&
        (!filters.rarity || String(row.rare) === filters.rarity));
      return { group, label, visible };
    }).filter((entry) => entry.visible.length);
    $('#palicoCount').textContent = `${num(matches.reduce((n, entry) => n + entry.visible.length, 0))} 件`;
    list.innerHTML = matches.length ? matches.map(({ group, label, visible }) => palicoGroupHTML(group, label, visible, weapon, kind, filters, openGroups.has(String(group[0].id)))).join('')
      : '<p class="armor-empty">没有符合条件的装备。</p>';
    list.scrollTop = 0;
    const exists = matches.some((entry) => entry.visible.some((row) => row.id === selected));
    const target = (exists || initial && selected) ? selected : matches[0]?.visible[0].id || 0;
    show(target, { save: !initial, focus: initial && Boolean(parts[2]) });
  }
  controls.addEventListener('change', (event) => {
    const key = event.target.dataset.armorSelect;
    if (key) { filters[key] = event.target.value; render(); }
  });
  search.addEventListener('input', () => { filters.q = search.value.trim(); render(); });
  $('#palicoReset').addEventListener('click', () => {
    for (const key of Object.keys(filters)) filters[key] = '';
    for (const element of $$('input, select', controls)) element.value = '';
    openGroups.clear(); render();
  });
  list.addEventListener('toggle', (event) => {
    const group = event.target;
    if (!group.dataset.palicoGroup || !list.contains(group)) return;
    if (group.open) openGroups.add(group.dataset.palicoGroup);
    else openGroups.delete(group.dataset.palicoGroup);
  }, true);
  $('#palicoExpand').addEventListener('click', () => $$('details', list).forEach((group) => { group.open = true; }));
  $('#palicoCollapse').addEventListener('click', () => $$('details', list).forEach((group) => { group.open = false; }));
  $('#palicoReturn').addEventListener('click', () => $('#palicoIndex').scrollIntoView({ block: 'start' }));
  list.addEventListener('click', (event) => {
    const link = event.target.closest('[data-palico-piece]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    show(Number(link.dataset.palicoPiece), { save: true, mobile: true });
  });
  for (const select of $$('select', controls)) select.value = filters[select.dataset.armorSelect];
  render(true);
}

function palicoGroupHTML(group, label, visible, weapon, kind, filters, open) {
  const first = group[0];
  const aggregate = weapon ? `${group.length} 把同外观武器` : `${group.length} 件 · 总防御 ${num(group.reduce((sum, row) => sum + row.def, 0))}`;
  const members = weapon ? visible : group;
  return `<details class="armor-set" data-palico-group="${first.id}" ${open ? 'open' : ''}>
    <summary><span class="armor-chevron" aria-hidden="true">›</span>${ic(first.img, 'armor-thumb')}<span class="armor-set-summary">
      <span class="armor-set-title"><b>${esc(label)}</b>${weapon && group.length > 1 ? '' : rarity(first.rare)}</span>
      <span class="armor-set-meta">${aggregate}${visible.length < group.length ? ` · 匹配 ${visible.length} 件` : ''}</span></span></summary>
    <div class="armor-members">${members.map((row) => `<a href="${esc(palicoGearHref(kind, row.id, filters))}" data-palico-piece="${row.id}" ${visible.includes(row) ? '' : 'class="armor-member-other"'}><span>${palicoPart(row.part)}</span><b>${esc(row.name)}</b><small>${weapon ? `近 ${row.atkD} · 远 ${row.atkI}` : `防御 ${row.def}`}</small></a>`).join('')}</div></details>`;
}

function palicoGearDetail(detail, weapon) {
  const a = detail.data;
  const stat = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const sharp = ['—', '红', '橙', '黄', '绿', '蓝', '白', '紫'][a.Sharp_ID];
  const stats = [['防御', a.Def], ['价格', `${num(a.Price)} z`], ...(weapon ? [['锋利度', sharp], ['类型', esc(a.typeName)]] : [])];
  const weaponTable = () => simpleTable(['攻击', '威力', '会心率', '属性'], [['近战', a.AtkD, a.AtkD_Affinity, a.AtkD_SpAtkPt], ['远程', a.AtkI, a.AtkI_Affinity, a.AtkI_SpAtkPt]].map(([label, attack, affinity, pt]) => `<tr><td>${label}</td><td>${num(attack)}</td><td>${affinityPercent(affinity)}</td><td>${elementChip(a.element, pt) || '—'}</td></tr>`));
  const resist = resGrid({ fir: a.Res_Fire, wtr: a.Res_Water, thd: a.Res_Thunder, ice: a.Res_Ice, drg: a.Res_Dragon });
  return `<header class="armor-hero"><div class="armor-art">${ic(a.ImgFile, 'armor-art-img')}</div><div><h3>${esc(a.name)}</h3><div class="armor-piece-tags">${rarity(a.Rare)} ${palicoPart(a.Part)}</div><dl class="armor-stats">${stats.map(([label, value]) => stat(label, value)).join('')}</dl></div></header>
    <section class="armor-block"><h3>${weapon ? '攻击与属性' : '属性耐性'}</h3><div class="armor-block-body">${weapon ? weaponTable() : resist}</div></section>
    <section class="armor-block"><h3>生产素材</h3>${detail.materials.length ? `<ul class="armor-mats">${detail.materials.map((m) => `<li><a href="#/items/${m.id}">${itemIcon(m.id)}<span>${esc(m.name)}</span><b>×${num(m.qty)}</b></a></li>`).join('')}</ul>` : '<p class="armor-block-body armor-muted">没有记录生产素材。</p>'}</section>`;
}
