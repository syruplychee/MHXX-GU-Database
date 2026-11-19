'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { openSave, convertSave, palicoRules } = require('../public/save-core.js');
const questStore = require('../public/save-quests-core.js');
const { deflateSync } = require('node:zlib');
const catalog = require('../public/save-catalog.json');

const fixtures = {
  'switch-gu': { size: 5159100, header: 36, bases: [0x18CC78, 0x2AC53C, 0x3CBE00], width: 104, b: 0xB281 },
  'switch-xx': { size: 4726188, header: 36, bases: [0x126474, 0x244C34, 0x3633F4], width: 60, b: 0xB280 },
  '3ds-xx': { size: 4726152, header: 0, bases: [0x126474, 0x244C34, 0x3633F4], width: 60, b: 0xB280 },
};
const chat = 0x11D089;
const mainKey = 0x36B2EE74;
const backupKey = 0xD0819B92;

function fixture(format, active, marker) {
  const { size, header, bases, b } = fixtures[format];
  const file = Buffer.alloc(size);
  if (header) {
    [0, 0, 4, 0, 0x14, mainKey, 12].forEach((value, index) => file.writeUInt32LE(value, index * 4));
    file.writeBigUInt64LE(BigInt(size - header), 0x1C);
  }
  file.writeUInt32LE(0xC6, header);
  file.writeUInt32LE(0x1C, header + 8);
  file.writeUInt32LE(b, header + 12);
  bases.forEach((base, index) => {
    file.writeUInt32LE(base, header + 0x10 + 4 * index);
    if (active.includes(index)) {
      file[header + 4 + index] = 1;
      file.write(`角色${index + 1}`, header + base + 0x23B7D);
    }
    file[header + base + chat - 1] = marker;
    file[header + base + chat + 99 * fixtures[format].width + 2] = marker;
  });
  file[header + 7] = active.at(-1) ?? 0;
  file[header + 0x60] = marker;
  file[file.length - 1] = marker;
  return file;
}

test('识别三种 system 和裸 GU，未修改导出保留每个字节', () => {
  for (const format of Object.keys(fixtures)) {
    const file = fixture(format, [1], 5);
    const save = openSave(file);
    assert.equal(save.format, format);
    assert.equal(save.bodyOffset, fixtures[format].header);
    assert.deepEqual(Buffer.from(save.export()), file);
    assert.deepEqual(save.slots().map(slot => slot?.name ?? null), [null, '角色2', null]);
  }
  const raw = fixture('switch-gu', [0], 5).subarray(36);
  const rawSave = openSave(raw);
  assert.equal(rawSave.format, 'switch-gu');
  assert.equal(rawSave.bodyOffset, 0);
  assert.deepEqual(Buffer.from(rawSave.export('system')), raw);
});

test('拒绝错误头部、标记和指针，名称与数值补丁失败时不改原数据', () => {
  const file = fixture('switch-xx', [0], 4);
  const brokenHeader = Buffer.from(file);
  brokenHeader.writeBigUInt64LE(1n, 0x1C);
  assert.throws(() => openSave(brokenHeader), /容器头/);
  const brokenPointer = Buffer.from(file);
  brokenPointer.writeUInt32LE(2, 0x24 + 0x18);
  assert.throws(() => openSave(brokenPointer), /角色槽 3/);
  const brokenFlag = Buffer.from(file);
  brokenFlag[0x24 + 5] = 2;
  assert.throws(() => openSave(brokenFlag), /角色槽 2/);
  assert.throws(() => openSave(file.subarray(1)), /无法识别/);
  const save = openSave(file);
  assert.throws(() => save.setCharacter(0, { name: '临时修改', funds: -1 }), /金币/);
  assert.throws(() => save.item(1, 0), /已创建/);
  assert.deepEqual(Buffer.from(save.export()), file);
});

