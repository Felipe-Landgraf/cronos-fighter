// Selected community assets only. Sources, licenses and original hashes: manifest.json.
export const assetURL = file => new URL(file, import.meta.url).href;

export const VFX_SHEETS = Object.freeze({
  hit: { file: 'vfx/white_hit.png', width: 256, height: 256, columns: 8, frames: 8 },
  slash: { file: 'vfx/white_slash.png', width: 256, height: 256, columns: 8, frames: 13 },
  spark: { file: 'vfx/white_spark.png', width: 256, height: 256, columns: 8, frames: 14 },
  critical: { file: 'vfx/gold_crit.png', width: 256, height: 256, columns: 8, frames: 14 },
  electric: { file: 'vfx/electric_ring_6x5.png', width: 265, height: 265, columns: 6, frames: 30 },
  fire: { file: 'vfx/fire_ring_6x5.png', width: 421, height: 425, columns: 6, frames: 30 },
});

export const VFX_TEXTURES = Object.freeze({
  smoke: 'vfx/smoke_01.png',
  flare: 'vfx/flare_01.png',
});

export const AUDIO_SOURCES = Object.freeze({
  punch: ['audio/impactPunch_medium_000.ogg', 'audio/impactPunch_medium_001.ogg'],
  heavy: ['audio/impactPunch_heavy_000.ogg', 'audio/impactPunch_heavy_001.ogg'],
  block: ['audio/impactMetal_light_001.ogg'],
  swing: ['audio/knifeSlice.ogg'],
  swingHeavy: ['audio/knifeSlice2.ogg'],
  dash: ['audio/cloth3.ogg'],
  land: ['audio/footstep_concrete_000.ogg', 'audio/footstep_concrete_001.ogg'],
  cast: ['audio/knifeSlice2.ogg'],
  release: ['audio/impactSoft_heavy_001.ogg'],
  countdown: ['audio/impactMetal_light_001.ogg'],
  round: ['audio/announcer-round-1.ogg', 'audio/announcer-round-2.ogg', 'audio/announcer-round-3.ogg'],
  fight: ['audio/announcer-fight.ogg'],
  ko: ['audio/announcer-ko.ogg'],
  time: ['audio/announcer-time.ogg'],
  tie: ['audio/announcer-tie.ogg'],
});
