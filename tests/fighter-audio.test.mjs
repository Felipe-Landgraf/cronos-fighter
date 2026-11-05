import test from 'node:test';
import assert from 'node:assert/strict';

const { createCombatAudio } = await import('../polish/audio.js').catch(() => ({}));
const KINDS = ['punch', 'heavy', 'block', 'swing', 'swingHeavy', 'dash', 'land', 'cast', 'release', 'countdown', 'round', 'fight', 'ko', 'time', 'tie'];
const sample = name => `https://audio.test/${name}.ogg`;
const SOURCES = Object.fromEntries(KINDS.map(kind => [kind, [sample(kind)]]));
SOURCES.punch.push(sample('punch-alt'));

class Param {
  constructor(value = 1) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exponential', value, time]); }
}

class Node {
  constructor(type) { this.type = type; this.connections = []; this.disconnected = false; }
  connect(other) { this.connections.push(other); return other; }
  disconnect() { this.disconnected = true; this.connections = []; }
}

class Context {
  constructor() {
    this.state = 'running'; this.currentTime = 3; this.nodes = []; this.sources = [];
    this.decodes = []; this.resumes = 0; this.closes = 0;
  }
  add(node) { this.nodes.push(node); return node; }
  createBufferSource() {
    const source = new Node('source');
    source.playbackRate = new Param(); source.started = false; source.stopped = false;
    source.start = time => { source.started = true; source.startTime = time; };
    source.stop = time => { source.stopped = true; source.stopTime = time; };
    source.end = () => source.onended?.();
    this.sources.push(source); return this.add(source);
  }
  createGain() { const node = new Node('gain'); node.gain = new Param(); return this.add(node); }
  createBiquadFilter() { const node = new Node('filter'); node.frequency = new Param(); node.Q = new Param(); return this.add(node); }
  createStereoPanner() { const node = new Node('panner'); node.pan = new Param(); return this.add(node); }
  async decodeAudioData(bytes) {
    const url = new TextDecoder().decode(bytes); this.decodes.push(url);
    return { duration: .24, url };
  }
  async resume() { this.resumes++; }
  async close() { this.closes++; }
}

function harness(options = {}) {
  assert.equal(typeof createCombatAudio, 'function', 'audio module must export its factory');
  const context = options.context ?? new Context();
  const output = new Node('existing-master'); output.gain = new Param(.1375);
  const settings = { mute: false, effectsVolume: .25, ...options.settings };
  const requests = [];
  const fetchImpl = options.fetchImpl ?? (async (url, init) => {
    requests.push({ url, signal: init.signal });
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
  });
  const audio = createCombatAudio({ context, output, settings, fetchImpl, sources: options.sources ?? SOURCES });
  return { audio, context, output, settings, requests };
}

function match() {
  return {
    tick: 1, roundNumber: 1, phase: 'playing', paused: false, rngState: 1948, impacts: [],
    fighters: [0, 1].map(side => ({ id: `fighter-${side}`, side, x: 400 + side * 400, y: 600,
      state: 'idle', stateTicks: 0, attackInstanceId: 0, move: null, moveTick: 0, specialAttack: null })),
  };
}

function cast(fighter, instance = 7, age = 0) {
  fighter.state = 'special'; fighter.attackInstanceId = instance;
  fighter.specialAttack = { id: fighter.id, age, origin: fighter.x, dir: fighter.side ? -1 : 1, hits: [] };
}

const played = context => context.sources.filter(source => source.started).map(source => new URL(source.buffer.url).pathname.slice(1, -4));
function route(source) {
  const nodes = []; let next = source;
  while (next) { nodes.push(next); next = next.connections[0]; }
  return nodes;
}
function peak(source) { return Math.max(...route(source).find(node => node.type === 'gain').gain.events.map(event => event[1])); }

test('concurrent loads fetch and decode each shared URL once', async () => {
  const h = harness({ sources: { punch: [sample('one'), sample('two')], heavy: [sample('one')], block: [sample('three')] } });
  const loaded = await Promise.all([h.audio.load(), h.audio.load(), h.audio.load()]);
  assert.deepEqual(loaded, [true, true, true]);
  assert.equal(h.requests.length, 3); assert.equal(h.context.decodes.length, 3);
  assert.equal(h.audio.stats().loadedBuffers, 3);
  assert.equal(h.audio.play('heavy'), true);
  assert.equal(h.context.decodes.length, 3, 'playing reuses the decoded buffer');
  h.audio.destroy();
});

