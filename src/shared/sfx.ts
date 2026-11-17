// Pure sound-design helpers for the synthesised SFX (src/client/sfx.ts). No runtime imports:
// unit tests load this file directly.

/** Master volume (0..1) with sound on: deliberately low, the game is mostly read and tapped. */
export const MASTER_VOLUME = 0.35;
/** At most this many oscillator/noise voices at once (cheap on phones). */
export const MAX_VOICES = 8;
/** Realtime clues of other players play at this fraction of your own. */
export const OTHER_CLUE_GAIN = 0.35;

export const MUTE_KEY = 'crackthevault:muted';

/** Stored mute preference → muted? Anything but "1" (incl. missing storage) means sound on. */
export const parseMuted = (stored: string | null): boolean => stored === '1';

/**
 * What to do with an existing audio context when the tab's visibility changes: suspend while
 * hidden (stops the audio thread), resume on return only when sound is on.
 */
export const visibilityAction = (
  visible: boolean,
  muted: boolean
): 'suspend' | 'resume' | null => {
  if (!visible) return 'suspend';
  return muted ? null : 'resume';
};

export type Note = { freq: number; delayS: number; durationS: number };

const C5 = 523.25;
/** Major pentatonic steps above C5 (semitones), so any run of notes sounds friendly. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

const semis = (base: number, n: number) =>
  Math.round(base * 2 ** (n / 12) * 100) / 100;

/**
 * The notes of a clue: one rising pentatonic note per 🟢 (right dial), then a softer, lower
 * note per 🟡; a blank clue (0 🟢 0 🟡) is two falling low notes. Capped at 6 notes.
 */
export const clueNotes = (exact: number, misplaced: number): Note[] => {
  const whole = (n: number) =>
    Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const e = whole(exact);
  const m = whole(misplaced);
  if (e === 0 && m === 0)
    return [
      { freq: 220, delayS: 0, durationS: 0.16 },
      { freq: 164.81, delayS: 0.11, durationS: 0.22 },
    ];
  const notes: Note[] = [];
  for (let i = 0; i < e && notes.length < 6; i++)
    notes.push({
      freq: semis(C5, PENTA[Math.min(i, PENTA.length - 1)] ?? 0),
      delayS: notes.length * 0.075,
      durationS: 0.22,
    });
  for (let i = 0; i < m && notes.length < 6; i++)
    notes.push({
      freq: semis(C5 / 2, PENTA[Math.min(i, PENTA.length - 1)] ?? 0),
      delayS: notes.length * 0.075,
      durationS: 0.14,
    });
  return notes;
};

/**
 * Polyphony limiter. `ends` are the end times (s) of the voices playing; returns the new list
 * with `count` voices added, or null when they don't fit under `max` at `now` (sound skipped).
 */
export const acquireVoice = (
  ends: readonly number[],
  now: number,
  durationS: number,
  max: number = MAX_VOICES,
  count = 1
): number[] | null => {
  const active = ends.filter((end) => end > now);
  const n = Math.max(1, Math.floor(count));
  if (active.length + n > max) return null;
  const end = now + Math.max(0, durationS);
  return [...active, ...Array.from({ length: n }, () => end)];
};