test('金币、游玩时间和名字更新实际值及对应副本，HR 和其他槽保持原样', () => {
  for (const [format, { header, bases }] of Object.entries(fixtures)) {
    const file = fixture(format, [0, 2], 8);
    const base = header + bases[2];
    file.writeUInt16LE(123, base + 0x28);
    file.writeUInt16LE(456, base + 0xC71BD + 0x16);
    const save = openSave(file);
    assert(save.setCharacter(2, { name: '镰蟹猎人', funds: 1_111_111, playTime: 3601, points: 55 }));
    assert.equal(save.character(2).hr, 123);
    assert.equal(save.character(2).points, 55);
    const out = Buffer.from(save.export());
    for (const offset of [0x24, 0x280F]) assert.equal(out.readUInt32LE(base + offset), 1_111_111);
    for (const offset of [0x20, 0x2248B]) assert.equal(out.readUInt32LE(base + offset), 3601);
    assert.equal(out.readUInt32LE(base + 0xC71BD + 0x914), format === 'switch-gu' ? 3601 : 0);
    assert.equal(out.toString('utf8', base, base + 12), '镰蟹猎人');
    assert.equal(out.toString('utf16le', base + 0xC71BD, base + 0xC71BD + 8), '镰蟹猎人');
    assert.equal(out.readUInt16LE(base + 0xC71BD + 0x16), 456);
    assert(out.subarray(0, base).equals(file.subarray(0, base)));
  }
});

test('道具只修改命中的 19 bit，格位相邻位与末尾填充位保留', () => {
  const file = fixture('switch-xx', [0], 4);
  const box = fixtures['switch-xx'].header + fixtures['switch-xx'].bases[0] + 0x278;
  file.fill(0xA5, box, box + 5463);
  const save = openSave(file);
  const neighbors = [save.item(0, 1), save.item(0, 2298)];
  assert(save.setItem(0, 0, 0xABC, 0x55));
  assert(save.setItem(0, 2299, 0xFFF, 99));
  assert.deepEqual(save.item(0, 0), { id: 0xABC, count: 0x55 });
  assert.deepEqual(save.item(0, 2299), { id: 0xFFF, count: 99 });
  const out = Buffer.from(save.export());
  assert.deepEqual([...out.subarray(box, box + 3)], [0xBC, 0x5A, (0xA5 & 0xF8) | 5]);
  assert.equal(out[box + 5462] & 0xF0, 0xA0);
  assert.deepEqual([save.item(0, 1), save.item(0, 2298)], neighbors);
  assert.throws(() => save.setItem(0, 0, 0, 6), /数量/);
});

for (const [from, sourceSpec] of Object.entries(fixtures)) {
  for (const [to, targetSpec] of Object.entries(fixtures)) {
    if (from === to) continue;
    test(`${from} → ${to} 保留目标共享区并迁移三个槽的标记和有效角色`, () => {
      const sourceFile = fixture(from, [0, 2], 0x33);
      const targetFile = fixture(to, [1], 0x66);
      const sourceGroup = sourceSpec.header + sourceSpec.bases[2] + chat + 99 * sourceSpec.width;
      sourceFile.writeUInt16LE(2, sourceGroup);
      const source = openSave(sourceFile);
      const target = openSave(targetFile);
      const long = 'あ'.repeat(sourceSpec.width === 104 ? 30 : 19);
      source.setCharacter(2, { funds: 222_222 });
      source.setItem(2, 2299, 9, 88);
      source.setShoutout(0, 23, '手动一');
      source.setShoutout(2, 72, '自动一');
      source.setShoutout(2, 98, long);
      const before = source.export();
      const { save, truncated } = convertSave(source, target);
      const out = Buffer.from(save.export('system'));
      const backup = Buffer.from(save.export('system_backup'));
      assert.equal(save.format, to);
      assert.equal(out.length, targetSpec.size);
      assert.deepEqual(save.slots().map(slot => slot?.name ?? null), ['角色1', null, '角色3']);
      assert.equal(out[targetSpec.header + 7], 2);
      assert.equal(out[targetSpec.header + 0x60], 0x66);
      assert.equal(out[out.length - 1], 0x66);
      assert.equal(out[targetSpec.header + targetSpec.bases[1] + chat - 1], 0x66);
      assert.equal(out[targetSpec.header + targetSpec.bases[2] + chat - 1], 0x33);
      assert.equal(save.character(2).funds, 222_222);
      assert.deepEqual(save.item(2, 2299), { id: 9, count: 88 });
      assert.equal(save.shoutout(0, 23), '手动一');
      assert.equal(save.shoutout(2, 72), '自动一');
      const shorten = sourceSpec.width > targetSpec.width;
      assert.equal(save.shoutout(2, 98), shorten ? 'あ'.repeat(19) : long);
      assert.equal(truncated, Number(shorten));
      const targetGroup = targetSpec.header + targetSpec.bases[2] + chat + 99 * targetSpec.width;
      assert.equal(out.readUInt16LE(targetGroup), 2);
      assert.equal(out[targetGroup + 2], 0x66);
      assert.deepEqual(openSave(out).slots(), save.slots());
      if (targetSpec.header) {
        assert.equal(out.readUInt32LE(0x14), mainKey);
        assert.equal(backup.readUInt32LE(0x14), backupKey);
        assert(out.subarray(36).equals(backup.subarray(36)));
      } else {
        assert(out.equals(backup));
      }
      assert.deepEqual(source.export(), before);
      assert(Buffer.from(target.export()).equals(targetFile));
    });
  }
}