test('unloaded events return fallback and are never replayed when loading finishes', async () => {
  const h = harness();
  assert.equal(h.audio.play('punch'), false);
  const m = match(); cast(m.fighters[0]); h.audio.observe(m);
  await h.audio.load(); h.audio.observe(m);
  assert.deepEqual(played(h.context), []);
  assert.equal(h.audio.play('punch'), true);
  h.audio.destroy();
});

test('failed fetch or decode keeps successful kinds available without throwing', async () => {
  const context = new Context();
  const decode = context.decodeAudioData.bind(context);
  context.decodeAudioData = async bytes => {
    if (new TextDecoder().decode(bytes).includes('corrupt')) throw Error('unsupported sample');
    return decode(bytes);
  };
  const h = harness({ context, sources: { punch: [sample('good')], heavy: [sample('network')], block: [sample('corrupt')] },
    fetchImpl: async url => ({ ok: !url.includes('network'), arrayBuffer: async () => new TextEncoder().encode(url).buffer }) });
  assert.equal(await h.audio.load(), false);
  assert.equal(h.audio.play('punch'), true);
  assert.equal(h.audio.play('heavy'), false); assert.equal(h.audio.play('block'), false);
  assert.equal(h.audio.stats().failedSources, 2);
  h.audio.destroy();
});

test('all named cues use samples and remain on the provided master route', async () => {
  const h = harness(); await h.audio.load();
  for (const kind of KINDS) {
    assert.equal(h.audio.play(kind, { x: 900, side: 1 }), true, kind);
    assert.equal(route(h.context.sources.at(-1)).at(-1), h.output);
  }
  assert.equal(h.audio.play('unknown'), false);
  assert.deepEqual(new Set(played(h.context)), new Set(KINDS));
  assert.equal(h.output.gain.value, .1375, 'module must not replace or rescale the existing master');
  assert.equal(h.context.resumes, 0); assert.equal(h.context.closes, 0);
  h.audio.destroy(); assert.equal(h.output.disconnected, false);
});

test('suspended context returns fallback without creating nodes or unlocking itself', async () => {
  const h = harness(); await h.audio.load(); h.context.state = 'suspended';
  assert.equal(h.audio.play('punch'), false);
  h.audio.resume(); assert.equal(h.context.resumes, 0);
  assert.equal(h.context.sources.length, 0);
  h.context.state = 'running'; assert.equal(h.audio.play('punch'), true);
  h.audio.destroy();
});

test('unavailable Web Audio remains inert', async () => {
  assert.equal(typeof createCombatAudio, 'function');
  const audio = createCombatAudio({ context: null, output: null, settings: {} });
  assert.equal(await audio.load(), false); assert.equal(audio.play('punch'), false);
  audio.observe(match()); audio.pause(); audio.resume(); audio.destroy(); audio.destroy();
  assert.equal(audio.stats().activeVoices, 0);
});

test('mute and zero volume silence existing tails and consume muted events', async () => {
  const h = harness(); await h.audio.load(); const m = match(); h.audio.observe(m);
  h.audio.play('heavy'); const first = h.context.sources[0];
  h.settings.mute = true; cast(m.fighters[0]); h.audio.observe(m);
  assert.equal(h.audio.stats().activeVoices, 0); assert.equal(first.disconnected, true);
  const before = h.context.sources.length; h.audio.play('punch'); assert.equal(h.context.sources.length, before);
  h.settings.mute = false; h.audio.observe(m); assert.equal(h.context.sources.length, before);
  h.audio.play('heavy'); const second = h.context.sources.at(-1);
  h.settings.effectsVolume = 0; h.audio.observe(m);
  assert.equal(second.disconnected, true); assert.equal(h.audio.stats().activeVoices, 0);
  h.audio.play('punch'); assert.equal(h.context.sources.at(-1), second);
  h.audio.destroy();
});

