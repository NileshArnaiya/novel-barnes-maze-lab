import type { Point } from '../core/types';

/**
 * Classical blob tracking. No model weights, no GPU, no WASM codec.
 *
 * This is a deliberate choice rather than a shortcut. A segmentation network
 * would be more robust on hard footage, but it would also be a black box that a
 * user cannot audit and cannot fix when it fails. Every step below is something
 * a scientist can be walked through in two minutes: subtract the empty arena,
 * threshold what changed, take the biggest connected region, find its centre.
 *
 * The tradeoff is documented in KNOWN_LIMITATIONS.md. Where this approach
 * fails, it fails visibly and says so, which is the property that matters most.
 */

export interface Frame {
  /** Single-channel luminance, length = width * height. */
  gray: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Convert RGBA canvas data to luminance using the standard Rec. 601 weights. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Frame {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    gray[j] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return { gray, width, height };
}

/**
 * Build a background model by taking the per-pixel median of sampled frames.
 *
 * Median rather than mean, because the animal is a moving outlier. With enough
 * samples the animal is never at the same pixel in most of them, so the median
 * of each pixel is the empty arena. A mean would smear a faint ghost of the
 * animal's path into the background and weaken every subsequent detection.
 */
export function buildBackground(samples: readonly Frame[]): Frame {
  const first = samples[0];
  if (!first) throw new Error('Cannot build a background from zero frames.');

  const { width, height } = first;
  const n = samples.length;
  const out = new Uint8ClampedArray(width * height);
  const scratch = new Uint8Array(n);

  for (let px = 0; px < out.length; px++) {
    for (let s = 0; s < n; s++) scratch[s] = samples[s]?.gray[px] ?? 0;
    // Insertion sort: n is small (typically 15 to 30 samples) and this avoids
    // allocating a new array per pixel, which matters over ~300k pixels.
    for (let i = 1; i < n; i++) {
      const v = scratch[i] ?? 0;
      let j = i - 1;
      while (j >= 0 && (scratch[j] ?? 0) > v) {
        scratch[j + 1] = scratch[j] ?? 0;
        j--;
      }
      scratch[j + 1] = v;
    }
    out[px] = scratch[n >> 1] ?? 0;
  }

  return { gray: out, width, height };
}

export interface Blob {
  centroid: Point;
  /** Area in pixels. Used to reject noise and to detect merged blobs. */
  area: number;
  /**
   * Principal axis angle in radians, from image moments. This is what lets us
   * separate nose from tail without a pose model.
   */
  orientation: number;
  /** Extreme point along the principal axis, our nose estimate. */
  extremeA: Point;
  extremeB: Point;
}

/**
 * Find the animal in one frame.
 *
 * `mask` restricts the search to the platform, which removes the single largest
 * source of false positives: the experimenter's hand, the escape box, and
 * anything moving at the edge of the room.
 */
/**
 * Reusable scratch buffers.
 *
 * detectBlob runs once per frame. At 640 by 480 that is a 300 KB foreground
 * mask plus a 1.2 MB label array, and a three-minute trial at 30 fps calls it
 * over five thousand times. Allocating fresh arrays each call hands the garbage
 * collector roughly eight gigabytes of short-lived typed arrays to deal with
 * over one video, which is enough to push a browser tab into memory pressure
 * and, on a machine already loaded with other applications, out of memory
 * entirely.
 *
 * Reusing the buffers makes the per-frame allocation constant. They are keyed
 * by size so a change of video resolution reallocates once rather than never.
 */
const scratch = {
  size: 0,
  fg: new Uint8Array(0),
  labels: new Int32Array(0),
  stack: new Int32Array(0),
  component: new Int32Array(0),
  best: new Int32Array(0),
};

function ensureScratch(size: number) {
  if (scratch.size === size) return;
  scratch.size = size;
  scratch.fg = new Uint8Array(size);
  scratch.labels = new Int32Array(size);
  scratch.stack = new Int32Array(size);
  scratch.component = new Int32Array(size);
  scratch.best = new Int32Array(size);
}

/**
 * Find the animal in one frame.
 *
 * `mask` restricts the search to the platform, which removes the single largest
 * source of false positives: the experimenter's hand, the escape box, and
 * anything moving at the edge of the room.
 */
export function detectBlob(
  frame: Frame,
  background: Frame,
  threshold: number,
  minArea: number,
  mask: (x: number, y: number) => boolean,
): Blob | null {
  const { width, height } = frame;
  const size = width * height;
  ensureScratch(size);

  const { fg, labels, stack, component, best } = scratch;
  fg.fill(0);
  labels.fill(-1);

  // Step 1: absolute difference from the background, thresholded.
  // The animal is darker than the platform in typical footage, but we use the
  // absolute difference so the tool also works with a light animal on a dark
  // platform without a separate code path.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask(x, y)) continue;
      const d = Math.abs((frame.gray[i] ?? 0) - (background.gray[i] ?? 0));
      if (d > threshold) fg[i] = 1;
    }
  }

  // Step 2: largest connected component, found with an iterative flood fill.
  // Iterative rather than recursive because a large blob would blow the call
  // stack on a real frame.
  let bestCount = 0;

  for (let seed = 0; seed < size; seed++) {
    if (fg[seed] !== 1 || labels[seed] !== -1) continue;

    let count = 0;
    let sp = 0;
    stack[sp++] = seed;
    labels[seed] = seed;

    while (sp > 0) {
      const i = stack[--sp]!;
      component[count++] = i;
      const x = i % width;
      const y = (i - x) / width;

      // 4-connectivity. 8 would merge the animal with nearby noise more often.
      if (x > 0 && fg[i - 1] === 1 && labels[i - 1] === -1) {
        labels[i - 1] = seed;
        stack[sp++] = i - 1;
      }
      if (x < width - 1 && fg[i + 1] === 1 && labels[i + 1] === -1) {
        labels[i + 1] = seed;
        stack[sp++] = i + 1;
      }
      if (y > 0 && fg[i - width] === 1 && labels[i - width] === -1) {
        labels[i - width] = seed;
        stack[sp++] = i - width;
      }
      if (y < height - 1 && fg[i + width] === 1 && labels[i + width] === -1) {
        labels[i + width] = seed;
        stack[sp++] = i + width;
      }
    }

    if (count > bestCount) {
      bestCount = count;
      best.set(component.subarray(0, count));
    }
  }

  if (bestCount < minArea) return null;

  // Step 3: image moments. The first moments give the centroid; the second
  // central moments give the orientation of the principal axis.
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < bestCount; k++) {
    const i = best[k]!;
    const x = i % width;
    sx += x;
    sy += (i - x) / width;
  }
  const cx = sx / bestCount;
  const cy = sy / bestCount;

  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;
  for (let k = 0; k < bestCount; k++) {
    const i = best[k]!;
    const x = i % width;
    const y = (i - x) / width;
    const dx = x - cx;
    const dy = y - cy;
    mu20 += dx * dx;
    mu02 += dy * dy;
    mu11 += dx * dy;
  }
  mu20 /= bestCount;
  mu02 /= bestCount;
  mu11 /= bestCount;

  const orientation = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);

  // Step 4: the two extreme points along that axis. One is the nose, the other
  // the tail base. Which is which is resolved in occlusion.ts using the
  // direction of travel, because a still animal gives no cue at all.
  const ux = Math.cos(orientation);
  const uy = Math.sin(orientation);
  let minProj = Infinity;
  let maxProj = -Infinity;
  let pMin: Point = { x: cx, y: cy };
  let pMax: Point = { x: cx, y: cy };

  for (let k = 0; k < bestCount; k++) {
    const i = best[k]!;
    const x = i % width;
    const y = (i - x) / width;
    const proj = (x - cx) * ux + (y - cy) * uy;
    if (proj < minProj) {
      minProj = proj;
      pMin = { x, y };
    }
    if (proj > maxProj) {
      maxProj = proj;
      pMax = { x, y };
    }
  }

  return {
    centroid: { x: cx, y: cy },
    area: bestCount,
    orientation,
    extremeA: pMax,
    extremeB: pMin,
  };
}
