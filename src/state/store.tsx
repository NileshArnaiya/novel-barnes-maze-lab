import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { analyze } from '../core/analyze';
import { DEFAULT_PARAMS } from '../core/params';
import { assessQuality } from '../core/quality';
import type { Project, ScoringParams, TrackPoint, VideoRecord } from '../core/types';
import { buildExampleProject } from '../demo/exampleCohort';
import { loadProject, saveProject } from '../io/db';

/**
 * Application state.
 *
 * Deliberately plain React context and hooks rather than a state library. The
 * state here is one project object and a couple of selections; a store library
 * would add a dependency and an abstraction for something a reader can hold in
 * their head. The tradeoff is that every consumer re-renders on any change,
 * which is acceptable at this scale and is noted in KNOWN_LIMITATIONS.md.
 */

interface StoreValue {
  project: Project;
  activeVideoId: string | null;
  activeVideo: VideoRecord | null;
  /** Set when local persistence is unavailable, so the UI can warn the user. */
  storageWarning: string | null;
  loading: boolean;

  setActiveVideo: (id: string | null) => void;
  setParams: (params: ScoringParams) => void;
  updateVideo: (id: string, patch: Partial<VideoRecord>) => void;
  /** Replace a track and rescore in one step, keeping events and summary in sync. */
  setTrack: (id: string, track: TrackPoint[]) => void;
  addVideos: (videos: VideoRecord[]) => void;
  loadExample: () => void;
  clearExamples: () => void;
  reset: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function emptyProject(): Project {
  return {
    schemaVersion: 1,
    toolVersion: '0.1.0',
    createdAt: new Date().toISOString(),
    params: DEFAULT_PARAMS,
    videos: [],
  };
}

/**
 * Rescore one video from its current track, map and the project parameters.
 *
 * Everything derived lives downstream of this one function, so there is exactly
 * one place where a number can be computed. That is what makes "drag a
 * threshold, watch the count change" correct rather than approximately correct.
 */
function rescore(video: VideoRecord, params: ScoringParams): VideoRecord {
  if (!video.track || !video.map) return video;
  const { events, summary } = analyze(video, video.track, video.map, params);
  const quality = assessQuality(video.track, video.fps);
  return { ...video, events, summary, qcFlag: quality.flag };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(emptyProject);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore on start. If there is nothing saved, load the example so a first
  // visitor sees the tool working rather than an empty screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadProject();
      if (cancelled) return;

      if (!result.ok) {
        setStorageWarning(
          `Your work cannot be saved in this browser (${result.error}). Export before you close the tab.`,
        );
        const example = buildExampleProject();
        setProject(example);
        setActiveVideoId(example.videos[0]?.id ?? null);
      } else if (result.value && result.value.videos.length > 0) {
        setProject(result.value);
        setActiveVideoId(result.value.videos[0]?.id ?? null);
      } else {
        const example = buildExampleProject();
        setProject(example);
        setActiveVideoId(example.videos[0]?.id ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Autosave, debounced. Saving on every keystroke would write the whole
  // project on each slider tick; waiting until the user leaves would lose work.
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (loading) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveProject(project).then((r) => {
        if (!r.ok) setStorageWarning(`Could not save locally: ${r.error}`);
      });
    }, 600);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [project, loading]);

  const setParams = useCallback((params: ScoringParams) => {
    setProject((p) => ({
      ...p,
      params,
      videos: p.videos.map((v) => rescore(v, params)),
    }));
  }, []);

  const updateVideo = useCallback((id: string, patch: Partial<VideoRecord>) => {
    setProject((p) => ({
      ...p,
      videos: p.videos.map((v) => (v.id === id ? rescore({ ...v, ...patch }, p.params) : v)),
    }));
  }, []);

  const setTrack = useCallback((id: string, track: TrackPoint[]) => {
    setProject((p) => ({
      ...p,
      videos: p.videos.map((v) => (v.id === id ? rescore({ ...v, track }, p.params) : v)),
    }));
  }, []);

  const addVideos = useCallback((videos: VideoRecord[]) => {
    setProject((p) => ({ ...p, videos: [...p.videos, ...videos] }));
    // Select what was just loaded, rather than keeping whatever was selected
    // before. Leaving the old trial active meant the next step asked for a
    // video file belonging to a different record, which read as the tool losing
    // the file the user had only just chosen.
    if (videos[0]) setActiveVideoId(videos[0].id);
  }, []);

  const loadExample = useCallback(() => {
    const example = buildExampleProject();
    setProject(example);
    setActiveVideoId(example.videos[0]?.id ?? null);
  }, []);

  const clearExamples = useCallback(() => {
    setProject((p) => ({ ...p, videos: p.videos.filter((v) => !v.synthetic) }));
    setActiveVideoId(null);
  }, []);

  const reset = useCallback(() => {
    setProject(emptyProject());
    setActiveVideoId(null);
  }, []);

  const activeVideo = useMemo(
    () => project.videos.find((v) => v.id === activeVideoId) ?? null,
    [project.videos, activeVideoId],
  );

  const value: StoreValue = {
    project,
    activeVideoId,
    activeVideo,
    storageWarning,
    loading,
    setActiveVideo: setActiveVideoId,
    setParams,
    updateVideo,
    setTrack,
    addVideos,
    loadExample,
    clearExamples,
    reset,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside a StoreProvider');
  return ctx;
}
