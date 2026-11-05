import { VFX_SHEETS, VFX_TEXTURES, assetURL } from './assets.js';

const IMPACT_TICKS = 18;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const position = item => item && Number.isFinite(item.x) && Number.isFinite(item.y)
  && item.x >= -192 && item.x <= 1472 && item.y >= -192 && item.y <= 912;
const activeMatch = match => match?.phase === 'playing' && !match.roundCountdownLocked;

/** Presentation only: no timers, simulation writes, RNG or extra render surfaces.
 * Inject sources as {sheets, textures}; sheet dimensions describe one cell.
 * load() resolves false when no art is available. Individual missing assets
 * remain independent, and false from drawImpact leaves the original Ae intact.
 */
export function createCombatVFX({ imageFactory = () => new Image(), sources = { sheets: VFX_SHEETS, textures: VFX_TEXTURES } } = {}) {
  const sheets = Object.create(null), textures = Object.create(null), entries = [];
  for (const [key, spec] of Object.entries(sources.sheets || {})) {
    if (!spec || ![spec.width, spec.height, spec.columns, spec.frames].every(value => Number.isInteger(value) && value > 0)) continue;
    const entry = { ...spec, ready: false, image: null, atlas: true };
    sheets[key] = entry; entries.push(entry);
  }
  for (const [key, file] of Object.entries(sources.textures || {})) {
    const entry = { file, ready: false, image: null, atlas: false };
    textures[key] = entry; entries.push(entry);
  }
  let loading;
  // Weak keys keep presentation clocks out of simulation snapshots and let old
  // rounds/events disappear without a retained event list or a second timer.
  const timelines = new WeakMap();

  function timeline(match, options) {
    const clock = Number.isFinite(options.visualTick) ? options.visualTick
      : Number.isFinite(options.presentationTick) ? options.presentationTick : match.tick;
    let state = timelines.get(match);
    if (!state || clock < state.clock || match.tick < state.tick || match.roundNumber !== state.round) {
      state = { clock, tick: match.tick, round: match.roundNumber, contacts: new WeakMap(), casts: new WeakMap() };
      timelines.set(match, state);
    }
    state.clock = clock; state.tick = match.tick;
    return state;
  }

  function specialData(match, fighter, options) {
    const sp = fighter.specialAttack, cfg = options.specialConfigs?.[sp?.id];
    if (!activeMatch(match) || match.paused || fighter.state !== 'special' || !cfg
      || !Number.isFinite(cfg.launch) || cfg.launch < .65 || !Number.isFinite(sp.age) || sp.age < 0) return null;
    const time = .65 + sp.age / 60, released = time - cfg.launch;
    if (released >= .38) return null;
    const fade = castFade(match, sp, options);
    if (!fade) return null;
    const color = typeof cfg.color === 'string' && /^#[\da-f]{6}$/i.test(cfg.color) ? cfg.color : '#f5d39a';
    const warm = parseInt(color.slice(1, 3), 16) > parseInt(color.slice(5, 7), 16);
    return { sp, color, ring: warm ? sheets.fire : sheets.electric, released, fade,
      progress: clamp((time - .65) / Math.max(.1, cfg.launch - .65)), release: clamp(released / .38) };
  }

  function castFade(match, sp, options) {
    const state = timeline(match, options);
    let cast = state.casts.get(sp);
    if (!cast || cast.age !== sp.age) { cast = { age: sp.age, clock: state.clock }; state.casts.set(sp, cast); }
    // A stalled simulation cannot leave a charge/release frozen indefinitely.
    // Pausing stops visualTick in the session; no clock comes from wall time here.
    return clamp(1 - Math.max(0, state.clock - cast.clock - 3) / 15);
  }

  function specialContacts(match, options) {
    const ending = options.endingTick;
    if (options.reduceEffects || match.paused || match.roundCountdownLocked
      || !activeMatch(match) && !(Number.isFinite(ending) && ending >= 0 && ending < IMPACT_TICKS)) return [];
    const state = timeline(match, options), contacts = [], sides = new Set(), impacts = match.impacts || [];
    // Two trades remain visible; a retained multihit list never stacks cores.
    for (let index = impacts.length - 1, stop = Math.max(0, impacts.length - 8); index >= stop; index--) {
      const impact = impacts[index];
      if (impact?.move !== 'special' || !position(impact) || !Number.isFinite(impact.tick)) continue;
      const simulationAge = match.tick - impact.tick;
      if (!Number.isFinite(simulationAge) || simulationAge < 0 || simulationAge >= IMPACT_TICKS) continue;
      let birth = state.contacts.get(impact);
      if (!birth) { birth = { clock: state.clock, age: simulationAge }; state.contacts.set(impact, birth); }
      const age = Math.max(simulationAge + (Number.isFinite(ending) ? ending : 0), birth.age + state.clock - birth.clock);
      const side = impact.side === 1 ? 1 : 0;
      if (age < 0 || age >= (impact.blocked ? 12 : IMPACT_TICKS) || sides.has(side)) continue;
      const fighter = (match.fighters || []).slice(0, 2).find(item => item?.side === side);
      const configured = options.specialConfigs?.[fighter?.id]?.color;
      const color = typeof configured === 'string' && /^#[\da-f]{6}$/i.test(configured) ? configured : '#f5d39a';
      contacts.push({ impact, age, side, color }); sides.add(side);
    }
    return contacts;
  }

  function load() {
    if (loading) return loading;
    loading = Promise.all(entries.map(entry => new Promise(resolve => {
      let image;
      try { image = imageFactory(); }
      catch { resolve(false); return; }
      if (!image || typeof image !== 'object') { resolve(false); return; }
      let settled = false;
      const finish = success => {
        if (settled) return;
        settled = true;
        const width = image.naturalWidth, height = image.naturalHeight;
        entry.ready = !!success && width > 0 && height > 0 && (!entry.atlas
          || width >= entry.width * entry.columns && height >= entry.height * Math.ceil(entry.frames / entry.columns));
        entry.image = entry.ready ? image : null;
        image.onload = image.onerror = null;
        resolve(entry.ready);
      };
      try {
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = assetURL(entry.file);
        if (image.complete) finish(image.naturalWidth > 0);
      } catch { finish(false); }
    }))).then(results => results.some(Boolean));
    return loading;
  }

  // Atlases are sampled only within a cell; frame 1 avoids the almost empty
  // first white-hit cell and gives the hitstop frame an immediate bright core.
  function frame(entry, age, duration) {
    return Math.min(entry.frames - 1, 1 + Math.floor(clamp(age / duration) * (entry.frames - 1)));
  }

  function paint(ctx, entry, cell, x, y, width, height, alpha, rotation = 0, facing = 1) {
    if (!entry?.ready || !(alpha > 0)) return false;
    const image = entry.image;
    cell = clamp(Math.floor(cell), 0, entry.atlas ? entry.frames - 1 : 0);
    const sw = entry.atlas ? entry.width : image.naturalWidth;
    const sh = entry.atlas ? entry.height : image.naturalHeight;
    const sx = entry.atlas ? cell % entry.columns * sw : 0;
    const sy = entry.atlas ? Math.floor(cell / entry.columns) * sh : 0;
    ctx.save();
    ctx.globalAlpha = clamp(alpha);
    ctx.globalCompositeOperation = 'screen';
    ctx.imageSmoothingEnabled = true;
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    if (facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(image, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
    ctx.restore();
    return true;
  }

  function drawImpact(ctx, impact, age, { reduceEffects = false } = {}) {
    if (reduceEffects || !position(impact) || !Number.isFinite(age) || age < 0 || age >= IMPACT_TICKS) return false;
    // Special contacts are drawn once by drawSpecialFront, using visual time to
    // expire during hitstop. A missing atlas preserves the original Ae fallback.
    if (impact.move === 'special') return !!(impact.blocked ? sheets.electric?.ready : sheets.critical?.ready);
    const blocked = !!impact.blocked;
    const heavy = impact.move !== 'punch';
    const entry = blocked ? sheets.electric : impact.combo || impact.counter || heavy ? sheets.critical : sheets.hit;
    if (!entry?.ready) return false;
    const alpha = Math.min(1, (1 - age / IMPACT_TICKS) * 1.35);
    const size = (blocked ? 82 : heavy || impact.combo || impact.counter ? 112 : 88) * (1 + age / 120);
    paint(ctx, entry, frame(entry, age, IMPACT_TICKS), impact.x, impact.y, size, blocked ? size * 1.12 : size,
      alpha * (blocked ? .85 : .95), blocked ? 0 : impact.side === 1 ? -.2 : .2);
    if (blocked && age < 8 && sheets.spark?.ready) {
      paint(ctx, sheets.spark, frame(sheets.spark, age, 8), impact.x, impact.y, 42, 42, (1 - age / 8) * .6);
    }
    return true;
  }

  function drawSwing(ctx, fighter, attackConfigs) {
    const cfg = attackConfigs?.[fighter.move];
    if (fighter.state !== 'attack' || !cfg || !Number.isFinite(cfg.startup) || !(cfg.active > 0) || !sheets.slash?.ready) return;
    const age = fighter.moveTick - cfg.startup, duration = Math.min(cfg.active, 9);
    if (!Number.isFinite(age) || age < 0 || age >= duration) return;
    const facing = fighter.facing === -1 ? -1 : 1;
    const sweep = fighter.move === 'sweep', uppercut = fighter.move === 'uppercut', punch = fighter.move === 'punch';
    const size = punch ? 84 : 118;
    paint(ctx, sheets.slash, frame(sheets.slash, age, duration), fighter.x + facing * (uppercut ? 76 : punch ? 96 : 134),
      fighter.y - (sweep ? 38 : uppercut ? 210 : 151), size, size, (1 - age / duration) * .47,
      sweep ? -.8 : uppercut ? -1.25 : -.22, facing);
  }

  function drawDust(ctx, fighter) {
    if (!textures.smoke?.ready || fighter.y < 594) return;
    if (fighter.state === 'dash' && Number.isFinite(fighter.stateTicks) && fighter.stateTicks >= 0 && fighter.stateTicks < 10) {
      const age = fighter.stateTicks, direction = fighter.dashDirection === -1 ? -1 : 1;
      paint(ctx, textures.smoke, 0, fighter.x - direction * (26 + age * 2), 590 - age * .4,
        76 + age * 5, 28 + age, (1 - age / 12) * .25, -.08 * direction);
    } else if (Number.isFinite(fighter.landingTicks) && fighter.landingTicks > 0 && fighter.landingTicks <= 6) {
      const age = 6 - fighter.landingTicks;
      paint(ctx, textures.smoke, 0, fighter.x, 592, 72 + age * 9, 24 + age * 2, (1 - age / 6) * .23);
    }
  }

  function drawSpecial(ctx, match, fighter, options) {
    const data = specialData(match, fighter, options);
    if (!data) return;
    const { sp, color, ring, released, progress, release, fade } = data;
    if (!ring?.ready) return;
    const alpha = (released < 0 ? (.28 + progress * .32) : (1 - release) ** 1.5 * .82) * fade;
    const size = released < 0 ? 158 + progress * 62 : 220 + release * 190;
    paint(ctx, ring, Math.floor(sp.age * .8) % ring.frames, fighter.x, 594, size, size * .28, alpha, 0, sp.dir);
    paint(ctx, textures.flare, 0, fighter.x, fighter.y - 145, released < 0 ? 142 : 205, 90, alpha * .45);
    ctx.save(); ctx.globalAlpha = alpha * .7; ctx.strokeStyle = color; ctx.lineWidth = released < 0 ? 2 : 4;
    ctx.beginPath(); ctx.ellipse(fighter.x, 594, size * .48, size * .115, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    if (released >= 0) paint(ctx, textures.smoke, 0, fighter.x, 592, size * .9, 46, (1 - release) * .3 * fade);
  }

  function drawWorld(ctx, match, options = {}) {
    const { reduceEffects = false, attackConfigs } = options;
    if (reduceEffects || !activeMatch(match)) return;
    const fighters = match.fighters || [];
    for (let index = 0; index < Math.min(2, fighters.length); index++) {
      const fighter = fighters[index];
      if (!position(fighter)) continue;
      drawDust(ctx, fighter);
      drawSwing(ctx, fighter, attackConfigs);
      drawSpecial(ctx, match, fighter, options);
    }
  }

  function drawBackdrop(ctx, match, options = {}) {
    if (options.reduceEffects) return;
    const contacts = specialContacts(match, options).filter(item => !item.impact.blocked && sheets.critical?.ready);
    const casts = [];
    for (const fighter of (match.fighters || []).slice(0, 2)) {
      if (!position(fighter)) continue;
      const data = specialData(match, fighter, options);
      if (data?.ring?.ready) casts.push({ fighter, ...data });
    }
    let dim = 0;
    for (const data of casts) dim = Math.max(dim, data.fade * (data.released < 0 ? .13 + data.progress * .19 : .2 * (1 - data.release) ** 2));
    for (const { age } of contacts) if (age < 4) dim = Math.max(dim, .78 * (1 - age / 4) ** 2);
    if (!dim && !casts.length) return;
    const bounds = options.backdropBounds;
    const fullViewport = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width > 0 && bounds.height > 0;
    ctx.save(); ctx.globalAlpha = dim; ctx.fillStyle = '#06101c';
    if (fullViewport) ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    else ctx.fillRect(0, 0, 1280, 720);
    ctx.restore();
    for (const { fighter, color, released, progress, release, fade } of casts) {
      const strength = (released < 0 ? .16 + progress * .2 : .32 * (1 - release) ** 2) * fade;
      const x = fighter.x, y = fighter.y - 133;
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const glow = ctx.createRadialGradient(x, y, 35, x, y, released < 0 ? 178 : 225);
      glow.addColorStop(0, 'transparent'); glow.addColorStop(.38, color); glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow; ctx.globalAlpha = strength * .65; ctx.fillRect(x - 225, y - 225, 450, 450);
      ctx.fillStyle = color; ctx.globalAlpha = strength;
      for (let index = 0; index < 8; index++) {
        const angle = -Math.PI + index * Math.PI / 7, ray = 110 + index % 3 * 24 + progress * 35;
        const ax = Math.cos(angle), ay = Math.sin(angle);
        ctx.beginPath(); ctx.moveTo(x + ax * 72, y + ay * 72);
        ctx.lineTo(x + ax * ray - ay * 7, y + ay * ray + ax * 7);
        ctx.lineTo(x + ax * (ray + 48), y + ay * (ray + 48)); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawSpecialFront(ctx, match, options = {}) {
    if (options.reduceEffects) return;
    for (const fighter of (match.fighters || []).slice(0, 2)) {
      if (!position(fighter)) continue;
      const data = specialData(match, fighter, options);
      if (!data?.ring?.ready || data.released < 0) continue;
      const radius = 54 + data.release * 125;
      const facing = data.sp.dir === -1 ? -1 : 1, angle = facing < 0 ? Math.PI : 0;
      ctx.save(); ctx.globalAlpha = (1 - data.release) ** 2 * .65 * data.fade;
      ctx.strokeStyle = data.color; ctx.lineWidth = 5 * (1 - data.release) + 1;
      ctx.beginPath(); ctx.ellipse(fighter.x + facing * 40, fighter.y - 128,
        radius * .66, radius, -.15 * facing, angle - 1.2, angle + 1.2); ctx.stroke(); ctx.restore();
    }
    for (const { impact, age, color } of specialContacts(match, options)) {
      const blocked = !!impact.blocked, duration = blocked ? 12 : IMPACT_TICKS;
      const entry = blocked ? sheets.electric : sheets.critical;
      if (!entry?.ready) continue;
      const progress = age / duration, alpha = (1 - progress) ** 1.25;
      const size = blocked ? 122 + progress * 30 : 218 + progress * 96;
      paint(ctx, entry, frame(entry, age, duration), impact.x, impact.y, size, size, alpha * (blocked ? .8 : .98));
      ctx.save(); ctx.globalAlpha = alpha * (blocked ? .65 : .9); ctx.strokeStyle = blocked ? '#aeeaff' : color;
      ctx.lineWidth = blocked ? 2 : 3;
      ctx.beginPath(); ctx.ellipse(impact.x, impact.y, 38 + progress * (blocked ? 38 : 136), 46 + progress * (blocked ? 38 : 114),
        0, 0, Math.PI * 2); ctx.stroke();
      if (!blocked) {
        ctx.fillStyle = color;
        for (let index = 0; index < 12; index++) {
          const angle = index * Math.PI / 6 + .16, ax = Math.cos(angle), ay = Math.sin(angle);
          const inner = 28 + progress * 115 + index % 3 * 5, outer = inner + (1 - progress) * (76 + index % 3 * 21);
          const width = (1 - progress) * (index % 2 ? 3 : 6);
          ctx.beginPath(); ctx.moveTo(impact.x + ax * inner, impact.y + ay * inner * .78);
          ctx.lineTo(impact.x + ax * outer - ay * width, impact.y + ay * outer * .78 + ax * width);
          ctx.lineTo(impact.x + ax * (outer + 22), impact.y + ay * (outer + 22) * .78);
          ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = '#fff3cf'; ctx.lineWidth = 1.5; ctx.globalAlpha = alpha * .8;
        ctx.beginPath();
        for (let index = 0; index < 8; index++) {
          const angle = index * Math.PI / 4 + .35, ax = Math.cos(angle), ay = Math.sin(angle);
          const inner = 92 + progress * 105, outer = inner + (1 - progress) * 98;
          ctx.moveTo(impact.x + ax * inner, impact.y + ay * inner * .7);
          ctx.lineTo(impact.x + ax * outer, impact.y + ay * outer * .7);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawSpecialOverlay(ctx, match, options) {
    const contact = specialContacts(match, options).filter(item => !item.impact.blocked && item.age < 6 && sheets.critical?.ready)
      .sort((a, b) => a.age - b.age)[0];
    if (!contact) return;
    const { width, height } = options, strength = (1 - contact.age / 6) ** 2;
    ctx.save(); ctx.globalAlpha = strength * .19; ctx.strokeStyle = contact.color;
    ctx.lineWidth = Math.max(1, width / 640); ctx.beginPath();
    for (let index = 0; index < 8; index++) {
      const left = index % 2 === 0, x = left ? 0 : width, y = height * (.18 + Math.floor(index / 2) * .2);
      ctx.moveTo(x, y); ctx.lineTo(x + (left ? 1 : -1) * width * (.1 + index % 3 * .025), y + (height * .56 - y) * .15);
    }
    ctx.stroke(); ctx.restore();
  }

  function drawOverlay(ctx, match, options = {}) {
    const { width, height, reduceEffects = false } = options;
    if (reduceEffects || !activeMatch(match) || !textures.flare?.ready
      || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    drawSpecialOverlay(ctx, match, options);
    let strength = 0, side = 0, blue = false;
    const impacts = match.impacts || [];
    // At most eight candidate contacts, one accent. Trades never stack flashes.
    for (let index = Math.max(0, impacts.length - 8); index < impacts.length; index++) {
      const impact = impacts[index], age = match.tick - impact?.tick;
      if (impact?.move === 'special') continue;
      if (!position(impact) || !Number.isFinite(age) || age < 0 || age >= 6) continue;
      const power = (impact.blocked ? .22 : impact.counter || impact.combo ? .9 : impact.move === 'punch' ? .4 : .65) * (1 - age / 6) ** 2;
      if (power > strength) { strength = power; side = impact.side === 1 ? 1 : 0; blue = !!impact.blocked; }
    }
    const fighters = match.fighters || [];
    for (let index = 0; index < Math.min(2, fighters.length); index++) {
      const fighter = fighters[index], age = fighter?.specialAttack?.age;
      if (fighter?.state !== 'special' || !position(fighter) || !Number.isFinite(age) || age < 0 || age >= 10) continue;
      if (match.paused) continue;
      const power = .32 * (1 - age / 10) ** 2 * castFade(match, fighter.specialAttack, options);
      if (power > strength) { strength = power; side = fighter.side === 1 ? 1 : 0; blue = false; }
    }
    if (!strength) return;
    const edge = side === 0 ? width * .96 : width * .04;
    paint(ctx, textures.flare, 0, edge, height * .6, width * .42, height * .8, strength * .14, Math.PI / 2);
    if (strength < .45) return;
    ctx.save();
    ctx.globalAlpha = strength * .13;
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = blue ? '#b8efff' : '#fff1c3';
    ctx.lineWidth = Math.max(1, width / 1280);
    ctx.beginPath();
    for (let index = 0; index < 6; index++) {
      const y = height * (.3 + index * .105), length = width * (.035 + index % 3 * .012);
      const x = side === 0 ? width - index % 2 * width * .025 : index % 2 * width * .025;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (side === 0 ? -length : length), y + (height * .59 - y) * .06);
    }
    ctx.stroke();
    ctx.restore();
  }

  return { load, drawImpact, drawBackdrop, drawWorld, drawSpecialFront, drawOverlay };
}
