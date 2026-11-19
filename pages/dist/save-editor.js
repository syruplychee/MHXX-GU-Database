'use strict';

const saveEditorState = {
  source: null, fileName: '', slot: 0, tab: 'status', dirty: false,
  item: 0, itemPage: 0, itemFilter: '', itemMode: 'filled',
  gearBox: 'hunter', gearIndex: null, catIndex: null,
  group: 0, automatic: false, phrase: 0, targetFormat: '', conversion: null,
};
let saveCatalogRequest;

function loadSaveCatalog() {
  if (!saveCatalogRequest) {
    saveCatalogRequest = fetch('save-catalog.json?v=2').then(response => {
      if (!response.ok) throw new Error(`存档资料加载失败（HTTP ${response.status}）。`);
      return response.json();
    }).catch(error => {
      saveCatalogRequest = null;
      throw error;
    });
  }
  return saveCatalogRequest;
}

function saveFormatLabel(save) {
  const suffix = !save.bodyOffset && save.format === 'switch-gu' ? ' · 裸正文' : '';
  return save.layout.name + suffix;
}

function downloadSaveBytes(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

function downloadSaveFile(save, name) {
  downloadSaveBytes(save.export(name), name);
}

function saveFileButtons(prefix) {
  return `<div class="save-actions">
    <button type="button" class="btn primary" data-${prefix}="system">下载 system</button>
    <button type="button" class="btn" data-${prefix}="system_backup">下载 system_backup</button>
  </div>`;
}

function readLocalSystem(file) {
  if (file.size > SaveEditorCore.formats[0].size) throw new Error('文件超过已知 system 大小，请选择导出目录里的单个 system。');
  return file.arrayBuffer().then(buffer => SaveEditorCore.openSave(new Uint8Array(buffer)));
}

function saveEditorPage() {
  const state = saveEditorState;
  view.innerHTML = `<div class="save-workspace">
    <header class="save-title"><h1>存档编辑器</h1>
      <p>支持 Switch GU、Switch XX 和 3DS XX。文件在浏览器内处理，下载后再用模拟器或存档管理器导入。</p>
    </header>
    <section class="save-panel save-source">
      <label class="save-file-picker"><span class="btn primary">打开存档</span><input type="file" id="saveSourceFile" aria-label="打开源存档"></label>
      <div><strong id="saveSourceName">选择导出的 system 文件</strong>
        <p id="saveSourceInfo">3DS XX 请从 ExtData 导出。建议先备份完整存档目录。</p></div>
    </section>
    <p id="saveMessage" class="save-message" role="status" aria-live="polite"></p>
    <div id="saveEditorArea"></div>
  </div>`;
  const root = $('.save-workspace', view);
  const area = $('#saveEditorArea', root);
  const input = $('#saveSourceFile', root);
  const notice = (message, tone = '') => {
    const element = $('#saveMessage', root);
    element.textContent = message;
    element.dataset.tone = tone;
  };
  const changed = () => {
    state.dirty = true;
    state.conversion = null;
    notice('修改已应用到当前副本，可以下载或用于转换。', 'ok');
  };

  function render() {
    const source = state.source;
    if (!source) return;
    $('#saveSourceName', root).textContent = state.fileName;
    $('#saveSourceInfo', root).textContent = `${saveFormatLabel(source)} · ${num(source.layout.size)} 字节`;
    const slots = source.slots();
    const tabs = [['status', '人物状态'], ['character', '角色编辑'], ['items', '道具箱'], ['gear', '装备箱'],
      ['charms', '护石'], ['palico', '艾露猫'], ['shoutouts', '快捷喊话'], ['quests', '配信任务'], ['convert', '跨版本转换']];
    area.innerHTML = `<section class="save-panel save-toolbar">
      <div class="save-slots" aria-label="角色槽">${slots.map((slot, i) => `<button type="button" class="save-slot" data-save-slot="${i}"
        aria-pressed="${state.slot === i && !!slot}" ${slot ? '' : 'disabled'}><span>槽 ${i + 1}</span><b>${slot ? esc(slot.name || '未命名角色') : '空槽'}</b></button>`).join('')}</div>
      ${saveFileButtons('save-export')}
    </section>
    <nav class="save-tabs" aria-label="存档功能">${tabs.map(([id, label]) => `<button type="button" data-save-tab="${id}" aria-pressed="${id === state.tab}">${label}</button>`).join('')}</nav>
    <div id="saveTabContent"></div>`;
    const content = $('#saveTabContent', root);
    if (state.tab === 'convert') {
      renderSaveConversion(content, state);
    } else if (state.tab === 'quests') {
      renderSaveCatalogPage(content, state, changed, renderSaveQuests);
    } else if (!slots[state.slot]) {
      content.innerHTML = '<p class="save-panel">这份存档没有已创建的角色。</p>';
    } else if (state.tab === 'items') {
      renderSaveItems(content, state, changed);
    } else if (state.tab === 'shoutouts') {
      renderSaveShoutouts(content, state, changed);
    } else if (state.tab === 'character') {
      renderSaveCharacter(content, state, changed);
    } else {
      const pages = { status: renderSaveStatus, gear: renderSaveEquipment, charms: renderSaveEquipment, palico: renderSavePalico };
      renderSaveCatalogPage(content, state, changed, pages[state.tab]);
    }
  }

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (state.dirty && !window.confirm('当前副本还有未下载的修改。打开另一份存档并放弃这些修改？')) return;
    input.disabled = true;
    notice('正在读取存档…');
    try {
      const save = await readLocalSystem(file);
      if (!root.isConnected) return;
      Object.assign(state, {
        source: save, fileName: file.name, slot: Math.max(0, save.slots().findIndex(Boolean)), tab: 'status',
        dirty: false, item: 0, itemPage: 0, itemFilter: '', itemMode: 'filled',
        gearBox: 'hunter', gearIndex: null, catIndex: null,
        group: 0, automatic: false, phrase: 0, targetFormat: '', conversion: null,
      });
      render();
      notice(save.format === '3ds-xx' ? '已读取裸 XX 正文，按 3DS ExtData 格式处理。' : '');
    } catch (error) {
      notice(error.message, 'error');
    } finally {
      input.disabled = false;
    }
  });

  area.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if ('saveSlot' in button.dataset) {
      state.slot = Number(button.dataset.saveSlot);
      state.gearIndex = null;
      state.catIndex = null;
      render();
    } else if (button.dataset.saveTab) {
      state.tab = button.dataset.saveTab;
      if (button.dataset.statusCat !== undefined) state.catIndex = Number(button.dataset.statusCat);
      if (button.dataset.statusHunter !== undefined) {
        state.gearBox = 'hunter';
        state.gearIndex = null;
      }
      render();
    } else if (button.dataset.saveExport) {
      downloadSaveFile(state.source, button.dataset.saveExport);
      if (button.dataset.saveExport === 'system') state.dirty = false;
      notice(`已生成 ${button.dataset.saveExport}。`, 'ok');
    }
  });
  render();
}

