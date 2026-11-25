/** Frame-accurate shot boundaries for 拉片. Pure helpers; ffmpeg runs in server.ts. */

export type DetectedShot = { index: number; start: number; end: number; keyTime: number };

export const BREAKDOWN_MAX_DURATION_SECONDS = 600;
export const BREAKDOWN_MAX_SHOTS = 150;
/** Cuts closer than this are flashes, glitches or dissolve frames, not separate shots. */
export const BREAKDOWN_MIN_SHOT_SECONDS = 0.4;
/** A single uncut take longer than this is split so each analysed unit stays specific. */
export const BREAKDOWN_MAX_SHOT_SECONDS = 8;

/** Reads `pts_time:` values from ffmpeg `showinfo` output (stderr). */
export function parseSceneCutTimes(log: string): number[] {
  const times: number[] = [];
  for (const match of log.matchAll(/pts_time:\s*(-?\d+(?:\.\d+)?)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) times.push(value);
  }
  return [...new Set(times.map(time => Math.round(time * 1000) / 1000))].sort((a, b) => a - b);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Turns cut times into shots: drops flash cuts, splits long takes into readable
 * units and keeps the total within what one breakdown can describe well.
 */
export function buildShotsFromCuts(cuts: readonly number[], duration: number, options: {
  minShot?: number; maxShot?: number; maxShots?: number;
} = {}): DetectedShot[] {
  const minShot = options.minShot ?? BREAKDOWN_MIN_SHOT_SECONDS;
  const maxShot = options.maxShot ?? BREAKDOWN_MAX_SHOT_SECONDS;
  const maxShots = options.maxShots ?? BREAKDOWN_MAX_SHOTS;
  if (!(duration > 0)) return [];

  const boundaries = [0];
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    if (cut <= 0 || cut >= duration) continue;
    if (cut - boundaries[boundaries.length - 1] < minShot) continue;
    boundaries.push(cut);
  }
  // The last shot must not be a sliver either: move its start back into the previous one.
  if (boundaries.length > 1 && duration - boundaries[boundaries.length - 1] < minShot) boundaries.pop();
  boundaries.push(duration);

  let ranges: Array<[number, number]> = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const parts = Math.max(1, Math.ceil((end - start) / maxShot));
    for (let part = 0; part < parts; part += 1) {
      ranges.push([start + (end - start) * part / parts, start + (end - start) * (part + 1) / parts]);
    }
  }

  // Too many shots: merge the shortest neighbour pairs first, so rapid montages
  // become a few dense shots instead of truncating the end of the video.
  while (ranges.length > maxShots) {
    let shortest = 0;
    for (let i = 1; i < ranges.length; i += 1) {
      if (ranges[i][1] - ranges[i][0] < ranges[shortest][1] - ranges[shortest][0]) shortest = i;
    }
    const neighbour = shortest === 0 ? 1
      : shortest === ranges.length - 1 ? shortest - 1
      : (ranges[shortest - 1][1] - ranges[shortest - 1][0]) <= (ranges[shortest + 1][1] - ranges[shortest + 1][0]) ? shortest - 1 : shortest + 1;
    const [first, second] = [Math.min(shortest, neighbour), Math.max(shortest, neighbour)];
    ranges = [...ranges.slice(0, first), [ranges[first][0], ranges[second][1]], ...ranges.slice(second + 1)];
  }

  return ranges.map(([start, end], i) => ({
    index: i + 1,
    start: round(start),
    end: round(end),
    keyTime: round(keyFrameTime(start, end)),
  }));
}

/**
 * Representative frame time: 40% into the shot, never within 0.12s of a cut where
 * dissolves, motion blur and encoder keyframes make stills unreliable.
 */
export function keyFrameTime(start: number, end: number) {
  const length = end - start;
  if (length <= 0.3) return start + length / 2;
  return Math.min(end - 0.12, Math.max(start + 0.12, start + length * 0.4));
}

/** `00:04.2` under a minute of hours, `1:02:03.4` beyond. */
export function formatBreakdownTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const tenths = Math.round(safe * 10);
  const hours = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const secs = Math.floor((tenths % 600) / 10);
  const fraction = tenths % 10;
  const body = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${fraction}`;
  return hours ? `${hours}:${body}` : body;
}

/** Scene threshold: lower for low-contrast footage when nothing was found at all. */
export const BREAKDOWN_SCENE_THRESHOLDS = [0.3, 0.18] as const;
