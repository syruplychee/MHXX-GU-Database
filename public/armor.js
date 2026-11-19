'use strict';

const ARMOR_CLASS_FILTERS = [['', '全部'], [1, '剑士可用'], [2, '枪手可用'], [0, '剑枪共通']];
const ARMOR_SEX_FILTERS = [['', '全部'], [1, '男性可用'], [2, '女性可用'], [0, '男女共通']];

function armorHref(id, filters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== '') query.set(key, value);
  return '#/armor' + (id ? `/${id}` : '') + (query.size ? `?${query}` : '');
}

function armorSelect(name, label, all, options) {
  return `<label class="armor-control"><span>${label}</span><select data-armor-select="${name}"><option value="">${all}</option>${options.map(([value, text]) => `<option value="${value}">${esc(text)}</option>`).join('')}</select></label>`;
}

function armorButtons(name, label, options) {
  return `<fieldset class="armor-control"><legend>${label}</legend><div class="armor-buttons">${options.map(([value, text]) =>
    `<button type="button" data-armor-filter="${name}" data-value="${value}">${text}</button>`).join('')}</div></fieldset>`;
}

async function armorBrowserPage({ parts, params, token }) {
  const filters = Object.fromEntries(['q', 'borg', 'morf', 'part', 'slot', 'rarity', 'skill'].map((key) => [key, params[key] === 'all' ? '' : params[key] || '']));
  let selected = Number(parts[1]) || 0;
  let listRequest = 0;
  let detailRequest = 0;
  let timer;
  const openSets = new Set();
  let setsById = new Map();
  let setByPiece = new Map();

  view.innerHTML = `<div class="armor-browser">
    <header class="armor-banner"><h1>防具图鉴</h1></header>
    <div class="armor-columns">
      <aside class="armor-pane armor-filter-pane" aria-labelledby="armorFilterTitle">
        <div class="armor-heading"><h2 id="armorFilterTitle">筛选</h2><button type="button" id="armorReset">重置</button></div>
        <div class="armor-filters armor-scroll">
          <label class="armor-control"><span>名称</span><input type="search" id="armorSearch" placeholder="搜套装或单件" value="${esc(filters.q)}" autocomplete="off"></label>
          ${armorButtons('borg', '职业', ARMOR_CLASS_FILTERS)}
          ${armorButtons('morf', '性别', ARMOR_SEX_FILTERS)}
          ${armorSelect('part', '部位', '全部部位', S.meta.armorParts.map((part) => [part.id, part.name]))}
          ${armorSelect('slot', '孔位', '全部孔位', [0, 1, 2, 3].map((value) => [value, `${value} 孔`]))}
          ${armorSelect('rarity', '稀有度', '全部稀有度', Array.from({ length: 10 }, (_, i) => [i + 1, `R${i + 1}`]))}
          ${armorSelect('skill', '套装技能', '全部技能', [])}
        </div>
      </aside>
      <section class="armor-pane armor-index" aria-labelledby="armorListTitle">
        <div class="armor-heading"><h2 id="armorListTitle">套装 <span id="armorCount" role="status"></span></h2><div class="armor-actions"><button type="button" id="armorExpand">展开全部</button><button type="button" id="armorCollapse">折叠全部</button></div></div>
        <div class="armor-rows armor-scroll" id="armorSets"><p class="armor-empty">正在读取套装…</p></div>
      </section>
      <section class="armor-pane armor-details" id="armorDetails" aria-labelledby="armorDetailTitle" tabindex="-1">
        <div class="armor-heading"><h2 id="armorDetailTitle">单件详情</h2><button type="button" id="armorReturn">返回套装列表 ↑</button></div>
        <div id="armorPiece" class="armor-piece-detail armor-scroll"><p class="armor-empty">正在读取防具…</p></div>
      </section>
    </div>
  </div>`;

  const setsHost = $('#armorSets');
  const pane = $('#armorDetails');
  const pieceHost = $('#armorPiece');
  const search = $('#armorSearch');
  const filterHost = $('.armor-filters', view);
  const options = $$('[data-armor-select]', filterHost);
  const skillsSelect = $('[data-armor-select="skill"]', filterHost);
  const buttons = $$('[data-armor-filter]', filterHost);

  function syncFilters() {
    for (const element of options) element.value = filters[element.dataset.armorSelect];
    for (const button of buttons) button.setAttribute('aria-pressed', button.dataset.value === filters[button.dataset.armorFilter]);
  }

  function groupFor(id) {
    return $(`[data-armor-set="${setByPiece.get(id)}"]`, setsHost);
  }

  function renderMembers(group) {
    const members = $('.armor-members', group);
    if (!members.firstElementChild) members.innerHTML = armorMemberRows(setsById.get(group.dataset.armorSet), filters);
    $(`[data-armor-piece="${selected}"]`, members)?.setAttribute('aria-current', 'true');
  }

  async function showPiece(id, { reveal = false, scroll = false, save = false } = {}) {
    const request = ++detailRequest;
    selected = id;
    const group = groupFor(id);
    for (const element of $$('[aria-current]', setsHost)) element.removeAttribute('aria-current');
    if (group) {
      group.querySelector('summary').setAttribute('aria-current', 'true');
      if (scroll) {
        group.open = true;
        openSets.add(group.dataset.armorSet);
      }
      if (group.open) renderMembers(group);
      if (scroll) {
        const bounds = setsHost.getBoundingClientRect();
        setsHost.scrollTop += group.getBoundingClientRect().top - bounds.top - 6;
      }
    }
    if (save) history.replaceState(null, '', armorHref(id, filters));
    if (!id) {
      pieceHost.innerHTML = '<p class="armor-empty">选中一件防具后查看详情。</p>';
      return;
    }
    pieceHost.innerHTML = '<p class="armor-empty">正在读取防具…</p>';
    try {
      const detail = await api('/armor/' + id);
      if (token !== routeToken || request !== detailRequest) return;
      pieceHost.innerHTML = armorPieceDetail(detail, filters);
      pieceHost.scrollTop = 0;
      if (reveal && matchMedia('(max-width: 770px)').matches) {
        pane.scrollIntoView({ block: 'start' });
        pane.focus({ preventScroll: true });
      }
    } catch (err) {
      if (token === routeToken && request === detailRequest) pieceHost.innerHTML = `<p class="armor-empty" role="alert">${esc(err.message)}</p>`;
    }
  }

  async function loadSets({ focus = false, save = false } = {}) {
    const request = ++listRequest;
    setsHost.setAttribute('aria-busy', 'true');
    try {
      const result = await api('/armor/sets', filters);
      if (token !== routeToken || request !== listRequest) return;
      setsById = new Map(result.rows.map((set) => [String(set.id), set]));
      setByPiece = new Map(result.rows.flatMap((set) => set.pieces.map((piece) => [piece.id, set.id])));
      setsHost.innerHTML = result.rows.length ? result.rows.map((set) => armorSetRow(set, filters, openSets.has(String(set.id)))).join('')
        : '<p class="armor-empty">没有符合筛选条件的套装。</p>';
      setsHost.scrollTop = 0;
      $('#armorCount').textContent = `${num(result.total)} 组`;
      const existing = result.rows.some((set) => set.matches.includes(selected));
      const target = (existing || focus && selected) ? selected : result.rows[0]?.matches[0] || 0;
      showPiece(target, { scroll: focus && Boolean(parts[1]), save });
    } catch (err) {
      if (token === routeToken && request === listRequest) setsHost.innerHTML = `<p class="armor-empty" role="alert">${esc(err.message)}</p>`;
    } finally {
      if (request === listRequest) setsHost.removeAttribute('aria-busy');
    }
  }

  function changeFilters(changes) {
    clearTimeout(timer);
    Object.assign(filters, { q: search.value.trim() }, changes);
    syncFilters();
    loadSets({ save: true });
  }

  filterHost.addEventListener('click', (event) => {
    const button = event.target.closest('[data-armor-filter]');
    if (button && button.dataset.value !== filters[button.dataset.armorFilter]) changeFilters({ [button.dataset.armorFilter]: button.dataset.value });
  });
  filterHost.addEventListener('change', (event) => {
    const key = event.target.dataset.armorSelect;
    if (key) changeFilters({ [key]: event.target.value });
  });
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (token === routeToken) changeFilters({}); }, 160);
  });
  $('#armorReset').addEventListener('click', () => {
    search.value = '';
    openSets.clear();
    changeFilters(Object.fromEntries(Object.keys(filters).map((key) => [key, ''])));
  });
  setsHost.addEventListener('toggle', (event) => {
    const group = event.target;
    if (!group.dataset.armorSet || !setsHost.contains(group)) return;
    if (group.open) {
      openSets.add(group.dataset.armorSet);
      renderMembers(group);
    } else openSets.delete(group.dataset.armorSet);
  }, true);
  $('#armorExpand').addEventListener('click', () => $$('details', setsHost).forEach((group) => { group.open = true; }));
  $('#armorCollapse').addEventListener('click', () => $$('details', setsHost).forEach((group) => { group.open = false; }));
  for (const host of [setsHost, pieceHost]) {
    host.addEventListener('click', (event) => {
      const link = event.target.closest('[data-armor-piece]');
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const id = Number(link.dataset.armorPiece);
      if (!groupFor(id)) return;
      event.preventDefault();
      showPiece(id, { reveal: host === setsHost, scroll: host === pieceHost, save: true });
    });
  }
  $('#armorReturn').addEventListener('click', () => {
    $('.armor-index', view).scrollIntoView({ block: 'start' });
    groupFor(selected)?.querySelector('summary').focus({ preventScroll: true });
  });

  syncFilters();
  await Promise.all([
    loadSets({ focus: Boolean(selected) }),
    api('/set/skills').then(({ rows }) => {
      if (token !== routeToken) return;
      skillsSelect.insertAdjacentHTML('beforeend', rows.sort((a, b) => a.name.localeCompare(b.name)).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join(''));
      skillsSelect.value = filters.skill;
    }).catch(() => { if (token === routeToken) skillsSelect.disabled = true; }),
  ]);
}