function renderSaveCharacter(host, state, changed) {
  const current = state.source.character(state.slot);
  const fields = Object.entries(SaveEditorCore.stats).map(([key, { label, max }]) =>
    `<label class="save-field"><span>${label}${key === 'playTime' ? '（秒）' : ''}</span>
      <input type="number" name="${key}" min="0" max="${max}" step="1" value="${current[key]}" required></label>`);
  host.innerHTML = `<form class="save-panel save-section" id="saveCharacterForm">
    <div class="save-section-head"><h2>角色资料</h2><span class="dim">选档 HR ${current.hr}</span></div>
    <div class="save-fields">
      <label class="save-field"><span>角色名</span><input name="name" maxlength="10" value="${esc(current.name)}" required></label>
      ${fields.join('')}
    </div>
    <div class="save-actions"><button type="submit" class="btn primary">应用角色修改</button>
      <span class="save-form-note" role="status"></span></div>
  </form>`;
  const form = $('#saveCharacterForm', host);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const patch = { name: form.elements.name.value };
    for (const key of Object.keys(SaveEditorCore.stats)) patch[key] = form.elements[key].valueAsNumber;
    const note = $('.save-form-note', host);
    try {
      const updated = state.source.setCharacter(state.slot, patch);
      note.textContent = updated ? '已应用。' : '数值与存档一致。';
      note.dataset.tone = 'ok';
      if (updated) {
        changed();
        const slotLabel = host.closest('#saveEditorArea').querySelector(`[data-save-slot="${state.slot}"] b`);
        slotLabel.textContent = patch.name;
      }
    } catch (error) {
      note.textContent = error.message;
      note.dataset.tone = 'error';
    }
  });
}