test('报告 GU 已知不兼容装备，并保留非穿戴内容供用户核对', () => {
  const file = fixture('3ds-xx', [0], 0);
  const base = fixtures['3ds-xx'].bases[0];
  file.writeUInt16LE(14, base + 0x62EE);
  file.writeUInt16LE(100, base + 0x62EE + 2);
  const source = openSave(file);
  source.setItem(0, 0, 2905, 1);
  const target = openSave(fixture('switch-gu', [], 0));
  const { compatibility } = convertSave(source, target);
  assert.deepEqual(compatibility.equipped, ['槽 1 · 猎人 · 太刀 ID 100']);
  assert.equal(compatibility.storedGear, 1);
  assert.equal(compatibility.storedItems, 1);
});

test('道具使用随页面发布的存档 ID 表', () => {
  assert.deepEqual(catalog.items[1], ['调和书1入门篇', false]);
  assert.deepEqual(catalog.items[9], ['回复药', false]);
  assert.equal(Object.keys(catalog.items).length, 2991);
});

test('猎人与艾露猫装备箱写回，穿戴中的记录保留引用与快照', () => {
  const file = fixture('switch-gu', [0], 0);
  const base = fixtures['switch-gu'].header + fixtures['switch-gu'].bases[0];
  const save = openSave(file);
  assert(save.setEquipment(0, 'hunter', 30, {
    type: 1, id: 2, appearance: 1, jewels: [2638, 2639],
  }, catalog));
  assert.equal(save.equipment(0, 'hunter', 30).appearance, 1);
  assert.deepEqual(save.equipment(0, 'hunter', 30).jewels, [2638, 2639, 0]);
  assert.throws(() => save.setEquipment(0, 'hunter', 30, {
    type: 1, id: 2, jewels: [2639, 2639],
  }, catalog), /需要 4 孔/);
  assert(save.setEquipment(0, 'palico', 5, { type: 23, id: 2, appearance: 1 }, catalog));
  assert.equal(save.equipment(0, 'palico', 5).appearance, 1);

  const worn = Buffer.from(save.export());
  worn.writeUInt16LE(30, base + 0x23B39 + 2);
  const equipped = openSave(worn);
  assert.equal(equipped.playerStatus(0).equipment[1].index, 30);
  assert.throws(() => equipped.setEquipment(0, 'hunter', 30, { type: 0, id: 0 }, catalog), /预设引用/);
  assert(equipped.setEquipment(0, 'hunter', 30, { type: 1, id: 2, appearance: 3, jewels: [2638] }, catalog));
  const out = Buffer.from(equipped.export());
  assert.equal(out.readUInt16LE(base + 0x110 + 44 + 4), 3);
  assert.equal(out.readUInt16LE(base + 0x23B39 + 2), 30);
});

