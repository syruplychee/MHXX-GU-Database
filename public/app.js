'use strict';

/* ============================================================ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const view = $('#view');

const esc = (s) =>
  String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));
const affinityPercent = (value) => `${Math.round((value ?? 0) * 100)}%`;
const pct = (n) => {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return esc(n);
  return v <= 1 ? (v * 100).toFixed(v * 100 < 10 ? 1 : 0) + '%' : v + '%';
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const RARITY = ['#8a8f98', '#a9b2bf', '#79b06a', '#4f9dd9', '#a97fd4', '#d98a4f', '#d9584f', '#e0b34f', '#7fd9d9', '#d97fc2', '#f0d68a'];
const rarity = (r) => `<span class="rarity" style="background:${RARITY[r] || RARITY[0]}">${r ?? '—'}</span>`;

const ic = (name, cls = 'img16') =>
  `<img class="${cls}" src="/icons/${encodeURIComponent(name)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">`;
const itemIcon = (id) => ic('Itm_' + String(id).padStart(4, '0'));
const monIcon = (id) => ic('Mon_S_' + String(id).padStart(3, '0'));
const monBig = (id) => ic('Mon_B_' + String(id).padStart(3, '0'), 'img-art pixel');
const typeIcon = (t) => ic('Wpn_' + String(t).padStart(2, '0') + '01');
const armorIcon = (img, morf) => ic(img + (morf === 2 ? '_F' : '_M'), 'img16');

const weaponTypeName = (id) => {
  const t = (S.meta && S.meta.weaponTypes || []).find((x) => x.id === id);
  return t ? t.name : '—';
};
const armorPartName = (id) => {
  const p = (S.meta && S.meta.armorParts || []).find((x) => x.id === id);
  return p ? p.name : '—';
};
const borgName = (v) => (v === 1 ? '剑士' : v === 2 ? '枪手' : '共通');
const morfName = (v) => (v === 1 ? '男性' : v === 2 ? '女性' : '共通');

const ELEM_COLORS = {
  fire: '#e0715a', water: '#5aa8e0', thunder: '#e0c94f', ice: '#7fd0e0', dragon: '#b07fe0',
};
const elementChip = (name, pt) => {
  if (!name || name === '---' || pt === undefined || pt === null || pt < 0) return '';
  const color = /火|Fire/i.test(name) ? ELEM_COLORS.fire : /水|Wat/i.test(name) ? ELEM_COLORS.water
    : /雷|Thun/i.test(name) ? ELEM_COLORS.thunder : /冰|Ice/i.test(name) ? ELEM_COLORS.ice
    : /龙|Dra/i.test(name) ? ELEM_COLORS.dragon : '#9aa3af';
  return `<span class="chip" style="color:${color};border-color:${color}55;background:${color}14">${esc(name)} ${pt}</span>`;
};

const tag = (text, cls = '') => `<span class="tag ${cls}">${esc(text)}</span>`;
const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
const skillChips = (list) =>
  list && list.length
    ? `<div class="skills-inline">${list.slice(0, 4).map((s) => `<span class="chip ${s.pt < 0 ? 'red' : 'gold'}">${esc(s.name)} ${s.pt > 0 ? '+' : ''}${s.pt}</span>`).join('')}${list.length > 4 ? `<span class="chip">+${list.length - 4}</span>` : ''}</div>`
    : '<span class="dim">—</span>';

const iconForQuest = (n) => ic('QstIcon_' + (n || 1), 'img24');
const noteIcon = (n) => (n && n > 0 && n <= 8 ? ic('HHNote_' + n, 'img16') : '');

/* ============================================================ state */

const S = {
  lang: Number(localStorage.getItem('mhxx-lang') ?? 1),
  meta: null,
  set: JSON.parse(localStorage.getItem('mhxx-set') || 'null') || {
    borg: 1,
    morf: 1,
    parts: { head: {}, body: {}, arms: {}, waist: {}, legs: {} },
    talisman: { skills: [] },
  },
  cache: { armor: new Map(), jewels: null, skills: null },
};

async function api(path, params = {}) {
  const q = new URLSearchParams({ lang: S.lang });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const res = await fetch('/api' + path + '?' + q.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function apiPost(path, body) {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, lang: S.lang }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/* ============================================================ routing */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { parts: pathPart.split('/').filter(Boolean), params };
}

function setParams(patch) {
  const { parts, params } = parseHash();
  const next = { ...params, ...patch };
  for (const k of Object.keys(next)) if (next[k] === '' || next[k] === null || next[k] === undefined) delete next[k];
  const q = new URLSearchParams(next).toString();
  const base = '#/' + parts.join('/');
  location.hash = q ? base + '?' + q : base;
}

function setRoute(path, params = {}) {
  const q = new URLSearchParams(params).toString();
  location.hash = '#/' + path + (q ? '?' + q : '');
}

function navActive(parts) {
  let active = 'home';
  if (parts[0] === 'palico') active = `palico-${parts[1] || 'team'}`;
  else if (parts[0]) active = parts[0];
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === active));
}

let routeToken = 0;

async function route() {
  const token = ++routeToken;
  const { parts, params } = parseHash();
  if ($('#skillPreview').open) $('#skillPreview').close();
  navActive(parts);
  $('#sidebar').classList.remove('open');
  window.scrollTo({ top: 0 });
  const go = (fn) => {
    const p = (async () => {
      try {
        return await fn({ parts, params, token });
      } catch (err) {
        if (token === routeToken) view.innerHTML = `<div class="error">加载失败：${esc(err.message)}</div>`;
      }
    })();
    return p;
  };

  try {
    if (!parts.length) return go(homePage);
    switch (parts[0]) {
      case 'items': return parts[1] ? go((c) => itemPage(c, +parts[1])) : go(itemsPage);
      case 'weapons':
        if (parts[1] === 'tree' && params.view === 'list') return go(weaponsTreeListPage);
        if (!parts[1] || parts[1] === 'tree') return go(weaponForgePage);
        return go((c) => weaponPage(c, +parts[1]));
      case 'armor': return go(armorBrowserPage);
      case 'skills': return parts[1] ? go((c) => skillPage(c, +parts[1])) : go(skillsPage);
      case 'jewels': return parts[1] ? go((c) => jewelPage(c, +parts[1])) : go(jewelsPage);
      case 'quests': return go(questBrowserPage);
      case 'monsters': return go(monsterBrowserPage);
      case 'combos': return go(combosPage);
      case 'horns': return go(hornsPage);
      case 'kinsects': return go(kinsectsPage);
      case 'palico':
        if (parts[1] === 'weapons' || parts[1] === 'armor') return go(palicoGearPage);
        return go(teamGuidePage);
      case 'arena': return parts[1] ? go((c) => arenaPage(c, +parts[1])) : go(arenaListPage);
      case 'locations': return go(locationGuidePage);
      case 'awards': return go(awardsPage);
      case 'hfh': return go(hfhPage);
      case 'set': return go(setPage);
      default: return go(homePage);
    }
  } catch (err) {
    if (token !== routeToken) return;
    view.innerHTML = `<div class="error">加载失败：${esc(err.message)}</div>`;
  }
}

/* ============================================================ shell */