async function renderSaveItems(host, state, changed) {
  host.innerHTML = '<p class="save-panel">正在读取道具图鉴…</p>';
  let catalog;
  let catalogError = '';
  try {
    const { items } = await loadSaveCatalog();
    catalog = new Map(Object.entries(items).map(([key, [name, dummy]]) => {
      const id = Number(key);
      return [id, { id, name, dummy }];
    }));
  } catch {
    catalog = new Map();
    catalogError = '道具图鉴读取失败。仍可清空格子或修改已有道具数量。';
  }
  if (!host.isConnected) return;
  const source = state.source;
  const slot = state.slot;
  const count = SaveEditorCore.itemCount;
  const nameOf = id => id === 0 ? '空格' : catalog.get(id)?.name ?? (catalogError ? '道具名未加载' : '未收录道具');
  const allowed = id => !catalog.get(id)?.dummy && (source.format !== 'switch-gu' || !SaveEditorCore.xxOnlyItems.has(id));
  host.innerHTML = `<div class="save-item-columns">
    <section class="save-panel save-section">
      <div class="save-section-head"><h2>道具箱</h2><span class="dim">共 ${num(count)} 格</span></div>
      <div class="save-filters">
        <label class="save-field"><span>显示</span><select id="saveItemMode">
          <option value="filled" ${state.itemMode === 'filled' ? 'selected' : ''}>已存放</option>
          <option value="all" ${state.itemMode === 'all' ? 'selected' : ''}>全部格位</option></select></label>
        <label class="save-field"><span>筛选箱内道具</span><input type="search" id="saveItemFilter" value="${esc(state.itemFilter)}" placeholder="名称或存档 ID"></label>
      </div>
      <div class="save-table-scroll"><table class="save-items"><thead><tr><th scope="col">格位</th><th scope="col">道具</th><th scope="col">数量</th><th scope="col"><span class="save-visually-hidden">操作</span></th></tr></thead>
        <tbody id="saveItemRows"></tbody></table></div>
      <div class="save-actions" id="saveItemPager"></div>
    </section>
    <form class="save-panel save-section" id="saveItemForm">
      <div class="save-section-head"><h2>编辑格位</h2><button type="button" id="saveFirstEmpty" class="btn sm">定位空格</button></div>
      ${catalogError ? `<p class="save-help">${catalogError}</p>` : ''}
      <div class="save-filters">
        <label class="save-field"><span>格位</span><input name="position" type="number" min="1" max="${count}" step="1" required></label>
        <label class="save-field"><span>搜索可用道具</span><input type="search" id="savePickItem" placeholder="名称或 ID" ${catalog.size ? '' : 'disabled'}></label>
      </div>
      <div id="saveItemMatches" class="save-item-matches" hidden></div>
      <div class="save-fields">
        <label class="save-field"><span>存档 ID</span><input name="itemId" type="number" min="0" max="4095" step="1" required></label>
        <label class="save-field"><span>数量</span><input name="amount" type="number" min="0" max="99" step="1" required></label>
      </div>
      <p id="saveItemLabel" class="save-help"></p>
      <div class="save-actions"><button class="btn primary" type="submit">应用格位修改</button>
        <button class="btn ghost" type="button" id="saveClearItem">清空本格</button></div>
      <p class="save-form-note" role="status"></p>
    </form>
  </div>`;
  const form = $('#saveItemForm', host);
  const note = $('.save-form-note', form);
  const rows = $('#saveItemRows', host);
  const pager = $('#saveItemPager', host);
  const matches = $('#saveItemMatches', host);
  const picker = $('#savePickItem', host);
  const pageSize = 18;
  const items = Array.from({ length: count }, (_, index) => source.item(slot, index));
  const textMatches = (id, name, term) => /^\d+$/.test(term) ? String(id) === term : name.toLowerCase().includes(term);

  function renderList() {
    const term = state.itemFilter.trim().toLowerCase();
    const entries = items.map((item, index) => ({ ...item, index }))
      .filter(({ id }) => (state.itemMode === 'all' || id !== 0) && (!term || textMatches(id, nameOf(id), term)));
    const pages = Math.max(1, Math.ceil(entries.length / pageSize));
    state.itemPage = Math.min(state.itemPage, pages - 1);
    rows.innerHTML = entries.slice(state.itemPage * pageSize, (state.itemPage + 1) * pageSize).map(({ index, id, count }) =>
      `<tr class="${index === state.item ? 'save-selected' : ''}"><td>${index + 1}</td>
      <td>${esc(nameOf(id))}${id ? ` <small class="dim">#${id}</small>` : ''}</td><td>${count || '—'}</td>
      <td><button class="btn sm" type="button" data-save-item="${index}" aria-label="编辑第 ${index + 1} 格">编辑</button></td></tr>`).join('')
      || '<tr><td colspan="4">没有匹配的格位。</td></tr>';
    pager.innerHTML = `<button class="btn sm" type="button" data-save-page="-1" ${state.itemPage === 0 ? 'disabled' : ''}>上一页</button>
      <span class="dim">${state.itemPage + 1} / ${pages} · ${num(entries.length)} 格</span>
      <button class="btn sm" type="button" data-save-page="1" ${state.itemPage + 1 >= pages ? 'disabled' : ''}>下一页</button>`;
  }

  function selectItem(index) {
    state.item = index;
    const item = items[index];
    form.elements.position.value = index + 1;
    form.elements.itemId.value = item.id;
    form.elements.amount.value = item.id ? item.count : 0;
    $('#saveItemLabel', host).textContent = nameOf(item.id);
    note.textContent = '';
    picker.value = '';
    matches.hidden = true;
    renderList();
  }

  function applyItem(id, amount) {
    try {
      const previous = items[state.item];
      if (id && id !== previous.id && (!catalog.has(id) || !allowed(id))) {
        throw new Error('新增道具请从当前版本的可用道具中选择。');
      }
      const updated = source.setItem(slot, state.item, id, id ? amount : 0);
      items[state.item] = source.item(slot, state.item);
      selectItem(state.item);
      note.textContent = updated ? '格位已更新。' : '格位内容一致。';
      note.dataset.tone = 'ok';
      if (updated) changed();
    } catch (error) {
      note.textContent = error.message;
      note.dataset.tone = 'error';
    }
  }

  $('#saveItemMode', host).addEventListener('change', (event) => {
    state.itemMode = event.target.value;
    state.itemPage = 0;
    renderList();
  });
  $('#saveItemFilter', host).addEventListener('input', (event) => {
    state.itemFilter = event.target.value;
    state.itemPage = 0;
    renderList();
  });
  pager.addEventListener('click', (event) => {
    if (!event.target.dataset.savePage) return;
    state.itemPage += Number(event.target.dataset.savePage);
    renderList();
  });
  rows.addEventListener('click', (event) => {
    if (event.target.dataset.saveItem !== undefined) selectItem(Number(event.target.dataset.saveItem));
  });
  form.elements.position.addEventListener('change', () => {
    if (form.elements.position.checkValidity()) selectItem(form.elements.position.valueAsNumber - 1);
  });
  form.elements.itemId.addEventListener('input', () => {
    $('#saveItemLabel', host).textContent = nameOf(form.elements.itemId.valueAsNumber);
  });
  picker.addEventListener('input', () => {
    const query = picker.value.trim().toLowerCase();
    matches.hidden = !query;
    if (!query) return;
    const found = [...catalog.values()].filter(row => allowed(row.id) && textMatches(row.id, row.name, query)).slice(0, 12);
    matches.innerHTML = found.map(row => `<button type="button" class="btn sm" data-pick-save-item="${row.id}">${esc(row.name)} · #${row.id}</button>`).join('')
      || '<p class="save-help">没有匹配的可用道具。</p>';
  });
  matches.addEventListener('click', (event) => {
    const id = Number(event.target.dataset.pickSaveItem);
    if (!id) return;
    form.elements.itemId.value = id;
    if (!form.elements.amount.valueAsNumber) form.elements.amount.value = 1;
    $('#saveItemLabel', host).textContent = nameOf(id);
    picker.value = '';
    matches.hidden = true;
  });
  $('#saveFirstEmpty', host).addEventListener('click', () => {
    const index = items.findIndex(item => !item.id);
    if (index !== -1) selectItem(index);
    else note.textContent = '道具箱没有空格。';
  });
  $('#saveClearItem', host).addEventListener('click', () => applyItem(0, 0));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    applyItem(form.elements.itemId.valueAsNumber, form.elements.amount.valueAsNumber);
  });
  selectItem(state.item);
}

