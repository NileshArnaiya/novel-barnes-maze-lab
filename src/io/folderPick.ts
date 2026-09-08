/**
 * Load a folder of trials. Three routes, same File[]:
 *   1. showDirectoryPicker
 *   2. webkitdirectory on a file input
 *   3. drop a folder
 * Non-scorable files are filtered out first.
 */

/** Video or pose CSV. Everything else is ignored. */
const SCORABLE = /\.(mp4|mov|m4v|webm|avi|mkv|csv|slp|h5|hdf5)$/i;

/** Caps so pointing at the home folder does not freeze the tab. */
const MAX_DEPTH = 6;
const MAX_FILES = 2000;

export function isScorableFile(name: string): boolean {
  // macOS `._trial.mp4` sidecar files are not data.
  if (name.startsWith('.')) return false;
  return SCORABLE.test(name);
}

/** Local types for showDirectoryPicker. The DOM lib does not include them yet. */
interface FileSystemEntryHandle {
  kind: 'file' | 'directory';
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterableIterator<FileSystemEntryHandle>;
}

type DirectoryPicker = () => Promise<FileSystemEntryHandle>;

function directoryPicker(): DirectoryPicker | null {
  const fn = (window as unknown as { showDirectoryPicker?: DirectoryPicker })
    .showDirectoryPicker;
  return typeof fn === 'function' ? fn.bind(window) : null;
}

export function supportsDirectoryPicker(): boolean {
  return directoryPicker() !== null;
}

async function walkHandle(
  dir: FileSystemEntryHandle,
  out: File[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES || !dir.values) return;

  for await (const entry of dir.values()) {
    if (out.length >= MAX_FILES) return;
    if (entry.kind === 'file' && entry.getFile) {
      if (!isScorableFile(entry.name)) continue;
      out.push(await entry.getFile());
    } else if (entry.kind === 'directory') {
      // Labs often file by day / cohort / animal.
      await walkHandle(entry, out, depth + 1);
    }
  }
}

/**
 * Folder picker. `null` = cancelled. `[]` = folder had nothing we can score.
 */
export async function pickDirectoryFiles(): Promise<File[] | null> {
  const pick = directoryPicker();
  if (!pick) return null;

  let handle: FileSystemEntryHandle;
  try {
    handle = await pick();
  } catch {
    // Dialog dismissed.
    return null;
  }

  const files: File[] = [];
  await walkHandle(handle, files, 0);
  return sortByName(files);
}

/**
 * Dropped-folder entries via webkitGetAsEntry (callback API).
 */
interface LegacyEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: LegacyEntry[]) => void, err: (e: unknown) => void) => void;
  };
}

function readEntries(entry: LegacyEntry): Promise<LegacyEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return Promise.resolve([]);

  // readEntries yields ≤100 per call; empty batch means done. Drain the loop.
  return new Promise((resolve) => {
    const all: LegacyEntry[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        pump();
      }, () => resolve(all));
    };
    pump();
  });
}

function entryFile(entry: LegacyEntry): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) {
      resolve(null);
      return;
    }
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

async function walkLegacy(entry: LegacyEntry, out: File[], depth: number): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;

  if (entry.isFile) {
    if (!isScorableFile(entry.name)) return;
    const f = await entryFile(entry);
    if (f) out.push(f);
    return;
  }

  if (entry.isDirectory) {
    for (const child of await readEntries(entry)) {
      if (out.length >= MAX_FILES) return;
      await walkLegacy(child, out, depth + 1);
    }
  }
}

/** Files from a drop, expanding any folders in it. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((item) =>
      (item as unknown as { webkitGetAsEntry?: () => LegacyEntry | null }).webkitGetAsEntry?.(),
    )
    .filter((e): e is LegacyEntry => Boolean(e));

  const hasDirectory = entries.some((e) => e.isDirectory);
  if (!hasDirectory) {
    // Plain files: keep the list as-is so a bad file still gets a reason.
    return Array.from(dt.files);
  }

  const files: File[] = [];
  for (const entry of entries) await walkLegacy(entry, files, 0);
  return sortByName(files);
}

/** Sort by name, numeric so trial10 comes after trial9. */
export function sortByName(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}
