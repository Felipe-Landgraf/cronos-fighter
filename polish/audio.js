import { AUDIO_SOURCES, assetURL } from './assets.js';

// Conservative local gains feed Me's existing settings-controlled master.
const MIX = Object.freeze({
  punch: { gain: .45, rate: 1.07, frequency: 6800 },
  heavy: { gain: .64, rate: .88, frequency: 4400 },
  block: { gain: .25, rate: 1.15, frequency: 5200 },
  swing: { gain: .20, rate: 1.15, frequency: 5600 },
  swingHeavy: { gain: .26, rate: .82, frequency: 4400 },
  dash: { gain: .17, rate: 1.05, frequency: 3800 },
  land: { gain: .21, rate: 1, frequency: 2600 },
  cast: { gain: .24, rate: .72, frequency: 3200 },
  release: { gain: .52, rate: .90, frequency: 4800 },
  countdown: { gain: .24, rate: 1.55, frequency: 4200 },
});

const MAX_VOICES = 12;
const ANNOUNCER = new Set(['round', 'fight', 'ko', 'time', 'tie']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

function variationHash(kind, side, variation) {
  const text = `${kind}:${side ?? ''}:${variation ?? 0}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Sample player owned by the current match. It never owns or resumes the context. */
export function createCombatAudio({ context, output, settings = {}, fetchImpl = globalThis.fetch, sources = AUDIO_SOURCES } = {}) {
  const kinds = new Map();
  for (const [kind, files] of Object.entries(sources)) {
    kinds.set(kind, (Array.isArray(files) ? files : [files]).filter(file => typeof file === 'string').map(assetURL));
  }
  const urls = [...new Set([...kinds.values()].flat())];
  const buffers = new Map();
  const voices = new Set();
  const counters = new Map();
  const observed = new Map();
  let destroyed = false, paused = false, loading = false, failedSources = 0;
  let loadPromise, loadController, lastMatch, lastRound, lastTick, lastPhase;

  const muted = () => settings.mute || finite(settings.effectsVolume, .55) <= 0;
  const available = () => !destroyed && !paused && !muted() && context?.state === 'running' && output;

  function releaseVoice(voice, stop = false) {
    if (!voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) {
      try { voice.source.stop(context.currentTime); } catch { /* Source may have ended already. */ }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* Already disconnected by the browser. */ }
    }
  }

  function stopVoices(onlyEffects = false) {
    for (const voice of voices) if (!onlyEffects || !voice.announcer) releaseVoice(voice, true);
  }

  function load() {
    if (destroyed || !context?.decodeAudioData || !output || typeof fetchImpl !== 'function') return Promise.resolve(false);
    if (loadPromise) return loadPromise;
    loading = true;
    loadController = new AbortController();
    const { signal } = loadController;
    loadPromise = Promise.all(urls.map(async url => {
      try {
        const response = await fetchImpl(url, { signal });
        if (destroyed || signal.aborted) return false;
        if (!response.ok) throw new Error('Sample unavailable');
        const bytes = await response.arrayBuffer();
        if (destroyed || signal.aborted) return false;
        const buffer = await context.decodeAudioData(bytes);
        if (destroyed || signal.aborted) return false;
        buffers.set(url, buffer);
        return true;
      } catch {
        if (!destroyed && !signal.aborted) failedSources++;
        return false;
      }
    })).then(results => {
      loading = false;
      return !destroyed && results.length > 0 && results.every(Boolean);
    });
    return loadPromise;
  }

  function play(kind, { side, x, variation, rate = 1, gain = 1 } = {}) {
    if (!available()) {
      if (muted()) stopVoices();
      return false;
    }
    const announcer = ANNOUNCER.has(kind);
    const mix = announcer ? { gain: .75, rate: 1 } : MIX[kind], options = kinds.get(kind);
    if (!mix || !options?.length) return false;
    const countKey = `${kind}:${side ?? ''}`;
    const ordinal = variation ?? counters.get(countKey) ?? 0;
    const hash = variationHash(kind, side, ordinal);
    const index = kind === 'round' ? clamp(Math.floor(finite(variation, 1)) - 1, 0, options.length - 1) : hash % options.length;
    const buffer = buffers.get(options[index]);
    if (!buffer) return false;
    const now = context.currentTime;
    // Reap completed schedules even when an ended callback is awaiting dispatch.
    for (const voice of voices) if (voice.announcer && voice.endAt <= now) releaseVoice(voice);
    let startAt = now;
    if (announcer) {
      const speaking = [...voices].filter(voice => voice.announcer);
      if (speaking.some(voice => voice.kind === kind && (kind !== 'round' || voice.index === index))) return true;
      if (kind === 'fight' && speaking.every(voice => voice.kind === 'round')) {
        // Only the round -> Fight pair is queued. Results replace stale speech.
        startAt = Math.max(now, ...speaking.map(voice => voice.endAt));
      } else {
        for (const voice of speaking) releaseVoice(voice, true);
      }
    }
    counters.set(countKey, (counters.get(countKey) ?? 0) + 1);
    if (!announcer) {
      const effects = [...voices].filter(voice => !voice.announcer);
      while (effects.length >= MAX_VOICES) releaseVoice(effects.shift(), true);
    }

    const nodes = [];
    let voice;
    try {
      const source = context.createBufferSource(); nodes.push(source);
      const level = context.createGain(); nodes.push(level);
      const speed = announcer ? 1 : clamp(mix.rate * (1 + ((hash >>> 8) % 9 - 4) * .008) * finite(rate, 1), .4, 2);
      const strength = clamp(mix.gain * finite(gain, 1), 0, .8);
      const duration = announcer ? finite(buffer.duration, .2) : Math.min(.75, Math.max(.02, finite(buffer.duration, .2) / speed));
      const fade = Math.min(.018, duration / 4);
      source.buffer = buffer;
      source.playbackRate.value = speed;
      level.gain.setValueAtTime(0, startAt);
      level.gain.linearRampToValueAtTime(strength, startAt + .003);
      level.gain.setValueAtTime(strength, startAt + duration - fade);
      level.gain.linearRampToValueAtTime(0, startAt + duration);
      if (announcer) source.connect(level);
      else {
        const filter = context.createBiquadFilter(); nodes.push(filter);
        filter.type = 'lowpass'; filter.frequency.value = mix.frequency; filter.Q.value = .65;
        source.connect(filter).connect(level);
      }
      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner(); nodes.push(panner);
        panner.pan.value = announcer ? 0 : Number.isFinite(x) ? clamp((x / 640 - 1) * .22, -.35, .35) : side === 0 ? -.1 : side === 1 ? .1 : 0;
        level.connect(panner).connect(output);
      } else level.connect(output);
      voice = { source, nodes, announcer, kind, index, startAt, endAt: startAt + duration };
      voices.add(voice);
      source.onended = () => releaseVoice(voice);
      source.start(startAt);
      source.stop(startAt + duration);
      return true;
    } catch {
      if (voice) releaseVoice(voice, true);
      else for (const node of nodes) {
        try { node.disconnect(); } catch { /* Best effort when context is closing. */ }
      }
      return false;
    }
  }

  function observe(match, { specialConfigs = {} } = {}) {
    if (destroyed || !match) return;
    const reset = lastMatch && (lastMatch !== match || match.roundNumber !== lastRound || match.tick < lastTick);
    if (reset) { stopVoices(); observed.clear(); counters.clear(); }
    if (muted() || match.paused) stopVoices();
    else if (match.phase !== 'playing' && lastPhase === 'playing') stopVoices(true);
    if (match.paused) paused = true;
    const canPlay = !match.paused && match.phase === 'playing' && !match.roundCountdownLocked;
    lastMatch = match; lastRound = match.roundNumber; lastTick = match.tick; lastPhase = match.phase;

    // Only transition/startup cues live here. Me owns normal swings and all impacts.
    for (const fighter of match.fighters ?? []) {
      const side = fighter.side;
      const previous = observed.get(side);
      const sp = fighter.state === 'special' ? fighter.specialAttack : null;
      const instance = sp ? fighter.attackInstanceId : null;
      const memo = { state: fighter.state, y: fighter.y, instance, released: previous?.instance === instance && previous?.released };
      const emit = kind => { if (canPlay) play(kind, { side, x: fighter.x, variation: instance ?? match.tick }); };

      if (sp) {
        if (previous?.instance !== instance) emit('cast');
        const launch = specialConfigs[sp.id]?.launch;
        if (!memo.released && Number.isFinite(launch) && .65 + finite(sp.age, 0) / 60 >= launch) {
          memo.released = true;
          emit('release');
        }
      }
      if (fighter.state === 'dash' && previous?.state !== 'dash') emit('dash');
      if (previous?.y < 600 && fighter.y >= 600) emit('land');
      observed.set(side, memo);
    }
  }

  function pause() { paused = true; stopVoices(); }
  function resume() { if (!destroyed) paused = false; }
  function destroy() {
    if (destroyed) return;
    destroyed = true; paused = true; loading = false;
    loadController?.abort(); stopVoices(); buffers.clear(); observed.clear(); counters.clear(); lastMatch = null;
  }
  function stats() {
    const announcements = [...voices].filter(voice => voice.announcer);
    const current = announcements.find(voice => voice.startAt <= context?.currentTime && voice.endAt > context?.currentTime);
    return { activeVoices: voices.size, activeEffects: voices.size - announcements.length, activeAnnouncers: announcements.length,
      queuedAnnouncers: announcements.filter(voice => voice.startAt > context?.currentTime).length,
      announcerKind: current?.kind ?? null, announcerEndsAt: current?.endAt ?? null,
      loadedBuffers: buffers.size, totalSources: urls.length, failedSources, loading, paused, destroyed };
  }

  return { load, play, observe, pause, resume, destroy, stats };
}
