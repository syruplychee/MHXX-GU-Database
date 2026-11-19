'use strict';

const questTextLabels = ['任务名称', '委托人', '任务说明', '小型怪物描述', '主目标描述', '失败条件描述', '副目标描述'];
const questLanguages = { chS: '简体中文', chT: '繁體中文', eng: 'English', jpn: '日本語', fre: 'Français', ger: 'Deutsch', ita: 'Italiano', spa: 'Español' };

function renderSaveQuests(host, state, changed, catalog) {
  const { source } = state;
  const core = SaveQuestsCore;
  let rows = core.list(source);
  let selected = rows[0]?.id;
  let generation = 0;
  host.innerHTML = `<div class="save-quest-page">
    <section class="save-panel save-section">
      <div class="save-section-head"><h2>配信任务</h2><span class="dim">任务区供此存档的三个角色共同使用</span></div>
      <div class="save-actions">
        <button class="btn" type="button" id="saveQuestPackOut">导出任务整包</button>
        <label class="save-file-picker"><span class="btn">导入任务整包或同版 system</span>
          <input type="file" id="saveQuestPackIn" aria-label="导入任务整包或同版 system"></label>
      </div>
      <p class="save-help">整包包含活动任务、挑战任务和固定配装。导入会替换当前副本的配信任务区。</p>
      <p id="saveQuestNotice" class="save-form-note" role="status"></p>
    </section>
    <div class="save-quest-columns">
      <section class="save-panel save-section">
        <div class="save-section-head"><h2>任务列表</h2><span class="dim" id="saveQuestCount"></span></div>
        <div class="save-fields"><label class="save-field"><span>筛选</span><select id="saveQuestKind">
          <option value="">全部</option><option value="event">活动</option><option value="challenge">挑战</option></select></label>
          <label class="save-field"><span>搜索</span><input type="search" id="saveQuestFilter" placeholder="名称或任务编号"></label></div>
        <div id="saveQuestRows" class="save-quest-list"></div>
      </section>
      <div id="saveQuestEdit"></div>
    </div>
  </div>`;
  const status = $('#saveQuestNotice', host);
  const list = $('#saveQuestRows', host);
  const kind = $('#saveQuestKind', host);
  const query = $('#saveQuestFilter', host);
  const editor = $('#saveQuestEdit', host);

  function notice(message, tone) {
    status.textContent = message;
    status.dataset.tone = tone;
  }
  function renderRows() {
    const term = query.value.trim().toLowerCase();
    const filtered = rows.filter(row =>
      (!kind.value || (kind.value === 'challenge') === row.challenge) &&
      (!term || String(row.id).includes(term) || catalog.eventNames[row.id]?.toLowerCase().includes(term)));
    $('#saveQuestCount', host).textContent = `${filtered.length} / ${rows.length}`;
    list.innerHTML = filtered.map(row => `<button type="button" class="save-slot" data-quest-id="${row.id}" aria-pressed="${row.id === selected}">
      <b>${esc(catalog.eventNames[row.id] ?? `任务 #${row.id}`)}</b><span>${row.challenge ? '挑战' : '活动'} · #${row.id}</span>
    </button>`).join('') || '<p class="save-help">没有符合条件的配信任务。</p>';
  }

  async function select(record) {
    const request = ++generation;
    if (!record) {
      editor.innerHTML = '<p class="save-panel">当前存档没有配信任务。可导入同版本的任务包或 system。</p>';
      return;
    }
    selected = record.id;
    renderRows();
    editor.innerHTML = '<p class="save-panel">正在读取任务 ARC…</p>';
    try {
      const detail = await core.inspectQuest(record.arc);
      if (request !== generation || !editor.isConnected) return;
      renderSaveQuestEditor(editor, detail, source, catalog, changed, () => {
        rows = core.list(source);
        return select(rows.find(row => row.id === record.id));
      });
    } catch (error) {
      if (request !== generation || !editor.isConnected) return;
      editor.innerHTML = `<section class="save-panel save-section"><h2>任务 #${record.id}</h2>
        <p data-tone="error">${esc(error.message)}</p><button type="button" class="btn" id="saveQuestRaw">导出原始 ARC</button></section>`;
      $('#saveQuestRaw', editor).onclick = () => downloadSaveBytes(record.arc, `q${record.id}.arc`);
    }
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-quest-id]');
    if (!button) return;
    select(rows.find(row => row.id === Number(button.dataset.questId)));
  });
  kind.addEventListener('change', renderRows);
  query.addEventListener('input', renderRows);
  $('#saveQuestPackOut', host).onclick = () => {
    try {
      downloadSaveBytes(core.exportPack(source), `${source.format}.mhqpack`);
      notice(`已导出 ${rows.length} 个配信任务。`, 'ok');
    } catch (error) { notice(error.message, 'error'); }
  };
  $('#saveQuestPackIn', host).addEventListener('change', async event => {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    input.disabled = true;
    try {
      if (file.size > 5159100) throw new Error('任务包或 system 的大小超过支持范围。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!host.isConnected) return;
      const isSave = [5159100, 5159064, 4726188, 4726152].includes(bytes.length);
      const pack = isSave ? core.exportPack(SaveEditorCore.openSave(bytes)) : bytes;
      const copy = SaveEditorCore.openSave(source.export());
      const count = core.importPack(copy, pack);
      if (!window.confirm(`将当前副本的 ${rows.length} 个配信任务替换为这份文件的 ${count} 个任务？`)) return;
      core.importPack(source, pack);
      changed();
      rows = core.list(source);
      selected = rows[0]?.id;
      renderRows();
      select(rows[0]);
      notice(`已导入 ${count} 个任务。下载 system 可保存修改。`, 'ok');
    } catch (error) { notice(error.message, 'error'); }
    finally { input.disabled = false; }
  });
  renderRows();
  select(rows[0]);
}

function renderSaveQuestEditor(host, detail, source, catalog, changed, reload) {
  const core = SaveQuestsCore;
  const { id } = detail.arc;
  let language = ['chS', 'chT', 'jpn', 'eng'].map(lang => detail.texts.findIndex(row => row.lang === lang)).find(index => index >= 0) ?? 0;
  let reward = Math.max(0, detail.rewardTables.findIndex(row => row.rows.length));
  const edited = { texts: {}, rewards: {} };
  host.innerHTML = `<form class="save-panel save-section" id="saveQuestForm">
    <div class="save-section-head"><h2>基于模板自建任务</h2><span class="dim">任务 #${id}</span></div>
    <p class="save-help">保留任务编号、地图、怪物和刷怪资源。可以修改此模板的参数、文本和道具报酬。</p>
    <div class="save-fields">${Object.entries(core.fields).map(([key, field]) =>
      saveNumber(key, field.label, detail.args[key], Math.min(field.min, detail.args[key]), Math.max(field.max, detail.args[key]))).join('')}</div>
    ${detail.texts.length ? `<details open><summary>游戏内文本</summary>
      ${saveSelect('language', '语言', detail.texts.map((row, i) => [i, questLanguages[row.lang] ?? row.lang]), language)}
      <div id="saveQuestTexts" class="save-fields"></div></details>` : ''}
    ${detail.rewardTables.length ? `<details><summary>道具报酬</summary>
      ${saveSelect('rewardTable', '报酬表', detail.rewardTables.map((row, i) => [i, row.entry.name.split('\\').at(-1)]), reward)}
      <div class="save-table-scroll"><table class="save-items">
        <thead><tr><th>道具 ID</th><th>名称</th><th>数量</th><th>权重</th><th>操作</th></tr></thead><tbody id="saveQuestRewards"></tbody>
      </table></div><button class="btn sm" id="saveAddReward" type="button">添加报酬</button></details>` : ''}
    <div class="save-actions">
      <button class="btn primary" type="submit">应用到当前存档</button>
      <button class="btn" type="button" id="saveQuestArcOut">导出自建 ARC</button>
      <label class="save-file-picker"><span class="btn">导入同编号 ARC</span>
        <input type="file" accept=".arc" id="saveQuestArcIn" aria-label="导入同编号 ARC"></label>
    </div>
    <p class="save-form-note" role="status"></p>
  </form>`;
  const form = $('#saveQuestForm', host);
  const notice = $('.save-form-note', form);
  const textBox = $('#saveQuestTexts', form);
  const rewardBox = $('#saveQuestRewards', form);
  const submit = $('button[type="submit"]', form);
  const arcOut = $('#saveQuestArcOut', form);

  function drawTexts() {
    if (!textBox) return;
    const strings = edited.texts[language] ?? detail.texts[language].strings;
    textBox.innerHTML = strings.map((value, i) => `<label class="save-field"><span>${questTextLabels[i]}</span>
      <textarea data-quest-text="${i}" rows="${i === 2 ? 3 : 2}">${esc(value)}</textarea></label>`).join('');
  }
  function takeTexts() {
    if (!textBox) return;
    edited.texts[language] = $$('[data-quest-text]', textBox).map((field, i) => {
      const original = detail.texts[language].strings[i];
      return original.replace(/\r\n/g, '\n') === field.value ? original : field.value.replace(/\r?\n/g, '\r\n');
    });
  }
  function drawRewards() {
    if (!rewardBox) return;
    const rows = edited.rewards[reward] ?? detail.rewardTables[reward].rows;
    rewardBox.innerHTML = rows.map(row => `<tr>
      <td><input type="number" aria-label="道具 ID" data-reward-id min="1" max="2990" value="${row.id}"></td>
      <td data-reward-name>${esc(catalog.items[row.id]?.[0] ?? '未收录')}</td>
      <td><input type="number" aria-label="数量" data-reward-count min="1" max="99" value="${row.count}"></td>
      <td><input type="number" aria-label="抽取权重" data-reward-weight min="0" max="100" value="${row.weight}"></td>
      <td><button type="button" class="btn sm ghost" data-remove-quest-reward>移除</button></td></tr>`).join('')
      || '<tr><td colspan="5">此报酬表没有道具。</td></tr>';
    $('#saveAddReward', form).disabled = rows.length >= 39;
  }
  function takeRewards() {
    if (!rewardBox) return;
    edited.rewards[reward] = $$('tr:has([data-reward-id])', rewardBox).map(row =>
      Object.fromEntries(['id', 'count', 'weight'].map(key => [key, $(`[data-reward-${key}]`, row).valueAsNumber])));
  }
  function edits() {
    takeTexts();
    takeRewards();
    for (const [table, entries] of Object.entries(edited.rewards)) {
      for (const [i, row] of entries.entries()) {
        if (row.id === detail.rewardTables[table].rows[i]?.id) continue;
        const item = catalog.items[row.id];
        if (!item || item[1] || (source.format === 'switch-gu' && SaveEditorCore.xxOnlyItems.has(row.id))) {
          throw new Error(`道具 ID ${row.id} 无法作为当前版本的新增报酬。`);
        }
      }
    }
    return { ...edited, args: Object.fromEntries(Object.keys(core.fields).map(key => [key, form.elements[key].valueAsNumber])) };
  }
  async function apply(operation) {
    submit.disabled = arcOut.disabled = true;
    try { await operation(); }
    catch (error) {
      notice.textContent = error.message;
      notice.dataset.tone = 'error';
    } finally { submit.disabled = arcOut.disabled = false; }
  }
  async function install(bytes) {
    if (!form.isConnected) return;
    if (await core.replaceQuest(source, id, bytes)) {
      changed();
      await reload();
    } else {
      notice.textContent = '任务内容与当前存档一致。';
      notice.dataset.tone = 'ok';
    }
  }
  form.elements.language?.addEventListener('change', event => {
    takeTexts();
    language = Number(event.target.value);
    drawTexts();
  });
  form.elements.rewardTable?.addEventListener('change', event => {
    takeRewards();
    reward = Number(event.target.value);
    drawRewards();
  });
  rewardBox?.addEventListener('input', event => {
    if ('rewardId' in event.target.dataset) $('[data-reward-name]', event.target.closest('tr')).textContent =
      catalog.items[event.target.valueAsNumber]?.[0] ?? '未收录';
  });
  rewardBox?.addEventListener('click', event => {
    if (!event.target.closest('[data-remove-quest-reward]')) return;
    const index = event.target.closest('tr').sectionRowIndex;
    takeRewards();
    edited.rewards[reward].splice(index, 1);
    drawRewards();
  });
  $('#saveAddReward', form)?.addEventListener('click', () => {
    takeRewards();
    edited.rewards[reward].push({ id: 9, count: 1, weight: 1 });
    drawRewards();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    apply(async () => install(await core.editQuest(detail, edits())));
  });
  arcOut.onclick = () => apply(async () => {
    downloadSaveBytes(await core.editQuest(detail, edits()), `q${id}.arc`);
    notice.textContent = '已生成任务 ARC。';
    notice.dataset.tone = 'ok';
  });
  $('#saveQuestArcIn', form).addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) apply(async () => {
      if (file.size > 0x1C00) throw new Error('任务 ARC 超过存档容器大小。');
      await install(new Uint8Array(await file.arrayBuffer()));
    });
  });
  drawTexts();
  drawRewards();
}