test('护石校验技能点和孔数并写入品级原料，失败时保留原记录', () => {
  const file = fixture('3ds-xx', [1], 0);
  const save = openSave(file);
  const charm = { type: 6, id: 1, points: [5, 0], skills: [1, 0], slots: 0, jewels: [] };
  assert(save.setEquipment(1, 'hunter', 50, charm, catalog));
  assert.equal(save.equipment(1, 'hunter', 50).points[0], 5);
  const out = Buffer.from(save.export());
  const base = fixtures['3ds-xx'].bases[1];
  assert.equal(out.readUInt16LE(base + 0x62EE + 36 * 50 + 18), 353);
  assert.throws(() => save.setEquipment(1, 'hunter', 50, { ...charm, points: [6, 0] }, catalog), /技能点数/);
  assert.throws(() => save.setEquipment(1, 'hunter', 50, { ...charm, slots: 3 }, catalog), /孔数/);
  assert(Buffer.from(save.export()).equals(out));
});

test('艾露猫编辑可回读，保持记录边界、指派和颜色第四字节', () => {
  const file = fixture('switch-xx', [0], 0);
  const base = fixtures['switch-xx'].header + fixtures['switch-xx'].bases[0];
  const at = base + 0x23BB6 + 324 * 4;
  file.write('测试猫', at);
  file[at + 0x24] = 9;
  file[at + 0x55] = 7;
  file[at + 0x57] = 5;
  file[at + 0x11D] = 0xCC;
  file[base + 0x23A58] = 1;
  file[base + 0x23B9D] = 4;
  file.set([31, 9, 1, 2, 0, 0, 0], at + 0x38);
  file.set([45, 38, 1, 0, 0], at + 0x48);
  const save = openSave(file);
  assert(save.setPalico(0, 4, {
    name: '苍蓝猫', greeting: '开工了！', target: 3, exp: 100, colors: { coat: '#4d8bf0' },
    equippedMoves: [31, 2], equippedSkills: [1],
  }, catalog));
  const cat = save.playerStatus(0).companions[0];
  assert.equal(cat.name, '苍蓝猫');
  assert.deepEqual(cat.equippedMoves, [31, 2]);
  assert.deepEqual(cat.equippedSkills, [1]);
  assert.equal(cat.colors.coat, '#4d8bf0');
  const out = Buffer.from(save.export());
  assert.equal(out[at + 0x11D], 0xCC);
  assert(out.subarray(0, at).equals(file.subarray(0, at)));
  assert(out.subarray(at + 324).equals(file.subarray(at + 324)));
  assert.throws(() => save.setPalico(0, 4, { equippedSkills: [2] }, catalog), /已学/);
  assert(Buffer.from(save.export()).equals(out));
});

test('可选活跃存档只读验证道具表、当前装备与艾露猫', { skip: !process.env.MHXX_ACTIVE_SAVE }, () => {
  const file = readFileSync(process.env.MHXX_ACTIVE_SAVE);
  const save = openSave(file);
  const slot = save.slots().findIndex(Boolean);
  assert(slot >= 0);
  const occupied = Array.from({ length: 2300 }, (_, index) => save.item(slot, index)).filter(record => record.id);
  assert(occupied.length > 0);
  assert.equal(occupied.filter(record => catalog.items[record.id]).length, occupied.length);
  const status = save.playerStatus(slot);
  assert(status.equipment.some(gear => gear && catalog.gear[gear.type]?.[gear.id]));
  assert(status.companions.some(Boolean));
  assert(Buffer.from(save.export()).equals(file));
});

