import test from 'node:test';
import assert from 'node:assert/strict';
import { VFX_SHEETS, VFX_TEXTURES } from '../polish/assets.js';

async function renderer(options) {
  let vfxModule;
  try { vfxModule = await import('../polish/vfx.js'); }
  catch (error) { assert.fail(`Combat VFX module is unavailable: ${error.message}`); }
  assert.equal(typeof vfxModule.createCombatVFX, 'function');
  return vfxModule.createCombatVFX(options);
}

// Only image transport and the canvas boundary are replaced. The renderer, source
// definitions, frame selection and lifetime handling under test are the real code.
function images({ fail = () => false } = {}) {
  const created = [];
  return {
    created,
    imageFactory() {
      const image = { complete: false, naturalWidth: 0, naturalHeight: 0 };
      Object.defineProperty(image, 'src', {
        get() { return this.url; },
        set(url) {
          this.url = url;
          queueMicrotask(() => {
            this.complete = true;
            if (fail(url)) { this.onerror?.(new Error('unavailable')); return; }
            const sheet = Object.values(VFX_SHEETS).find(item => url.endsWith(item.file));
            this.naturalWidth = sheet ? sheet.width * sheet.columns : 512;
            this.naturalHeight = sheet ? sheet.height * Math.ceil(sheet.frames / sheet.columns) : 512;
            this.onload?.();
          });
        },
      });
      created.push(image);
      return image;
    },
  };
}

