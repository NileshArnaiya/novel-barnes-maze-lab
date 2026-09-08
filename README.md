# Barnes maze scorer

**[Live app](https://barnes-maze-lab.vercel.app/) &middot; [Demo video](https://www.youtube.com/watch?v=PMTxAgf9lAE)**

A browser tool that turns Barnes maze videos into an analysis-ready spreadsheet, built for a
researcher who wants results without opening a terminal. Track the animal, define the maze,
review and correct, and export tidy data with publication figures. It runs fully client-side,
so videos never leave the machine.

Review workspaceTrajectory figure and the scoring thresholdsReview workspace on a scored trial

## Quick start

```bash
git clone https://github.com/NileshArnaiya/novel-barnes-maze-lab
cd novel-barnes-maze-lab-main
pnpm install
pnpm dev
```

Open the printed localhost URL. Node 18+ and [pnpm](https://pnpm.io) 9+.

Sample data ships with the repo under barnes-maze-data or you can Grab the three test clips from [salk-airc/rse-takehome-2026](https://github.com/salk-airc/rse-takehome-2026) under
`data/barnes-maze/`, or click **Load example trials** in the app for three generated ones.

## Scripts


| Command          | What it does                                             |
| ---------------- | -------------------------------------------------------- |
| `pnpm dev`       | Start the dev server with hot reload                     |
| `pnpm build`     | Type-check and build a static `dist/`                    |
| `pnpm preview`   | Serve the built `dist/` locally                          |
| `pnpm test`      | Golden tests on synthetic trajectories                   |
| `pnpm test:eval` | Detection and tracking-accuracy checks on labelled clips |
| `pnpm typecheck` | `tsc --noEmit`                                           |


## How it works

Five steps, left to right:

1. **Load** &mdash; drop in an MP4, or a SLEAP / DeepLabCut CSV export (auto-detected).
2. **Maze** &mdash; drag a ring onto the platform, size it, mark the escape hole. Do it once,
  then apply the geometry to the rest of the cohort.
3. **Track** &mdash; find the animal frame by frame, or re-reason over an imported track.
4. **Review** &mdash; the workspace: trajectory over the footage, a scrubable timeline,
  live-updating measures, the strategy classifier with its reasoning, and every threshold
   on screen next to the numbers it drives.
5. **Export** &mdash; the cohort learning curve, an analysis-ready Excel workbook, tidy CSVs,
  trajectory and heatmap figures, and a reloadable project file.

The design rule the whole thing follows: **uncertainty is never hidden.** When the animal
can't be located, the frame is marked lost and drawn as a break in the path, never
interpolated. A hole entry and a tracking failure are distinct states, resolved from where
the animal was last seen. Every number links back to the frame it came from.

## What I chose not to build

- **A trained strategy classifier.** BUNS (Illouz 2016) is the rigorous version, an SVM over trajectory features. A model shipped without its training set is a black box the user can't audit, so I used transparent rules over the same features, with the reasoning shown.
- **A deep-learning tracker.** More robust on hard footage, but an unauditable dependency that
needs a download. The classical tracker can be explained in two minutes and fails visibly;
for hard footage the SLEAP/DeepLabCut import path takes over.
- **A backend or desktop build.** I was in 2 minds, because a backend could help in many ways to use APIs and databases to store locally and also run models locally or hosted which would help but eventually a web interface is the most easiest way to get a researcher to try the tool out. 
- **Native** `.slp` **/** `.h5` **parsing.** Both are HDF5, a heavy browser dependency. Labs share the  
CSV exports, so did not make sense to do this, might add only for convenience in the future.

## Tech

TypeScript, React, and Vite. No backend and no runtime data services. Video is decoded with
WebCodecs (frame-exact) or the `<video>` element as a fallback; the demuxer is `mp4box` and
the Excel export uses `SheetJS`, both bundled and lazy-loaded. Deploys as static files to any
host; a `vercel.json` is included.

The scientific core in `src/core/` is pure TypeScript with no dependencies and no DOM, so
every measure is unit-testable in isolation. React is only the shell around it.

```
src/
  core/       measures, events, strategy, geometry  (pure, tested)
  tracking/   background model, blob detection, occlusion, decoding
  io/         persistence, CSV/XLSX export, pose import, figures
  state/      the project store
  ui/         wizard shell, steps, canvas, panels
```

## Testing

`pnpm test` checks the measures against synthetic trajectories with answers worked out by
hand. `pnpm test:eval` is the pixel-level check: maze detection on sampled frames, and
whether the tracked point lands on the animal in frames you labelled by hand. Either layer
skips and prints setup instructions when the data is missing, so CI stays green without it.
See [VALIDATION.md](VALIDATION.md) for what a green result does and does not mean.

### Ground truth and evals

ffmpeg must be on your `PATH`. Sample clips live in `barnes-maze-data/` (`test50.mp4`,
`test51.mp4`, `test53.mp4`). The same steps work on your own MP4s.

**1. Maze-detection fixtures** (platform and hole ring). Defaults to `barnes-maze-data/`:

```bash
./scripts/make-fixtures.sh
# or
./scripts/make-fixtures.sh /path/to/your/videos
```

This writes greyscale frames to `test/fixtures/frames/`. That folder is gitignored. The
detection half of `pnpm test:eval` currently looks for clips named `test50`, `test51`, and
`test53`.

**2. Hand-label the animal.** One video at a time:

```bash
node scripts/label-frames.mjs barnes-maze-data/test53.mp4
```

For your own footage, pass that file instead:

```bash
node scripts/label-frames.mjs /path/to/your-trial.mp4
```

The script prints a local URL. Open it, **click the mouse** in each frame (or skip if the
animal is not visible). Labels save as you go. When the page says done, close the tab and
stop the script (`Ctrl-C`). Repeat for each clip.

Clicks are written to `test/fixtures/labels/<name>.labels.json`, with matching PNGs and PGMs
under `test/fixtures/labels/<name>/`. Eight frames are sampled across the clip. That is a
spot check, not a full labelled trial.

**3. Run the eval:**

```bash
pnpm test:eval
```

That runs maze detection against the fixtures, then tracking accuracy against every
`*.labels.json` it finds. The tracker must land within 6 cm of your click (about a body
length: you click somewhere on the animal, the detector returns the centroid). On your own
clips, name the file whatever you like; the accuracy tests pick up the label file from the
stem of the video name.

## Privacy and cost

Nothing is sent anywhere: no server, API key, analytics, cookie, or CDN. The one exception is
an optional trial explainer (step 4) that calls Google Gemini, off unless
`VITE_GEMINI_API_KEY` is set, and even then it sends only summary numbers, never frames or
identifiers, and shows the exact payload first. See `[.env.example](.env.example)`. Running
cost is static hosting only; the analysis happens in the browser.

## Accessibility

Keyboard-navigable throughout (press `?` for the shortcut list), a skip link to the
workspace, status never signalled by colour alone, a real `slider` timeline, reflow at 200%
zoom, and `prefers-reduced-motion` honoured.

## Docs

- `[docs/measures.md](docs/measures.md)` &mdash; every measure, its source, and where the
literature disagrees.
- [VALIDATION.md](VALIDATION.md) &mdash; how tracking accuracy was checked.
- `[ARCHITECTURE.md](ARCHITECTURE.md)` &mdash; data flow in one page.
- `[CONTRIBUTING.md](CONTRIBUTING.md)` &mdash; local setup and the rules for a change.
- `[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)` &mdash; real defects vs excluded scope.
- `[AI_NOTES.md](AI_NOTES.md)` &mdash; how AI tooling was used and where it was wrong.

## Claude skill

The installable Claude Code skill lives at
[NileshArnaiya/barnes-maze-claude-skill](https://github.com/NileshArnaiya/barnes-maze-claude-skill).
It teaches Claude this assay's measures, the export schema, and the analysis traps the data
invites, so it writes correct analysis code against the exports. A copy also ships in
`[claude-skills/](claude-skills/)`.

```
/plugin marketplace add NileshArnaiya/barnes-maze-claude-skill
/plugin install analyzing-barnes-maze@barnes-maze-skills
```

## License

[MIT](LICENSE).