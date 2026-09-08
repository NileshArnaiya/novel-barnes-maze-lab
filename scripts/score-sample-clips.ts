/**
 * Score the three sample clips and write the combined pack to outputs/sample-clips.
 *
 * Run: pnpm score-samples
 * Needs ffmpeg and barnes-maze-data/test50.mp4 (and 51, 53).
 */
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packFiles } from '../src/io/exportPack';
import { buildReportPdf, type Rasterizer } from '../src/io/report';
import type { Frame } from '../src/tracking/blob';
import { projectFromVideos, scoreFrames } from '../src/tracking/scoreOffline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? join(ROOT, 'barnes-maze-data');
const OUT = join(ROOT, 'outputs', 'sample-clips');
const CLIPS = ['test50', 'test51', 'test53'];

function probe(video: string): { fps: number; width: number; height: number } {
  const parsed = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate,width,height', '-of', 'json', video],
      { encoding: 'utf8' },
    ),
  ) as { streams?: { width?: number; height?: number; avg_frame_rate?: string }[] };
  const stream = parsed.streams?.[0];
  const width = stream?.width ?? 0;
  const height = stream?.height ?? 0;
  const [a, b] = (stream?.avg_frame_rate ?? '30/1').split('/').map(Number);
  const fps = a && b ? a / b : 30;
  if (!width || !height) throw new Error(`Could not read size of ${video}`);
  return { fps, width, height };
}

function extractGray(video: string, dest: string, width: number, height: number): number {
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', video, '-vf', `scale=${width}:${height},format=gray`, '-f', 'rawvideo', dest],
    { stdio: 'inherit' },
  );
  const bytes = statSync(dest).size;
  const frameSize = width * height;
  if (bytes % frameSize !== 0) {
    throw new Error(`${dest} is not a whole number of ${width}x${height} frames`);
  }
  return bytes / frameSize;
}

function openGray(path: string, width: number, height: number): { frameAt: (i: number) => Frame; close: () => void } {
  const fd = openSync(path, 'r');
  const frameSize = width * height;
  return {
    frameAt: (i: number) => {
      const buf = Buffer.alloc(frameSize);
      const n = readSync(fd, buf, 0, frameSize, i * frameSize);
      if (n !== frameSize) throw new Error(`Short read at frame ${i} of ${path}`);
      return { gray: new Uint8ClampedArray(buf), width, height };
    },
    close: () => closeSync(fd),
  };
}

function hasBin(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function tryCliRasterizer(): Rasterizer | undefined {
  const tools: { bin: string; args: (svg: string, png: string) => string[] }[] = [
    { bin: 'rsvg-convert', args: (svg, png) => ['-o', png, svg] },
    { bin: 'magick', args: (svg, png) => [svg, png] },
    { bin: 'convert', args: (svg, png) => [svg, png] },
  ];
  const tool = tools.find((t) => hasBin(t.bin));
  if (!tool) return undefined;
  return async (svg: string) => {
    const dir = join(tmpdir(), `barnes-svg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const svgPath = join(dir, 'figure.svg');
    const pngPath = join(dir, 'figure.png');
    writeFileSync(svgPath, svg);
    try {
      execFileSync(tool.bin, tool.args(svgPath, pngPath), { stdio: 'ignore' });
      return new Uint8Array(readFileSync(pngPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function nodeRasterizer(): Promise<Rasterizer | undefined> {
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    return async (svg: string) => {
      const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
      return png;
    };
  } catch {
    return tryCliRasterizer();
  }
}

export async function main() {
  if (!existsSync(SRC)) {
    console.error(`No videos at ${SRC}`);
    process.exit(1);
  }

  const cache = join(ROOT, '.cache', 'score-frames');
  mkdirSync(cache, { recursive: true });

  const videos = [];
  for (const name of CLIPS) {
    const file = join(SRC, `${name}.mp4`);
    if (!existsSync(file)) {
      console.error(`skipping ${name}, not found`);
      continue;
    }
    const { fps, width, height } = probe(file);
    const raw = join(cache, `${name}.gray`);
    console.error(`extracting ${name} (${width}x${height} at ${fps.toFixed(3)} fps)`);
    const count = extractGray(file, raw, width, height);
    const gray = openGray(raw, width, height);
    try {
      console.error(`scoring ${name}: ${count} frames`);
      const record = scoreFrames(count, gray.frameAt, fps, `${name}.mp4`, name, { targetHoleIndex: 0 });
      videos.push(record);
      console.error(
        `${name}: ${record.summary?.primaryLatencyS ?? 'no reach'} s, ${record.summary?.primaryErrors} errors, strategy ${record.summary?.strategy.label}`,
      );
    } finally {
      gray.close();
      rmSync(raw, { force: true });
    }
  }

  if (videos.length === 0) {
    console.error('No clips scored.');
    process.exit(1);
  }

  const project = projectFromVideos(videos);
  const rasterize = await nodeRasterizer();
  if (!rasterize) {
    console.error('No SVG rasteriser; PDF will be tables only, figures stay as SVG.');
  }
  const pdf = await buildReportPdf(project, rasterize);
  const files = packFiles(project, pdf);

  mkdirSync(join(OUT, 'figures'), { recursive: true });
  for (const f of files) {
    writeFileSync(join(OUT, f.path), f.bytes);
  }
  console.error(`wrote ${files.length} files to ${OUT}`);
}
