import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a hidden video element parked on a given frame, so the arena canvas can
 * draw the real footage underneath the tracking overlay.
 *
 * This is not decoration. Watching the marker sit on the animal is the fastest
 * way a person can tell whether tracking worked, and it is the only check that
 * does not require trusting the tool. Drawing a trajectory on a blank
 * background asks the user to believe the numbers; drawing it on the video lets
 * them see.
 *
 * Seeking rather than playing, because scrubbing to a specific frame is what
 * the review workflow does. Seeks are coalesced: if the user drags the
 * timeline, we skip intermediate targets rather than queuing a seek per frame,
 * which otherwise makes the scrubber feel stuck.
 */
export function useVideoFrameSource(file: File | null, timeS: number) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Bumped every time a seek finishes.
   *
   * Seeking is asynchronous, so a consumer that draws when `timeS` changes
   * paints the frame the element is still showing, which is the previous one.
   * The canvas lags by exactly one seek and the overlay appears misaligned with
   * the animal, which is precisely the thing the footage is there to let the
   * user check. Consumers depend on this counter so they redraw once the new
   * frame is actually present.
   */
  const [seekTick, setSeekTick] = useState(0);
  const pending = useRef<number | null>(null);
  const seeking = useRef(false);

  useEffect(() => {
    if (!file) {
      setEl(null);
      setReady(false);
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const onReady = () => {
      setEl(video);
      setReady(true);
      setError(null);
    };
    const onError = () =>
      setError('This browser cannot decode that video, so the footage cannot be shown.');

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      setEl(null);
      setReady(false);
    };
  }, [file]);

  useEffect(() => {
    if (!el || !ready) return;

    const run = (t: number) => {
      seeking.current = true;
      const done = () => {
        el.removeEventListener('seeked', done);
        seeking.current = false;
        setSeekTick((n) => n + 1);
        // Take the most recent request that arrived while we were busy, and
        // discard everything in between.
        if (pending.current !== null) {
          const next = pending.current;
          pending.current = null;
          if (Math.abs(next - el.currentTime) > 0.01) run(next);
        }
      };
      el.addEventListener('seeked', done);
      el.currentTime = t;
    };

    if (seeking.current) pending.current = timeS;
    else if (Math.abs(timeS - el.currentTime) > 0.01) run(timeS);
  }, [el, ready, timeS]);

  return { videoEl: ready ? el : null, error, seekTick };
}
