'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { openSave, convertSave } = require('../public/save-core.js');

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