test('light and heavy mixes differ and deterministic variation does not touch game RNG', async () => {
  const h = harness(); await h.audio.load();
  const originalRandom = Math.random; Math.random = () => { throw Error('game RNG must not be used'); };
  try {
    h.audio.play('punch', { side: 0, variation: 4 }); const first = h.context.sources.at(-1);
    h.audio.play('punch', { side: 0, variation: 4 }); const repeated = h.context.sources.at(-1);
    h.audio.play('heavy', { side: 1, variation: 4 }); const heavy = h.context.sources.at(-1);
    assert.equal(first.buffer, repeated.buffer); assert.equal(first.playbackRate.value, repeated.playbackRate.value);
    assert.notEqual(first.playbackRate.value, heavy.playbackRate.value);
    assert.ok(peak(heavy) > peak(first)); assert.ok(peak(heavy) <= .8);
  } finally { Math.random = originalRandom; h.audio.destroy(); }
});

test('special release has more presence than a light impact without rescaling the master', async () => {
  const h = harness(); await h.audio.load();
  h.audio.play('punch'); const light = h.context.sources.at(-1);
  h.audio.play('release'); const special = h.context.sources.at(-1);
  assert.ok(peak(special) > peak(light));
  assert.ok(peak(special) < .65, 'leave room for simultaneous special impacts');
  assert.equal(h.output.gain.value, .1375);
  h.audio.destroy();
});

test('voice cap evicts old voices and ended sources disconnect their whole route', async () => {
  const h = harness(); await h.audio.load();
  for (let i = 0; i < 30; i++) h.audio.play('punch', { variation: i });
  assert.equal(h.audio.stats().activeVoices, 12);
  assert.ok(h.context.sources.slice(0, 18).every(source => source.disconnected && source.stopped));
  const last = h.context.sources.at(-1); const nodes = route(last).slice(0, -1);
  last.end(); assert.equal(h.audio.stats().activeVoices, 11);
  assert.ok(nodes.every(node => node.disconnected));
  h.audio.destroy(); assert.equal(h.audio.stats().activeVoices, 0);
  assert.ok(h.context.nodes.every(node => node.disconnected));
});

test('pause stops tails and resume never replays events observed during pause', async () => {
  const h = harness(); await h.audio.load(); const m = match(); h.audio.observe(m);
  h.audio.play('heavy'); h.audio.pause(); assert.equal(h.audio.stats().activeVoices, 0);
  cast(m.fighters[0]); h.audio.observe(m); h.audio.play('punch');
  const count = h.context.sources.length; h.audio.resume(); h.audio.observe(m);
  assert.equal(h.context.sources.length, count); assert.equal(h.context.resumes, 0);
  assert.equal(h.audio.play('punch'), true); h.audio.destroy();
});

test('destroy aborts in-flight loads and late fetch/decode completion cannot resurrect audio', async () => {
  let finish; const wait = new Promise(resolve => { finish = resolve; }); const requests = [];
  const h = harness({ sources: { punch: [sample('late')] }, fetchImpl: async (url, init) => {
    requests.push(init.signal); await wait;
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
  } });
  const loading = h.audio.load(); await Promise.resolve(); h.audio.destroy(); h.audio.destroy();
  assert.ok(requests[0].aborted); finish(); assert.equal(await loading, false);
  assert.equal(h.audio.stats().loadedBuffers, 0); assert.equal(h.audio.stats().activeVoices, 0);
  assert.equal(h.audio.play('punch'), false); assert.equal(await h.audio.load(), false);
  h.audio.resume(); h.audio.observe(match()); assert.equal(h.context.sources.length, 0);
  assert.equal(h.context.closes, 0);
});

test('destroy during decode discards the late decoded buffer', async () => {
  const context = new Context(); let finish; let decoding;
  const started = new Promise(resolve => { decoding = resolve; });
  context.decodeAudioData = bytes => { decoding(); return new Promise(resolve => { finish = () => resolve({ duration: .2, url: new TextDecoder().decode(bytes) }); }); };
  const h = harness({ context, sources: { punch: [sample('late')] } });
  const loading = h.audio.load(); await started; h.audio.destroy(); finish();
  assert.equal(await loading, false); assert.equal(h.audio.stats().loadedBuffers, 0);
});

