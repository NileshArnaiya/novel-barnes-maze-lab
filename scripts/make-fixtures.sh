#!/usr/bin/env bash
# Generate evaluation fixtures from the sample videos.
#
# The sample videos are not in this repository, deliberately. This script pulls
# a handful of frames out of your local copy and writes them as PGM, which is a
# plain-text-header greyscale format Node can parse in fifteen lines with no
# dependency. The eval suite then runs the real detection code against real
# footage instead of only against synthetic trajectories.
#
# Fixtures are gitignored. They are derived from data we were asked not to
# redistribute, and they can be regenerated in one command.
#
# Usage:
#   ./scripts/make-fixtures.sh
#   ./scripts/make-fixtures.sh /path/to/videos
#
# Requires ffmpeg on your PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/barnes-maze-data}"
if [ ! -d "$SRC" ]; then
  echo "No video directory at $SRC" >&2
  echo "Usage: $0 [path/to/barnes-maze-data]" >&2
  exit 1
fi

OUT="test/fixtures/frames"
mkdir -p "$OUT"

for name in test50 test51 test53; do
  video="$SRC/$name.mp4"
  [ -f "$video" ] || { echo "skipping $name, not found"; continue; }

  # Duration and frame rate, recorded so the eval can assert on them. These
  # differ between the sample clips, which is exactly why the tool never
  # assumes a frame rate.
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=avg_frame_rate,nb_frames,width,height \
    -of json "$video" > "$OUT/$name.json"

  # Twenty-five frames spread across the recording, the same sampling the
  # background model uses. Downscaled to keep the fixture set small.
  ffmpeg -v error -y -i "$video" \
    -vf "select='not(mod(n\,ceil(t)))',scale=320:-1,format=gray" \
    -frames:v 25 "$OUT/${name}_%02d.pgm"

  echo "wrote fixtures for $name"
done

echo
echo "Fixtures in $OUT. Run: ppnpm test:eval"
