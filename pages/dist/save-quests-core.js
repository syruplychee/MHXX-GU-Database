'use strict';

const SaveQuestsCore = (() => {
  const decode = new TextDecoder();
  const encode = new TextEncoder();
  const MAGIC = encode.encode('MHQPK01\0');
  const ARC = 0x00435241;
  const R_QUEST = 0x1BBFD18E;
  const R_TEXT = 0x242BB29A;
  const R_REWARD = 0x5B3C302D;
  const EVENT_SLOTS = 160;
  const ARENA_SLOTS = 45;
  const ARENA_RECORD = 0x800;
  const TRAILER = 0x100;
  const FLAGS = 32;
  const accountBodyOffset = 0x12C2B2;
  const dataView = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
  const family = save => save.format === 'switch-gu' ? 1 : 2;
  const limits = group => group === 1 ? { event: 0xF875, stride: 0x1C00 } : { event: 0xF874, stride: 0x1400 };
  const flagBodyOffset = group => group === 1 ? 0xB2CD : 0xB2CC;
  const storeSize = stride => (EVENT_SLOTS + ARENA_SLOTS) * stride + ARENA_SLOTS * ARENA_RECORD;

  function layout(save) {
    const group = family(save);
    const { event, stride } = limits(group);
    return {
      group, stride, event: save.bodyOffset + event, flags: save.bodyOffset + flagBodyOffset(group),
      size: storeSize(stride), account: group === 1 ? save.bodyOffset + accountBodyOffset : null,
    };
  }

  function fail(reason) {
    throw new Error(reason);
  }

  function range(label, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) fail(`${label}须为 ${min}～${max} 的整数。`);
  }

  function nullString(bytes) {
    const end = bytes.indexOf(0);
    return decode.decode(end === -1 ? bytes : bytes.subarray(0, end));
  }

  function parseArc(bytes) {
    if (bytes.length < 12) fail('ARC 文件头不完整。');
    const view = dataView(bytes);
    if (view.getUint32(0, true) !== ARC || view.getUint16(4, true) !== 17) fail('此文件不是版本 17 的任务 ARC。');
    const count = view.getUint16(6, true);
    const end = 12 + 80 * count;
    if (count < 1 || end > bytes.length) fail('ARC 文件表越界。');
    const entries = Array.from({ length: count }, (_, i) => {
      const at = 12 + i * 80;
      const name = nullString(bytes.subarray(at, at + 64));
      const type = view.getUint32(at + 64, true);
      const size = view.getUint32(at + 68, true);
      const packed = view.getUint32(at + 72, true);
      const offset = view.getUint32(at + 76, true);
      const real = packed & 0x1FFFFFFF;
      if (!name || offset < end || !size || offset + size > bytes.length || real > 1024 * 1024) {
        fail('ARC 文件条目不完整或尺寸越界。');
      }
      return { name, type, real, packed, offset, size, raw: bytes.subarray(offset, offset + size) };
    });
    const ordered = [...entries].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i - 1].offset + ordered[i - 1].size > ordered[i].offset) fail('ARC 文件条目相互重叠。');
    }
    const mains = entries.filter(entry => entry.type === R_QUEST);
    const match = mains[0]?.name.match(/questData_(\d{7})$/i);
    if (mains.length !== 1 || !match) fail('ARC 中没有唯一且可识别的任务主体。');
    return { bytes, entries, id: Number(match[1]), main: mains[0] };
  }

  function scanStore(bytes, stride) {
    const view = dataView(bytes);
    const records = [];
    const ids = new Set();
    for (let i = 0; i < EVENT_SLOTS + ARENA_SLOTS; i++) {
      const at = i * stride;
      const id = view.getUint32(at, true);
      if (!id) continue;
      const size = view.getUint32(at + 4, true);
      const challenge = i >= EVENT_SLOTS;
      const kind = Math.floor(id / 1000);
      const correctKind = challenge ? [1020, 1120].includes(kind) : [1010, 1011, 1110, 1111].includes(kind);
      if (!correctKind || ids.has(id) || size < 12 || size + 8 > stride - TRAILER) fail(`任务 #${id} 的位置、尺寸或编号不合法。`);
      const arc = bytes.subarray(at + 8, at + 8 + size);
      const parsed = parseArc(arc);
      if (parsed.id !== id || parsed.main.real !== (stride === 0x1C00 ? 0x171 : 0xF9)) {
        fail(`任务 #${id} 的 ARC 编号或版本与存档不一致。`);
      }
      ids.add(id);
      records.push({ id, at, size, challenge, arc });
    }
    return records;
  }

  function bit(bytes, index) {
    return !!(bytes[index >> 3] & (1 << (index & 7)));
  }

  function validateStore(flags, bytes, stride) {
    const entries = scanStore(bytes, stride);
    const view = dataView(bytes);
    const arenaStart = (EVENT_SLOTS + ARENA_SLOTS) * stride;
    const challengeIds = new Set(entries.filter(entry => entry.challenge).map(entry => entry.id));
    for (let i = 0; i < ARENA_SLOTS; i++) {
      const at = arenaStart + i * ARENA_RECORD;
      const id = view.getUint32(at, true);
      if (bit(flags, i) !== !!id) fail('挑战任务标记与固定配装记录不一致。');
      if (!id) continue;
      const size = view.getUint32(at + 4, true);
      if (![169, 942].includes(size) || view.getUint32(at + 8, true) !== id || !challengeIds.delete(id)) {
        fail(`挑战任务 #${id} 缺少匹配的固定配装。`);
      }
    }
    if (challengeIds.size) fail('有挑战任务缺少固定配装。');
    let events = 0;
    for (let i = 0; i < EVENT_SLOTS; i++) if (bit(flags.subarray(8, 28), i)) events++;
    if (events !== entries.filter(entry => !entry.challenge).length) fail('活动任务位图与任务数量不一致。');
    return entries;
  }

  function list(save) {
    const meta = layout(save);
    return scanStore(save.bytes.subarray(meta.event, meta.event + meta.size), meta.stride);
  }

  function exportPack(save) {
    const meta = layout(save);
    const flags = save.bytes.subarray(meta.flags, meta.flags + FLAGS);
    const bytes = save.bytes.subarray(meta.event, meta.event + meta.size);
    validateStore(flags, bytes, meta.stride);
    const output = new Uint8Array(12 + FLAGS + meta.size);
    output.set(MAGIC);
    output[8] = meta.group;
    output.set(flags, 12);
    output.set(bytes, 12 + FLAGS);
    if (meta.account !== null) {
      const at = 12 + FLAGS + meta.account - meta.event;
      output.fill(0, at, at + 8);
    }
    return output;
  }

  function importPack(save, bytes) {
    const meta = layout(save);
    if (!same(bytes.subarray(0, 8), MAGIC)) fail('请选择配信任务 .mhqpack 文件。');
    if (bytes[8] !== meta.group) fail('GU 与 XX 的配信任务包不通用。Switch XX 和 3DS XX 可以互导。');
    if (bytes.length !== 12 + FLAGS + meta.size || bytes.subarray(9, 12).some(Boolean)) fail('配信任务包的长度或版本不符。');
    const flags = bytes.subarray(12, 12 + FLAGS);
    const payload = bytes.subarray(12 + FLAGS);
    const entries = validateStore(flags, payload, meta.stride);
    const account = meta.account === null ? null : save.bytes.slice(meta.account, meta.account + 8);
    save.bytes.set(flags, meta.flags);
    save.bytes.set(payload, meta.event);
    if (account) save.bytes.set(account, meta.account);
    return entries.length;
  }

  function byteStream(bytes) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice());
        controller.close();
      },
    });
  }

  async function unzip(entry) {
    if (entry.size === entry.real && entry.raw[0] !== 0x78) return entry.raw.slice();
    const reader = byteStream(entry.raw).pipeThrough(new DecompressionStream('deflate')).getReader();
    const output = new Uint8Array(entry.real);
    let at = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (at + value.length > output.length) fail('ARC 解压大小超出声明值。');
        output.set(value, at);
        at += value.length;
      }
    } catch (error) {
      fail(`ARC 条目 ${entry.name} 解压失败：${error.message}`);
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (at !== output.length) fail('ARC 解压后的长度与声明值不符。');
    return output;
  }

  async function deflate(bytes) {
    const stream = byteStream(bytes).pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function questData(raw, id) {
    const view = dataView(raw);
    if (![0x171, 0xF9].includes(raw.length) || view.getUint32(0, true) !== 0x434B0000 ||
        view.getUint32(4, true) !== 1 || view.getUint32(12, true) !== id) fail('任务主体结构、版本或编号不符。');
    return view;
  }

  const fields = {
    time: { at: 0x16, label: '时限（分钟）', min: 1, max: 255, byte: true },
    faints: { at: 0x17, label: '猫车上限', min: 1, max: 255, byte: true },
    fee: { at: 0x31, label: '契约金', min: 0, max: 9_999_999 },
    reward: { at: 0x39, label: '主任务报酬', min: 0, max: 9_999_999 },
    subReward: { at: 0x3D, label: '副任务报酬', min: 0, max: 9_999_999 },
    hr: { at: 0x4D, label: '主任务 HR 点数', min: 0, max: 9_999_999 },
  };

  function messages(raw) {
    const view = dataView(raw);
    if (raw.length < 40 || view.getUint32(0, true) !== 0x00444D47 || view.getUint32(0x18, true) !== 7) {
      fail('不支持此任务文本的 GMD 布局。');
    }
    const at = raw.length - view.getUint32(0x20, true);
    if (at < 40 || at >= raw.length) fail('任务文本区越界。');
    const strings = decode.decode(raw.subarray(at)).split('\0');
    if (strings.length !== 8 || strings[7] !== '') fail('任务文本条目不完整。');
    return { at, strings: strings.slice(0, 7) };
  }

  function rewards(raw) {
    const view = dataView(raw);
    if (raw.length !== 184 || view.getUint32(0, true) !== 0x3F800000 || view.getUint32(4, true) !== 1) {
      fail('不支持此道具报酬表的布局。');
    }
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const at = 24 + 4 * i;
      const id = view.getUint16(at, true);
      const count = raw[at + 2];
      const weight = raw[at + 3];
      if (!id && !count && (weight === 255 || weight === 0)) break;
      if (!id || !count) fail('道具报酬条目结构不完整。');
      rows.push({ id, count, weight });
    }
    return rows;
  }

  async function inspectQuest(bytes) {
    const arc = parseArc(bytes);
    const main = await unzip(arc.main);
    const meta = questData(main, arc.id);
    const args = Object.fromEntries(Object.entries(fields).map(([key, field]) =>
      [key, field.byte ? meta.getUint8(field.at) : meta.getInt32(field.at, true)]));
    const texts = await Promise.all(arc.entries.filter(entry => entry.type === R_TEXT).map(async entry => {
      const data = await unzip(entry);
      return { entry, data, ...messages(data), lang: entry.name.slice(-3) };
    }));
    const rewardTables = await Promise.all(arc.entries.filter(entry => entry.type === R_REWARD).map(async entry => {
      const data = await unzip(entry);
      return { entry, data, rows: rewards(data) };
    }));
    return { arc, args, texts, rewardTables, main };
  }

  async function editQuest(quest, changes) {
    const updated = new Map();
    const main = quest.main.slice();
    const view = dataView(main);
    for (const [key, value] of Object.entries(changes.args ?? {})) {
      const field = fields[key];
      if (value === quest.args[key]) continue;
      range(field.label, value, field.min, field.max);
      if (field.byte) view.setUint8(field.at, value);
      else view.setInt32(field.at, value, true);
    }
    if (!same(main, quest.main)) updated.set(quest.arc.main, main);
    for (const [index, strings] of Object.entries(changes.texts ?? {})) {
      const part = quest.texts[index];
      if (strings.length === 7 && strings.every((value, i) => value === part.strings[i])) continue;
      if (strings.length !== 7 || strings.some(value => value.includes('\0')) || !strings[0].trim()) fail('任务名不能为空，文本不能含 NUL。');
      const encoded = encode.encode(strings.join('\0') + '\0');
      if (encoded.length > 8192) fail('此语言的任务文本过长。');
      const data = new Uint8Array(part.at + encoded.length);
      data.set(part.data.subarray(0, part.at));
      data.set(encoded, part.at);
      dataView(data).setUint32(0x20, encoded.length, true);
      updated.set(part.entry, data);
    }
    for (const [index, rows] of Object.entries(changes.rewards ?? {})) {
      const part = quest.rewardTables[index];
      if (rows.length > 39) fail('每张道具报酬表最多 39 项，另留结束标记。');
      if (rows.length === part.rows.length && rows.every((row, i) =>
        row.id === part.rows[i].id && row.count === part.rows[i].count && row.weight === part.rows[i].weight)) continue;
      const data = part.data.slice();
      data.fill(0, 24);
      rows.forEach(({ id, count, weight }, i) => {
        const at = 24 + 4 * i;
        range('道具 ID', id, 1, 2990);
        range('道具数量', count, 1, 99);
        range('抽取权重', weight, 0, 100);
        dataView(data).setUint16(at, id, true);
        data[at + 2] = count;
        data[at + 3] = weight;
      });
      if (rows.length) data[27 + 4 * rows.length] = 255;
      if (!same(data, part.data)) updated.set(part.entry, data);
    }
    if (!updated.size) return quest.arc.bytes.slice();
    const { arc } = quest;
    const data = await Promise.all(arc.entries.map(async entry => {
      const replacement = updated.get(entry);
      return replacement ? { raw: await deflate(replacement), real: replacement.length } : entry;
    }));
    const head = 12 + arc.entries.length * 80;
    const result = new Uint8Array(head + data.reduce((n, entry) => n + entry.raw.length, 0));
    result.set(arc.bytes.subarray(0, head));
    const table = dataView(result);
    let at = head;
    data.forEach((entry, i) => {
      const offset = 12 + 80 * i + 68;
      table.setUint32(offset, entry.raw.length, true);
      table.setUint32(offset + 4, (arc.entries[i].packed & 0xE0000000) | entry.real, true);
      table.setUint32(offset + 8, at, true);
      result.set(entry.raw, at);
      at += entry.raw.length;
    });
    return result;
  }

  async function replaceQuest(save, id, bytes) {
    const meta = layout(save);
    const record = list(save).find(row => row.id === id);
    if (!record) fail('当前存档没有此任务编号，请先从同版任务包安装对应任务。');
    if (parseArc(bytes).id !== id) fail('导入 ARC 的编号必须和所选任务一致。');
    const quest = await inspectQuest(bytes);
    if ((quest.main.length === 0x171 ? 1 : 2) !== meta.group) fail('ARC 的任务主体属于另一个游戏版本。');
    if (same(record.arc, bytes)) return false;
    const at = meta.event + record.at;
    const end = at + meta.stride - TRAILER;
    const payloadEnd = at + 8 + bytes.length + TRAILER;
    if (payloadEnd > end || (meta.account !== null && at <= meta.account && meta.account < at + meta.stride && payloadEnd > meta.account)) {
      fail('修改后的 ARC 超出当前存档任务格可用空间。');
    }
    const trailer = save.bytes.slice(end, end + TRAILER);
    const staleEnd = Math.min(at + 8 + record.size + TRAILER, end);
    if (meta.account !== null && staleEnd > meta.account && meta.account >= at) fail('原任务与账号区重叠，无法安全替换。');
    save.bytes.fill(0, at + 8, Math.max(payloadEnd, staleEnd));
    save.bytes.set(bytes, at + 8);
    save.bytes.set(trailer, at + 8 + bytes.length);
    save.data.setUint32(at + 4, bytes.length, true);
    return true;
  }

  return { fields, list, exportPack, importPack, inspectQuest, editQuest, replaceQuest };
})();

if (typeof module !== 'undefined') module.exports = SaveQuestsCore;
