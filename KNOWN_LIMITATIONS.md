# Known limitations

**Detection runs on the main thread at reduced resolution.** Frames are processed at 640 px
on the long edge

**Video files are not persisted across a reload.** Tracks, corrections and scores are all
saved. 
## Found by running against the real sample videos

**Frame rate differs between clips in the same dataset.** `test51` is 15.005 fps and
`test53` is 29.934 fps. Same rig, same assay. 


Tracking accuracy is spot-checked, not fully validated

The tracker was checked against hand-labelled ground truth: a person clicked the animal in frames sampled across each of the three sample clips, and the real detector was run on those exact frames. Every labelled frame was detected and every detection fell within one mouse body length of the click.

Clip	Frames detected	Within 6 cm	Median error
test50	8 / 8	8 / 8	1.6 cm
test51	7 / 7	7 / 7	0.5 cm
test53	7 / 7	7 / 7	1.0 cm

What this does not establish:

It is 22 frames, not a validation study. Per-frame accuracy over a whole trial, across more than one rig, with error distributions, was not measured. That is a project in itself and needs labelled data this exercise does not ship. See docs/validation.md.
The number is a centroid-to-click distance, not a true position error. A human clicks somewhere on the animal; the detector returns the body centroid; the two differ by roughly a body length even when tracking is perfect. The 6 cm tolerance is set for that, and the medians are comfortably inside it, but they are not a claim of millimetre accuracy.
It was checked on clean, high-contrast, top-down footage. Low-contrast or shadowed video will do worse. The tool reports tracked_fraction per trial so a degraded run shows as a low number rather than a confident wrong one, and the SLEAP/DeepLabCut import path is there for footage the classical tracker cannot handle yet.

