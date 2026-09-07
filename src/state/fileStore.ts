/**
 * Where the actual video files live while the tab is open.
 *
 * Deliberately in memory and not in IndexedDB. A `File` is structured-cloneable
 * so it could be persisted, but a cohort of sixty behaviour videos is many
 * gigabytes and writing that into the user's browser storage is a rude thing to
 * do to a laptop, on top of being slow.
 *
 * The consequence is honest and stated in the UI: after a reload, tracks,
 * corrections and scores are all still there, but the video itself has to be
 * re-selected before you can re-run tracking or scrub the footage. The
 * scientific work survives; only the thing that can be trivially reopened does
 * not.
 */
const files = new Map<string, File>();

export function rememberFile(videoId: string, file: File): void {
  files.set(videoId, file);
}

export function getFile(videoId: string): File | null {
  return files.get(videoId) ?? null;
}

export function forgetFile(videoId: string): void {
  files.delete(videoId);
}