function initShell() {
  const sel = $('#langSelect');
  sel.innerHTML = (S.meta.langs || []).map((l) => `<option value="${l.id}" ${l.id === S.lang ? 'selected' : ''}>${esc(l.label)}</option>`).join('');
  sel.addEventListener('change', () => {
    S.lang = Number(sel.value);
    localStorage.setItem('mhxx-lang', S.lang);
    S.cache.armor.clear();
    S.cache.jewels = null;
    S.cache.skills = null;
    api('/meta')
      .then((m) => {
        S.meta = m;
        route();
      })
      .catch(() => route());
  });

  const counts = S.meta.counts;
  $('#topCounts').innerHTML = `道具 ${num(counts.items)} · 武器 ${num(counts.weapons)} · 防具 ${num(counts.armor)} · 任务 ${num(counts.quests)}`;

  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  const input = $('#search');
  const panel = $('#searchPanel');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { panel.hidden = true; panel.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const data = await api('/search', { q });
        if (!data.groups.length) { panel.innerHTML = `<div class="empty">没有匹配项</div>`; panel.hidden = false; return; }
        panel.innerHTML = data.groups.map((g) => `
          <div class="search-group">
            <h4>${esc(g.label)}</h4>
            ${g.rows.map((r) => `<div class="search-item" data-href="${searchHref(g.type, r.id)}">
              <span class="s-name">${esc(r.name)}</span>
              <span class="s-tag">${searchTag(g.type, r)}</span>
            </div>`).join('')}
          </div>`).join('');
        panel.hidden = false;
      } catch { panel.hidden = true; }
    }, 180);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) panel.hidden = true;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = panel.querySelector('.search-item');
      if (first) location.hash = first.dataset.href;
      panel.hidden = true;
    }
  });

  // global click delegation for rows / search items
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-href]');
    if (!el) return;
    if (e.target.closest('a')) return;
    const panel = $('#searchPanel');
    if (panel) panel.hidden = true;
    location.hash = el.dataset.href;
  });

  // filters + pager delegation
  view.addEventListener('change', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f) return;
    setParams({ [f.dataset.filter]: f.value, page: null });
  });
  view.addEventListener('input', (e) => {
    const f = e.target.closest('[data-live-filter]');
    if (!f) return;
    clearTimeout(f._t);
    f._t = setTimeout(() => setParams({ [f.dataset.liveFilter]: f.value, page: null }), 320);
  });
  view.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (!pg) return;
    setParams({ page: pg.dataset.page });
  });
}

function searchHref(type, id) {
  const map = { items: 'items', weapons: 'weapons', armor: 'armor', monsters: 'monsters', quests: 'quests', skills: 'skills' };
  return `#/${map[type] || type}/${id}`;
}
function searchTag(type, r) {
  if (type === 'weapons') return weaponTypeName(r.type);
  if (type === 'armor') return armorPartName(r.part);
  if (type === 'quests') return '任务';
  if (type === 'monsters') return '怪物';
  return '';
}

/* ============================================================ home */

async function homePage({ token }) {
  const c = S.meta.counts;
  const monsters = await api('/monsters', { size: 12 });
  if (token !== routeToken) return;
  view.innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <div class="eyebrow">Monster Hunter XX · Database</div>
        <h1>MHXX <em>Dex</em></h1>
        <p>从《MHXX Dex》桌面程序反编译并解密数据库重建的网页资料库：道具、武器、防具、技能、怪物、任务、配装模拟，全部来自原始游戏数据。</p>
        <div class="hero-tags">
          ${chip(`道具 ${num(c.items)}`, 'gold')} ${chip(`武器 ${num(c.weapons)}`, 'gold')} ${chip(`防具 ${num(c.armor)}`, 'gold')}
          ${chip(`任务 ${num(c.quests)}`)} ${chip(`怪物 ${num(c.monsters)}`)} ${chip(`技能 ${num(c.skills)}`)}
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="#/set">开始配装</a>
          <a class="btn" href="#/weapons">浏览武器</a>
          <a class="btn ghost" href="#/monsters">怪物图鉴</a>
        </div>
      </div>
      <div class="hero-side">
        <div class="tile"><b>${num(c.weapons)}</b><span>把武器</span></div>
        <div class="tile"><b>${num(c.armor)}</b><span>件防具</span></div>
        <div class="tile"><b>${num(c.items)}</b><span>种道具</span></div>
        <div class="tile"><b>${num(c.quests)}</b><span>个任务</span></div>
      </div>
    </section>

    <div class="section-title"><h2>图鉴入口</h2><span class="rule"></span></div>
    <div class="cards">
      ${[
        ['#/items', '❖', '道具', '素材 / 消耗品 / 掉落'],
        ['#/weapons', '⚔', '武器', '14 种武器与派生'],
        ['#/armor', '⛨', '防具', '头 / 胸 / 腕 / 腰 / 脚'],
        ['#/skills', '✦', '技能', '技能树与等级'],
        ['#/jewels', '◉', '装饰品', '珠子与镶嵌'],
        ['#/monsters', '☠', '怪物', '弱点 / 素材 / 任务'],
        ['#/quests', '⚑', '任务', '报酬与目标'],
        ['#/combos', '⇄', '调和', '配方与成功率'],
        ['#/locations', '▦', '地图与交换', '区域采集与山菜爷'],
        ['#/arena', '⚖', '斗技大会', '限定装备'],
      ].map(([href, ico, name, desc]) => `<a class="card" href="${href}"><span class="c-ico">${ico}</span><span><b>${name}</b><small>${desc}</small></span></a>`).join('')}
    </div>

    <div class="section-title"><h2>怪物速览</h2><span class="rule"></span><a class="btn sm ghost" href="#/monsters">全部 →</a></div>
    <div class="monster-grid">
      ${monsters.rows.map((m) => `<a class="monster-card" href="#/monsters/${m.id}">${monIcon(m.id)}<span>${esc(m.name)}</span></a>`).join('')}
    </div>

    <div class="section-title"><h2>武器类型</h2><span class="rule"></span></div>
    <div class="cards">
      ${(S.meta.weaponTypes || []).map((t) => `<a class="card" href="#/weapons?type=${t.id}">${ic(t.icon, 'img24')}<span><b>${esc(t.name)}</b><small>${esc(t.en)}</small></span></a>`).join('')}
    </div>
  `;
}

/* ============================================================ generic list */

function headHTML(eyebrow, title, sub) {
  return `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>`;
}

function filterSelect(key, label, options, params) {
  const cur = params[key] ?? '';
  return `<label class="field"><span>${esc(label)}</span><select data-filter="${key}">
    <option value="">全部</option>
    ${options.map(([v, t]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}
  </select></label>`;
}

function filterSearch(params, placeholder = '按名称搜索') {
  return `<label class="field grow"><span>搜索</span><input data-live-filter="q" value="${esc(params.q || '')}" placeholder="${esc(placeholder)}" /></label>`;
}

function pagerHTML(data, params) {
  if (!data.pages || data.pages <= 1) return '';
  const page = data.page;
  const nums = [];
  const push = (n) => nums.push(`<button class="pg ${n === page ? 'active' : ''}" data-page="${n}">${n}</button>`);
  const windowStart = Math.max(1, page - 2);
  const windowEnd = Math.min(data.pages, windowStart + 4);
  for (let i = windowStart; i <= windowEnd; i++) push(i);
  return `<div class="pager">
    <button class="btn sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ 上一页</button>
    <div class="pages">${nums.join('')}</div>
    <button class="btn sm" data-page="${page + 1}" ${page >= data.pages ? 'disabled' : ''}>下一页 ›</button>
    <span class="dim">共 ${num(data.total)} 条 · 第 ${page}/${data.pages} 页</span>
  </div>`;
}

async function listPage(cfg) {
  const { params, token } = cfg;
  view.innerHTML = `
    ${headHTML(cfg.eyebrow, cfg.title, cfg.sub)}
    <div class="toolbar">${(cfg.filters || []).map((f) => (typeof f === 'function' ? f(params) : f)).join('')}</div>
    <div id="listHost"><div class="loading">加载中…</div></div>`;
  const data = await cfg.fetch(params);
  if (token !== routeToken) return;
  const host = $('#listHost');
  const rows = data.rows || [];
  if (!rows.length) {
    host.innerHTML = `<div class="empty">没有符合条件的数据</div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap">
      <table class="grid">
        <thead><tr>${cfg.columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((r) => `<tr class="${cfg.href ? 'clickable' : ''}" ${cfg.href ? `data-href="${esc(cfg.href(r))}"` : ''}>
            ${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pagerHTML(data, params)}`;
}

/* ============================================================ list pages */

function itemsPage({ params, token }) {
  return listPage({
    params, token, eyebrow: 'Items', title: '道具', sub: '素材、消耗品与获得方式',
    filters: [filterSearch(params), filterSelect('rarity', '稀有度', Array.from({ length: 10 }, (_, i) => [i + 1, 'R' + (i + 1)]), params)],
    fetch: (p) => api('/items', { q: p.q, rarity: p.rarity, page: p.page }),
    href: (r) => `#/items/${r.id}`,
    columns: [
      { label: '道具', render: (r) => `<div class="cell-name">${itemIcon(r.id)}<span><span class="nm">${esc(r.name)}</span></span></div>` },
      { label: '稀有', cls: 'num', render: (r) => rarity(r.rare) },
      { label: '最大', cls: 'num', render: (r) => num(r.max) },
      { label: '卖价', cls: 'num', render: (r) => num(r.sell) },
      { label: '买价', cls: 'num', render: (r) => num(r.buy) },
      { label: 'ID', cls: 'num dim', render: (r) => `<span class="mono">${r.hex || r.id}</span>` },
    ],
  });
}

async function weaponsTreeListPage({ params, token }) {
  const type = Number(params.type || 1);
  const tabs = (S.meta.weaponTypes || [])
    .map((t) => `<a class="ttab ${t.id === type ? 'active' : ''}" href="#/weapons/tree?type=${t.id}">${ic(t.icon, 'img16')}<span>${esc(t.name)}</span></a>`)
    .join('');
  view.innerHTML = `
    ${headHTML('Weapon Tree', '武器派生树', '父子关系由 DB_Wpn.Child + 前序编号还原，与桌面版内置树逐边一致')}
    <div class="ttabs">${tabs}</div>
    <div class="toolbar">
      <label class="field grow"><span>过滤</span><input id="treeFilter" placeholder="输入武器名，匹配项会自动展开并高亮" /></label>
      <button class="btn sm" id="treeExpand">展开全部</button>
      <button class="btn sm" id="treeCollapse">折叠全部</button>
      <a class="btn sm" href="#/weapons/tree?type=${type}">图形视图</a>
      <span class="dim" id="treeCount">加载中…</span>
    </div>
    <div class="panel pad" id="treeHost"><div class="loading">加载中…</div></div>`;

  const data = await api('/weapons/tree', { type });
  if (token !== routeToken) return;
  const host = $('#treeHost');

  const nodeHTML = (n, depth) => {
    const kids = n.children.length
      ? `<div class="tkids" ${depth >= 1 ? 'hidden' : ''}>${n.children.map((c) => nodeHTML(c, depth + 1)).join('')}</div>`
      : '';
    return `<div class="tnode" data-name="${esc(String(n.name).toLowerCase())}">
      <div class="trow">
        ${n.children.length ? `<button class="tchev ${depth < 1 ? 'open' : ''}" data-toggle title="展开/收起">▸</button>` : '<span class="tchev empty"></span>'}
        <a class="tname" href="#/weapons/${n.id}">${esc(n.name)}</a>
        <span class="tmeta">攻 ${n.atk} · ${n.el1 > 0 ? esc(n.el1name) + ' ' + n.el1pt : '无属性'} · R${n.rare}</span>
      </div>
      ${kids}
    </div>`;
  };

  host.innerHTML = data.roots.map((r) => nodeHTML(r, 0)).join('');
  $('#treeCount').textContent = `${data.typeName} · ${data.roots.length} 条派生线 · ${data.total} 把武器`;

  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (!btn) return;
    const node = btn.closest('.tnode');
    const kids = node.querySelector(':scope > .tkids');
    if (!kids) return;
    kids.hidden = !kids.hidden;
    btn.classList.toggle('open', !kids.hidden);
  });

  $('#treeExpand').addEventListener('click', () => {
    $$('.tkids', host).forEach((k) => { k.hidden = false; });
    $$('.tchev[data-toggle]', host).forEach((b) => b.classList.add('open'));
  });
  $('#treeCollapse').addEventListener('click', () => {
    $$('.tkids', host).forEach((k) => { k.hidden = true; });
    $$('.tchev[data-toggle]', host).forEach((b) => b.classList.remove('open'));
  });

  let timer = null;
  $('#treeFilter').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      const nodes = $$('.tnode', host);
      nodes.forEach((n) => n.classList.remove('hit', 'hide'));
      if (!q) {
        nodes.forEach((n) => {
          const kids = n.querySelector(':scope > .tkids');
          if (kids) kids.hidden = true;
          const btn = n.querySelector(':scope > .trow > .tchev[data-toggle]');
          if (btn) btn.classList.remove('open');
        });
        $('#treeCount').textContent = `${data.typeName} · ${data.roots.length} 条派生线 · ${data.total} 把武器`;
        return;
      }
      let hits = 0;
      nodes.forEach((n) => {
        if (!n.dataset.name.includes(q)) { n.classList.add('hide'); return; }
        hits++;
        n.classList.add('hit');
        let parent = n.parentElement.closest('.tnode');
        while (parent) {
          parent.classList.remove('hide');
          const kids = parent.querySelector(':scope > .tkids');
          if (kids) kids.hidden = false;
          const btn = parent.querySelector(':scope > .trow > .tchev[data-toggle]');
          if (btn) btn.classList.add('open');
          parent = parent.parentElement.closest('.tnode');
        }
      });
      $('#treeCount').textContent = `匹配 ${hits} 把武器`;
    }, 160);
  });
}

