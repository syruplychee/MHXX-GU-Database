'use strict';

// Browser code and Node tests share the same binary reader. Offsets below are
// relative to the body or the selected character as indicated at each use.
const SaveEditorCore = (() => {
  const HEADER_SIZE = 0x24;
  const SYSTEM_KEYS = { system: 0x36B2EE74, system_backup: 0xD0819B92 };
  const GU_BASES = [0x18CC78, 0x2AC53C, 0x3CBE00];
  const XX_BASES = [0x126474, 0x244C34, 0x3633F4];
  const formats = [
    { id: 'switch-gu', name: 'Switch GU（国际版）', size: 0x4EB8BC, header: HEADER_SIZE,
      bases: GU_BASES, stride: 0x11F8C4, phraseSize: 104, sharedB: 0xB281 },
    { id: 'switch-xx', name: 'Switch XX（日版）', size: 0x481DAC, header: HEADER_SIZE,
      bases: XX_BASES, stride: 0x11E7C0, phraseSize: 60, sharedB: 0xB280 },
    { id: '3ds-xx', name: '3DS XX（日版）', size: 0x481D88, header: 0,
      bases: XX_BASES, stride: 0x11E7C0, phraseSize: 60, sharedB: 0xB280 },
  ];
  const rawGu = { ...formats[0], size: 0x4EB898, header: 0 };
  const itemCount = 2300;
  const shoutoutCount = 99;
  const ITEM_BOX = 0x278;
  const POUCH = 0x27BF;
  const SHOUTOUTS = 0x11D089;
  const CARD = 0xC71BD;
  const GEAR_BOX = 0x62EE;
  const CAT_BOX = 0x17C2E;
  const CAT_LIST = 0x23BB6;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stats = {
    funds: { label: '金币', offsets: [0x280F, 0x24], max: 9_999_999 },
    playTime: { label: '游玩时间', offsets: [0x2248B, 0x20, CARD + 0x914], max: 35_999_999 },
    points: { label: 'HR 点数', offsets: [0x280B], max: 9_999_999 },
    academy: { label: '龙历院点数', offsets: [0x2817], max: 9_999_999 },
    bherna: { label: '贝尔纳点数', offsets: [0x281B], max: 20_000 },
    kokoto: { label: '科科特点数', offsets: [0x281F], max: 20_000 },
    pokke: { label: '波凯点数', offsets: [0x2823], max: 20_000 },
    yukumo: { label: '结云点数', offsets: [0x2827], max: 20_000 },
  };

  function integer(label, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${label}须为 ${min}–${max} 的整数。`);
    }
  }

  function textBytes(bytes) {
    const nul = bytes.indexOf(0);
    return nul === -1 ? bytes : bytes.subarray(0, nul);
  }

  function encodeText(text, size, label) {
    const encoded = encoder.encode(text);
    if (text.includes('\0') || encoded.length >= size) {
      throw new Error(`${label}最多使用 ${size - 1} 字节，且不能包含空字符。`);
    }
    const result = new Uint8Array(size);
    result.set(encoded);
    return result;
  }

  function itemWord(bytes, at, index) {
    const bit = index * 19;
    const byte = at + (bit >> 3);
    return ((bytes[byte] | (bytes[byte + 1] << 8) | (bytes[byte + 2] << 16)) >>> (bit & 7)) & 0x7FFFF;
  }

  function checkHeader(data, layout) {
    if (!layout.header) return;
    const u32 = (at) => data.getUint32(at, true);
    const key = u32(0x14);
    if (u32(0) !== 0 || u32(4) !== 0 || u32(8) !== 4 || u32(0x10) !== 0x14 ||
        !Object.values(SYSTEM_KEYS).includes(key) || u32(0x18) !== 12 ||
        data.getBigUint64(0x1C, true) !== BigInt(layout.size - HEADER_SIZE)) {
      throw new Error('Switch 容器头不符合此版本的 system 格式。');
    }
  }

  class SaveFile {
    constructor(bytes) {
      const layout = [...formats, rawGu].find(candidate => candidate.size === bytes.byteLength);
      if (!layout) throw new Error(`文件有 ${bytes.byteLength.toLocaleString()} 字节，无法识别为支持的 GU / XX system。`);
      this.bytes = new Uint8Array(bytes);
      this.data = new DataView(this.bytes.buffer);
      checkHeader(this.data, layout);
      const head = layout.header;
      if (this.data.getUint32(head, true) !== 0xC6 ||
          this.data.getUint32(head + 8, true) !== 0x1C ||
          this.data.getUint32(head + 12, true) !== layout.sharedB) {
        throw new Error('正文头与识别出的游戏版本不符。');
      }
      this.bases = layout.bases.map((base, index) => {
        const pointer = this.data.getUint32(head + 0x10 + 4 * index, true);
        if (this.bytes[head + 4 + index] > 1 || pointer !== base || head + pointer + layout.stride > bytes.byteLength) {
          throw new Error(`角色槽 ${index + 1} 的使用标记或位置无效。`);
        }
        return head + pointer;
      });
      this.layout = layout;
      this.format = layout.id;
      this.bodyOffset = head;
    }

    slotUsed(slot) {
      integer('角色槽索引', slot, 0, 2);
      return this.bytes[this.bodyOffset + 4 + slot] === 1;
    }

    slotBase(slot) {
      if (!this.slotUsed(slot)) throw new Error('请选择一个已创建角色的存档槽。');
      return this.bases[slot];
    }

    slots() {
      return this.bases.map((_, slot) => this.slotUsed(slot) ? this.character(slot) : null);
    }

    character(slot) {
      const base = this.slotBase(slot);
      const name = decoder.decode(textBytes(this.bytes.subarray(base + 0x23B7D, base + 0x23B9D)));
      const result = { name, hr: this.data.getUint16(base + 0x28, true) };
      for (const [key, stat] of Object.entries(stats)) result[key] = this.data.getUint32(base + stat.offsets[0], true);
      return result;
    }

    setCharacter(slot, changes) {
      const base = this.slotBase(slot);
      const current = this.character(slot);
      const writes = [];
      if (changes.name !== undefined && changes.name !== current.name) {
        const name = changes.name;
        if (!name.trim() || name.length > 10 || /[\u0000-\u001f\u007f\ud800-\udfff]/.test(name)) {
          throw new Error('角色名须为 1–10 个常用字符。');
        }
        const utf8 = encodeText(name, 32, '角色名');
        const cardName = new Uint8Array(22);
        const u16 = new DataView(cardName.buffer);
        for (let i = 0; i < name.length; i++) u16.setUint16(i * 2, name.charCodeAt(i), true);
        writes.push(() => {
          this.bytes.set(utf8, base);
          this.bytes.set(utf8, base + 0x23B7D);
          this.bytes.set(cardName, base + CARD);
        });
      }
      for (const [key, stat] of Object.entries(stats)) {
        const value = changes[key];
        if (value === undefined || value === current[key]) continue;
        integer(stat.label, value, 0, stat.max);
        // GU 的名片时间字段已经过运行时核对。XX 的游戏时间与选档副本共用已核对的前两处。
        const offsets = key === 'playTime' && this.format !== 'switch-gu' ? stat.offsets.slice(0, 2) : stat.offsets;
        writes.push(() => {
          for (const at of offsets) this.data.setUint32(base + at, value, true);
        });
      }
      for (const write of writes) write();
      return writes.length > 0;
    }

    item(slot, index) {
      integer('道具格索引', index, 0, itemCount - 1);
      const packed = itemWord(this.bytes, this.slotBase(slot) + ITEM_BOX, index);
      return { id: packed & 0xFFF, count: packed >>> 12 };
    }

    setItem(slot, index, id, count) {
      integer('道具格索引', index, 0, itemCount - 1);
      integer('存档道具 ID', id, 0, 0xFFF);
      integer('道具数量', count, id ? 1 : 0, id ? 99 : 0);
      const bit = index * 19;
      const at = this.slotBase(slot) + ITEM_BOX + (bit >> 3);
      const shift = bit & 7;
      const word = this.bytes[at] | (this.bytes[at + 1] << 8) | (this.bytes[at + 2] << 16);
      const packed = (id | (count << 12)) << shift;
      const next = (word & ~(0x7FFFF << shift)) | packed;
      this.bytes[at] = next;
      this.bytes[at + 1] = next >>> 8;
      this.bytes[at + 2] = next >>> 16;
      return next !== word;
    }

    shoutout(slot, index) {
      integer('喊话索引', index, 0, shoutoutCount - 1);
      const size = this.layout.phraseSize;
      const at = this.slotBase(slot) + SHOUTOUTS + index * size;
      return decoder.decode(textBytes(this.bytes.subarray(at, at + size)));
    }

    setShoutout(slot, index, text) {
      if (text === this.shoutout(slot, index)) return false;
      const size = this.layout.phraseSize;
      this.bytes.set(encodeText(text, size, '喊话'), this.slotBase(slot) + SHOUTOUTS + index * size);
      return true;
    }

    export(kind = 'original') {
      const result = this.bytes.slice();
      if (kind !== 'original') {
        if (!Object.hasOwn(SYSTEM_KEYS, kind)) throw new Error('无效的导出文件类型。');
        if (this.bodyOffset) new DataView(result.buffer).setUint32(0x14, SYSTEM_KEYS[kind], true);
      }
      return result;
    }
  }

  function copyChat(source, from, result, to) {
    const width = source.layout.phraseSize;
    const targetWidth = result.layout.phraseSize;
    const group = from + shoutoutCount * width;
    const targetGroup = to + shoutoutCount * targetWidth;
    if (width === targetWidth) {
      result.bytes.set(source.bytes.subarray(from, group + 2), to);
      return 0;
    }
    let truncated = 0;
    for (let i = 0; i < shoutoutCount; i++) {
      const fromAt = from + i * width;
      const toAt = to + i * targetWidth;
      const text = textBytes(source.bytes.subarray(fromAt, fromAt + width));
      let end = Math.min(text.length, targetWidth - 1);
      if (end < text.length) {
        truncated++;
        // The excluded byte may be inside a UTF-8 character. Remove that entire character.
        while (end > 0 && (text[end] & 0xC0) === 0x80) end--;
      }
      result.bytes.fill(0, toAt, toAt + targetWidth);
      result.bytes.set(text.subarray(0, end), toAt);
    }
    result.bytes.set(source.bytes.subarray(group, group + 2), targetGroup);
    return truncated;
  }

  // Known Japanese-only equipment and items in the GU ID space. IDs are save IDs.
  const xxOnlyArmor = new Set([
    670, 671, 672, 673, 674, 675, 676, 677, 678, 679, 680, 681, 712, 713, 714, 715, 716, 717,
    1257, 1258, 1259, 1260, 1261, 1262, 1263, 1264, 1265, 1266, 1267, 1268, 1269, 1270,
  ]);
  const noWaist = new Set([678, 679, 680, 681, 1257, 1258]);
  const xxOnlyGear = new Map([
    [8, [100]], [14, [100, 126]], [15, [109]], [18, [99]], [19, [88]], [21, [59]],
    [22, [251, 252, 264, 265, 266, 267, 268, 280, 494, 496, 500, 508]],
    [23, [246, 248, 262, 263, 264, 266, 281, 504, 507, 526]],
    [24, [246, 248, 262, 263, 264, 265, 266, 281, 504, 507, 512, 518, 526]],
  ]);
  const xxOnlyItems = new Set([2905, 2906, 2907, 2921, 2922, 2923, 2924, 2925, 2956, 2958, 2964, 2968, 2969, 2970, 2971]);
  const typeNames = [
    '空', '头部', '胸部', '腕部', '腰部', '腿部', '护石', '大剑', '片手剑', '大锤', '长枪', '重弩',
    '保留', '轻弩', '太刀', '斩击斧', '铳枪', '弓', '双剑', '狩猎笛', '操虫棍', '盾斧',
    '随从武器', '随从头部', '随从身体',
  ];

  function unavailableInGu(type, id) {
    if (type >= 1 && type <= 5) return xxOnlyArmor.has(id) && (type !== 4 || !noWaist.has(id));
    return xxOnlyGear.get(type)?.includes(id) ?? false;
  }

  function guCompatibility(source) {
    const equipped = [];
    let storedGear = 0;
    let storedItems = 0;
    const u16 = (at) => source.data.getUint16(at, true);
    const gear = (at) => {
      const type = u16(at) & 0x1F;
      const id = u16(at + 2);
      const appearance = u16(at + 4);
      if (unavailableInGu(type, id)) return `${typeNames[type]} ID ${id}`;
      const armor = (type >= 1 && type <= 5) || type === 23 || type === 24;
      if (armor && unavailableInGu(type, appearance)) return `${typeNames[type]}幻化 ID ${appearance}`;
      return '';
    };
    for (let slot = 0; slot < 3; slot++) {
      if (!source.slotUsed(slot)) continue;
      const base = source.bases[slot];
      for (let i = 0; i < 7; i++) {
        const index = u16(base + 0x23B39 + 2 * i);
        const live = base + GEAR_BOX + index * 36;
        const at = index < 2000 && (u16(live) & 0x1F) !== 0 ? live : base + 0x110 + i * 44;
        const issue = gear(at);
        if (issue) equipped.push(`槽 ${slot + 1} · 猎人 · ${issue}`);
      }
      for (let cat = 0; cat < 84; cat++) {
        const at = base + CAT_LIST + cat * 324;
        if (!source.bytes[at]) continue;
        for (let i = 0; i < 7; i++) {
          const index = u16(at + 0x100 + 2 * i);
          const issue = index < 1000 ? gear(base + CAT_BOX + index * 36) : '';
          if (issue) equipped.push(`槽 ${slot + 1} · 随从 ${cat + 1} · ${issue}`);
        }
      }
      for (let i = 0; i < 2000; i++) if (gear(base + GEAR_BOX + i * 36)) storedGear++;
      for (let i = 0; i < 1000; i++) if (gear(base + CAT_BOX + i * 36)) storedGear++;
      for (let i = 0; i < itemCount; i++) if (xxOnlyItems.has(itemWord(source.bytes, base + ITEM_BOX, i) & 0xFFF)) storedItems++;
      for (let i = 0; i < 32; i++) if (xxOnlyItems.has(itemWord(source.bytes, base + POUCH, i) & 0xFFF)) storedItems++;
    }
    return { equipped: [...new Set(equipped)], storedGear, storedItems };
  }

  function convertSave(source, target) {
    if (source.format === target.format) throw new Error('请选择与源档不同的目标游戏。');
    const active = source.slots().map((character, index) => character ? index : -1).filter(index => index >= 0);
    if (!active.length) throw new Error('源档没有可转换的角色。');
    const compatibility = target.format === 'switch-gu' ? guCompatibility(source) : null;
    const result = new SaveFile(target.bytes);
    let truncated = 0;
    for (let slot = 0; slot < 3; slot++) {
      const used = source.slotUsed(slot);
      result.bytes[result.bodyOffset + 4 + slot] = Number(used);
      if (!used) continue;
      const from = source.bases[slot];
      const to = result.bases[slot];
      result.bytes.set(source.bytes.subarray(from, from + SHOUTOUTS), to);
      truncated += copyChat(source, from + SHOUTOUTS, result, to + SHOUTOUTS);
    }
    const last = source.bytes[source.bodyOffset + 7];
    result.bytes[result.bodyOffset + 7] = active.includes(last) ? last : active[0];
    return { save: result, truncated, compatibility };
  }

  return {
    formats, stats, itemCount, shoutoutCount, xxOnlyItems,
    openSave: (bytes) => new SaveFile(bytes),
    convertSave,
  };
})();

if (typeof module !== 'undefined') module.exports = SaveEditorCore;