test('可选公开模板实际读写验证', { skip: !process.env.MHXX_SAVE_FIXTURES }, () => {
  const root = process.env.MHXX_SAVE_FIXTURES;
  const paths = {
    'switch-gu': 'Blank_Switch_Save/MHGU/system',
    'switch-xx': 'Blank_Switch_Save/MHXX Switch Version/system',
    '3ds-xx': 'Blank_3DS_Save/system',
  };
  for (const [format, relative] of Object.entries(paths)) {
    const file = readFileSync(path.join(root, relative));
    const save = openSave(file);
    assert.equal(save.format, format);
    assert(Buffer.from(save.export()).equals(file));
  }
});

test('艾露猫生成编号、固有项、传授来源、装备容量和原始字段一并校验', () => {
  const file = fixture('switch-gu', [0], 0);
  const base = fixtures['switch-gu'].header + fixtures['switch-gu'].bases[0];
  const at = base + 0x23BB6;
  file.write('测试猫', at);
  file[at + 0x25] = 5;
  file.fill(57, at + 0x38, at + 0x48);
  file.fill(96, at + 0x48, at + 0x54);
  file.set([12, 6, 9, 1, 4, 11, 15, 16, 0, 0], at + 0x38);
  file.set([24, 11, 2, 4, 6, 9, 0, 0], at + 0x48);
  file.set([3, 10, 3, 8], at + 0x54);
  const save = openSave(file);
  const original = save.palico(0, 0);
  assert.deepEqual(palicoRules.audit(original, catalog), []);
  const wrong = [...original.learnedMoves];
  wrong[4] = 2; // A cannot be written into a B slot.
  assert.throws(() => save.setPalico(0, 0, { learnedMoves: wrong }, catalog), /B 组/);
  wrong[4] = 11;
  assert.throws(() => save.setPalico(0, 0, { learnedMoves: wrong }, catalog), /重复/);
  const newSpecial = [...original.learnedSkills];
  newSpecial[6] = 62;
  assert.throws(() => save.setPalico(0, 0, { learnedSkills: newSpecial }, catalog), /配信技能/);
  assert.throws(() => save.setPalico(0, 0, { equippedMoves: [12, 6, 9, 1] }, catalog), /超过/);
  assert.throws(() => save.setPalico(0, 0, { equippedSkills: [2, 4] }, catalog), /超过/);
  assert(Buffer.from(save.export()).equals(file));
  const changed = palicoRules.changePattern(original, 'moves', 0, catalog);
  assert(save.setPalico(0, 0, changed, catalog));
  const cat = save.palico(0, 0);
  assert.equal(cat.movePattern, 0);
  assert.equal(cat.moveLength, 14);
  assert.deepEqual(cat.rawMoves.slice(14), [57, 57]);
  assert.deepEqual(cat.learnedMoves.slice(0, 4), original.learnedMoves.slice(0, 4));
  assert.deepEqual(palicoRules.audit(cat, catalog), []);
  const legacy = Buffer.from(save.export());
  legacy[at + 0x54] = 99;
  const special = openSave(legacy);
  assert(special.setPalico(0, 0, { greeting: '保留未知类型' }, catalog));
  assert.equal(special.palico(0, 0).movePattern, 99);
  assert.throws(() => special.setPalico(0, 0, { movePattern: 0 }, catalog), /原始已学栏/);
});