function skillsPage({ params, token }) {
  return listPage({
    params, token, eyebrow: 'Skills', title: '技能', sub: '技能树、等级阈值与效果说明',
    filters: [filterSearch(params)],
    fetch: (p) => api('/skills', { q: p.q, page: p.page }),
    href: (r) => `#/skills/${r.id}`,
    columns: [
      { label: '技能系统', render: (r) => `<span class="nm">${esc(r.name)}</span>` },
      { label: '等级数', cls: 'num', render: (r) => r.levels },
      { label: '点数范围', cls: 'num', render: (r) => `<span class="mono">${r.minPt} ~ ${r.maxPt}</span>` },
    ],
  });
}

function jewelsPage({ params, token }) {
  return listPage({
    params, token, eyebrow: 'Decorations', title: '装饰品', sub: '珠子 · 孔位 / 技能 / 素材',
    filters: [filterSearch(params), filterSelect('slot', '孔位', [[1, '1 孔'], [2, '2 孔'], [3, '3 孔']], params)],
    fetch: (p) => api('/jewels', { q: p.q, slot: p.slot, page: p.page }),
    href: (r) => `#/jewels/${r.id}`,
    columns: [
      { label: '装饰品', render: (r) => `<div class="cell-name">${itemIcon(r.itm)}<span class="nm">${esc(r.name)}</span></div>` },
      { label: '孔', cls: 'num', render: (r) => '◉'.repeat(r.slot) },
      { label: '技能', render: (r) => `<div class="skills-inline">${r.t1name ? `<span class="chip gold">${esc(r.t1name)} ${r.p1 > 0 ? '+' : ''}${r.p1}</span>` : ''}${r.t2name ? `<span class="chip red">${esc(r.t2name)} ${r.p2}</span>` : ''}</div>` },
      { label: '价格', cls: 'num', render: (r) => num(r.price) },
    ],
  });
}

function combosPage({ params, token }) {
  return listPage({
    params, token, eyebrow: 'Combos', title: '调和', sub: '素材 A + B → 结果 · 成功率',
    filters: [filterSearch(params, '按素材或结果搜索')],
    fetch: (p) => api('/combos', { q: p.q, page: p.page }),
    columns: [
      { label: '素材 A', render: (r) => `<a href="#/items/${r.aId}" class="cell-name">${itemIcon(r.aId)}<span class="nm">${esc(r.a)}</span></a>` },
      { label: '素材 B', render: (r) => `<a href="#/items/${r.bId}" class="cell-name">${itemIcon(r.bId)}<span class="nm">${esc(r.b)}</span></a>` },
      { label: '结果', render: (r) => `<a href="#/items/${r.cId}" class="cell-name">${itemIcon(r.cId)}<span class="nm" style="color:var(--gold-2)">${esc(r.c)}</span></a>` },
      { label: '数量', cls: 'num', render: (r) => num(r.qty) },
      { label: '成功率', cls: 'num', render: (r) => `<span class="mono">${esc(r.succ)}</span>` },
    ],
  });
}

