# What each measure means

Tracks `src/core/measures.ts`, `events.ts`, `strategy.ts`. Change a definition in code,
change it here.

Several of these measures have no single agreed definition. Labs count errors differently,
define "reached the target" differently, and score strategy by eye. Where that happens the
tool exposes the choice as a control and writes the value used into every export, instead of
picking one silently.

## Sources

Checked each of these by hand.

- **Barnes 1979**, *J Comp Physiol Psychol* 93(1):74-104. The original task.
- **Harrison et al. 2006**, *Learning & Memory* 13(6):809-819. Origin of the spatial / serial
  / random split this classifier uses; shows serial search needs no spatial memory.
- **Gawel et al. 2019**, *Naunyn-Schmiedeberg's Arch Pharmacol* 392(1):1-18. The best review
  of the measures and their confounds. Most useful single reference.
- **Illouz et al. 2016**, *Bioinformatics* 32(21):3314-3320. BUNS: an SVM that classifies
  strategy without a human rater.
- **Lee, Jung, Royer 2024**, *eLife* 88648. How strategies shift as an animal learns.

Compared against EthoVision XT, ANY-maze, and ConductVision, which do tracking and the
standard measures well. Used as inspiration.

## Trial types

Acquisition has an escape box under the target; probe does not. Total latency and escape are
undefined on a probe, so the tool returns null. One code path for both is how you get a
column that is confidently wrong.

## Primary latency

Time to first reach the target hole. "Reaching" = within `reachedTargetRadiusCm` (default
5 cm) of the centre; a radius is reproducible, a rater's judgement is not. First arrival is
scored, even if the animal then leaves and returns, because that is the memory question. Blank
= never reached, paired with a `reached_target` boolean so it can't be read as a fast zero.

## Total latency

Time to enter the escape box. Scored as a lasting disappearance at the target,
`escapeConfirmFrames` (default 8) long, checked against the last seen position. Too low and a
one-frame dropout reads as an escape.

## Primary and total errors

Distinct non-target holes investigated, before first reaching the target (primary) or across
the trial (total). An investigation is at least `investigationMinDwellS` (0.2 s) within
`investigationRadiusCm` (3 cm) of a hole; repeats inside `investigationRefractoryS` (1 s)
count once.

Some labs count every visit, not distinct holes, giving larger numbers for serial searchers.
This tool counts distinct holes and records that in the export. Scored off the nose when
available, else the body centre, because a mouse's centre passes near holes it never
inspected and inflates the count.

## Path length

Distance travelled, cm. Only consecutive seen frames count; gaps are skipped, not bridged
(bridging invents distance, skipping under-reports, and `tracked_fraction` flags it). Moves
below `MIN_DISPLACEMENT_CM` (0.4 cm) are noise, not travel, or resting jitter piles up at
30 fps. Centimetres via the platform diameter you enter, per video.

## Mean speed

Mean over frames moving faster than 1 cm/s, so it doesn't mix moving slowly with sitting
still. An exploring mouse runs ~5-15 cm/s; far outside that means bad calibration or the
tracker jumped off the animal.

## Target quadrant time

Seconds in the quarter of the platform centred on the target, defined relative to the target
so it means the same across animals. The standard probe readout. Unseen frames are excluded,
so a bad trial reports less, not an invented amount.

## Thigmotaxis fraction

Visible time within 5 cm of the edge. Its own number because it is anxiety, not memory, and
looks like poor memory in latency and errors (Gawel 2019).

## Search strategy

spatial, serial, random, or undetermined. The split is Harrison et al. 2006.

- **spatial**: straight to the target, or search concentrated in the target quadrant.
  Directness >= 0.45, or high quadrant occupancy, with <= 3 non-target holes.
- **serial**: >= 4 ring-adjacent holes checked in sequence.
- **random**: neither.
- **undetermined**: nothing to classify.

Serial is checked before spatial: an animal working the ring can finish on a straight leg, and
calling that spatial overstates memory. Reversals are allowed in a serial run. Random
confidence is capped at 0.5, being the leftover category.

The rigorous version is BUNS (Illouz 2016), an SVM over similar features. I didn't ship a
trained model: a model without its training data is a black box the user can't check. The
rules here use the same kind of features, show their reasoning, and can be overridden, with
the automatic reasoning kept alongside.

## Tracked fraction

Fraction of frames where position is known. In-hole counts as known (we know where it is, it
just isn't visible); only unexplained frames count against it. Read this first: it tells you
how much to trust everything else.