function canvas() {
  const calls = [], stack = [];
  const ctx = { globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, imageSmoothingEnabled: false,
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation,
      fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, imageSmoothingEnabled: this.imageSmoothingEnabled }); calls.push({ method: 'save', args: [] }); },
    restore() { assert.ok(stack.length, 'balanced canvas restore'); Object.assign(this, stack.pop()); calls.push({ method: 'restore', args: [] }); },
    createLinearGradient(...args) { calls.push({ method: 'createLinearGradient', args }); return { addColorStop() {} }; },
    createRadialGradient(...args) { calls.push({ method: 'createRadialGradient', args }); return { addColorStop() {} }; },
  };
  for (const method of ['drawImage', 'translate', 'scale', 'rotate', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect', 'ellipse', 'arc', 'closePath']) {
    ctx[method] = (...args) => {
      assert.ok(Number.isFinite(ctx.globalAlpha) && ctx.globalAlpha >= 0 && ctx.globalAlpha <= 1, 'finite bounded alpha');
      for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${method} has finite coordinates`);
      calls.push({ method, args, alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation,
        fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle });
    };
  }
  return { ctx, calls, get draws() { return calls.filter(call => call.method === 'drawImage'); },
    reset() { calls.length = 0; }, balanced() { assert.equal(stack.length, 0); assert.equal(ctx.globalAlpha, 1); assert.equal(ctx.globalCompositeOperation, 'source-over'); } };
}

const impact = (extra = {}) => ({ x: 720, y: 410, blocked: false, damage: 45, move: 'punch', side: 0, combo: false, counter: false, tick: 100, ...extra });
const fighter = (extra = {}) => ({ id: 'cleopatra', side: 0, x: 540, y: 600, state: 'idle', stateTicks: 0, dashDirection: 0,
  facing: 1, landingTicks: 0, move: null, moveTick: 0, specialAttack: null, ...extra });
const match = (extra = {}) => ({ tick: 100, phase: 'playing', paused: false, fighters: [fighter(), fighter({ side: 1, x: 800, facing: -1 })], impacts: [], ...extra });
const attackConfigs = { punch: { startup: 6, active: 6 }, kick: { startup: 12, active: 8 } };
const specialConfigs = { cleopatra: { launch: 1.55, end: 3.35, color: '#73dbc9' }, napoleao: { launch: 1.65, end: 3.5, color: '#f5d39a' } };
const special = (extra = {}) => fighter({ state: 'special', specialAttack: { id: 'cleopatra', age: 24, origin: 540, dir: 1, hits: [], ...extra } });

async function loaded(options = {}) {
  const transport = images(options), vfx = await renderer({ imageFactory: transport.imageFactory });
  await vfx.load();
  return { vfx, transport };
}

test('unloaded or failed art leaves the existing impact fallback available without drawing', async () => {
  const transport = images({ fail: () => true }), vfx = await renderer({ imageFactory: transport.imageFactory }), c = canvas();
  assert.equal(vfx.drawImpact(c.ctx, impact(), 0), false);
  assert.equal(await vfx.load(), false);
  assert.equal(vfx.drawImpact(c.ctx, impact(), 0), false);
  vfx.drawWorld(c.ctx, match({ fighters: [special()] }), { specialConfigs });
  vfx.drawOverlay(c.ctx, match({ impacts: [impact()] }), { width: 1280, height: 720 });
  assert.equal(c.calls.length, 0);
});

test('load caches image readiness and tolerates a throwing image factory', async () => {
  const transport = images(), vfx = await renderer({ imageFactory: transport.imageFactory });
  const results = await Promise.all([vfx.load(), vfx.load(), vfx.load()]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(transport.created.length, 8);
  await vfx.load();
  assert.equal(transport.created.length, 8);
  const unavailable = await renderer({ imageFactory() { throw new Error('unsupported'); } });
  assert.equal(await unavailable.load(), false);
  const unsupported = await renderer({ imageFactory() { return null; } });
  assert.equal(await unsupported.load(), false);
});

test('a broken hit sheet does not disable a healthy blue guard sheet', async () => {
  const { vfx } = await loaded({ fail: url => url.endsWith(VFX_SHEETS.hit.file) }), c = canvas();
  assert.equal(vfx.drawImpact(c.ctx, impact(), 0), false);
  assert.equal(vfx.drawImpact(c.ctx, impact({ blocked: true }), 0), true);
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.electric.file)));
  c.balanced();
});

test('impact atlases start visibly, advance across rows, and stay inside their cells', async () => {
  const { vfx } = await loaded(), c = canvas();
  for (const [hit, age, file, crop] of [
    [impact(), 0, VFX_SHEETS.hit.file, [256, 0, 256, 256]],
    [impact(), 9, VFX_SHEETS.hit.file, [1024, 0, 256, 256]],
    [impact({ counter: true }), 10, VFX_SHEETS.critical.file, [0, 256, 256, 256]],
    [impact({ blocked: true }), 9, VFX_SHEETS.electric.file, [795, 530, 265, 265]],
  ]) {
    c.reset(); assert.equal(vfx.drawImpact(c.ctx, hit, age), true);
    const draw = c.draws.find(call => call.args[0].src.endsWith(file));
    assert.ok(draw, `rendered ${file}`);
    assert.deepEqual(draw.args.slice(1, 5), crop);
    assert.ok(draw.args[7] <= 150 && draw.args[8] <= 150, 'contact stays compact beside the fighter');
    c.balanced();
  }
  for (let age = 0; age < 18; age += .5) {
    c.reset(); vfx.drawImpact(c.ctx, impact({ combo: true }), age);
    for (const { args } of c.draws) {
      assert.ok(args[1] >= 0 && args[2] >= 0);
      assert.ok(args[1] + args[3] <= args[0].naturalWidth);
      assert.ok(args[2] + args[4] <= args[0].naturalHeight);
    }
  }
});

test('contact lifetimes reject invalid, future, expired or off-world data', async () => {
  const { vfx } = await loaded(), c = canvas();
  for (const age of [-1, NaN, Infinity, 18, 1000]) assert.equal(vfx.drawImpact(c.ctx, impact(), age), false);
  for (const item of [null, impact({ x: NaN }), impact({ y: Infinity }), impact({ x: 1e9 })]) assert.equal(vfx.drawImpact(c.ctx, item, 0), false);
  assert.equal(c.calls.length, 0);
});

test('idle and reduced effects leave the canvas completely untouched', async () => {
  const { vfx } = await loaded(), c = canvas();
  vfx.drawWorld(c.ctx, match(), { specialConfigs, presentationTick: 100 });
  vfx.drawOverlay(c.ctx, match(), { width: 1280, height: 720, presentationTick: 100 });
  assert.equal(c.calls.length, 0);
  const active = match({ fighters: [special(), fighter({ state: 'dash', dashDirection: -1 })], impacts: [impact({ counter: true })] });
  assert.equal(vfx.drawImpact(c.ctx, impact(), 0, { reduceEffects: true }), false);
  vfx.drawWorld(c.ctx, active, { reduceEffects: true, specialConfigs });
  vfx.drawOverlay(c.ctx, active, { width: 390, height: 844, reduceEffects: true });
  assert.equal(c.calls.length, 0);
});

test('round end and countdown cannot freeze a new aura or overlay on screen', async () => {
  const { vfx } = await loaded(), c = canvas();
  for (const flags of [{ phase: 'round-over' }, { phase: 'finished' }, { roundCountdownLocked: true }]) {
    const state = match({ ...flags, fighters: [special()], impacts: [impact({ counter: true })] });
    vfx.drawWorld(c.ctx, state, { specialConfigs });
    vfx.drawOverlay(c.ctx, state, { width: 1280, height: 720 });
    assert.equal(c.calls.length, 0);
  }
});

test('ordinary swing art is restricted to its existing active startup window', async () => {
  const { vfx } = await loaded(), c = canvas();
  for (const moveTick of [0, 5, 12, 30]) {
    vfx.drawWorld(c.ctx, match({ fighters: [fighter({ state: 'attack', move: 'punch', moveTick })] }), { attackConfigs });
    assert.equal(c.calls.length, 0, `no slash at move tick ${moveTick}`);
  }
  vfx.drawWorld(c.ctx, match({ fighters: [fighter({ state: 'attack', move: 'punch', moveTick: 7 })] }), { attackConfigs });
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.slash.file)));
  c.balanced();
});

test('dash and landing dust use the community smoke texture and finish with their existing states', async () => {
  const { vfx } = await loaded(), c = canvas();
  for (const current of [fighter({ state: 'dash', dashDirection: 1, stateTicks: 2 }), fighter({ landingTicks: 5 })]) {
    c.reset(); vfx.drawWorld(c.ctx, match({ fighters: [current] }));
    assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_TEXTURES.smoke)));
    c.balanced();
  }
  c.reset(); vfx.drawWorld(c.ctx, match({ fighters: [fighter({ stateTicks: 500 })] }));
  assert.equal(c.calls.length, 0);
});

test('special charge and release use configured .65-offset clocks without repeating special contacts', async () => {
  const { vfx } = await loaded(), c = canvas();
  vfx.drawWorld(c.ctx, match({ fighters: [special()] }), { specialConfigs });
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.electric.file)));
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_TEXTURES.flare)));
  c.reset();
  const release = fighter({ id: 'napoleao', state: 'special', specialAttack: { id: 'napoleao', age: 60, origin: 540, dir: 1, hits: [] } });
  vfx.drawWorld(c.ctx, match({ fighters: [release] }), { specialConfigs });
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.fire.file)), 'release occurs at .65 + 60/60, not at age/60');
  const noHits = c.calls;
  const recorded = JSON.stringify(noHits);
  c.reset(); release.specialAttack.hits = [{ x: 850, y: 410, time: 1.65, blocked: false }];
  vfx.drawWorld(c.ctx, match({ fighters: [release] }), { specialConfigs });
  assert.equal(JSON.stringify(c.calls), recorded);
  c.reset();
  vfx.drawWorld(c.ctx, match({ fighters: [special({ age: 150, hits: [{ x: 800, y: 400, time: 3.1 }] })] }), { specialConfigs });
  assert.equal(c.calls.length, 0, 'late specials do not leave a permanent aura');
});

test('overlays are brief transparent edge accents at desktop and portrait sizes', async () => {
  const { vfx } = await loaded(), c = canvas();
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    c.reset();
    vfx.drawOverlay(c.ctx, match({ impacts: [impact({ counter: true })] }), { width, height });
    assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_TEXTURES.flare)));
    assert.ok(c.calls.every(call => call.alpha === undefined || call.alpha <= .18), 'no opaque screen flash');
    assert.equal(c.calls.some(call => call.method === 'fillRect' && call.args[2] === width && call.args[3] === height), false);
    c.balanced();
  }
  for (const input of [match({ tick: 106, impacts: [impact()] }), match({ tick: 99, impacts: [impact()] }), match()]) {
    c.reset(); vfx.drawOverlay(c.ctx, input, { width: 1280, height: 720 }); assert.equal(c.calls.length, 0);
  }
  for (const [width, height] of [[0, 720], [Infinity, 720], [390, NaN]]) {
    c.reset(); vfx.drawOverlay(c.ctx, match({ impacts: [impact()] }), { width, height }); assert.equal(c.calls.length, 0);
  }
});

test('a special cast gets one restrained edge pulse that ends before the sustained charge', async () => {
  const { vfx } = await loaded(), c = canvas();
  vfx.drawOverlay(c.ctx, match({ fighters: [special({ age: 3 })] }), { width: 1280, height: 720 });
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_TEXTURES.flare)));
  assert.ok(c.draws.every(call => call.alpha < .08));
  c.balanced(); c.reset();
  vfx.drawOverlay(c.ctx, match({ fighters: [special({ age: 11 })] }), { width: 1280, height: 720 });
  assert.equal(c.calls.length, 0);
});

test('special anticipation dims the stage behind fighters and uses the configured palette', async () => {
  const { vfx } = await loaded(), c = canvas();
  assert.equal(typeof vfx.drawBackdrop, 'function', 'a separate special backdrop layer exists');
  for (const id of ['cleopatra', 'napoleao']) {
    c.reset();
    const state = match({ fighters: [fighter({ id, state: 'special', specialAttack: { id, age: 30, dir: 1 } })] });
    vfx.drawBackdrop(c.ctx, state, { specialConfigs, visualTick: 100 });
    const dim = c.calls.find(call => call.method === 'fillRect' && call.args[2] === 1280 && call.args[3] === 720);
    assert.ok(dim && dim.alpha >= .12 && dim.alpha <= .45, 'visible, bounded stage dim');
    assert.equal(dim.fillStyle, '#06101c', 'the contrast frame is dark');
    assert.ok(c.calls.some(call => call.method === 'fill' && call.fillStyle === specialConfigs[id].color), 'rays carry the character palette');
    assert.equal(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.critical.file)), false, 'charge does not invent a contact');
    c.balanced();
  }
  c.reset(); vfx.drawBackdrop(c.ctx, match({ impacts: [impact()] }), { specialConfigs });
  assert.equal(c.calls.length, 0, 'ordinary contacts never darken the stage');
});

test('special release has a large expanding ring at the configured .65-offset launch', async () => {
  const { vfx } = await loaded(), c = canvas();
  assert.equal(typeof vfx.drawSpecialFront, 'function', 'special release and contact have a world front layer');
  const state = match({ fighters: [special({ age: 60, id: 'napoleao' })] });
  vfx.drawWorld(c.ctx, state, { specialConfigs, visualTick: 100 });
  vfx.drawSpecialFront(c.ctx, state, { specialConfigs, visualTick: 100 });
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.fire.file) && call.args[7] >= 190), 'release ring reads larger than an ordinary swing');
  assert.ok(c.calls.some(call => call.method === 'ellipse' && call.args[2] >= 50), 'release also has a clear geometric rim');
  assert.equal(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.critical.file)), false, 'a whiff has no contact explosion');
  c.balanced();
});

test('special stage contrast covers the full portrait canvas through its world transform', async () => {
  const { vfx } = await loaded(), c = canvas();
  const backdropBounds = { x: -10, y: -1707, width: 1300, height: 2770 };
  vfx.drawBackdrop(c.ctx, match({ fighters: [special()] }), { specialConfigs, backdropBounds });
  const rect = c.calls.find(call => call.method === 'fillRect');
  assert.deepEqual(rect.args, [-10, -1707, 1300, 2770], 'no hard edge across sky or floor in portrait');
  c.balanced();
});

test('only a confirmed special hit gets a large burst, radial shards and one dark impact frame', async () => {
  const { vfx } = await loaded(), c = canvas();
  assert.equal(typeof vfx.drawSpecialFront, 'function');
  const state = match({ impacts: [impact({ move: 'special' })] });
  vfx.drawBackdrop(c.ctx, state, { specialConfigs, visualTick: 100 });
  vfx.drawSpecialFront(c.ctx, state, { specialConfigs, visualTick: 100 });
  assert.equal(c.calls.filter(call => call.method === 'fillRect' && call.args[2] === 1280 && call.args[3] === 720).length, 1);
  const contrast = c.calls.find(call => call.method === 'fillRect' && call.args[2] === 1280 && call.args[3] === 720);
  assert.ok(contrast.alpha >= .7 && contrast.alpha <= .8, 'the contact frame strongly separates the fighters from the stage');
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.critical.file) && call.args[7] >= 190), 'contact core is substantially larger than ordinary heavy art');
  assert.ok(c.calls.filter(call => call.method === 'lineTo').length >= 20, 'directional shards and lines carry the impact');
  assert.ok(c.calls.some(call => call.strokeStyle === specialConfigs.cleopatra.color), 'contact retains the attacker palette');
  c.balanced();
  c.reset();
  assert.equal(vfx.drawImpact(c.ctx, impact({ move: 'special' }), 0), true, 'front layer owns the special contact');
  assert.equal(c.calls.length, 0, 'Ae cannot duplicate the same special core');
});

test('the special release arc faces the direction of the attack on either side', async () => {
  const { vfx } = await loaded(), c = canvas();
  for (const dir of [-1, 1]) {
    c.reset();
    vfx.drawSpecialFront(c.ctx, match({ fighters: [special({ age: 60, id: 'napoleao', dir })] }), { specialConfigs });
    const arc = c.calls.find(call => call.method === 'ellipse');
    assert.ok(arc);
    const middle = (arc.args[5] + arc.args[6]) / 2;
    assert.equal(Math.sign(Math.cos(middle)), dir, 'release rim opens toward the opponent');
  }
});

test('blocked specials keep their guard ring without damage shards or a dark contact frame', async () => {
  const { vfx } = await loaded(), c = canvas();
  assert.equal(typeof vfx.drawSpecialFront, 'function');
  const state = match({ impacts: [impact({ move: 'special', blocked: true, damage: 0 })] });
  vfx.drawBackdrop(c.ctx, state, { specialConfigs, visualTick: 100 });
  assert.equal(c.calls.length, 0, 'guard contact never triggers the stage impact frame');
  vfx.drawSpecialFront(c.ctx, state, { specialConfigs, visualTick: 100 });
  assert.ok(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.electric.file)));
  assert.equal(c.draws.some(call => call.args[0].src.endsWith(VFX_SHEETS.critical.file)), false);
  assert.ok(c.draws.every(call => call.args[7] <= 156), 'guard contact remains compact');
  assert.equal(c.calls.some(call => call.method === 'fill'), false, 'guard receives no damage shards');
  c.balanced();
});

test('special contact clocks expire through hitstop, including an event at tick zero', async () => {
  const { vfx } = await loaded(), c = canvas();
  assert.equal(typeof vfx.drawSpecialFront, 'function');
  const state = match({ tick: 0, hitstop: 12, impacts: [impact({ move: 'special', tick: 0 })] });
  const options = { width: 1280, height: 720, specialConfigs, presentationTick: 0, visualTick: 0 };
  vfx.drawBackdrop(c.ctx, state, options); vfx.drawSpecialFront(c.ctx, state, options);
  assert.ok(c.draws.length > 0, 'a tick-zero event is visible immediately');
  c.reset();
  const later = { ...options, visualTick: 20 };
  vfx.drawBackdrop(c.ctx, state, later); vfx.drawSpecialFront(c.ctx, state, later); vfx.drawOverlay(c.ctx, state, later);
  assert.equal(c.calls.length, 0, 'special effects finish while simulation and original presentation tick remain frozen');
  assert.equal(state.tick, 0); assert.equal(state.hitstop, 12);
});

test('special anticipation also expires if its age stalls while visual time advances', async () => {
  const { vfx } = await loaded(), c = canvas();
  assert.equal(typeof vfx.drawBackdrop, 'function');
  const state = match({ tick: 0, fighters: [special({ age: 0 })] });
  vfx.drawBackdrop(c.ctx, state, { specialConfigs, visualTick: 0 });
  assert.ok(c.calls.length > 0, 'anticipation starts at age zero');
  c.reset();
  vfx.drawBackdrop(c.ctx, state, { specialConfigs, visualTick: 30 });
  vfx.drawWorld(c.ctx, state, { specialConfigs, visualTick: 30 });
  vfx.drawSpecialFront(c.ctx, state, { specialConfigs, visualTick: 30 });
  vfx.drawOverlay(c.ctx, state, { width: 1280, height: 720, specialConfigs, visualTick: 30 });
  assert.equal(c.calls.length, 0);
});

test('special additions honor pause, countdown and reduced effects, with a bounded KO contact tail', async () => {
  const { vfx } = await loaded(), c = canvas();
  assert.equal(typeof vfx.drawBackdrop, 'function');
  for (const flags of [{ paused: true }, { roundCountdownLocked: true }, { phase: 'finished' }]) {
    const state = match({ ...flags, fighters: [special()], impacts: [impact({ move: 'special' })] });
    for (const method of ['drawBackdrop', 'drawSpecialFront']) vfx[method](c.ctx, state, { specialConfigs, visualTick: 100 });
    assert.equal(c.calls.length, 0);
  }
  const state = match({ fighters: [special()], impacts: [impact({ move: 'special' })] });
  for (const method of ['drawBackdrop', 'drawSpecialFront']) vfx[method](c.ctx, state, { specialConfigs, visualTick: 100, reduceEffects: true });
  assert.equal(c.calls.length, 0);
  const ko = match({ phase: 'finished', fighters: [special()], impacts: [impact({ move: 'special' })] });
  vfx.drawSpecialFront(c.ctx, ko, { specialConfigs, visualTick: 100, endingTick: 0 });
  assert.ok(c.draws.length > 0, 'the confirmed knockout contact can finish');
  c.reset();
  vfx.drawBackdrop(c.ctx, ko, { specialConfigs, visualTick: 130, endingTick: 30 });
  vfx.drawSpecialFront(c.ctx, ko, { specialConfigs, visualTick: 130, endingTick: 30 });
  assert.equal(c.calls.length, 0, 'KO cannot retain a charge or contact frame');
});

test('special trades and retained multihits have bounded draw work and never stack contrast frames', async () => {
  const { vfx } = await loaded(), c = canvas();
  assert.equal(typeof vfx.drawSpecialFront, 'function');
  const state = freeze(match({ impacts: Array.from({ length: 10000 }, (_, index) => impact({ move: 'special', side: index % 2 })) }));
  const before = JSON.stringify(state), options = { width: 390, height: 844, specialConfigs, visualTick: 100 };
  vfx.drawBackdrop(c.ctx, state, options); vfx.drawSpecialFront(c.ctx, state, options); vfx.drawOverlay(c.ctx, state, options);
  assert.equal(c.calls.filter(call => call.method === 'fillRect' && call.args[2] === 1280 && call.args[3] === 720).length, 1);
  assert.ok(c.draws.filter(call => call.args[0].src.endsWith(VFX_SHEETS.critical.file)).length <= 2, 'one core per side');
  assert.ok(c.calls.length < 300, 'retained contacts do not increase draw work');
  assert.equal(c.calls.some(call => call.method === 'fillRect' && call.args[2] === 390 && call.args[3] === 844), false, 'portrait overlay has no full-screen white flash');
  assert.equal(JSON.stringify(state), before);
  c.balanced();
});

function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; }

test('repeated presentation is deterministic, read-only, bounded and reuses loaded images', async () => {
  const { vfx, transport } = await loaded(), c = canvas();
  const state = freeze(match({ fighters: [special(), fighter({ state: 'dash', dashDirection: -1, stateTicks: 4 })],
    impacts: Array.from({ length: 10000 }, (_, index) => impact({ x: 720 + index % 20, counter: true })) }));
  const snapshot = JSON.stringify(state), imageCount = transport.created.length;
  const draw = () => {
    vfx.drawImpact(c.ctx, state.impacts[0], 2);
    vfx.drawWorld(c.ctx, state, { specialConfigs, attackConfigs, presentationTick: 100 });
    vfx.drawOverlay(c.ctx, state, { width: 1280, height: 720, presentationTick: 100 });
    assert.ok(c.calls.length < 180, 'render work stays bounded despite retained event count');
    c.balanced();
  };
  draw(); const first = JSON.stringify(c.calls);
  for (let frame = 0; frame < 120; frame++) { c.reset(); draw(); assert.equal(JSON.stringify(c.calls), first); }
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(transport.created.length, imageCount);
});
