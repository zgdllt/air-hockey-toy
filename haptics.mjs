// The web game owns the event vocabulary and timing for both native shells.
// macOS exposes three discrete feedback styles, so amplitude is approximate there.
const tap = (at, duration, intensity, sharpness = .8) => ({ at, duration, intensity, sharpness });
export const HAPTIC_PROFILES = Object.freeze({
  hit: [tap(0, 14, .72)],
  heavy: [tap(0, 24, 1, .9), tap(42, 12, .42, .5)],
  'opponent-hit': [tap(0, 13, .58, .72)],
  'opponent-heavy': [tap(0, 22, .85, .82), tap(38, 10, .32, .5)],
  wall: [tap(0, 8, .3, .95)],
  post: [tap(0, 13, .65, 1)],
  goal: [tap(0, 18, .8), tap(55, 26, 1, .65)],
  'opponent-goal': [tap(0, 28, .7, .35), tap(90, 18, .45, .3)],
  serve: [tap(0, 10, .42, .8)],
  win: [tap(0, 14, .6), tap(70, 18, .8), tap(150, 32, 1, .65)],
  lose: [tap(0, 30, .72, .3), tap(130, 28, .45, .25)],
  start: [tap(0, 10, .48)],
  pause: [tap(0, 8, .3, .5)],
  resume: [tap(0, 10, .45)],
  restart: [tap(0, 12, .5, .6)],
  deadball: [tap(0, 8, .32), tap(65, 8, .32)],
  select: [tap(0, 8, .28, .9)],
  toggle: [tap(0, 10, .45)],
  fullscreen: [tap(0, 10, .4, .6)],
});

export function browserTimings(pulses) {
  let end = 0;
  return pulses.flatMap((pulse) => {
    const timing = [Math.max(0, pulse.at - end), pulse.duration];
    end = pulse.at + pulse.duration;
    return timing;
  });
}

export function createHaptics(host = window) {
  let enabled = true;
  let lastRail = -Infinity;
  const available = () => Boolean(host.AndroidHaptics?.pulse || host.webkit?.messageHandlers?.macHaptics || host.navigator?.vibrate);
  function cancel() {
    try {
      if (host.AndroidHaptics?.cancel) host.AndroidHaptics.cancel();
      else if (host.webkit?.messageHandlers?.macHaptics) host.webkit.messageHandlers.macHaptics.postMessage({ action: 'cancel' });
      else host.navigator?.vibrate?.(0);
    } catch { /* Haptics remain optional. */ }
  }
  return {
    available,
    cancel,
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) cancel();
      host.AndroidHaptics?.setEnabled?.(enabled);
    },
    play(kind) {
      const pulses = HAPTIC_PROFILES[kind];
      if (!enabled || !pulses || host.document?.hidden) return;
      const now = host.performance.now();
      // Sliding rail contacts can arrive at 240 Hz. Do not turn them into a buzz.
      if (kind === 'wall' || kind === 'post') {
        if (now - lastRail < 45) return;
        lastRail = now;
      }
      const profile = { kind, pulses };
      try {
        if (host.AndroidHaptics?.pulse) host.AndroidHaptics.pulse(JSON.stringify(profile));
        else if (host.webkit?.messageHandlers?.macHaptics) host.webkit.messageHandlers.macHaptics.postMessage(profile);
        else host.navigator?.vibrate?.(browserTimings(pulses));
      } catch { /* Unsupported hardware or disabled system feedback. */ }
    },
  };
}
