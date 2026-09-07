import { useRef, useState } from 'react';
import { importPoseCsv } from '../../io/poseImport';
import { isHdf5, readContainerFps, readVideoMetadata, videoRecordFromFile } from '../../io/videoMeta';
import type { VideoRecord } from '../../core/types';
import { rememberFile } from '../../state/fileStore';
import { useStore } from '../../state/store';

/**
 * Step 1: get data in.
 *
 * Three doors, because a lab arrives with whatever it already has: raw video, a
 * SLEAP or DeepLabCut CSV export, or a `.slp` / `.h5` we cannot read.
 *
 * That last case matters more than it looks. An earlier version accepted only
 * CSV and silently ignored everything else, which told the user nothing and
 * looked broken. Naming the format, saying why it is unsupported, and giving
 * the exact export command turns a dead end into a next step.
 */
export function Load({ onLoaded }: { onLoaded?: () => void }) {
  const { addVideos, loadExample, project } = useStore();
  const [over, setOver] = useState(false);
  const [notes, setNotes] = useState<{ text: string; kind: 'ok' | 'warn' }[]>([]);
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Parse metadata out of a filename. Labs encode animal and day in filenames
   * because that is what the acquisition software allows. The guess is always
   * visible and editable, because a wrong silent guess mislabels a cohort.
   */
  const parseName = (name: string) => {
    const stem = name.replace(/\.[^.]+$/, '');
    const animal = /([A-Za-z]{1,4}[-_]?\d{1,4})/.exec(stem)?.[1] ?? stem;
    const day = /(?:day|d)[-_ ]?(\d{1,2})/i.exec(stem)?.[1];
    return { animalId: animal, day: day ? Number(day) : null };
  };

  const handleFiles = async (files: FileList) => {
    setBusy(true);
    const added: VideoRecord[] = [];
    const msgs: { text: string; kind: 'ok' | 'warn' }[] = [];

    for (const file of Array.from(files)) {
      const { animalId, day } = parseName(file.name);
      const lower = file.name.toLowerCase();

      // A pose export is sometimes named after its source video, e.g.
      // "trial.slp.mp4" or "trial.mp4.csv". Extension alone is not enough, so a
      // file whose name contains .slp or .csv, or whose text parses as a pose
      // table, is treated as a track no matter what it ends in. Getting this
      // wrong routes SLEAP coordinates through the video path, where they are
      // scored in a hardcoded 900 px space that never matches the real frame,
      // which is where a 380 metre path length comes from.
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
        // Read the real frame rate from the container rather than trusting the
        // box above. The two sample clips differ by a factor of two, and the
        // difference silently doubles or halves every time-based measure.
        const containerFps = await readContainerFps(file);
        const useFps = containerFps ?? fps;

        const record = videoRecordFromFile(file, meta, useFps, animalId, day);
        // Keep the File itself so step 3 can decode it. In memory only; see
        // src/state/fileStore.ts for why it is not persisted.
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
        // Size the working canvas to the coordinates in the file, not a fixed
        // 900. SLEAP and DeepLabCut report positions in the source video's pixel
        // space; a mismatched canvas size makes the platform-diameter
        // calibration wrong and inflates every distance and speed.
        let maxX = 0;
        let maxY = 0;
        for (const pt of result.track) {
          if (pt.body) {
            if (pt.body.x > maxX) maxX = pt.body.x;
            if (pt.body.y > maxY) maxY = pt.body.y;
          }
        }
        // Round up to a sensible frame, with a margin so the platform is not
        // flush against the edge. Falls back to 900 for an empty track.
        const w = maxX > 10 ? Math.ceil((maxX * 1.05) / 10) * 10 : 900;
        const h = maxY > 10 ? Math.ceil((maxY * 1.05) / 10) * 10 : 900;

        added.push({
          id: `${file.name}-${Date.now()}`,
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

      // SLEAP .slp and DeepLabCut .h5 are HDF5. We do not parse HDF5 in the
      // browser, and pretending otherwise would be worse than saying so.
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

    // Go straight to the next step. Loading a file is not a destination, and
    // leaving the user on the drop zone wondering whether anything happened is
    // the single most common way a wizard feels broken.
    if (added.length > 0) {
      setTimeout(() => onLoaded?.(), 400);
    }
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
          if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
        }}
      >
        <h3>Drop videos or tracked poses here</h3>
        <p className="hint" style={{ margin: '8px auto 18px', maxWidth: 460 }}>
          MP4 video, or a SLEAP or DeepLabCut CSV export. If you have already tracked your
          videos, bring those tracks in and skip straight to scoring. Formats are detected
          from the file itself.
        </p>
        <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? 'Reading files' : 'Choose files'}
        </button>
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
          Load three generated example trials, already scored, to see how the tool behaves. One
          of them has a deliberate tracking failure in it.
        </p>
        <button onClick={loadExample}>Load example trials</button>
      </div>

      <p className="hint" style={{ marginTop: 20 }}>
        Currently loaded: {project.videos.length} trial{project.videos.length === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
