import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function audioLifecycle() {
  const start = html.indexOf('function cronosBindCombatAudio(');
  assert.ok(start >= 0, 'Missing session audio lifecycle binding');
  const end = html.indexOf('\n}', start);
  assert.ok(end > start);
  const window = new EventTarget(), document = new EventTarget(), calls = [];
  let focused = true;
  document.hidden = false; document.hasFocus = () => focused;
  const session = { controller: new AbortController(), match: { phase: 'playing', paused: false },
    audio: { pause: () => calls.push('pause'), resume: () => calls.push('resume'), destroy: () => calls.push('destroy') } };
  const context = vm.createContext({ window, document, H: session });
  vm.runInContext(html.slice(start, end + 2), context);
  context.cronosBindCombatAudio(session);
  const dispatch = (type, persisted = false) => {
    const event = new Event(type); Object.defineProperty(event, 'persisted', { value: persisted }); window.dispatchEvent(event);
  };
  return { window, document, session, calls, dispatch, focus(value) { focused = value; } };
}

test('cached page transitions pause and restore the same audio session without destroying it', () => {
  const audio = audioLifecycle();
  audio.dispatch('pagehide', true); audio.dispatch('pageshow', true);
  assert.deepEqual(audio.calls, ['pause', 'resume']);
  audio.calls.length = 0; audio.session.match.paused = true;
  audio.dispatch('pagehide', true); audio.dispatch('pageshow', true);
  assert.deepEqual(audio.calls, ['pause'], 'A cached restore must not resume a manually paused fight');
  audio.dispatch('pagehide', false);
  assert.equal(audio.calls.at(-1), 'destroy');
});

test('blur and visibility changes stop tails during both KO and finished phases', () => {
  for (const phase of ['playing', 'round-over', 'finished']) {
    const audio = audioLifecycle(); audio.session.match.phase = phase;
    audio.focus(false); audio.dispatch('blur');
    audio.document.hidden = true; audio.document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(audio.calls, ['pause', 'pause'], phase);
    audio.document.hidden = false; audio.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(audio.calls.length, 2, 'A hidden/unfocused page must stay silent');
    audio.focus(true); audio.dispatch('focus');
    assert.equal(audio.calls.at(-1), 'resume', phase);
  }
});

test('unmount aborts every audio lifecycle listener', () => {
  const audio = audioLifecycle(); audio.session.controller.abort();
  for (const event of ['blur', 'focus', 'pagehide', 'pageshow']) audio.dispatch(event, true);
  audio.document.hidden = true; audio.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(audio.calls, []);
});

test('contact effects finish during the presentation clock while KO freezes simulation ticks', () => {
  const start = html.indexOf('for (const impact of match.impacts) Ae(');
  assert.ok(start >= 0);
  const end = html.indexOf('\n', start);
  const match = { tick: 500, impacts: [{ tick: 500, x: 700, y: 450 }] };
  const ages = [];
  const draw = (_ctx, _impact, age) => ages.push(age);
  // Supply those locals without replacing the actual age expression.
  const render = new Function('match', 'endingTick', 'Ae', 'const ctx = {}, reduceEffects = false;\n' + html.slice(start, end));
  for (const elapsed of [0, 9, 18, 120]) render(match, elapsed, draw);
  assert.deepEqual(ages, [0, 9, 18, 120]);
  ages.length = 0; render(match, null, draw);
  assert.deepEqual(ages, [0], 'Normal playing impacts retain the original simulation age');
});

function compileFunction(name, globals = {}) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const end = html.indexOf('\n}', start);
  const context = vm.createContext(globals);
  vm.runInContext(html.slice(start, end + 2), context);
  return context[name];
}

