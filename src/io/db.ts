import type { Project } from '../core/types';

/**
 * Persistence.
 *
 * The requirement is blunt: a browser refresh must not lose work. A student who
 * has hand-corrected forty frames and then hits reload should find those forty
 * frames intact.
 *
 * IndexedDB rather than localStorage because tracks are large. A ten-minute
 * trial at 30 fps is 18,000 points, and localStorage's roughly 5 MB budget runs
 * out across a cohort. IndexedDB also stores structured objects directly, so we
 * are not paying to serialise the whole project on every keystroke.
 *
 * No cookies are used anywhere in this tool. Nothing is sent to a server.
 */

const DB_NAME = 'barnes-maze-scorer';
const DB_VERSION = 1;
const STORE = 'projects';
const CURRENT_KEY = 'current';

/** Wrap the IndexedDB request API, which predates promises. */
function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database'));
  });
}

/**
 * Every storage call returns a result rather than throwing.
 *
 * Private browsing, a full disk, and some locked-down enterprise profiles all
 * make IndexedDB unavailable. None of those should white-screen the app; they
 * should degrade to "your work will not be saved" with a visible warning, so
 * the user can decide whether to continue.
 */
export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export async function saveProject(project: Project): Promise<StorageResult<void>> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    await promisify(tx.objectStore(STORE).put(project, CURRENT_KEY));
    db.close();
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save your work locally.' };
  }
}

export async function loadProject(): Promise<StorageResult<Project | null>> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readonly');
    const value = await promisify(tx.objectStore(STORE).get(CURRENT_KEY));
    db.close();
    return { ok: true, value: (value as Project | undefined) ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read your saved work.' };
  }
}

export async function clearProject(): Promise<StorageResult<void>> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    await promisify(tx.objectStore(STORE).delete(CURRENT_KEY));
    db.close();
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not clear saved work.' };
  }
}

/**
 * Whether this browser has seen the walkthrough.
 *
 * localStorage is right for this one: it is a single boolean, it needs to be
 * readable synchronously during the first render, and losing it is harmless.
 */
const WALKTHROUGH_KEY = 'barnes-walkthrough-seen';

export function hasSeenWalkthrough(): boolean {
  try {
    return localStorage.getItem(WALKTHROUGH_KEY) === '1';
  } catch {
    return false;
  }
}

export function markWalkthroughSeen(): void {
  try {
    localStorage.setItem(WALKTHROUGH_KEY, '1');
  } catch {
    // Storage unavailable. The walkthrough will show again next time, which is
    // a mildly annoying outcome rather than a broken one.
  }
}