test('领导猫传授栏可保留 57/96 空位，异常技能列不会锁住行动列', () => {
  const file = fixture('switch-gu', [0], 0);
  const base = fixtures['switch-gu'].header + fixtures['switch-gu'].bases[0];
  const at = base + 0x23BB6;
  file.write('测试领导猫', at);
  file.fill(57, at + 0x38, at + 0x48);
  file.fill(96, at + 0x48, at + 0x54);
  file.set([31, 9, 1, 4, 22, 55, 33, 32, 6, 2, 57], at + 0x38);
  file.set([45, 38, 21, 20, 40, 1, 96, 96], at + 0x48);
  file.set([3, 11, 6, 8], at + 0x54);
  const save = openSave(file);
  const cat = save.palico(0, 0);
  assert.deepEqual(palicoRules.audit(cat, catalog), []);
  assert.equal(palicoRules.options(cat, 'moves', 10, catalog)[0], 57);
  const moves = palicoRules.changePattern(cat, 'moves', 7, catalog);
  const skills = palicoRules.changePattern(cat, 'skills', 1, catalog);
  assert(save.setPalico(0, 0, { ...moves, ...skills }, catalog));
  const converted = save.palico(0, 0);
  assert.equal(converted.movePattern, 7);
  assert.equal(converted.skillPattern, 1);
  assert.deepEqual(converted.learnedMoves.slice(-3), [6, 2, 57]);
  assert.deepEqual(converted.learnedSkills.slice(-2), [96, 96]);
  assert.deepEqual(palicoRules.audit(converted, catalog), []);

  file[at + 0x48 + 3] = 91;
  const mixed = openSave(file);
  const original = mixed.palico(0, 0);
  assert.deepEqual(palicoRules.describe(original, 'moves', catalog).defects, []);
  assert.match(palicoRules.describe(original, 'skills', catalog).defects[0], /B 组/);
  assert(mixed.setPalico(0, 0, palicoRules.changePattern(original, 'moves', 7, catalog), catalog));
  assert.deepEqual(mixed.palico(0, 0).rawSkills, original.rawSkills);
  assert.throws(() => mixed.setPalico(0, 0, { skillPattern: 1 }, catalog), /原始已学栏/);
});

function questArc(id, gu) {
  const primary = Buffer.alloc(gu ? 0x171 : 0xF9);
  primary.writeUInt32LE(0x434B0000);
  primary.writeUInt32LE(1, 4);
  primary.writeUInt32LE(id, 12);
  primary[0x16] = 50;
  primary[0x17] = 3;
  const strings = Buffer.from('原任务\0委托人\0文本\0\0\0\0\0');
  const gmd = Buffer.alloc(40 + strings.length);
  gmd.writeUInt32LE(0x00444D47);
  gmd.writeUInt32LE(7, 0x18);
  gmd.writeUInt32LE(strings.length, 0x20);
  gmd.set(strings, 40);
  const rewards = Buffer.alloc(184);
  rewards.writeUInt32LE(0x3F800000);
  rewards.writeUInt32LE(1, 4);
  rewards.set([9, 0, 1, 100, 0, 0, 0, 255], 24);
  const entries = [
    [`quest\\questData\\questData_${id}`, 0x1BBFD18E, primary],
    [`quest\\questData\\questData_${id}_jpn`, 0x242BB29A, gmd],
    ['quest\\rem\\rem_123456', 0x5B3C302D, rewards],
  ].map(([name, type, data]) => ({ name, type, data, packed: deflateSync(data) }));
  const head = 12 + entries.length * 80;
  const out = Buffer.alloc(head + entries.reduce((sum, entry) => sum + entry.packed.length, 0));
  out.writeUInt32LE(0x00435241);
  out.writeUInt16LE(17, 4);
  out.writeUInt16LE(entries.length, 6);
  let cursor = head;
  entries.forEach((entry, index) => {
    const at = 12 + 80 * index;
    out.write(entry.name, at);
    out.writeUInt32LE(entry.type, at + 64);
    out.writeUInt32LE(entry.packed.length, at + 68);
    out.writeUInt32LE(0x40000000 | entry.data.length, at + 72);
    out.writeUInt32LE(cursor, at + 76);
    out.set(entry.packed, cursor);
    cursor += entry.packed.length;
  });
  return out;
}

function questFixture(format, id = 1010005) {
  const file = fixture(format, [0], 0);
  const { header } = fixtures[format];
  const gu = format === 'switch-gu';
  const at = header + (gu ? 0xF875 : 0xF874);
  const stride = gu ? 0x1C00 : 0x1400;
  const arc = questArc(id, gu);
  file[header + (gu ? 0xB2D5 : 0xB2D4)] = 1;
  file.writeUInt32LE(id, at);
  file.writeUInt32LE(arc.length, at + 4);
  file.set(arc, at + 8);
  file.fill(0xAE, at + 8 + arc.length, at + 8 + arc.length + 256);
  file.fill(0xAE, at + stride - 256, at + stride);
  return file;
}