function renderSaveShoutouts(host, state, changed) {
  const source = state.source;
  const slot = state.slot;
  const maxBytes = source.layout.phraseSize - 1;
  const textEncoder = new TextEncoder();
  host.innerHTML = `<form class="save-panel save-section">
    <div class="save-section-head"><h2>快捷喊话</h2><span class="dim">每条最多 ${maxBytes} 字节</span></div>
    <div class="save-fields">
      <label class="save-field"><span>分组</span><select name="group">${[0, 1, 2].map(i => `<option value="${i}" ${state.group === i ? 'selected' : ''}>组 ${i + 1}</option>`).join('')}</select></label>
      <label class="save-field"><span>类型</span><select name="mode"><option value="0">手动</option><option value="1" ${state.automatic ? 'selected' : ''}>自动</option></select></label>
      <label class="save-field"><span>条目</span><select name="phrase"></select></label>
    </div>
    <label class="save-field"><span>文本</span><textarea name="text" rows="3"></textarea></label>
    <div class="save-actions"><button class="btn primary" type="submit">应用喊话修改</button>
      <span class="dim" id="savePhraseSize"></span><span class="save-form-note" role="status"></span></div>
  </form>`;
  const form = $('form', host);
  const note = $('.save-form-note', form);
  const phraseIndex = choice => (state.automatic ? 72 + 9 * state.group : 24 * state.group) + choice;
  function renderCount() {
    $('#savePhraseSize', host).textContent = `${textEncoder.encode(form.elements.text.value).length} / ${maxBytes} 字节`;
  }
  function renderPhrase() {
    form.elements.text.value = source.shoutout(slot, phraseIndex(state.phrase));
    note.textContent = '';
    renderCount();
  }
  function renderChoices() {
    form.elements.phrase.innerHTML = Array.from({ length: state.automatic ? 9 : 24 }, (_, i) => {
      const text = source.shoutout(slot, phraseIndex(i)).slice(0, 24);
      return `<option value="${i}" ${i === state.phrase ? 'selected' : ''}>${i + 1} · ${esc(text || '空白')}</option>`;
    }).join('');
    renderPhrase();
  }
  form.elements.group.addEventListener('change', () => {
    state.group = Number(form.elements.group.value);
    renderChoices();
  });
  form.elements.mode.addEventListener('change', () => {
    state.automatic = form.elements.mode.value === '1';
    state.phrase = 0;
    renderChoices();
  });
  form.elements.phrase.addEventListener('change', () => {
    state.phrase = Number(form.elements.phrase.value);
    renderPhrase();
  });
  form.elements.text.addEventListener('input', renderCount);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const updated = source.setShoutout(slot, phraseIndex(state.phrase), form.elements.text.value);
      renderChoices();
      note.textContent = updated ? '已应用。' : '文本与存档一致。';
      note.dataset.tone = 'ok';
      if (updated) changed();
    } catch (error) {
      note.textContent = error.message;
      note.dataset.tone = 'error';
    }
  });
  renderChoices();
}