function hornsPage({ params, token }) {
  return listPage({
    params, token, eyebrow: 'Hunting Horn', title: '狩猎笛旋律', sub: '音色组合、效果、持续时间与装填',
    filters: [filterSearch(params, '按旋律效果搜索')],
    fetch: (p) => api('/horns', { q: p.q, page: p.page }),
    columns: [
      { label: '音色', render: (r) => `<span style="display:flex;gap:3px">${[r.n1, r.n2, r.n3, r.n4].map((n) => noteIcon(n)).join('')}</span>` },
      { label: '效果', render: (r) => `<div><b>${esc(r.eff1 || '—')}</b>${r.eff2 ? `<div class="dim" style="font-size:12px">${esc(r.eff2)}</div>` : ''}</div>` },
      { label: '效果时间', cls: 'num', render: (r) => `${esc(r.dur || '—')}<span class="dim"> / ${esc(r.durM || '—')}</span>` },
      { label: '装填', cls: 'num', render: (r) => `${esc(r.reload || '—')}<span class="dim"> / ${esc(r.reloadM || '—')}</span>` },
      { label: '分类', render: (r) => tag([r.cat1, r.cat2].filter(Boolean).join(' / ') || '—') },
      { label: '适用武器', cls: 'num', render: (r) => r.weapons },
    ],
  });
}

function kinsectsPage({ params, token }) {
  return listPage({
    params, token, eyebrow: 'Insect Glaive', title: '猎虫', sub: '虫饵、精华与强化素材',
    filters: [filterSearch(params)],
    fetch: (p) => api('/kinsects', { q: p.q, page: p.page }),
    href: (r) => `#/kinsects/${r.id}`,
    columns: [
      { label: '猎虫', render: (r) => `<div class="cell-name">${ic(r.img || 'KinsectImg_001')}<span class="nm">${esc(r.name)}</span></div>` },
      { label: '类型', render: (r) => tag('Type ' + r.type) },
      { label: '稀有', cls: 'num', render: (r) => rarity(r.rare) },
      { label: '虫技能', cls: 'num', render: (r) => r.bugSkills },
      { label: '精华技能', cls: 'num', render: (r) => r.extractSkills },
    ],
  });
}

