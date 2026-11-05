import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { VFX_SHEETS, VFX_TEXTURES, AUDIO_SOURCES } from '../polish/assets.js';

const root = new URL('../polish/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));

test('selected community media match recorded hashes and stay within the download budget', () => {
  const used = new Set([
    ...Object.values(VFX_SHEETS).map(sheet => sheet.file),
    ...Object.values(VFX_TEXTURES),
    ...Object.values(AUDIO_SOURCES).flat(),
  ]);
  assert.deepEqual([...used].sort(), manifest.files.map(entry => entry.file).sort());
  assert.equal(used.size, manifest.files.length, 'No duplicate or unused downloads in the runtime selection');
  let total = 0;
  for (const entry of manifest.files) {
    assert.match(entry.file, /^(vfx\/[\w-]+\.png|audio\/[\w-]+\.ogg)$/);
    const bytes = fs.readFileSync(new URL(entry.file, root));
    assert.equal(bytes.length, entry.bytes, entry.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.file);
    if (entry.file.endsWith('.png')) assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    else assert.equal(bytes.subarray(0, 4).toString(), 'OggS');
    total += bytes.length;
  }
  assert.equal(total, manifest.totalMediaBytes);
  assert.ok(total < 2 * 1024 * 1024, `${total} media bytes exceed the 2 MiB budget`);
});

test('all selected packs ship licenses and accessible creator credits', () => {
  const credits = fs.readFileSync(new URL('credits.html', root), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', root), 'utf8');
  assert.ok(Object.keys(manifest.packs).length >= 5, 'Keep the curated mix of community packs');
  for (const pack of Object.values(manifest.packs)) {
    assert.match(pack.url, /^https:\/\//);
    assert.ok(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'].includes(pack.license));
    assert.ok(credits.includes(pack.url), pack.title);
    assert.ok(credits.includes(pack.licenseFile), pack.title);
    const notice = fs.readFileSync(new URL(pack.licenseFile, root), 'utf8');
    assert.ok(notice.length > 100, pack.title);
  }
  assert.ok(html.includes('./polish/credits.html'));
  assert.ok(credits.includes('Combat FX Free by'));
  assert.ok(credits.includes('heyheythere'));
  assert.ok(credits.includes('CC BY 4.0'));
});

test('real announcements ship a matching licensed recording for every lifecycle cue', () => {
  for (const [kind, count] of [['round', 3], ['fight', 1], ['ko', 1], ['time', 1], ['tie', 1]]) {
    assert.ok(AUDIO_SOURCES[kind]?.length >= count, kind);
    for (const file of AUDIO_SOURCES[kind]) {
      const entry = manifest.files.find(entry => entry.file === file);
      assert.equal(entry?.role, 'announcer', `${kind} must use a recorded voice, not an impact sound`);
      assert.ok(entry.duration > .5 && entry.duration < 3, file);
      assert.ok(manifest.packs[entry.pack], file);
      if (entry.conversion) {
        assert.match(entry.sourceSha256, /^[a-f\d]{64}$/);
        assert.ok(entry.conversion.includes('libvorbis'), file);
      }
    }
  }
  const consistent = ['round', 'fight', 'ko'].flatMap(kind => AUDIO_SOURCES[kind]).map(file => manifest.files.find(entry => entry.file === file).pack);
  assert.equal(new Set(consistent).size, 1, 'core announcements should share one recorded voice');
});

test('every atlas cell layout fits the original high resolution PNG', () => {
  for (const sheet of Object.values(VFX_SHEETS)) {
    const bytes = fs.readFileSync(new URL(sheet.file, root));
    assert.equal(bytes.readUInt32BE(16), sheet.width * sheet.columns, sheet.file);
    assert.ok(bytes.readUInt32BE(20) >= sheet.height * Math.ceil(sheet.frames / sheet.columns), sheet.file);
    assert.ok(sheet.width >= 256 && sheet.height >= 256, 'Use the HD selection');
  }
});
