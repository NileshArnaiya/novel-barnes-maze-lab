#!/usr/bin/env node
/**
 * Hand-label animal position in a handful of frames, to validate tracking.
 *
 * The detection eval proves the maze geometry is found. It does not prove the
 * tracked point is on the animal, because there is no ground truth for animal
 * position. This script is how you make that ground truth: it extracts evenly
 * spaced frames from a sample video as PNGs and opens a tiny local page where
 * you click the animal in each one. Your clicks are written to a JSON file the
 * eval then checks the tracker against.
 *
 * Twenty labelled points across three clips is not a validation study. It is a
 * spot check, and it is the difference between "I never verified tracking" and
 * "I verified it against hand labels and it is within tolerance". Say it that
 * way; do not overclaim.
 *
 * Usage:
 *   node scripts/label-frames.mjs /path/to/data/barnes-maze/test53.mp4
 * then open the printed URL, click the animal in each frame, and it saves
 * test/fixtures/labels/test53.labels.json
 *
 * Requires ffmpeg and Node 18+. No dependencies.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const video = process.argv[2];
if (!video) {
  console.error('Usage: node scripts/label-frames.mjs /path/to/testNN.mp4');
  process.exit(1);
}

const name = basename(video).replace(/\.[^.]+$/, '');
const N_FRAMES = 8; // per clip; keep small, this is a spot check
const workDir = join('test', 'fixtures', 'labels', name);
const labelsPath = join('test', 'fixtures', 'labels', `${name}.labels.json`);
mkdirSync(workDir, { recursive: true });

// Probe fps and frame count so we can record the true frame index of each grab.
const probe = JSON.parse(
  execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=avg_frame_rate,nb_frames,width,height',
    '-of', 'json', video,
  ]).toString(),
);
const stream = probe.streams[0];
const [num, den] = stream.avg_frame_rate.split('/').map(Number);
const fps = den ? num / den : 30;
const nbFrames = Number(stream.nb_frames) || 900;
const width = stream.width;
const height = stream.height;

// Pick evenly spaced frame indices, avoiding the very start and end.
const indices = [];
for (let i = 0; i < N_FRAMES; i++) {
  indices.push(Math.round(nbFrames * (0.1 + (0.8 * i) / (N_FRAMES - 1))));
}

// Extract each as a PNG at full resolution.
for (const idx of indices) {
  const t = idx / fps;
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-ss', String(t), '-i', video,
    '-frames:v', '1', join(workDir, `${idx}.png`),
  ]);
  // Also write a greyscale PGM the accuracy test can read without any image
  // library. Same frame, full resolution, so the labelled coordinates and the
  // detector run on identical pixels.
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-ss', String(t), '-i', video,
    '-frames:v', '1', '-pix_fmt', 'gray', join(workDir, `${idx}.pgm`),
  ]);
}
console.log(`Extracted ${indices.length} frames from ${name} (${width}x${height}, ${fps.toFixed(3)} fps)`);

// Load any labels already saved, so you can resume.
let labels = {};
try {
  labels = JSON.parse(readFileSync(labelsPath, 'utf8')).points ?? {};
} catch {
  /* first run */
}

const page = (idx) => `<!doctype html><meta charset=utf8>
<style>body{font-family:sans-serif;background:#faf8f4;color:#26221f;margin:0;padding:20px}
img{max-width:90vw;border:1px solid #cfc5b7;cursor:crosshair;display:block}
.bar{margin:10px 0;font-size:14px}b{color:#c05f3c}</style>
<div class=bar>Frame <b>${idx}</b> &middot; click the animal &middot; ${indices.indexOf(idx)+1}/${indices.length}
&middot; <a href="/next?from=${idx}">skip</a></div>
<img src="/img/${idx}.png" id=i>
<script>
const idx=${idx}, w=${width}, h=${height};
document.getElementById('i').addEventListener('click',e=>{
  const r=e.target.getBoundingClientRect();
  const x=Math.round((e.clientX-r.left)/r.width*w);
  const y=Math.round((e.clientY-r.top)/r.height*h);
  fetch('/save?idx='+idx+'&x='+x+'&y='+y).then(()=>location='/next?from='+idx);
});
</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/img/')) {
    res.setHeader('content-type', 'image/png');
    res.end(readFileSync(join(workDir, url.pathname.slice(5))));
    return;
  }
  if (url.pathname === '/save') {
    const idx = url.searchParams.get('idx');
    labels[idx] = { x: Number(url.searchParams.get('x')), y: Number(url.searchParams.get('y')) };
    writeFileSync(labelsPath, JSON.stringify({ name, fps, width, height, points: labels }, null, 2));
    res.end('ok');
    return;
  }
  if (url.pathname === '/next') {
    const from = Number(url.searchParams.get('from'));
    const next = indices[indices.indexOf(from) + 1];
    if (next === undefined) {
      res.setHeader('content-type', 'text/html');
      res.end(`<body style="font-family:sans-serif;padding:40px">
        Done. Saved ${Object.keys(labels).length} labels to <code>${labelsPath}</code>.
        You can close this tab and stop the script (Ctrl-C), then run <code>pnpm test:eval</code>.</body>`);
      return;
    }
    res.writeHead(302, { location: '/frame/' + next });
    res.end();
    return;
  }
  const m = /^\/frame\/(\d+)$/.exec(url.pathname);
  const idx = m ? Number(m[1]) : indices[0];
  res.setHeader('content-type', 'text/html');
  res.end(page(idx));
});

server.listen(0, () => {
  const port = server.address().port;
  console.log(`\nOpen  http://localhost:${port}/frame/${indices[0]}  and click the animal in each frame.`);
  console.log('Labels save as you go. Ctrl-C when the page says done.\n');
});