function armorPointList(skills, links = false) {
  if (!skills.length) return '<span class="armor-muted">无技能点</span>';
  return `<span class="armor-points">${skills.map((s) => {
    const name = `${esc(s.name)} <b>${s.pt > 0 ? '+' : ''}${s.pt}</b>`;
    const cls = `armor-point${s.pt < 0 ? ' armor-negative' : ''}`;
    return links ? `<a class="${cls}" href="#/skills/${s.treeId}">${name}</a>` : `<span class="${cls}">${name}</span>`;
  }).join('')}</span>`;
}

function armorSetRow(set, filters, open) {
  const name = set.pieces.length === 1 ? set.name : `${set.name}套装`;
  const sex = set.morf || Number(filters.morf);
  return `<details class="armor-set" data-armor-set="${set.id}" ${open ? 'open' : ''}>
    <summary>
      <span class="armor-chevron" aria-hidden="true">›</span>${ic(`${set.img}_${sex === 2 ? 'F' : 'M'}`, 'armor-thumb')}
      <span class="armor-set-summary"><span class="armor-set-title"><b>${esc(name)}</b>${rarity(set.rare)}</span>
        <span class="armor-set-meta">${esc(borgName(set.borg))} · ${set.morf ? esc(morfName(set.morf)) : '男女共通'} · ${set.pieces.length} 件${set.matches.length < set.pieces.length ? ` · 匹配 ${set.matches.length} 件` : ''}</span>
        <span class="armor-total"><span class="armor-total-label">${set.pieces.length > 1 ? '总技能点' : '技能点'}</span>${armorPointList(set.skills)}</span>
      </span>
    </summary>
    <div class="armor-members"></div>
  </details>`;
}

