import type { Point, TrackPoint } from '../core/types';

/**
 * Importing tracks from SLEAP and DeepLabCut.
 *
 * This is the extension that changes what the tool is for. Labs running Barnes
 * maze usually already have a pose pipeline: SLEAP or DeepLabCut, trained on
 * their own footage, validated, and trusted. What they do not have is a
 * defensible way to turn those poses into latencies, error counts and search
 * strategies without hand-scoring or a bespoke lab script.
 *
 * So rather than competing with those tools, we accept their output. Drop in an
 * existing analysis file and every downstream feature works: occlusion
 * reasoning, event detection, correction, strategy, sensitivity sweep, export.
 * The built-in tracker becomes the fallback for people who do not have a pose
 * pipeline, not the main event.
 *
 * Scope note: both tools' native binary formats are HDF5. Parsing HDF5 in the
 * browser would mean a large dependency, so we accept the CSV exports that both
 * tools produce, which is what most labs share anyway. Native `.slp` reading is
 * listed in KNOWN_LIMITATIONS.md as excluded scope with the reason.
 */

export interface PoseImportResult {
  ok: boolean;
  track: TrackPoint[];
  /** Body part names found in the file, in column order. */
  bodyParts: string[];
  notes: string[];
}

/** Split a CSV line, honouring quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * DeepLabCut CSV.
 *
 * The layout is a three-row header: scorer, bodyparts, coords. Data rows start
 * with a frame index, then x, y, likelihood for each body part in turn.
 *
 *   scorer     , DLC_resnet50..., DLC_resnet50..., DLC_resnet50..., ...
 *   bodyparts  , nose          , nose          , nose          , ...
 *   coords     , x             , y             , likelihood    , ...
 *   0          , 412.3         , 288.1         , 0.998         , ...
 */
export function parseDeepLabCutCsv(
  text: string,
  fps: number,
  likelihoodThreshold = 0.6,
): PoseImportResult {
  const notes: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 4) {
    return { ok: false, track: [], bodyParts: [], notes: ['File has too few rows to be a DeepLabCut export.'] };
  }

  const bodyPartRow = splitCsvLine(lines[1] ?? '');
  const coordRow = splitCsvLine(lines[2] ?? '');

  if ((bodyPartRow[0] ?? '').toLowerCase() !== 'bodyparts') {
    return {
      ok: false,
      track: [],
      bodyParts: [],
      notes: ['Second row is not a `bodyparts` header, so this does not look like a DeepLabCut CSV.'],
    };
  }

  // Map each body part to its x, y and likelihood column indices.
  const columns = new Map<string, { x: number; y: number; p: number }>();
  for (let i = 1; i < bodyPartRow.length; i++) {
    const part = (bodyPartRow[i] ?? '').trim();
    const coord = (coordRow[i] ?? '').trim().toLowerCase();
    if (!part) continue;
    const entry = columns.get(part) ?? { x: -1, y: -1, p: -1 };
    if (coord === 'x') entry.x = i;
    else if (coord === 'y') entry.y = i;
    else if (coord === 'likelihood') entry.p = i;
    columns.set(part, entry);
  }

  const bodyParts = [...columns.keys()];
  notes.push(`Found ${bodyParts.length} body parts: ${bodyParts.join(', ')}.`);

  // Which part is the nose, and which stands in for the body centre. We match
  // on the conventional names and fall back to the first part rather than
  // failing, because lab naming varies.
  const nosePart = bodyParts.find((b) => /nose|snout|head/i.test(b));
  const bodyPart =
    bodyParts.find((b) => /body|centre|center|thorax|mid|spine/i.test(b)) ?? bodyParts[0];

  if (!nosePart) {
    notes.push('No nose-like body part found. Hole investigations will be scored from the body centre, which tends to overcount errors.');
  }
  if (!bodyPart) {
    return { ok: false, track: [], bodyParts, notes: [...notes, 'No usable body part columns.'] };
  }

  const track: TrackPoint[] = [];
  for (let r = 3; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r] ?? '');
    const frame = Number(cells[0]);
    if (!Number.isFinite(frame)) continue;

    const read = (part: string | undefined): { p: Point | null; conf: number } => {
      if (!part) return { p: null, conf: 0 };
      const c = columns.get(part);
      if (!c) return { p: null, conf: 0 };
      const x = Number(cells[c.x]);
      const y = Number(cells[c.y]);
      const conf = c.p >= 0 ? Number(cells[c.p]) : 1;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { p: null, conf: 0 };
      return { p: { x, y }, conf: Number.isFinite(conf) ? conf : 0 };
    };

    const body = read(bodyPart);
    const nose = read(nosePart);

    // A low-likelihood point is not a position, it is the network saying it
    // could not find the animal. We mark it lost rather than plotting it,
    // which is the same rule the built-in tracker follows.
    const found = body.p !== null && body.conf >= likelihoodThreshold;

    track.push({
      frame,
      t: frame / fps,
      state: found ? 'tracked' : 'lost',
      body: found ? body.p : null,
      nose: nose.conf >= likelihoodThreshold ? nose.p : null,
      confidence: body.conf,
      provenance: 'auto',
    });
  }

  notes.push(`Imported ${track.length} frames at ${fps} fps.`);
  const lost = track.filter((p) => p.state === 'lost').length;
  if (lost > 0) {
    notes.push(
      `${lost} frames were below the ${likelihoodThreshold} likelihood threshold and are marked as not tracked. Occlusion reasoning runs next and may reclassify some of them as hole entries.`,
    );
  }

  return { ok: true, track, bodyParts, notes };
}