test('special casts and character launch crossings play once per side and instance', async () => {
  const h = harness(); await h.audio.load(); const m = match();
  const specialConfigs = { 'fighter-0': { launch: 1.2 }, 'fighter-1': { launch: 1.5 } };
  h.audio.observe(m, { specialConfigs }); cast(m.fighters[0]); cast(m.fighters[1]);
  for (let i = 0; i < 6; i++) h.audio.observe(m, { specialConfigs });
  assert.deepEqual(played(h.context), ['cast', 'cast']);
  m.tick++; m.fighters[0].specialAttack.age = 33; m.fighters[1].specialAttack.age = 33;
  h.audio.observe(m, { specialConfigs }); assert.deepEqual(played(h.context), ['cast', 'cast', 'release']);
  m.tick++; m.fighters[1].specialAttack.age = 51;
  for (let i = 0; i < 6; i++) h.audio.observe(m, { specialConfigs });
  assert.deepEqual(played(h.context), ['cast', 'cast', 'release', 'release']);
  cast(m.fighters[0], 8); m.tick++; h.audio.observe(m, { specialConfigs });
  assert.equal(played(h.context).at(-1), 'cast'); h.audio.destroy();
});

test('dash and landing transitions dedupe repeated ticks while impact and swing stay with Me', async () => {
  const h = harness(); await h.audio.load(); const m = match(); h.audio.observe(m);
  m.fighters[0].state = 'dash'; m.fighters[1].y = 500; m.tick++;
  h.audio.observe(m); h.audio.observe(m); assert.deepEqual(played(h.context), ['dash']);
  m.fighters[0].state = 'attack'; m.fighters[0].move = 'punch'; m.fighters[0].moveTick = 6;
  m.impacts.push({ tick: m.tick, side: 0, x: 700, y: 400, move: 'punch', blocked: false });
  m.fighters[1].y = 600; m.tick++;
  h.audio.observe(m); h.audio.observe(m); assert.deepEqual(played(h.context), ['dash', 'land']);
  m.fighters[0].state = 'dash'; m.tick++; h.audio.observe(m);
  assert.deepEqual(played(h.context), ['dash', 'land', 'dash']); h.audio.destroy();
});

test('round changes and tick rewinds clear dedupe and stop old tails without mutating match', async () => {
  const h = harness(); await h.audio.load(); const m = match(); cast(m.fighters[0]);
  const before = JSON.stringify(m); h.audio.observe(m); assert.equal(JSON.stringify(m), before);
  const first = h.context.sources[0]; m.roundNumber++; m.tick = 2;
  h.audio.observe(m); assert.equal(first.disconnected, true); assert.equal(played(h.context).length, 2);
  const second = h.context.sources[1]; m.tick = 1;
  h.audio.observe(m); assert.equal(second.disconnected, true); assert.equal(played(h.context).length, 3);
  const last = h.context.sources.at(-1); m.phase = 'round-over'; h.audio.observe(m);
  assert.equal(last.disconnected, true); h.audio.destroy();
});

test('paused match stops voices and does not leak a new cast when unpaused', async () => {
  const h = harness(); await h.audio.load(); const m = match(); h.audio.observe(m); h.audio.play('heavy');
  m.paused = true; cast(m.fighters[0]); h.audio.observe(m);
  assert.equal(h.audio.stats().activeVoices, 0);
  const count = h.context.sources.length; m.paused = false; h.audio.resume(); h.audio.observe(m);
  assert.equal(h.context.sources.length, count); h.audio.destroy();
});

test('play failure disconnects every partial node and returns fallback', async () => {
  const context = new Context(); const create = context.createBufferSource.bind(context);
  context.createBufferSource = () => {
    const source = create(); source.start = () => { throw Error('autoplay denied'); }; return source;
  };
  const h = harness({ context }); await h.audio.load();
  assert.equal(h.audio.play('punch'), false); assert.equal(h.audio.stats().activeVoices, 0);
  assert.ok(context.nodes.length > 0); assert.ok(context.nodes.every(node => node.disconnected));
  assert.equal(h.output.disconnected, false); h.audio.destroy();
});

test('limited Web Audio without stereo panner still routes samples through the master', async () => {
  const context = new Context(); context.createStereoPanner = undefined;
  const h = harness({ context }); await h.audio.load();
  assert.equal(h.audio.play('heavy', { side: 1, x: 1200 }), true);
  const path = route(context.sources[0]); assert.equal(path.at(-1), h.output);
  assert.equal(path.filter(node => node.type === 'panner').length, 0);
  h.audio.pause(); assert.ok(path.slice(0, -1).every(node => node.disconnected)); h.audio.destroy();
});

