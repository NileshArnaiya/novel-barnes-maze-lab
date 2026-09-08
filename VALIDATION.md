# How tracking accuracy was checked

## The two things the test suite proves, and the gap between them

`pnpm test` proves the **measures** are correct given a trajectory. Synthetic paths with
answers you can work out by hand: a straight line of known length returns that length, a gap
is not bridged, a ring-walk classifies serial. These assume the trajectory is right; they
cannot check it, because the trajectory is supplied.

`pnpm test:eval`, detection half, proves the **maze geometry** is found: the platform is in
the right place, the hole ring sits at a sane radius, the background is not the animal. None
of this checks whether the tracked point is on the animal.

That leaves one question neither covers: **is the tracked dot actually on the mouse?** A
detector can place the ring perfectly and then follow a shadow. The measures would then be
computed correctly on a wrong path, and every other test would still pass.

## The ground-truth spot check

`pnpm test:eval` includes a tracking-accuracy check against hand labels. The process:

1. `node scripts/label-frames.mjs <clip>.mp4` pulls a handful of frames from a sample clip
   and opens a page where a person clicks the animal in each one.
2. Those clicks are saved as ground truth.
3. The eval runs the real detector on those frames and checks the detected centroid lands
   within 6 cm of the human label.

The 6 cm tolerance is deliberately generous. A mouse is a few centimetres long, the label is
a click somewhere on its body, and the detector returns the centroid, so the two differ by
roughly a body length even when tracking is perfect. The tolerance is set to catch "tracking
the wrong object" rather than to certify sub-centimetre accuracy.

## Result on the sample clips

Every labelled frame was detected, and every detection fell within a body length of the
human click, on all three clips:

| Clip | Frames detected | Within 6 cm | Median error |
| --- | --- | --- | --- |
| test50 | 8 / 8 | 8 / 8 | 1.6 cm |
| test51 | 7 / 7 | 7 / 7 | 0.5 cm |
| test53 | 7 / 7 | 7 / 7 | 1.0 cm |

Median error across the three clips is 0.5 to 1.6 cm on a 92 cm platform. That is well
inside a mouse body length, which is what a centroid-versus-click comparison can resolve, so
the honest reading is "the tracker is on the animal", not "the tracker is accurate to a
millimetre".

## What a green result means, and what it does not

A pass means: **in the frames that were labelled, the tracker was on the animal, within a
body length.** It rules out the gross failure modes: following the hand, a shadow, or
nothing.

A pass does **not** mean:

- Sub-centimetre position accuracy. The tolerance is a body length, and the median above is a
  centroid-to-click distance, not a true position error.
- Accuracy across a whole trial. This is 22 labelled frames across three clips, not every
  frame of every trial.
- Accuracy on your footage. It was checked on the three sample clips, which are clean,
  high-contrast, top-down. Low-contrast or shadowed footage will do worse, and the tool
  flags that through `tracked_fraction` rather than hiding it.

This is a spot check, stated as one. The honest sentence to use: *the tracker was validated
to find the maze, to score synthetic trajectories exactly, and to land on the animal within
a body length (median 0.5 to 1.6 cm) in 22 hand-labelled frames across the three sample
clips. Per-frame accuracy over a whole trial against a full labelled ground truth was not
measured, which is why SLEAP and DeepLabCut import is a first-class path rather than a
fallback.*

## Why not a full validation study

A real validation would label every frame of several trials, from more than one rig, and
report per-frame error distributions. That is a project in itself and needs labelled data
this exercise does not ship with. The classical tracker here is a transparent default for
clean footage, not a claim to beat a trained pose estimator. When tracking quality is the
thing that matters, the import path hands the job to SLEAP or DeepLabCut, which are built and
validated for exactly that, and every downstream feature works identically on their output.