import type { VideoRecord } from '../../core/types';

/**
 * What is happening, and what to do next.
 *
 * The wizard tells the user which step they are on. It does not tell them what
 * state their data is in, which is the thing they actually want to know after
 * pressing a button: did that work, is this trustworthy, what now.
 *
 * This banner answers those three in one line, derived from the record rather
 * than from a flag someone has to remember to set. Every message ends with an
 * action, because a status with no next step is just an observation.
 */
export function StatusBanner({ video, step }: { video: VideoRecord | null; step: number }) {
  if (!video) {
    return (
      <div className="notice info">
        Nothing loaded. Drop a video or a pose CSV in step 1, or load the example trials to
        see how the tool behaves.
      </div>
    );
  }

  const isVideo = /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(video.fileName);

  if (!video.map) {
    return (
      <div className="notice">
        <strong>{video.animalId}</strong> is loaded
        {isVideo ? `, ${video.width} by ${video.height} at ${video.fps.toFixed(2)} fps` : ''}, but
        the maze is not defined yet. Nothing can be scored until the tool knows where the holes
        are. Go to step 2.
      </div>
    );
  }

  if (!video.track) {
    return (
      <div className="notice">
        Maze defined with {video.map.holes.length} holes. No tracking yet, so there are no
        numbers on this trial. Go to step 3 and run it.
      </div>
    );
  }

  if (!video.summary) {
    return <div className="notice">Tracked, but not scored yet. Re-run step 3.</div>;
  }

  const s = video.summary;
  const pct = (s.trackedFraction * 100).toFixed(0);
  const strategy = s.strategy.label;

  // On the earlier steps, reporting a score the user is not looking at is
  // noise, and worse, it reads as if it applies to whatever they are about to
  // do. Say what this step is for instead.
  if (step === 2) {
    return (
      <div className="notice info">
        Editing the maze for <strong>{video.animalId}</strong>. This trial is already scored, so
        changing the ring or the escape hole will change its numbers.
      </div>
    );
  }
  if (step === 3) {
    return (
      <div className="notice info">
        <strong>{video.animalId}</strong> is already tracked at {pct}% of frames. Running this
        again replaces the automatic track. Anything you corrected by hand is kept.
      </div>
    );
  }

  // The headline is whether these numbers can be trusted, not what they are.
  if (video.qcFlag) {
    return (
      <div className="notice">
        <strong>Check this trial.</strong> {video.qcFlag} The animal was localised in {pct}% of
        frames, so the measures below are computed from what was seen and may under-report.
        Use the timeline to jump to the gaps.
      </div>
    );
  }

  return (
    <div className="notice info">
      Scored. The animal was localised in {pct}% of frames, searched{' '}
      <strong>{strategy}</strong>
      {s.primaryLatencyS !== null
        ? `, and reached the target after ${s.primaryLatencyS.toFixed(1)}s`
        : ', and never reached the target'}
      . Click any number to jump to the frame it came from, or drag a threshold to see how much
      it depends on where the line was drawn.
    </div>
  );
}