test('announcer preserves a full recording at natural pitch and in the center', async () => {
  const context = new Context();
  context.decodeAudioData = async bytes => ({ duration: 1.8, url: new TextDecoder().decode(bytes) });
  const h = harness({ context }); await h.audio.load();
  assert.equal(h.audio.play('ko', { side: 1, x: 1200, variation: 91, rate: .6 }), true);
  const voice = context.sources.at(-1), path = route(voice);
  assert.equal(voice.playbackRate.value, 1);
  assert.ok(Math.abs(voice.stopTime - voice.startTime - 1.8) < 1e-9, 'speech must not inherit the short effects cap');
  assert.equal(path.find(node => node.type === 'panner').pan.value, 0);
  assert.equal(path.some(node => node.type === 'filter'), false, 'do not muffle the recorded voice');
  assert.equal(path.at(-1), h.output);
  h.audio.destroy();
});

test('round numbers choose the corresponding recording rather than a hashed variant', async () => {
  const h = harness({ sources: { round: [sample('round-1'), sample('round-2'), sample('round-3')] } });
  await h.audio.load();
  for (const number of [1, 2, 3, 20]) {
    h.context.currentTime++;
    assert.equal(h.audio.play('round', { variation: number }), true);
  }
  assert.deepEqual(played(h.context), ['round-1', 'round-2', 'round-3', 'round-3']);
  h.audio.destroy();
});

test('a busy effects pool cannot evict the announcer', async () => {
  const h = harness(); await h.audio.load(); h.audio.play('fight');
  const narrator = h.context.sources[0];
  for (let i = 0; i < 40; i++) h.audio.play('heavy', { variation: i });
  assert.equal(narrator.disconnected, false);
  assert.equal(h.audio.stats().activeEffects, 12);
  assert.equal(h.audio.stats().activeAnnouncers, 1);
  assert.equal(h.audio.stats().activeVoices, 13);
  narrator.end(); assert.equal(h.audio.stats().activeAnnouncers, 0);
  h.audio.destroy();
});

test('Fight follows a speaking round without overlap and a result cancels stale speech', async () => {
  const context = new Context();
  context.decodeAudioData = async bytes => ({ duration: 1.6, url: new TextDecoder().decode(bytes) });
  const h = harness({ context }); await h.audio.load();
  assert.equal(h.audio.play('round', { variation: 1 }), true); const round = context.sources.at(-1);
  context.currentTime = 3.25; h.audio.play('fight'); const fight = context.sources.at(-1);
  assert.equal(round.disconnected, false);
  assert.equal(fight.startTime, round.stopTime);
  const count = context.sources.length; assert.equal(h.audio.play('fight'), true);
  assert.equal(context.sources.length, count, 'duplicate announcements must not build a queue');
  assert.equal(h.audio.stats().queuedAnnouncers, 1);
  h.audio.play('ko'); const result = context.sources.at(-1);
  assert.equal(round.disconnected, true); assert.equal(fight.disconnected, true);
  assert.equal(result.startTime, context.currentTime);
  assert.equal(h.audio.stats().activeAnnouncers, 1);
  assert.equal(h.audio.stats().queuedAnnouncers, 0);
  h.audio.destroy();
});

test('result narration survives the playing to round-over transition', async () => {
  const h = harness(); await h.audio.load(); const m = match(); h.audio.observe(m);
  h.audio.play('heavy'); const effect = h.context.sources.at(-1);
  m.phase = 'round-over'; h.audio.play('ko'); const narrator = h.context.sources.at(-1);
  h.audio.observe(m);
  assert.equal(effect.disconnected, true); assert.equal(narrator.disconnected, false);
  m.roundNumber++; m.tick = 0; h.audio.observe(m);
  assert.equal(narrator.disconnected, true, 'a new round must clear previous speech');
  h.audio.destroy();
});

test('pause, mute and destroy cancel current and scheduled speech without replay', async () => {
  for (const action of ['pause', 'mute', 'destroy']) {
    const context = new Context();
    context.decodeAudioData = async bytes => ({ duration: 1.8, url: new TextDecoder().decode(bytes) });
    const h = harness({ context }); await h.audio.load(); h.audio.play('round'); h.audio.play('fight');
    if (action === 'mute') { h.settings.mute = true; h.audio.observe(match()); }
    else h.audio[action]();
    assert.ok(context.sources.every(source => source.disconnected), action);
    assert.equal(h.audio.stats().activeAnnouncers, 0, action);
    const count = context.sources.length;
    h.settings.mute = false; h.audio.resume(); h.audio.observe(match());
    assert.equal(context.sources.length, count, action);
    h.audio.destroy();
  }
});