async function arenaListPage({ token }) {
  const data = await api('/arena');
  if (token !== routeToken) return;
  view.innerHTML = `${headHTML('Arena', '斗技大会', `${data.total} 个斗技任务 · 固定装备挑战`)}
    <div class="table-wrap"><table class="grid"><thead><tr><th>任务</th><th>地点</th><th class="num">报酬</th><th class="num">人数</th><th>时间限制</th></tr></thead><tbody>
    ${data.rows.map((r) => `<tr class="clickable" data-href="#/arena/${r.id}">
      <td><div class="cell-name">${iconForQuest(r.icon)}<span class="nm">${esc(r.name)}</span></div></td>
      <td>${esc(r.loc || '—')}</td><td class="num">${num(r.reward)}</td><td class="num">${r.player}</td>
      <td class="mono dim">${esc(r.timeS)} / ${esc(r.timeA)} / ${esc(r.timeB)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function awardsPage({ token }) {
  const data = await api('/awards');
  if (token !== routeToken) return;
  view.innerHTML = `${headHTML('Awards', '勋章', `${data.total} 枚勋章`)}
    <div class="cards">
      ${data.rows.map((r) => `<div class="card" style="align-items:flex-start;flex-direction:column;gap:6px">
        <b style="color:var(--gold-2)">${esc(r.name)}</b><small style="line-height:1.6">${esc(r.des || '')}</small></div>`).join('')}
    </div>`;
}

async function hfhPage({ token }) {
  const data = await api('/hfh');
  if (token !== routeToken) return;
  view.innerHTML = `${headHTML('Hunters for Hire', '猫猎人', '雇佣任务 · 成功率与报酬')}
    <div class="table-wrap"><table class="grid"><thead><tr><th>任务</th><th>地点</th><th class="num">等级</th><th class="num">成功率</th><th class="num">大成功</th><th class="num">费用</th></tr></thead><tbody>
    ${data.rows.map((r) => `<tr><td><span class="nm">${esc(r.name)}</span></td><td>${esc(r.loc || '—')}</td>
      <td class="num">${esc(r.lv)}</td><td class="num">${pct(r.succ)}</td><td class="num">${pct(r.bigSucc)}</td><td class="num">${num(r.fee)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

/* ============================================================ detail helpers */

function crumbs(items) {
  return `<div class="crumbs">${items.map(([href, label], i) => `${i ? '<span>›</span>' : ''}${href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`}`).join('')}</div>`;
}

function statBox(label, value, cls = '') {
  return `<div class="stat ${cls}"><span>${esc(label)}</span><b>${value}</b></div>`;
}

function section(title, body, count) {
  return `<section class="section"><h2>${esc(title)}${count !== undefined ? `<span class="count">${count}</span>` : ''}</h2>${body}</section>`;
}

function simpleTable(headers, rows, opts = {}) {
  if (!rows.length) return `<div class="panel pad empty">暂无数据</div>`;
  return `<div class="table-wrap"><table class="grid"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function resGrid(data) {
  const cells = [['火', data.fir], ['水', data.wtr], ['雷', data.thd], ['冰', data.ice], ['龙', data.drg]];
  return `<div class="res-grid">${cells.map(([n, v]) => `<div class="res"><b class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${v > 0 ? '+' : ''}${v ?? 0}</b><span>${n}</span></div>`).join('')}</div>`;
}

function sharpnessBars(weapon) {
  const names = ['红', '橙', '黄', '绿', '蓝', '白', '紫'];
  const labels = ['基础', '锋利度等级 +1', '锋利度等级 +2'];
  // The original gauge is 180 pixels wide and uses 2 pixels per stored unit.
  const scale = 90;
  return `<div class="sharp-gauges">${[weapon.sharpness, ...weapon.sharpnessExtensions].map((segments, level) => {
    const description = segments.map((s, i) => s.value ? `${names[i]} ${s.value}` : '').filter(Boolean).join('、');
    return `<div class="sharp-gauge"><span>${labels[level]}</span><div class="sharp" role="img" aria-label="${labels[level]}，各色长度（数据库单位）${description}" title="${description}（数据库单位）">
      ${segments.map((s) => s.value ? `<span class="seg" style="width:${s.value / scale * 100}%;background:${s.color}"></span>` : '').join('')}
    </div></div>`;
  }).join('')}</div>`;
}

/* ============================================================ item detail */

async function itemPage({ token }, id) {
  view.innerHTML = `<div class="loading">加载中…</div>`;
  const d = await api(`/items/${id}`);
  if (token !== routeToken) return;
  const it = d.data;
  view.innerHTML = `
    ${crumbs([['#/items', '道具'], [null, it.name]])}
    <div class="detail-hero">
      <div class="detail-art"><div class="art-box">${ic('Itm_' + String(it.id).padStart(4, '0'), 'img-art pixel')}</div></div>
      <div class="detail-info">
        <div class="eyebrow">Item #${String(it.id).padStart(4, '0')}</div>
        <h1>${esc(it.name)}</h1>
        <div class="tags">${rarity(it.rare)} ${chip('最大持有 ' + it.max)} ${chip('卖价 ' + num(it.sell))} ${chip('买价 ' + num(it.buy))}</div>
        <div class="stat-grid">
          ${statBox('稀有度', 'R' + it.rare, 'gold')}${statBox('最大持有', num(it.max))}${statBox('卖价', num(it.sell) + 'z')}${statBox('买价', num(it.buy) + 'z')}
        </div>
      </div>
    </div>

    ${d.monsters.length ? section('怪物掉落', simpleTable(['怪物', '获得方式', '等级', '数量', '概率'], d.monsters.map((r) => `<tr class="clickable" data-href="#/monsters/${r.monId}">
      <td><div class="cell-name">${monIcon(r.monId)}<span class="nm">${esc(r.mon)}</span></div></td>
      <td>${esc(r.how || '—')}</td><td>${esc(r.rank || '—')}</td><td class="num">${num(r.qty)}</td><td class="num">${pct(r.pct)}</td></tr>`)), d.monsters.length) : ''}

    ${d.maps.length ? section('地图采集', simpleTable(['地图', '区域', '方式', '等级'], d.maps.map((r) => `<tr>
      <td>${esc(r.loc)}</td><td>${esc(r.area || '—')}</td><td>${esc(r.how || '—')}</td><td>${esc(r.rank || '—')}</td></tr>`)), d.maps.length) : ''}

    ${d.quests.length ? section('任务报酬', simpleTable(['任务', '报酬行', '数量', '概率'], d.quests.map((r) => `<tr class="clickable" data-href="#/quests/${r.qstId}">
      <td><span class="nm">${esc(r.name)}</span></td><td>${esc(r.line || '—')}</td><td class="num">${num(r.qty)}</td><td class="num">${pct(r.pct)}</td></tr>`)), d.quests.length) : ''}

    ${d.combos.length ? section('调和配方', simpleTable(['素材 A', '素材 B', '结果', '成功率'], d.combos.map((r) => `<tr>
      <td>${esc(r.a)}</td><td>${esc(r.b)}</td><td style="color:var(--gold-2)">${esc(r.c)}</td><td class="num">${esc(r.succ)}</td></tr>`)), d.combos.length) : ''}

    ${d.weapons.length ? section('作为武器素材', simpleTable(['武器', '用途', '数量'], d.weapons.map((r) => `<tr class="clickable" data-href="#/weapons/${r.id}">
      <td>${esc(r.name)}</td><td>${r.kind === 'P' ? '生产' : '强化'}</td><td class="num">${num(r.qty)}</td></tr>`)), d.weapons.length) : ''}

    ${d.armors.length ? section('作为防具素材', simpleTable(['防具', '部位', '数量'], d.armors.map((r) => `<tr class="clickable" data-href="#/armor/${r.id}">
      <td>${esc(r.name)}</td><td>${esc(armorPartName(r.part))}</td><td class="num">${num(r.qty)}</td></tr>`)), d.armors.length) : ''}

    ${d.jewels.length ? section('作为装饰品素材', simpleTable(['装饰品', '孔位', '数量'], d.jewels.map((r) => `<tr class="clickable" data-href="#/jewels/${r.id}">
      <td>${esc(r.name)}</td><td>${'◉'.repeat(r.slot || 0)}</td><td class="num">${num(r.qty)}</td></tr>`)), d.jewels.length) : ''}

    ${d.vet.length ? section('山菜爷交换', simpleTable(['交出', '获得', '概率', '地点'], d.vet.map((r) => `<tr>
      <td>${esc(r.give)}</td><td>${esc(r.get)}</td><td class="num">${pct(r.pct)}</td><td>${esc(r.loc || '—')}</td></tr>`)), d.vet.length) : ''}

    ${d.palico.length ? section('随从队伍', simpleTable(['队伍', '等级', '区域', '数量', '概率'], d.palico.map((r) => `<tr>
      <td class="mono">#${String(r.id).padStart(3, '0')}</td><td>${esc(r.rank || '—')}</td><td>${esc(r.zone || '—')}</td><td class="num">${num(r.qty)}</td><td class="num">${pct(r.pct)}</td></tr>`)), d.palico.length) : ''}
  `;
}

/* ============================================================ weapon detail */

function weaponSpecificStats(w) {
  return [
    ['瓶子', w.axename], ['炮击类型', w.glname],
    ['装填速度', w.reloadname], ['稳定度', w.steadyname], ['后坐力', w.recoilname],
    ['弓射击', w.bowname], ['射击1', w.bow1name], ['射击2', w.bow2name], ['射击3', w.bow3name], ['射击4', w.bow4name],
    ['猎虫类型', w.kinname],
  ].filter(([, value]) => value && !['---', '0', -1].includes(value));
}

function bowgunAmmoHTML(rows, showCapacity = false) {
  const groups = [
    ['常规弹', rows.filter((a) => !a.internal && a.qty > 0)],
    ['内藏弹', rows.filter((a) => a.internal)],
    ['技能追加弹种', rows.filter((a) => !a.internal && a.qty <= 0)],
  ];
  return `<div class="bowgun-ammo">${groups.filter(([, ammo]) => ammo.length).map(([label, ammo]) => `<section class="bowgun-ammo-group">
    <h4>${label} <small>${ammo.length}</small></h4>${ammo.map((a) => {
      const speed = a.fireMode === 'rapid' ? `<span class="bowgun-badge bowgun-rapid">速射 ×${a.sp}${a.gap > 0 ? ` · 间隔${esc(a.gapName)}` : ''}</span>`
        : a.fireMode === 'crouch' ? `<span class="bowgun-badge bowgun-crouch">蹲射 ${a.sp} 发</span>` : '';
      const badges = `${speed}${a.internal ? `<span class="bowgun-badge bowgun-internal">内藏弹 · 总数 ${a.max}</span>` : ''}${a.qty <= 0 ? '<span class="bowgun-badge">需弹种追加</span>' : ''}`;
      return `<a class="bowgun-ammo-row" href="#/items/${a.id}"><span class="bowgun-ammo-name">${itemIcon(a.id)}<b>${esc(a.name)}</b></span>
        <span class="bowgun-ammo-qty">装填 ${a.qty || a.unlockQty}${showCapacity && !a.internal ? ` · 携带上限 ${a.max}` : ''}</span>
        ${badges ? `<span class="bowgun-ammo-badges">${badges}</span>` : ''}</a>`;
    }).join('')}</section>`).join('')}</div>`;
}

async function weaponPage({ token }, id) {
  view.innerHTML = `<div class="loading">加载中…</div>`;
  const d = await api(`/weapons/${id}`);
  if (token !== routeToken) return;
  const w = d.data;
  const img = w.ImgFile ? `/icons/${encodeURIComponent(w.ImgFile)}` : '';
  const params = weaponSpecificStats(w);

  view.innerHTML = `
    ${crumbs([['#/weapons', '武器'], ['#/weapons?type=' + w.Wpn_Type_ID, weaponTypeName(w.Wpn_Type_ID)], [null, w.name]])}
    <div class="detail-hero">
      <div class="detail-art">
        <div class="art-box ${img ? '' : 'noart'}">${img ? `<img class="pixel" src="${img}" alt="" onerror="this.parentNode.classList.add('noart');this.src='/icons/${w.Wpn_Type_ID ? 'Wpn_' + String(w.Wpn_Type_ID).padStart(2, '0') + '01' : 'blank16'}'">` : typeIcon(w.Wpn_Type_ID)}</div>
      </div>
      <div class="detail-info">
        <div class="eyebrow">#${w.Wpn_ID} · ${esc(weaponTypeName(w.Wpn_Type_ID))}</div>
        <h1>${esc(w.name)}</h1>
        <div class="tags">${rarity(w.Rare)} ${tag(weaponTypeName(w.Wpn_Type_ID))} ${w.Slot ? chip('孔位 ' + '◉'.repeat(w.Slot)) : ''}
          ${elementChip(w.el1name, w.SpAtk1_Pt)}${elementChip(w.el2name, w.SpAtk2_Pt)}
          <a class="chip gold" href="${forgeHref({ type: w.Wpn_Type_ID, weapon: w.Wpn_ID })}">在派生图中定位 ↗</a></div>
        <div class="stat-grid">
          ${statBox('攻击力', num(w.Atk), 'gold')}
          ${statBox('会心率', affinityPercent(w.Affinity))}
          ${statBox('防御', num(w.Def))}
          ${statBox('稀有度', 'R' + w.Rare)}
          ${statBox('生产费用', num(w.ProPx) + 'z')}
          ${statBox('强化费用', num(w.LvUpPx) + 'z')}
        </div>
      </div>
    </div>

    ${w.sharpness.length ? section('锋利度', `<div class="panel pad">${sharpnessBars(w)}</div>`) : ''}

    ${params.length ? section('武器参数', `<div class="panel pad"><div class="kv">${params.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>`) : ''}

    ${d.materials.length ? section('生产 / 强化素材', simpleTable(['用途', '素材', '数量'], d.materials.map((m) => `<tr class="clickable" data-href="#/items/${m.id}">
      <td>${m.kind === 'P' ? '<span class="chip gold">生产</span>' : '<span class="chip">强化</span>'}</td>
      <td><div class="cell-name">${itemIcon(m.id)}<span class="nm">${esc(m.name)}</span></div></td>
      <td class="num">${num(m.qty)}</td></tr>`)), d.materials.length) : ''}

    ${d.ammo.length && (w.Wpn_Type_ID === 12 || w.Wpn_Type_ID === 13) ? section('可发射弹种', bowgunAmmoHTML(d.ammo, true), d.ammo.length)
      : d.ammo.length ? section('可装填弹药', simpleTable(['弹药', '装填数', '最大', '特殊射击'], d.ammo.map((a) => `<tr class="clickable" data-href="#/items/${a.id}">
      <td><div class="cell-name">${itemIcon(a.id)}<span class="nm">${esc(a.name)}</span></div></td>
      <td class="num">${num(a.qty)}</td><td class="num">${num(a.max)}</td><td class="num">${num(a.sp)}</td></tr>`)), d.ammo.length) : ''}

    ${d.songs.length ? section('旋律', simpleTable(['音色', '效果', '时间', '装填'], d.songs.map((s) => `<tr>
      <td><span style="display:flex;gap:3px">${[s.n1, s.n2, s.n3, s.n4].map(noteIcon).join('')}</span></td>
      <td>${esc(s.eff1 || '—')}${s.eff2 ? `<div class="dim">${esc(s.eff2)}</div>` : ''}</td>
      <td class="num">${esc(s.dur)} / ${esc(s.durM)}</td><td class="num">${esc(s.reload)} / ${esc(s.reloadM)}</td></tr>`)), d.songs.length) : ''}

    ${d.tree ? section('派生关系', `<div class="panel pad">
      <div class="rel-line"><span class="label">树根</span><a href="#/weapons/${d.tree.root.id}">${esc(d.tree.root.name)}</a>${d.tree.depth ? `<span class="dim">· 第 ${d.tree.depth} 段强化</span>` : '<span class="dim">· 当前武器即树根</span>'}</div>
      <div class="rel-line"><span class="label">派生自</span>${d.tree.parent ? `<a class="chip gold" href="#/weapons/${d.tree.parent.id}">${esc(d.tree.parent.name)}</a>` : '<span class="dim">无（树根武器）</span>'}</div>
      <div class="rel-line"><span class="label">可派生</span>${d.tree.children.length ? d.tree.children.map((c) => `<a class="chip" href="#/weapons/${c.id}">${esc(c.name)}</a>`).join('') : '<span class="dim">无（最终强化）</span>'}</div>
      ${d.tree.ancestors.length > 1 ? `<div class="rel-line"><span class="label">升级路径</span><span class="dim">${d.tree.ancestors.map((a) => `<a href="#/weapons/${a.id}">${esc(a.name)}</a>`).join(' → ')} → <b style="color:var(--gold-2)">${esc(w.name)}</b></span></div>` : ''}
    </div>`) : ''}
  `;
}

/* ============================================================ skill detail */

const signedSkillPoints = (pt) => `${pt > 0 ? '+' : ''}${pt}`;

function skillLevelRows(levels) {
  return levels.map((level) => `
    <div class="skill-line ${level.pt < 0 ? 'dim' : ''}">
      <span><span class="name">${esc(level.name || '—')}</span> <span class="skill-threshold">(${signedSkillPoints(level.pt)})</span></span>
      <span class="lv">${esc(level.des || '')}</span>
    </div>`).join('');
}

function skillPreviewButton(id, points, content, className) {
  return `<button type="button" class="${className} skill-preview-trigger" data-skill-id="${id}" data-skill-points="${points}" aria-haspopup="dialog">${content}</button>`;
}

function initSkillPreview() {
  const dialog = $('#skillPreview');
  const title = $('#skillPreviewName');
  const points = $('#skillPreviewPoints');
  const body = $('#skillPreviewBody');
  let request = 0;

  view.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-skill-id]');
    if (!trigger) return;
    const current = ++request;
    title.textContent = '技能详情';
    points.textContent = `这件装备提供 ${signedSkillPoints(Number(trigger.dataset.skillPoints))} 点`;
    body.innerHTML = '<p class="skill-preview-message" role="status">正在读取技能…</p>';
    dialog.showModal();
    try {
      const detail = await api('/skills/' + trigger.dataset.skillId);
      if (!dialog.open || request !== current) return;
      title.textContent = detail.data.name;
      body.innerHTML = skillLevelRows(detail.levels);
      body.scrollTop = 0;
    } catch (error) {
      if (dialog.open && request === current) {
        body.innerHTML = `<p class="skill-preview-message" role="alert">读取技能失败：${esc(error.message)}</p>`;
      }
    }
  });

  $('#skillPreviewClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
  });
}

async function skillPage({ token }, id) {
  view.innerHTML = `<div class="loading">加载中…</div>`;
  const d = await api(`/skills/${id}`);
  if (token !== routeToken) return;
  const levels = d.levels || [];
  view.innerHTML = `
    ${crumbs([['#/skills', '技能'], [null, d.data.name]])}
    <div class="page-head"><div><div class="eyebrow">Skill Tree #${id}</div><h1>${esc(d.data.name)}</h1>
      <div class="sub">${levels.length} 个等级 · 由 ${d.armor.length} 件防具 / ${d.jewels.length} 种装饰品提供</div></div></div>

    ${section('等级与效果', `<div class="panel pad">${skillLevelRows(levels)}</div>`, levels.length)}

    ${d.armor.length ? section('提供该技能的防具', simpleTable(['防具', '部位', '点数'], d.armor.map((r) => `<tr class="clickable" data-href="#/armor/${r.id}">
      <td><div class="cell-name"><span class="c-ico" style="width:22px;height:22px;font-size:11px">⛨</span><span class="nm">${esc(r.name)}</span></div></td>
      <td>${esc(armorPartName(r.part))}</td><td class="num">${r.pt > 0 ? '+' : ''}${r.pt}</td></tr>`)), d.armor.length) : ''}

    ${d.jewels.length ? section('提供该技能的装饰品', simpleTable(['装饰品', '孔位', '点数'], d.jewels.map((r) => `<tr class="clickable" data-href="#/jewels/${r.id}">
      <td><span class="nm">${esc(r.name)}</span></td><td>${'◉'.repeat(r.slot || 0)}</td><td class="num">${r.pt > 0 ? '+' : ''}${r.pt}</td></tr>`)), d.jewels.length) : ''}
  `;
}

/* ============================================================ jewel detail */

async function jewelPage({ token }, id) {
  view.innerHTML = `<div class="loading">加载中…</div>`;
  const d = await api(`/jewels/${id}`);
  if (token !== routeToken) return;
  const j = d.data;
  view.innerHTML = `
    ${crumbs([['#/jewels', '装饰品'], [null, j.name]])}
    <div class="detail-hero">
      <div class="detail-art"><div class="art-box">${ic('Itm_' + String(j.Itm_ID).padStart(4, '0'), 'img-art pixel')}</div></div>
      <div class="detail-info">
        <div class="eyebrow">Jewel #${j.Jew_ID}</div>
        <h1>${esc(j.name)}</h1>
        <div class="tags">${'◉'.repeat(j.Slot || 0)} ${chip('价格 ' + num(j.Price))} ${j.rare ? rarity(j.rare) : ''}</div>
        <div class="skills-inline" style="margin-top:8px">
          ${j.t1name ? skillPreviewButton(j.SklTree1_ID, j.SklTree1_Pt, `${esc(j.t1name)} ${signedSkillPoints(j.SklTree1_Pt)}`, 'chip gold') : ''}
          ${j.t2name ? skillPreviewButton(j.SklTree2_ID, j.SklTree2_Pt, `${esc(j.t2name)} ${signedSkillPoints(j.SklTree2_Pt)}`, 'chip red') : ''}
        </div>
      </div>
    </div>
    ${d.materials.length ? section('生产素材', simpleTable(['素材', '数量'], d.materials.map((m) => `<tr class="clickable" data-href="#/items/${m.id}">
      <td><div class="cell-name">${itemIcon(m.id)}<span class="nm">${esc(m.name)}</span></div></td><td class="num">${num(m.qty)}</td></tr>`)), d.materials.length) : ''}
  `;
}

/* ============================================================ arena detail */

async function arenaPage({ token }, id) {
  view.innerHTML = `<div class="loading">加载中…</div>`;
  const d = await api(`/arena/${id}`);
  if (token !== routeToken) return;
  const a = d.data;
  view.innerHTML = `
    ${crumbs([['#/arena', '斗技大会'], [null, a.name]])}
    <div class="detail-hero">
      <div class="detail-art"><div class="art-box noart">${iconForQuest(a.QstIcon)}</div></div>
      <div class="detail-info">
        <div class="eyebrow">Arena #${a.Ara_ID}</div>
        <h1>${esc(a.name)}</h1>
        <div class="tags">${tag(a.loc || '')} ${chip('人数 ' + a.Player)} ${chip('报酬 ' + num(a.Reward) + 'z')}</div>
      </div>
    </div>
    ${d.monsters.length ? section('目标怪物', `<div class="monster-grid">${d.monsters.map((m) => `<a class="monster-card" href="#/monsters/${m.id}">${monIcon(m.id)}<span>${esc(m.name)}</span></a>`).join('')}</div>`) : ''}
    ${d.weapons.length ? section('可用武器', `<div class="cards">${d.weapons.map((w) => `<a class="card" href="#/weapons/${w.id}">
      <span class="c-ico">⚔</span><span><b>${esc(w.name)}</b><small>${esc(w.kind || '')}</small></span></a>`).join('')}</div>`) : ''}
    ${d.armors.length ? section('固定防具', `<div class="cards">${d.armors.map((x) => `<a class="card" href="#/armor/${x.id}">
      <span class="c-ico">⛨</span><span><b>${esc(x.name)}</b><small>${esc(armorPartName(x.part))}</small></span></a>`).join('')}</div>`) : ''}
    ${d.items.length ? section('支给品', simpleTable(['道具', '数量', '概率'], d.items.map((r) => `<tr class="clickable" data-href="#/items/${r.id}">
      <td><div class="cell-name">${itemIcon(r.id)}<span class="nm">${esc(r.name)}</span></div></td><td class="num">${num(r.qty)}</td><td class="num">${pct(r.pct)}</td></tr>`)), d.items.length) : ''}
  `;
}

/* ============================================================ set builder */

const SLOT_KEYS = [['head', '头部'], ['body', '胸部'], ['arms', '腕部'], ['waist', '腰部'], ['legs', '脚部']];

function saveSet() {
  localStorage.setItem('mhxx-set', JSON.stringify(S.set));
}

async function armorOptions(part) {
  const key = `${S.set.borg}-${S.set.morf}-${part}`;
  if (!S.cache.armor.has(key)) {
    const data = await api('/set/armor', { part, borg: S.set.borg, morf: S.set.morf });
    S.cache.armor.set(key, data.rows);
  }
  return S.cache.armor.get(key);
}

async function jewelOptions() {
  if (!S.cache.jewels) S.cache.jewels = (await api('/set/jewels')).rows;
  return S.cache.jewels;
}

async function skillOptions() {
  if (!S.cache.skills) S.cache.skills = (await api('/set/skills')).rows;
  return S.cache.skills;
}

async function setPage({ token }) {
  view.innerHTML = `${headHTML('Loadout', '配装器', '选择 5 件防具 + 护石，实时计算防御、耐性与技能')}
    <div class="toolbar">
      <label class="field"><span>剑士 / 枪手</span><select id="setBorg"><option value="1" ${S.set.borg === 1 ? 'selected' : ''}>剑士</option><option value="2" ${S.set.borg === 2 ? 'selected' : ''}>枪手</option></select></label>
      <label class="field"><span>性别</span><select id="setMorf"><option value="1" ${S.set.morf === 1 ? 'selected' : ''}>男性</option><option value="2" ${S.set.morf === 2 ? 'selected' : ''}>女性</option></select></label>
      <button class="btn ghost" id="setReset">清空</button>
      <span class="dim" style="margin-left:auto">点击部位选择防具，点击“＋ 装饰品”镶嵌珠子</span>
    </div>
    <div class="set-wrap">
      <div id="setSlots"></div>
      <div class="summary" id="setSummary"><div class="loading">计算中…</div></div>
    </div>`;

  $('#setBorg').addEventListener('change', (e) => {
    S.set.borg = Number(e.target.value);
    S.cache.armor.clear();
    saveSet();
    setPage({ token });
  });
  $('#setMorf').addEventListener('change', (e) => {
    S.set.morf = Number(e.target.value);
    S.cache.armor.clear();
    saveSet();
    setPage({ token });
  });
  $('#setReset').addEventListener('click', () => {
    S.set.parts = { head: {}, body: {}, arms: {}, waist: {}, legs: {} };
    S.set.talisman = { skills: [] };
    saveSet();
    setPage({ token });
  });

  renderSlots(token);
  computeSet(token);
}

async function renderSlots(token) {
  const host = $('#setSlots');
  if (!host) return;
  const rows = [];
  for (const [key, label] of SLOT_KEYS) {
    const sel = S.set.parts[key] || {};
    let name = '<span class="dim">选择防具…</span>';
    let meta = '';
    let art = '<span class="dim" style="width:22px;text-align:center">＋</span>';
    if (sel.amrId) {
      const options = await armorOptions(key === 'head' ? 1 : key === 'body' ? 2 : key === 'arms' ? 3 : key === 'waist' ? 4 : 5);
      const a = options.find((x) => x.id === sel.amrId);
      if (a) {
        name = `${esc(a.name)}`;
        art = armorIcon(a.img, S.set.morf);
        meta = `<span class="pmeta">防御 ${a.def} · 孔 ${'◉'.repeat(a.slot || 0) || '无'} · ${esc((a.skills || []).map((s) => s.n + (s.p > 0 ? '+' : '') + s.p).join(' / ') || '无技能')}</span>`;
      }
    }
    const jw = (sel.jewels || []).map((jid) => jid);
    rows.push(`
      <div class="slot-row" data-slot="${key}">
        <div class="slot-label">${label}</div>
        <div>
          <button class="pick-btn" data-pick="${key}">
            ${art}
            <span style="flex:1;display:flex;flex-direction:column;gap:2px">${name}${meta}</span>
            ${sel.amrId ? '<span class="clear" data-clear="' + key + '">✕</span>' : ''}
          </button>
          <div class="jewels-line">
            ${jw.map((jid) => `<span class="jewel-chip" data-jewel="${jid}"><b>◉</b> 珠子#${jid} <button data-unjewel="${jid}" data-slot="${key}">✕</button></span>`).join('')}
            ${sel.amrId ? `<button class="btn sm ghost" data-addjewel="${key}">＋ 装饰品</button>` : ''}
          </div>
        </div>
        <div class="dim mono">${sel.amrId ? '' : ''}</div>
      </div>`);
  }

  // talisman editor
  const skills = await skillOptions();
  const tal = S.set.talisman.skills || [];
  rows.push(`
    <div class="slot-row" data-slot="talisman">
      <div class="slot-label">护石</div>
      <div style="display:grid;gap:6px">
        ${[0, 1, 2].map((i) => `
          <div style="display:flex;gap:8px;align-items:center">
            <select data-tal-skill="${i}" style="flex:1;padding:6px 8px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px">
              <option value="">（无）</option>
              ${skills.map((s) => `<option value="${s.id}" ${tal[i] && Number(tal[i].treeId) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
            <input type="number" data-tal-pt="${i}" value="${tal[i] ? tal[i].pt : ''}" placeholder="点数" style="width:84px;padding:6px 8px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px" />
          </div>`).join('')}
      </div>
      <div class="dim">最多 3 个技能</div>
    </div>`);
  if (token !== routeToken) return;
  host.innerHTML = rows.join('');

  host.onclick = async (e) => {
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      S.set.parts[clear.dataset.clear] = {};
      saveSet();
      return renderSlots(token).then(() => computeSet(token));
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) return openArmorPicker(pick.dataset.pick, token);
    const addJ = e.target.closest('[data-addjewel]');
    if (addJ) return openJewelPicker(addJ.dataset.addjewel, token);
    const un = e.target.closest('[data-unjewel]');
    if (un) {
      const key = un.dataset.slot;
      const id = Number(un.dataset.unjewel);
      const arr = S.set.parts[key].jewels || [];
      const idx = arr.indexOf(id);
      if (idx >= 0) arr.splice(idx, 1);
      S.set.parts[key].jewels = arr;
      saveSet();
      return renderSlots(token).then(() => computeSet(token));
    }
  };
  host.oninput = (e) => {
    const pt = e.target.closest('[data-tal-pt]');
    if (!pt) return;
    const i = Number(pt.dataset.talPt);
    const skillSel = host.querySelector(`[data-tal-skill="${i}"]`);
    const treeId = Number(skillSel.value);
    S.set.talisman.skills[i] = treeId ? { treeId, pt: Number(pt.value || 0) } : null;
    S.set.talisman.skills = S.set.talisman.skills.filter(Boolean);
    saveSet();
    clearTimeout(host._t);
    host._t = setTimeout(() => computeSet(token), 350);
  };
  host.onchange = (e) => {
    const sel = e.target.closest('[data-tal-skill]');
    if (!sel) return;
    const i = Number(sel.dataset.talSkill);
    const ptInput = host.querySelector(`[data-tal-pt="${i}"]`);
    const treeId = Number(sel.value);
    if (!ptInput.value) ptInput.value = 3;
    S.set.talisman.skills[i] = treeId ? { treeId, pt: Number(ptInput.value || 0) } : null;
    S.set.talisman.skills = S.set.talisman.skills.filter(Boolean);
    saveSet();
    computeSet(token);
  };
}

function openArmorPicker(partKey, token) {
  const part = partKey === 'head' ? 1 : partKey === 'body' ? 2 : partKey === 'arms' ? 3 : partKey === 'waist' ? 4 : 5;
  armorOptions(part).then((rows) => {
    openModal(`选择防具 · ${SLOT_KEYS.find((s) => s[0] === partKey)[1]}`, rows, (q) =>
      rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())).map((r) => ({
        id: r.id,
        html: `<div><div class="pr-name">${esc(r.name)}</div><div class="pr-sub">${esc((r.skills || []).map((s) => s.n + (s.p > 0 ? '+' : '') + s.p).join(' / ') || '无技能')}</div></div>`,
        meta: `防御 ${r.def} · 孔 ${r.slot} · R${r.rare}`,
      })),
      (row) => {
        S.set.parts[partKey] = { amrId: row.id, jewels: [] };
        saveSet();
        closeModal();
        renderSlots(token).then(() => computeSet(token));
      }
    );
  });
}

function openJewelPicker(partKey, token) {
  jewelOptions().then((rows) => {
    openModal('选择装饰品', rows, (q) =>
      rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())).map((r) => ({
        id: r.id,
        html: `<div><div class="pr-name">${esc(r.name)} <span class="dim">${'◉'.repeat(r.slot)}</span></div><div class="pr-sub">${esc([r.t1name ? r.t1name + ' ' + (r.p1 > 0 ? '+' : '') + r.p1 : '', r.t2name ? r.t2name + ' ' + r.p2 : ''].filter(Boolean).join(' / '))}</div></div>`,
        meta: `${num(r.price)}z`,
      })),
      (row) => {
        const sel = S.set.parts[partKey] || {};
        sel.jewels = sel.jewels || [];
        sel.jewels.push(row.id);
        S.set.parts[partKey] = sel;
        saveSet();
        closeModal();
        renderSlots(token).then(() => computeSet(token));
      }
    );
  });
}

let setTimer = null;
async function computeSet(token) {
  const host = $('#setSummary');
  if (!host) return;
  clearTimeout(setTimer);
  setTimer = setTimeout(async () => {
    try {
      const body = {
        borg: S.set.borg,
        morf: S.set.morf,
        parts: Object.fromEntries(SLOT_KEYS.map(([k]) => [k, S.set.parts[k] || {}])),
        talisman: S.set.talisman || { skills: [] },
      };
      const d = await apiPost('/set/compute', body);
      if (token !== routeToken) return;
      const t = d.totals;
      host.innerHTML = `
        <h3>配装总览</h3>
        <div class="dim">${t.borg === 1 ? '剑士' : '枪手'} · ${t.morf === 1 ? '男性' : '女性'} · ${d.pieces.length}/5 件</div>
        <div class="totals">
          <div class="stat gold"><span>防御</span><b>${t.def}</b></div>
          <div class="stat"><span>最大防御</span><b>${t.maxdef}</b></div>
          <div class="stat"><span>孔位</span><b>${t.usedSlots}/${t.slots}</b></div>
        </div>
        ${resGrid(t)}
        <div class="section-title" style="margin:16px 0 8px"><h2 style="font-size:15px">技能</h2><span class="rule"></span></div>
        <div>
          ${d.active.length ? d.active.map((s) => `<div class="skill-line ${s.skill ? '' : 'dim'}">
            <span><span class="name">${esc(s.skill || s.name)}</span> ${s.skill && s.skill !== s.name ? `<span class="dim">${esc(s.name)}</span>` : ''}</span>
            <span class="lv">${s.pt > 0 ? '+' : ''}${s.pt}${s.threshold !== null && s.threshold !== undefined ? ` <span class="dim">(${s.threshold})</span>` : ''}</span>
          </div>`).join('') : '<div class="dim" style="padding:6px 0">尚未选择装备</div>'}
        </div>
        ${d.jewels.length ? `<div class="dim" style="margin-top:10px">已镶嵌 ${d.jewels.length} 颗装饰品</div>` : ''}
      `;
    } catch (err) {
      host.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  }, 120);
}

/* ============================================================ modal */

let modalState = null;

function openModal(title, rows, mapFn, onPick) {
  modalState = { mapFn, onPick };
  const modal = $('#modal');
  modal.hidden = false;
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <input id="modalSearch" placeholder="搜索名称…" />
        <button class="btn sm ghost" id="modalClose">关闭</button>
      </div>
      <div class="modal-body" id="modalBody"></div>
      <div class="modal-foot"><span id="modalCount"></span><span>点击条目选择</span></div>
    </div>`;
  const body = $('#modalBody');
  const render = (q) => {
    const items = mapFn(q);
    $('#modalCount').textContent = `${items.length} 条`;
    body.innerHTML = items.slice(0, 400).map((it) => `<div class="pick-row" data-id="${it.id}">
      <div>${it.html}</div><div class="pr-meta">${it.meta || ''}</div></div>`).join('') || '<div class="empty">没有结果</div>';
  };
  render('');
  $('#modalSearch').addEventListener('input', (e) => render(e.target.value.trim()));
  setTimeout(() => $('#modalSearch').focus(), 30);
}

function closeModal() {
  modalState = null;
  const modal = $('#modal');
  modal.hidden = true;
  modal.innerHTML = '';
}

function initModal() {
  $('#modal').addEventListener('click', (e) => {
    if (!modalState) return;
    if (e.target.id === 'modal' || e.target.closest('#modalClose')) return closeModal();
    const row = e.target.closest('.pick-row');
    if (!row) return;
    const input = $('#modalSearch');
    const item = modalState.mapFn(input ? input.value.trim() : '').find((x) => String(x.id) === row.dataset.id);
    if (item) modalState.onPick(item);
  });
}

/* ============================================================ boot */

async function boot() {
  try {
    S.meta = await api('/meta');
  } catch (err) {
    view.innerHTML = `<div class="error">无法连接数据服务：${esc(err.message)}<br/>请先运行 <code>node server/server.js</code></div>`;
    return;
  }
  initShell();
  initModal();
  initSkillPreview();
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/';
  route();
}

boot();