/**
 * SLEAP analysis CSV.
 *
 * SLEAP's CSV export is flatter than DeepLabCut's: a single header row with
 * names like `track`, `frame_idx`, then `<part>.x`, `<part>.y`, `<part>.score`.
 */
export function parseSleapCsv(
  text: string,
  fps: number,
  scoreThreshold = 0.4,
): PoseImportResult {
  const notes: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, track: [], bodyParts: [], notes: ['File is empty or has no data rows.'] };
  }

  const header = splitCsvLine(lines[0] ?? '').map((h) => h.trim());
  const frameCol = header.findIndex((h) => /^frame_?idx$/i.test(h));
  if (frameCol < 0) {
    return {
      ok: false,
      track: [],
      bodyParts: [],
      notes: ['No `frame_idx` column found, so this does not look like a SLEAP analysis CSV.'],
    };
  }

  const columns = new Map<string, { x: number; y: number; p: number }>();
  header.forEach((h, i) => {
    const m = /^(.+)\.(x|y|score)$/i.exec(h);
    if (!m) return;
    const part = m[1] ?? '';
    const kind = (m[2] ?? '').toLowerCase();
    const entry = columns.get(part) ?? { x: -1, y: -1, p: -1 };
    if (kind === 'x') entry.x = i;
    else if (kind === 'y') entry.y = i;
    else entry.p = i;
    columns.set(part, entry);
  });

  const bodyParts = [...columns.keys()];
  if (bodyParts.length === 0) {
    return { ok: false, track: [], bodyParts, notes: ['No `<part>.x` / `<part>.y` columns found.'] };
  }
  notes.push(`Found ${bodyParts.length} nodes: ${bodyParts.join(', ')}.`);

  const nosePart = bodyParts.find((b) => /nose|snout|head/i.test(b));
  const bodyPart =
    bodyParts.find((b) => /body|centre|center|thorax|mid|spine/i.test(b)) ?? bodyParts[0];
  if (!bodyPart) {
    return { ok: false, track: [], bodyParts, notes: [...notes, 'No usable node columns.'] };
  }

  const track: TrackPoint[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r] ?? '');
    const frame = Number(cells[frameCol]);
    if (!Number.isFinite(frame)) continue;

    const read = (part: string | undefined) => {
      if (!part) return { p: null as Point | null, conf: 0 };
      const c = columns.get(part);
      if (!c) return { p: null as Point | null, conf: 0 };
      const x = Number(cells[c.x]);
      const y = Number(cells[c.y]);
      const conf = c.p >= 0 ? Number(cells[c.p]) : 1;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { p: null as Point | null, conf: 0 };
      return { p: { x, y }, conf: Number.isFinite(conf) ? conf : 0 };
    };

    const body = read(bodyPart);
    const nose = read(nosePart);
    const found = body.p !== null && body.conf >= scoreThreshold;

    track.push({
      frame,
      t: frame / fps,
      state: found ? 'tracked' : 'lost',
      body: found ? body.p : null,
      nose: nose.conf >= scoreThreshold ? nose.p : null,
      confidence: body.conf,
      provenance: 'auto',
    });
  }

  notes.push(`Imported ${track.length} frames at ${fps} fps.`);
  return { ok: true, track, bodyParts, notes };
}

/**
 * Guess which format a dropped file is, so the user does not have to say.
 * A tool that asks "is this a SLEAP file or a DeepLabCut file" about a file it
 * could simply look at is making its own problem the user's problem.
 */
export function importPoseCsv(text: string, fps: number): PoseImportResult {
  const lines = text.split(/\r?\n/, 3);
  const second = (lines[1] ?? '').toLowerCase();
  if (second.startsWith('bodyparts')) return parseDeepLabCutCsv(text, fps);
  if (/frame_?idx/i.test(lines[0] ?? '')) return parseSleapCsv(text, fps);

  // Try both rather than refusing. Ambiguity is our problem, not the user's.
  const dlc = parseDeepLabCutCsv(text, fps);
  if (dlc.ok) return dlc;
  return parseSleapCsv(text, fps);
}

/**
 * Export corrected tracks back out in SLEAP-compatible CSV.
 *
 * Corrections made here are real scientific work and should not be trapped in
 * this tool. Anything a user fixes can go back into their own pipeline.
 */
export function exportSleapCsv(track: readonly TrackPoint[]): string {
  const header = ['track', 'frame_idx', 'body.x', 'body.y', 'body.score', 'nose.x', 'nose.y', 'nose.score'];
  const lines = [header.join(',')];
  for (const p of track) {
    lines.push(
      [
        'track_0',
        p.frame,
        p.body?.x.toFixed(2) ?? '',
        p.body?.y.toFixed(2) ?? '',
        p.body ? p.confidence.toFixed(3) : '',
        p.nose?.x.toFixed(2) ?? '',
        p.nose?.y.toFixed(2) ?? '',
        p.nose ? p.confidence.toFixed(3) : '',
      ].join(','),
    );
  }
  return lines.join('\n');
}
