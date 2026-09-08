# Known limitations

**Detection runs on the main thread at reduced resolution.** Frames are processed at 640 px
on the long edge

**Video files are not persisted across a reload.** Tracks, corrections and scores are all
saved. 
## Found by running against the real sample videos

**Frame rate differs between clips in the same dataset.** `test51` is 15.005 fps and
`test53` is 29.934 fps. Same rig, same assay. 