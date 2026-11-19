'use strict';

const FORGE_MODES = [
  ['tree', '派生图'], ['production', '生产列表'], ['upgrade', '强化列表'], ['all', '全部武器'],
];
const FORGE_ROW = 42;
const FORGE_STEP = 51;

function forgeHref({ type, mode, weapon, q, rarity, page }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ type, mode: mode === 'tree' ? '' : mode, weapon, q, rarity, page: page > 1 ? page : '' })) {
    if (value) query.set(key, value);
  }
  return '#/weapons' + (query.size ? '?' + query : '');
}

async function weaponForgePage({ params, token }) {
  const types = S.meta.weaponTypes;
  const type = (types.find((entry) => entry.id === Number(params.type)) || types[0]).id;
  const mode = FORGE_MODES.find(([id]) => id === params.mode)?.[0] || (params.rarity || params.page ? 'all' : 'tree');
  const isTree = mode === 'tree';
  const state = { type, mode, weapon: Number(params.weapon), q: params.q || '', rarity: isTree ? '' : params.rarity || '', page: isTree ? 1 : Number(params.page) || 1 };

  view.innerHTML = `<div class="weapon-forge">
    <header class="forge-banner">
      <h1>武器图鉴</h1>
      <nav class="forge-modes" aria-label="武器浏览方式">
        ${FORGE_MODES.map(([id, label]) => `<a data-forge-mode="${id}" ${id === mode ? 'aria-current="page"' : ''} href="${esc(forgeHref({ ...state, mode: id, page: 1, rarity: '' }))}">${label}</a>`).join('')}
      </nav>
    </header>
    <nav class="forge-types" aria-label="武器种类">
      ${types.map((entry) => `<a href="${forgeHref({ type: entry.id, mode })}" ${entry.id === type ? 'aria-current="page"' : ''}>${ic(entry.icon)}${esc(entry.name)}</a>`).join('')}
    </nav>
    <div class="forge-grid">
      <section class="forge-panel forge-map" aria-labelledby="forgeMapTitle">
        <div class="forge-heading"><h2 id="forgeMapTitle">${esc(weaponTypeName(type))} · ${FORGE_MODES.find(([id]) => id === mode)[1]}</h2></div>
        <div class="forge-filters">
          <input id="forgeSearch" type="search" aria-label="搜索武器" placeholder="搜索武器名称" value="${esc(state.q)}" autocomplete="off">
          ${isTree ? '<select id="forgeJump" aria-label="定位派生路线"><option value="">跳转路线</option></select>' : `
            <select id="forgeRarity" aria-label="稀有度"><option value="">全部稀有度</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">R${i + 1}</option>`).join('')}</select>`}
        </div>
        <div class="forge-browser" id="forgeBrowser"><p class="forge-message" role="status">加载中…</p></div>
        <div class="forge-footer">
          <span id="forgeCount" role="status"></span>
          ${isTree ? '<a class="forge-text-link" href="#/weapons/tree?type=' + type + '&amp;view=list">文字树</a>' : '<div class="forge-pager"><button type="button" id="forgePrev" disabled>上一页</button><span id="forgePage"></span><button type="button" id="forgeNext" disabled>下一页</button></div>'}
          <button type="button" id="forgeReveal" hidden>查看所选 ↓</button>
        </div>
      </section>
      <section class="forge-panel forge-preview" aria-labelledby="forgePreviewTitle">
        <div class="forge-heading"><h2 id="forgePreviewTitle">武器与素材</h2></div>
        <div id="forgePreview" class="forge-content"></div>
      </section>
      <section class="forge-panel forge-attributes" aria-labelledby="forgeStatsTitle">
        <div class="forge-heading"><h2 id="forgeStatsTitle">武器属性</h2></div>
        <div id="forgeStats" class="forge-content"></div>
      </section>
    </div>
  </div>`;

  const browser = $('#forgeBrowser');
  const preview = $('#forgePreview');
  const stats = $('#forgeStats');
  const search = $('#forgeSearch');
  const count = $('#forgeCount');
  const reveal = $('#forgeReveal');
  const modeLinks = $$('[data-forge-mode]', view);
  const typeRail = $('.forge-types', view);
  const typeLink = $('[aria-current]', typeRail);
  typeRail.scrollLeft += Math.max(0, typeLink.getBoundingClientRect().right - typeRail.getBoundingClientRect().right + 6);
  const nodes = new Map();
  let detailRequest = 0;
  let selectedLink = null;
  let marked = [];

  function syncLinks(save) {
    if (save) history.replaceState(null, '', forgeHref(state));
    for (const link of modeLinks) {
      const target = link.dataset.forgeMode;
      link.href = forgeHref({ ...state, mode: target, page: target === mode ? state.page : 1, rarity: target === 'tree' ? '' : state.rarity });
    }
  }

  function scrollToEntry(link) {
    const rect = link.getBoundingClientRect();
    const bounds = browser.getBoundingClientRect();
    const top = bounds.top + (isTree ? 32 : 0);
    if (rect.top < top || rect.bottom > bounds.bottom - 12) browser.scrollTop += rect.top - top - 10;
    const left = bounds.left + (isTree ? $('.forge-track-label', browser).offsetWidth : 0);
    if (rect.left < left || rect.right > bounds.right - 12) browser.scrollLeft += rect.left - left - 10;
  }

  async function selectWeapon(link, { scroll = false, save = false } = {}) {
    if (scroll && link) scrollToEntry(link);
    if (link === selectedLink && link) {
      syncLinks(save);
      return;
    }
    const request = ++detailRequest;
    selectedLink?.removeAttribute('aria-current');
    for (const mark of marked) mark.classList.remove('forge-path');
    marked = [];
    selectedLink = link;
    state.weapon = link ? Number(link.dataset.weaponId) : 0;
    reveal.hidden = !link;
    syncLinks(save);
    if (!link) {
      preview.innerHTML = '<p class="forge-message">选中一把武器后查看素材。</p>';
      stats.innerHTML = '<p class="forge-message">选中一把武器后查看属性。</p>';
      return;
    }

    link.setAttribute('aria-current', 'true');
    const node = nodes.get(state.weapon);
    if (node) {
      marked.push(node.label);
      for (let step = node; step.parent; step = step.parent) marked.push(step.edge, step.parent.link);
      for (const mark of marked) mark.classList.add('forge-path');
    }
    preview.innerHTML = '<p class="forge-message" role="status">加载中…</p>';
    stats.innerHTML = '';
    preview.scrollTop = 0;
    stats.scrollTop = 0;
    try {
      const detail = await api('/weapons/' + state.weapon);
      if (token !== routeToken || request !== detailRequest) return;
      preview.innerHTML = forgePreview(detail, mode);
      stats.innerHTML = forgeStats(detail.data);
    } catch (err) {
      if (token === routeToken && request === detailRequest) {
        preview.innerHTML = `<p class="forge-message" role="alert">武器详情加载失败：${esc(err.message)}</p>`;
        selectedLink = null;
        link.removeAttribute('aria-current');
      }
    }
  }

  browser.addEventListener('click', (event) => {
    const link = event.target.closest('[data-weapon-id]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectWeapon(link, { scroll: isTree, save: true });
  });
  reveal.addEventListener('click', () => $('#forgePreviewTitle').scrollIntoView({ block: 'start' }));

  if (isTree) {
    const data = await api('/weapons/tree', { type });
    if (token !== routeToken) return;
    const { branches, tracks } = forgeTree(browser, data.roots, nodes, type);
    const jump = $('#forgeJump');
    jump.insertAdjacentHTML('beforeend', branches.map((branch) => `<option value="${branch.id}">${esc(branch.name)}</option>`).join(''));
    jump.addEventListener('change', () => {
      if (!jump.value) { browser.scrollTop = 0; return; }
      const node = nodes.get(Number(jump.value));
      if (node.branch.element.hidden) {
        search.value = '';
        filterTree(false);
      }
      selectWeapon(node.link, { scroll: true, save: true });
    });

    function filterTree(save) {
      state.q = search.value.trim();
      const query = state.q.toLowerCase();
      let first = null;
      let hits = 0;
      for (const branch of branches) {
        const matches = branch.nodes.filter((node) => node.name.toLowerCase().includes(query));
        branch.element.hidden = matches.length === 0;
        hits += matches.length;
        first ||= matches[0]?.link;
        for (const node of branch.nodes) {
          const match = node.name.toLowerCase().includes(query);
          node.link.classList.toggle('forge-match', Boolean(query) && match);
          node.link.classList.toggle('forge-muted', !match);
        }
      }
      $('#forgeEmpty').hidden = hits > 0;
      count.textContent = query ? `匹配 ${num(hits)} 把武器` : `${num(branches.length)} 条路线 · ${num(data.total)} 把武器`;
      const current = nodes.get(state.weapon);
      const link = current && !current.branch.element.hidden && !current.link.classList.contains('forge-muted') ? current.link : first;
      selectWeapon(link, { scroll: Boolean(query || current), save });
    }

    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (token === routeToken) filterTree(true); }, 150);
    });

    browser.addEventListener('keydown', (event) => {
      const link = event.target.closest('[data-weapon-id]');
      if (!link || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const node = nodes.get(Number(link.dataset.weaponId));
      let next;
      if (event.key === 'ArrowLeft') next = node.parent;
      if (event.key === 'ArrowRight') next = nodes.get(node.children[0]?.id);
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        for (let row = node.track + direction; row >= 0 && row < tracks.length; row += direction) {
          const entries = tracks[row].filter((candidate) => !candidate.branch.element.hidden);
          if (!entries.length) continue;
          next = entries.reduce((closest, candidate) => Math.abs(candidate.depth - node.depth) < Math.abs(closest.depth - node.depth) ? candidate : closest);
          break;
        }
      }
      event.preventDefault();
      if (next) {
        next.link.focus({ preventScroll: true });
        selectWeapon(next.link, { scroll: true, save: true });
      }
    });
    filterTree(false);
    return;
  }

  const rarityFilter = $('#forgeRarity');
  rarityFilter.value = state.rarity;
  const prev = $('#forgePrev');
  const next = $('#forgeNext');
  let listRequest = 0;
  async function loadList(save) {
    const request = ++listRequest;
    prev.disabled = true;
    next.disabled = true;
    try {
      const data = await api('/weapons', { type, q: state.q, rarity: state.rarity, page: state.page, size: 30, recipe: mode });
      if (token !== routeToken || request !== listRequest) return;
      browser.innerHTML = data.rows.length ? `<div class="forge-list">${data.rows.map((row) => forgeListRow(row, mode)).join('')}</div>`
        : '<p class="forge-message">没有符合条件的武器。</p>';
      browser.scrollTop = 0;
      count.textContent = `共 ${num(data.total)} 把`;
      $('#forgePage').textContent = `${data.page} / ${data.pages}`;
      prev.disabled = data.page <= 1;
      next.disabled = data.page >= data.pages;
      const existing = $(`[data-weapon-id="${state.weapon}"]`, browser);
      selectWeapon(existing || $('[data-weapon-id]', browser), { scroll: Boolean(existing), save });
    } catch (err) {
      if (token === routeToken && request === listRequest) {
        browser.innerHTML = `<p class="forge-message" role="alert">列表加载失败：${esc(err.message)}</p>`;
        selectWeapon(null);
      }
    }
  }
  let timer;
  function filterList() {
    clearTimeout(timer);
    state.q = search.value.trim();
    state.rarity = rarityFilter.value;
    state.page = 1;
    loadList(true);
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (token === routeToken) filterList(); }, 150);
  });
  rarityFilter.addEventListener('change', filterList);
  prev.addEventListener('click', () => { state.page--; loadList(true); });
  next.addEventListener('click', () => { state.page++; loadList(true); });
  await loadList(false);
}

function forgeTree(browser, roots, nodes, type) {
  const tracks = [];
  let columns = 1;
  const branches = roots.map((root) => {
    const branch = { id: root.id, name: forgeBranchName(root.name), nodes: [], rows: [] };
    function place(entry, parent, row) {
      const depth = parent ? parent.depth + 1 : 0;
      const node = { ...entry, depth, parent, branch, row: row.index, track: row.track };
      row.nodes.push(node);
      branch.nodes.push(node);
      nodes.set(node.id, node);
      columns = Math.max(columns, depth + 1);
      for (const [index, child] of entry.children.entries()) place(child, node, index ? addRow(child) : row);
    }
    function addRow(entry) {
      const row = { entry, index: branch.rows.length, track: tracks.length, nodes: [] };
      tracks.push(row.nodes);
      branch.rows.push(row);
      return row;
    }
    place(root, null, addRow(root));
    return branch;
  });

  const width = columns * FORGE_STEP;
  const colors = [null, ELEM_COLORS.fire, ELEM_COLORS.water, ELEM_COLORS.thunder, ELEM_COLORS.ice, ELEM_COLORS.dragon, '#bd8bdf', '#e1b74e', '#85bdcd', '#e28865'];
  browser.innerHTML = `<div class="forge-chart" style="--track-width:${width}px;--forge-row:${FORGE_ROW}px;--forge-step:${FORGE_STEP}px">
    <div class="forge-scale"><span class="forge-track-label">派生路线</span><div class="forge-scale-steps" aria-label="派生阶段">
      ${Array.from({ length: columns }, (_, i) => `<span title="第 ${i + 1} 阶段">${i + 1}</span>`).join('')}
    </div></div>
    ${branches.map((branch) => `<div class="forge-branch" data-root="${branch.id}">
      <div class="forge-labels">
        ${branch.rows.map((row) => `<div class="forge-track-label" title="${esc(forgeBranchName(row.entry.name))}"><span aria-hidden="true">${row.index ? '└' : '◆'}</span><span>${esc(forgeBranchName(row.entry.name))}</span></div>`).join('')}
      </div>
      <div class="forge-track" style="height:${branch.rows.length * FORGE_ROW}px">
        <svg class="forge-edges" aria-hidden="true" width="${width}" height="${branch.rows.length * FORGE_ROW}">
          ${branch.nodes.filter((node) => node.parent).map((node) => {
            const x1 = (node.parent.depth + 0.5) * FORGE_STEP;
            const x2 = (node.depth + 0.5) * FORGE_STEP;
            const y1 = (node.parent.row + 0.5) * FORGE_ROW;
            const y2 = (node.row + 0.5) * FORGE_ROW;
            return `<path data-to="${node.id}" d="M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}"/>`;
          }).join('')}
        </svg>
        ${branch.nodes.map((node) => `<a class="forge-node" href="#/weapons/${node.id}" data-weapon-id="${node.id}" aria-label="${esc(node.name)}" title="${esc(node.name)} · 攻击 ${node.atk}"
          style="left:${(node.depth + 0.5) * FORGE_STEP}px;top:${(node.row + 0.5) * FORGE_ROW}px;--forge-rarity:${RARITY[node.rare] || RARITY[0]}">
          ${typeIcon(type)}${colors[node.el1] ? `<i style="background:${colors[node.el1]}" aria-hidden="true"></i>` : ''}
        </a>`).join('')}
      </div>
    </div>`).join('')}
  </div><p class="forge-message" id="forgeEmpty" role="status" hidden>找不到匹配的武器。</p>`;

  for (const branch of branches) {
    branch.element = $(`[data-root="${branch.id}"]`, browser);
    const labels = $$('.forge-track-label', branch.element);
    for (const link of $$('[data-weapon-id]', branch.element)) {
      const node = nodes.get(Number(link.dataset.weaponId));
      node.link = link;
      node.label = labels[node.row];
    }
    for (const edge of $$('[data-to]', branch.element)) nodes.get(Number(edge.dataset.to)).edge = edge;
  }
  return { branches, tracks };
}

function forgeBranchName(name) {
  return name.replace(/\s*[-–]?\s*Lv\.?\s*\d+\s*$/i, '');
}

function forgeListRow(row, mode) {
  const price = mode === 'production' ? row.productionPrice : row.upgradePrice;
  return `<a class="forge-list-row" href="#/weapons/${row.id}" data-weapon-id="${row.id}">
    <span class="forge-list-icon">${typeIcon(row.type)}</span><span class="forge-list-name"><b>${esc(row.name)}</b><small>攻击 ${num(row.atk)}${row.el1 > 0 ? ` · ${esc(row.el1name)} ${row.el1pt}` : ''}</small></span>
    ${mode === 'all' ? '' : `<span class="forge-price">${num(price)} z</span>`}${rarity(row.rare)}
  </a>`;
}

function forgePreview(detail, mode) {
  const w = detail.data;
  const fallback = `Wpn_${String(w.Wpn_Type_ID).padStart(2, '0')}01`;
  const art = w.ImgFile || fallback;
  const groups = mode === 'production' ? [['P', '生产', w.ProPx]] : mode === 'upgrade' ? [['U', '强化', w.LvUpPx]] : [
    ['P', '生产', w.ProPx], ['U', '强化', w.LvUpPx],
  ];
  const recipes = groups.filter(([kind, , price]) => price > 0 || detail.materials.some((item) => item.kind === kind));
  return `<h3 class="forge-weapon-name">${esc(w.name)}</h3>
    <div class="forge-art${art === fallback ? ' forge-art-fallback' : ''}">
      <img src="/icons/${encodeURIComponent(art)}" alt="${esc(w.name)}" onerror="this.onerror=null;this.src='/icons/${fallback}';this.parentElement.classList.add('forge-art-fallback')">
    </div>
    ${recipes.map(([kind, label, price]) => {
      const items = detail.materials.filter((item) => item.kind === kind);
      return `<div class="forge-recipe"><h4>${label}素材</h4>
        ${items.length ? `<ul>${items.map((item) => `<li><a href="#/items/${item.id}">${itemIcon(item.id)}<span>${esc(item.name)}</span><b>×${num(item.qty)}</b></a></li>`).join('')}</ul>` : '<p class="forge-no-material">没有登记素材</p>'}
        ${price > 0 ? `<div class="forge-cost"><span>${label}费用</span><b>${num(price)} z</b></div>` : ''}
      </div>`;
    }).join('') || '<p class="forge-no-material">没有登记生产或强化配方。</p>'}
    ${mode === 'upgrade' && detail.tree?.parent ? `<a class="forge-source" href="${forgeHref({ type: w.Wpn_Type_ID, weapon: detail.tree.parent.id })}">派生自 ${esc(detail.tree.parent.name)} ↗</a>` : ''}
    <a class="forge-detail-link" href="#/weapons/${w.Wpn_ID}">完整武器详情 <span aria-hidden="true">↗</span></a>`;
}

function forgeStats(w) {
  const elements = [elementChip(w.el1name, w.SpAtk1_Pt), elementChip(w.el2name, w.SpAtk2_Pt)].filter(Boolean).join(' ');
  const row = (name, value, cls = '') => `<div class="forge-stat ${cls}"><dt>${name}</dt><dd>${value}</dd></div>`;
  return `<dl class="forge-stat-sheet">
    ${row('稀有度', `<b style="color:${RARITY[w.Rare] || RARITY[0]}">RARE ${w.Rare}</b>`)}
    ${row('攻击力', `<strong>${num(w.Atk)}</strong>`, 'forge-attack')}
    ${row('会心率', `${w.Affinity || 0}%`)}
    ${row('防御加成', `${w.Def > 0 ? '+' : ''}${num(w.Def)}`)}
    ${row('属性', elements || '无')}
    ${row('孔位', `<span class="forge-slots" aria-label="${w.Slot || 0} 个孔位">${'●'.repeat(w.Slot || 0)}${'○'.repeat(3 - (w.Slot || 0))}</span>`)}
    ${w.sharpness.length ? row('锋利度', sharpnessBars(w), 'forge-sharpness') : ''}
    ${weaponSpecificStats(w).map(([name, value]) => row(name, esc(value))).join('')}
  </dl>`;
}