test('special presentation clock advances through hitstop and KO but stops while paused or hidden', () => {
  const document = { hidden: false, hasFocus: () => true };
  const advance = compileFunction('cronosAdvanceSpecialPresentation', { document });
  const session = { visualTick: 0, match: { tick: 200, hitstop: 6, paused: false, phase: 'playing' } };
  const before = structuredClone(session.match);
  advance(session, 1000 / 60); assert.equal(session.visualTick, 1);
  assert.deepEqual(session.match, before, 'Presentation does not change the match');
  session.match.phase = 'finished'; advance(session, 1000 / 60); assert.equal(session.visualTick, 2);
  session.match.paused = true; advance(session, 100); assert.equal(session.visualTick, 2);
  session.match.paused = false; document.hidden = true; advance(session, 100); assert.equal(session.visualTick, 2);
  document.hidden = false; document.hasFocus = () => false; advance(session, 100); assert.equal(session.visualTick, 2);
});

test('round narration retries early decoded audio once and rejects stale, paused and late announcements', async () => {
  for (const scenario of ['ready', 'stale', 'late', 'paused', 'hidden', 'unfocused', 'unmounted']) {
    let resolve, loaded = false, calls = 0;
    const pending = new Promise(done => { resolve = done; });
    const clock = { elapsed: 0, roundNumber: 2 };
    const session = { roundCountdown: clock, match: { paused: false, phase: 'playing' },
      audio: { cue(kind, options) { assert.equal(kind, 'round'); assert.equal(options.variation, 2); if (!loaded) return false; calls++; return true; }, ready: () => pending } };
    const document = { hidden: false, hasFocus: () => true };
    const globals = { H: session, document };
    const announce = compileFunction('cronosAnnounceRound', globals);
    announce(session); assert.equal(calls, 0);
    if (scenario === 'stale') session.roundCountdown = { ...clock };
    if (scenario === 'late') clock.elapsed = 701;
    if (scenario === 'paused') session.match.paused = true;
    if (scenario === 'hidden') document.hidden = true;
    if (scenario === 'unfocused') document.hasFocus = () => false;
    if (scenario === 'unmounted') globals.H = null;
    loaded = true; resolve(true); await pending; await Promise.resolve();
    assert.equal(calls, scenario === 'ready' ? 1 : 0, scenario);
  }
});

test('round narration already loaded plays once without scheduling another attempt', async () => {
  let calls = 0;
  const session = { roundCountdown: { elapsed: 0, roundNumber: 1 }, match: { phase: 'playing', paused: false },
    audio: { cue() { calls++; return true; }, ready() { assert.fail('Loaded narration should not enqueue retries'); } } };
  compileFunction('cronosAnnounceRound', { H: session, document: { hidden: false, hasFocus: () => true } })(session);
  await Promise.resolve(); assert.equal(calls, 1);
});

test('round result speaks KO, time or draw once at the existing transition hook', () => {
  for (const [result, expected] of [[{ winner: 0, reason: 'nocaute' }, 'ko'],
    [{ winner: 1, reason: 'tempo' }, 'time'], [{ winner: null, reason: 'nocaute' }, 'tie']]) {
    const calls = [], session = { match: { roundResult: result }, audio: { cue: kind => calls.push(kind) } };
    compileFunction('cronosBeginRoundEnd', { y() {} })(session, 1200);
    assert.deepEqual(calls, [expected]);
    assert.equal(session.resultAt, 1200);
    assert.equal(session.roundTransition.elapsed, 0, 'Existing result timing is preserved');
  }
});

test('round observer resets before announcing so the first simulation step cannot cut Fight', () => {
  const calls = [], session = { match: { phase: 'playing', fighters: [], roundNumber: 2 },
    audio: { beginRound(match) { assert.equal(match.roundCountdownLocked, true); calls.push('observer'); } } };
  compileFunction('cronosBeginRoundCountdown', { y() {},
    cronosAnnounceRound() { calls.push('round'); }, cronosAnnounceRoundCountdown() { calls.push('countdown'); }
  })(session, 5000);
  assert.deepEqual(calls, ['observer', 'round', 'countdown']);
  assert.equal(session.roundCountdown.elapsed, 0);
});