function renderSaveConversion(host, state) {
  const source = state.source;
  const targets = SaveEditorCore.formats.filter(format => format.id !== source.format);
  if (!state.targetFormat) state.targetFormat = targets[0].id;
  const active = source.slots().filter(Boolean).length;
  host.innerHTML = `<section class="save-panel save-section">
    <div class="save-section-head"><h2>跨版本转换</h2><span class="dim">源档有 ${active} 个角色</span></div>
    <p class="save-help">选一份由目标游戏生成的 system。输出沿用目标的全局设置和配信数据，角色槽以源档为准。空白目标档也可以使用。</p>
    <form class="save-conversion-form">
      <label class="save-field"><span>目标版本</span><select name="format">
        ${targets.map(format => `<option value="${format.id}" ${format.id === state.targetFormat ? 'selected' : ''}>${format.name}</option>`).join('')}
      </select></label>
      <label class="save-field"><span>目标 system</span><input type="file" name="template" required></label>
      <button type="submit" class="btn primary" ${active ? '' : 'disabled'}>生成转换文件</button>
    </form>
    <div id="saveConvertResult" aria-live="polite"></div>
  </section>`;
  const result = $('#saveConvertResult', host);
  const form = $('form', host);
  const button = $('button[type="submit"]', form);

  function renderResult() {
    const conversion = state.conversion;
    if (!conversion) {
      result.innerHTML = active ? '' : '<p class="save-help">源档没有可转换的角色。</p>';
      return;
    }
    const { save, truncated, compatibility } = conversion;
    if (compatibility?.equipped.length) {
      result.innerHTML = `<div class="save-result" data-tone="error">
        <p>以下穿戴装备或幻化在 GU 中不可用。请先在源游戏换下，并重新导出源档。</p>
        <ul>${compatibility.equipped.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul>
      </div>`;
      return;
    }
    result.innerHTML = `<div class="save-result" data-tone="ok">
      <strong>${saveFormatLabel(save)} · 已转换 ${active} 个角色</strong>
      ${truncated ? `<p>${truncated} 条喊话超过目标版本的长度，已按完整字符截短。</p>` : ''}
      ${compatibility && (compatibility.storedGear || compatibility.storedItems) ? `<p>发现 ${compatibility.storedGear} 件装备和 ${compatibility.storedItems} 格道具含已知日版限定内容。原记录已保留，在 GU 中可能显示为 DUMMY。</p>` : ''}
      ${saveFileButtons('save-converted')}
    </div>`;
  }

  form.elements.format.addEventListener('change', () => {
    state.targetFormat = form.elements.format.value;
    form.elements.template.value = '';
    state.conversion = null;
    renderResult();
  });
  form.elements.template.addEventListener('change', () => {
    state.conversion = null;
    renderResult();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = form.elements.template.files[0];
    if (!file) return;
    state.conversion = null;
    result.textContent = '正在验证目标文件并转换…';
    button.disabled = true;
    try {
      const target = await readLocalSystem(file);
      if (!host.isConnected || form.elements.template.files[0] !== file) return;
      if (target.format !== state.targetFormat) throw new Error(`目标文件识别为 ${saveFormatLabel(target)}，请核对选择的版本。`);
      state.conversion = SaveEditorCore.convertSave(source, target);
      renderResult();
    } catch (error) {
      if (!host.isConnected || form.elements.template.files[0] !== file) return;
      result.innerHTML = `<p class="save-result" data-tone="error">${esc(error.message)}</p>`;
    } finally {
      button.disabled = !active;
    }
  });
  result.addEventListener('click', (event) => {
    const name = event.target.dataset.saveConverted;
    if (name && state.conversion) downloadSaveFile(state.conversion.save, name);
  });
  renderResult();
}