function armorMemberRows(set, filters) {
  return set.pieces.map((piece) => `<a href="${esc(armorHref(piece.id, filters))}" data-armor-piece="${piece.id}" ${set.matches.includes(piece.id) ? '' : 'class="armor-member-other"'}>
    <span>${esc(armorPartName(piece.part))}</span><b>${esc(piece.name)}</b><small>防御 ${num(piece.def)} · ${piece.slot} 孔</small>
  </a>`).join('');
}

function armorPieceDetail(detail, filters) {
  const a = detail.data;
  const sex = a.MorF || Number(filters.morf);
  const stats = [['防御', a.Def], ['最大防御', a.MaxDef], ['孔位', a.Slot], ['价格', `${num(a.Price)} z`]];
  return `<header class="armor-hero">
    <div class="armor-art">${ic(`${a.Amr_ImgFile}_${sex === 2 ? 'F' : 'M'}`, 'armor-art-img')}<small>系列立绘</small></div>
    <div><h3>${esc(a.name)}</h3><div class="armor-piece-tags">${rarity(a.Rare)} ${esc(armorPartName(a.Part))} · ${esc(borgName(a.BorG))} · ${a.MorF ? esc(morfName(a.MorF)) : '男女共通'}</div>
    <dl class="armor-stats">${stats.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl></div>
  </header>
  <section class="armor-block"><h3>属性耐性</h3><div class="armor-block-body">${resGrid({ fir: a.Res_Fire, wtr: a.Res_Water, thd: a.Res_Thunder, ice: a.Res_Ice, drg: a.Res_Dragon })}</div></section>
  <section class="armor-block"><h3>单件技能点</h3><div class="armor-block-body">${armorPointList(detail.skills, true)}</div></section>
  <section class="armor-block"><h3>生产素材</h3>${detail.materials.length ? `<ul class="armor-mats">${detail.materials.map((m) => `<li><a href="#/items/${m.id}">${itemIcon(m.id)}<span>${esc(m.name)}</span><b>×${num(m.qty)}</b></a></li>`).join('')}</ul>` : '<p class="armor-block-body armor-muted">没有记录生产素材。</p>'}</section>
  ${detail.family.length > 1 ? `<section class="armor-block"><h3>同系列防具</h3><ul class="armor-mats">${detail.family.map((f) => `<li><a href="${esc(armorHref(f.id, filters))}" data-armor-piece="${f.id}" ${f.id === a.Amr_ID ? 'aria-current="true"' : ''}><span>${esc(f.name)}</span><small>${esc(armorPartName(f.part))}</small></a></li>`).join('')}</ul></section>` : ''}`;
}
