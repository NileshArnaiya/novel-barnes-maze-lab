import { useRef, useState } from 'react';
import {
  filesFromDrop,
  isScorableFile,
  pickDirectoryFiles,
  sortByName,
  supportsDirectoryPicker,
} from '../../io/folderPick';
import { importPoseCsv } from '../../io/poseImport';
import { isHdf5, readContainerFps, readVideoMetadata, videoRecordFromFile } from '../../io/videoMeta';
import type { VideoRecord } from '../../core/types';
import { rememberFile } from '../../state/fileStore';
import { useStore } from '../../state/store';

/**
 * Step 1: load videos, a folder of trials, or a pose CSV.
 * `.slp` / `.h5` are named and refused — they need a CSV export.
 */
export function Load({ onLoaded }: { onLoaded?: () => void }) {
  const { addVideos, loadExample, project } = useStore();
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState<{ text: string; kind: 'ok' | 'warn' }[]>([]);
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const canPickDirectory = supportsDirectoryPicker();

  /** Animal id and day from the filename. Always shown so a bad guess can be fixed. */
  const parseName = (name: string) => {
    const stem = name.replace(/\.[^.]+$/, '');
    const animal = /([A-Za-z]{1,4}[-_]?\d{1,4})/.exec(stem)?.[1] ?? stem;
    const day = /(?:day|d)[-_ ]?(\d{1,2})/i.exec(stem)?.[1];
    return { animalId: animal, day: day ? Number(day) : null };
  };

  /** Unique ids. Two folders can both contain trial1.mp4. */
  const uniqueId = (candidate: string, taken: Set<string>): string => {
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    let n = 2;
    while (taken.has(`${candidate}-${n}`)) n++;
    const id = `${candidate}-${n}`;
    taken.add(id);
    return id;
  };

  const handleFiles = async (input: FileList | File[]) => {
    const files = Array.isArray(input) ? input : sortByName(Array.from(input));
    setBusy(true);
    const added: VideoRecord[] = [];
    const msgs: { text: string; kind: 'ok' | 'warn' }[] = [];
    const taken = new Set(project.videos.map((v) => v.id));

    let index = 0;
    for (const file of files) {
      index++;
      if (files.length > 3) setBusyNote(`Reading ${index} of ${files.length}: ${file.name}`);

      const { animalId, day } = parseName(file.name);
      const lower = file.name.toLowerCase();

      // Pose CSVs are sometimes named like trial.mp4.csv. Don't send those
      // through the video path (that is how you get a 380 m path length).
      const looksLikePose =
        /\.slp|\.csv$|deeplabcut|dlc/i.test(lower) ||
        (/\.mp4$/.test(lower) && /\.slp\.mp4$/i.test(lower));

      if (/\.(mp4|mov|m4v|webm|avi|mkv)$/.test(lower) && !looksLikePose) {
        const meta = await readVideoMetadata(file);
        if (!meta) {
          msgs.push({
            kind: 'warn',
            text: `${file.name}: this browser cannot decode that video. Chrome and Safari handle H.264 MP4 reliably; some AVI and MKV codecs are not supported in any browser. Converting to MP4 will work.`,
          });
          continue;
        }
        // Real fps from the container, not the box above.
        const containerFps = await readContainerFps(file);
        const useFps = containerFps ?? fps;

        const built = videoRecordFromFile(file, meta, useFps, animalId, day);
        const record = { ...built, id: uniqueId(built.id, taken) };
        // File stays in memory for tracking. Not persisted. See fileStore.ts.
        rememberFile(record.id, file);
        added.push(record);
        msgs.push({
          kind: containerFps ? 'ok' : 'warn',
          text: containerFps
            ? `${file.name}: ${meta.width} by ${meta.height}, ${meta.durationS.toFixed(1)}s, ${containerFps.toFixed(3)} fps read from the file. Define the maze in step 2.`
            : `${file.name}: ${meta.width} by ${meta.height}, ${meta.durationS.toFixed(1)}s. The frame rate could not be read from this container, so ${fps} fps is assumed. Every latency and speed scales with it, so check this against your recording software before trusting the numbers.`,
        });
        continue;
      }

      if (/\.csv$/.test(lower) || looksLikePose) {
        const text = await file.text();
        const result = importPoseCsv(text, fps);
        if (!result.ok) {
          msgs.push({ kind: 'warn', text: `${file.name}: ${result.notes.join(' ')}` });
          continue;
        }
        // Canvas matches coordinates in the file, not a hardcoded 900.
        let maxX = 0;
        let maxY = 0;
        for (const pt of result.track) {
          if (pt.body) {
            if (pt.body.x > maxX) maxX = pt.body.x;
            if (pt.body.y > maxY) maxY = pt.body.y;
          }
        }
        // Room around the track so the platform is not flush to the edge.
        const w = maxX > 10 ? Math.ceil((maxX * 1.05) / 10) * 10 : 900;
        const h = maxY > 10 ? Math.ceil((maxY * 1.05) / 10) * 10 : 900;

        added.push({
          id: uniqueId(`${file.name}-${Date.now()}`, taken),
          fileName: file.name,
          durationS: result.track.length / fps,
          fps,
          width: w,
          height: h,
          animalId,
          cohort: 'imported',
          day,
          trialType: 'acquisition',
          map: null,
          track: result.track,
          events: null,
          summary: null,
          step: 2,
          strategyOverride: null,
          qcFlag: null,
        });
        msgs.push({ kind: 'ok', text: `${file.name}: ${result.notes.join(' ')}` });
        continue;
      }

      // HDF5 (.slp / .h5). We do not parse it in the browser.
      if (/\.(slp|h5|hdf5)$/.test(lower) || (await isHdf5(file))) {
        msgs.push({
          kind: 'warn',
          text: `${file.name} is an HDF5 file, which this tool does not read (see Known limitations for why). Export it as CSV and drop that in. In SLEAP: File, then Export Analysis CSV. In DeepLabCut: set save_as_csv=True and the analysis step writes a CSV beside the h5.`,
        });
        continue;
      }

      msgs.push({
        kind: 'warn',
        text: `${file.name}: not a video or a pose CSV, so nothing was done with it.`,
      });
    }

    if (added.length > 0) addVideos(added);
    setNotes(msgs);
    setBusy(false);
    setBusyNote(null);

    // Next step once something loaded.
    if (added.length > 0) {
      setTimeout(() => onLoaded?.(), 400);
    }
  };

  /** Folder picker, or a directory input where the picker is missing. */
  const chooseFolder = async () => {
    if (!canPickDirectory) {
      dirRef.current?.click();
      return;
    }

    setBusy(true);
    setBusyNote('Reading the folder');
    const files = await pickDirectoryFiles();
    setBusy(false);
    setBusyNote(null);

    // Cancelled. Not an error, so say nothing.
    if (files === null) return;

    if (files.length === 0) {
      setNotes([
        {
          kind: 'warn',
          text: 'That folder has no videos or pose CSVs in it. Sub-folders are searched too, so check you picked the right one.',
        },
      ]);
      return;
    }

    await handleFiles(files);
  };

  return (
    <div>
      <h2>Load your trials</h2>
      <p className="hint" style={{ marginTop: 6, marginBottom: 20 }}>
        Nothing is uploaded. Everything runs in this browser tab and your files never leave
        your computer.
      </p>

      <div className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="fps">Frame rate</label>
        <input
          id="fps"
          type="number"
          min={1}
          max={240}
          value={fps}
          style={{ width: 90 }}
          onChange={(e) => setFps(Number(e.target.value) || 30)}
        />
        <span className="hint">
          fps. Only used when the frame rate cannot be read from the file itself, which the tool
          tries first. Every latency and speed scales with it.
        </span>
      </div>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          // Expand folders now; DataTransfer is empty after this handler.
          const dt = e.dataTransfer;
          if (dt.items.length > 0 || dt.files.length > 0) {
            void filesFromDrop(dt).then((files) => {
              if (files.length > 0) void handleFiles(files);
            });
          }
        }}
      >
        <h3>Drop videos or a folder of trials here</h3>
        <p className="hint" style={{ margin: '8px auto 18px', maxWidth: 460 }}>
          MP4 video, or a SLEAP or DeepLabCut CSV export. Drag and drop, or point at a folder
          and the whole cohort comes in at once, sub-folders included. If you have already
          tracked your videos, bring those tracks in and skip straight to scoring. Formats are
          detected from the file itself.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Reading files' : 'Choose files'}
          </button>
          <button onClick={() => void chooseFolder()} disabled={busy}>
            Point at a folder
          </button>
        </div>
        {busyNote ? (
          <p className="hint" style={{ marginTop: 12 }}>
            {busyNote}
          </p>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv,.csv,.slp,.h5,.hdf5"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            // Reset so choosing the same file twice still fires a change event.
            e.target.value = '';
          }}
        />
        {/*
          Fallback folder input for browsers without showDirectoryPicker.
          `webkitdirectory` is not in React's attribute types, hence the cast.
        */}
        <input
          ref={dirRef}
          type="file"
          multiple
          hidden
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []).filter((f) => isScorableFile(f.name));
            if (picked.length > 0) void handleFiles(sortByName(picked));
            else if (e.target.files && e.target.files.length > 0) {
              setNotes([
                {
                  kind: 'warn',
                  text: 'That folder has no videos or pose CSVs in it. Check you picked the right one.',
                },
              ]);
            }
            e.target.value = '';
          }}
        />
      </div>

      {notes.length > 0 ? (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3>What happened to each file</h3>
          <ul className="reason" style={{ marginTop: 8 }}>
            {notes.map((n, i) => (
              <li key={i} style={n.kind === 'warn' ? { color: '#7a4f0d' } : undefined}>
                {n.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="panel" style={{ marginTop: 18 }}>
        <h3>No data to hand?</h3>
        <p className="hint" style={{ margin: '6px 0 14px' }}>
          Load generated example trials, already scored, to see how the tool behaves. One
          of them has a deliberate tracking failure in it. They span two cohorts and three
          days so the learning curve and cohort comparison have something to draw.
        </p>
        <button onClick={loadExample}>Load example trials</button>
      </div>

      <p className="hint" style={{ marginTop: 20 }}>
        Currently loaded: {project.videos.length} trial{project.videos.length === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