test('XX 配信任务包跨 NS / 3DS 导入，目标角色和存档封装保持原样', () => {
  const source = openSave(questFixture('3ds-xx'));
  const targetBytes = fixture('switch-xx', [1], 0x34);
  const target = openSave(targetBytes);
  const pack = questStore.exportPack(source);
  assert.equal(questStore.importPack(target, pack), 1);
  assert.deepEqual(questStore.exportPack(target), pack);
  assert.equal(questStore.list(target)[0].id, 1010005);
  const output = Buffer.from(target.export());
  const base = fixtures['switch-xx'].header + fixtures['switch-xx'].bases[0];
  assert(output.subarray(base).equals(targetBytes.subarray(base)));
  assert(output.subarray(0, 36).equals(targetBytes.subarray(0, 36)));
  assert.throws(() => questStore.importPack(openSave(questFixture('switch-gu')), pack), /不通用/);
  const invalid = pack.slice();
  invalid[20] = 0;
  assert.throws(() => questStore.importPack(target, invalid), /位图/);
  assert(Buffer.from(target.export()).equals(output));
});

test('GU 配信包省略账号字段并保留目标值，任务可改文本、参数及道具报酬', async () => {
  const original = questFixture('switch-gu');
  const account = 0x12C2D6;
  original.fill(0x32, account, account + 8);
  const source = openSave(original);
  const pack = questStore.exportPack(source);
  const recipient = questFixture('switch-gu');
  recipient.fill(0x56, account, account + 8);
  const save = openSave(recipient);
  questStore.importPack(save, pack);
  assert.deepEqual([...save.export().slice(account, account + 8)], Array(8).fill(0x56));
  const before = questStore.list(save)[0];
  const model = await questStore.inspectQuest(before.arc);
  assert.deepEqual(await questStore.editQuest(model, {}), before.arc.slice());
  const messages = [...model.texts[0].strings];
  messages[0] = '我的新任务';
  const edited = await questStore.editQuest(model, {
    args: { time: 20, reward: 888 }, texts: { 0: messages },
    rewards: { 0: [{ id: 10, count: 2, weight: 100 }, { id: 11, count: 1, weight: 1 }] },
  });
  assert(await questStore.replaceQuest(save, before.id, edited));
  const next = await questStore.inspectQuest(questStore.list(save)[0].arc);
  assert.equal(next.args.time, 20);
  assert.equal(next.args.reward, 888);
  assert.equal(next.texts[0].strings[0], '我的新任务');
  assert.deepEqual(next.rewardTables[0].rows.map(row => row.id), [10, 11]);
  const out = Buffer.from(save.export());
  const start = 0xF899;
  assert(out.subarray(0, start).equals(recipient.subarray(0, start)));
  assert(out.subarray(start + 0x1C00).equals(recipient.subarray(start + 0x1C00)));
  assert(out.subarray(start + 0x1B00, start + 0x1C00).equals(recipient.subarray(start + 0x1B00, start + 0x1C00)));
  await assert.rejects(questStore.replaceQuest(save, before.id, questArc(before.id + 1, true)), /编号/);
  assert(Buffer.from(save.export()).equals(out));
});

test('可选三版有配信任务存档逐条解包及整包往返', { skip: !process.env.MHXX_DLC_FIXTURES }, async () => {
  const root = process.env.MHXX_DLC_FIXTURES;
  for (const [folder, count] of [['MH Gen U Switch Savedata', 165], ['MH XX Switch Savedata', 180], ['MH XX 3DS Savedata', 180]]) {
    const bytes = readFileSync(path.join(root, folder, 'system'));
    const save = openSave(bytes);
    const records = questStore.list(save);
    assert.equal(records.length, count);
    for (const record of records) assert.equal((await questStore.inspectQuest(record.arc)).arc.id, record.id);
    assert.equal(questStore.importPack(save, questStore.exportPack(save)), count);
    assert(Buffer.from(save.export()).equals(bytes));
  }
});
