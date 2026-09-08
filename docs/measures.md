# What each measure means

This file backs up every number the tool produces: what it is, where the definition comes
from, and where researchers disagree. It tracks `src/core/measures.ts`, `events.ts` and
`strategy.ts`. If you change a threshold or a definition in code, change it here too.

The honest thing to say up front: several of these measures have no single agreed
definition. Different labs count errors differently, define "reached the target"
differently, and score strategy by eye. Where that is the case, the tool exposes the choice
as a control and writes the value used into every export, rather than picking one silently
and hoping nobody asks.

## Sources

These are the papers the definitions come from. I have kept the list short and checked each
citation by hand.

- Barnes CA (1979), *J Comp Physiol Psychol* 93(1):74-104. The original task.
- Harrison FE, Reiserer RS, Tomarken AJ, McDonald MP (2006), *Learning & Memory* 13(6):809-819,
  doi:10.1101/lm.334306. The reference for the spatial / serial / random distinction this
  tool's classifier uses. Shows the maze can be solved by spatial, cued, or serial search,
  and that serial search does not need spatial memory.
- Gawel K, Gibula E, Marszalek-Grabska M, Filarowska J, Kotlinska JH (2019),
  *Naunyn-Schmiedeberg's Archives of Pharmacology* 392(1):1-18, doi:10.1007/s00210-018-1589-y.
  A methodological review of the measures, the confounds, and how apparatus design pushes
  animals toward serial search. The single most useful reference for what the numbers mean.
- Illouz T, Madar R, Clague C, Griffioen KJ, Louzoun Y, Okun E (2016), *Bioinformatics*
  32(21):3314-3320, doi:10.1093/bioinformatics/btw376. BUNS: a support vector machine that
  classifies Barnes maze strategy without a human rater, plus a cognitive score scale.
- Lee J-Y, Jung D, Royer S (2024), *eLife* 88648. Stochastic characterisation of navigation
  strategies in an automated Barnes maze; useful on how strategies shift as an animal learns.

Tools worth knowing, because a researcher will compare this to them: EthoVision XT (the
commercial standard, referenced throughout Gawel 2019), ANY-maze, and ConductVision's Barnes
maze offering. They do the tracking and the standard measures well; what they mostly do not
do is expose every threshold, show the classifier's reasoning, or sweep a threshold to test
robustness, which is where this tool tries to earn its place.

## Trial types

An acquisition trial has an escape box under the target hole. A probe trial does not: the box
is removed to test whether the animal remembers where it was.

Total latency and escape events are undefined on a probe trial. The tool returns null, not a
number. Running both trial types through one code path is a common way to end up with a
column that is confidently wrong.

## Primary latency

Time from the start of the trial to the animal first reaching the target hole.

What counts as "reaching" is set by `reachedTargetRadiusCm`, default 5 cm from the hole
centre. Papers split between a fixed radius and a rater deciding the animal made a
hole-directed approach. I went with the radius because it is reproducible and does not need a
human in the loop.

One edge case worth knowing: an animal can reach the target, not go in, wander off, and come
back. The tool scores the first arrival. That reflects whether the animal knew where the hole
was, which is the memory question, rather than whether it felt like entering.

A blank means the animal never reached the target. The export pairs the number with a
`reached_target` boolean so a blank cannot be read as a fast zero.

## Total latency

Time to enter the escape box.

Scored as a lasting disappearance at the target hole, checked against where the animal was
last seen. `escapeConfirmFrames` (default 8) sets how long the disappearance has to last
before it counts. Set it too low and a one-frame dropout over the target reads as an escape.

## Primary and total errors

The count of distinct non-target holes the animal investigated, either before it first
reached the target (primary) or across the whole trial (total).

An investigation is a continuous stretch of at least `investigationMinDwellS` (default 0.2 s)
with the scoring point inside `investigationRadiusCm` (default 3 cm) of a hole centre. Two
visits to the same hole inside `investigationRefractoryS` (default 1 s) count as one.

Convention worth flagging: some labs count every visit, not distinct holes. That gives larger
numbers, especially for a serial searcher going round the ring. This tool counts distinct
holes and writes that choice into the parameters export, so anyone comparing to a published
number knows which convention produced it.

Nose versus body centre matters here more than it looks. A mouse running past a hole has its
body centre pass within a few centimetres of holes it never actually inspected, so scoring
off the centre inflates the error count. The tool scores off the nose when it has one, and
falls back to the centre when it does not, and says which it used.

## Path length

Total distance travelled, in centimetres.

Only consecutive frames where the animal was actually seen contribute. Gaps are skipped, not
bridged. Drawing a straight line across a five-second gap adds distance the animal may never
have covered; skipping instead under-reports, which is the safer way to be wrong and is
flagged by `tracked_fraction`. Frame-to-frame moves below `MIN_DISPLACEMENT_CM` (0.4 cm) are
treated as noise, not travel, because a resting animal's centre jitters by a pixel or two
every frame and that adds up fast at 30 fps.

Centimetres, never pixels. The conversion comes from the platform diameter you enter, per
video, because camera height changes between rigs and sometimes between days on one rig.

## Mean speed

Mean speed over the frames where the animal was moving faster than 1 cm/s.

Averaging over the whole trial mixes "moved slowly" with "sat still for a while", which are
different behaviours. The floor is in the parameters export. For reference, an exploring mouse
runs somewhere around 5 to 15 cm/s, so a number far outside that band means the calibration
is off or the tracker jumped to something that is not the animal.

## Target quadrant time

Seconds spent in the quarter of the platform centred on the target hole. Quadrants are defined
relative to the target, not the image, so the measure means the same thing for two animals
whose escape holes are in different places.

This is the standard probe-trial readout: an animal that remembers concentrates its search
here. Frames where the animal is not visible are left out, so a poorly tracked trial reports
less quadrant time rather than an invented amount.

## Thigmotaxis fraction

Fraction of the visible time the animal spent within 5 cm of the platform edge.

Kept as its own number because it is an anxiety readout that looks like poor memory in the
latency and error counts. A frightened animal hugging the wall should not be written up as a
forgetful one, and Gawel 2019 is good on this confound.

## Search strategy

One of spatial, serial, random, or undetermined. The spatial / serial / random split is the
one from Harrison et al. 2006.

- spatial: goes more or less straight to the target, or concentrates its search in the target
  quadrant. Directness at or above 0.45, or high target-quadrant occupancy, with at most 3
  non-target holes checked.
- serial: works round the ring hole by hole. A run of at least 4 ring-adjacent holes checked
  in sequence.
- random: neither of the above.
- undetermined: no investigations and no target arrival, so there is nothing to classify.
  Returned instead of forcing a label onto noise.

Serial is checked before spatial on purpose. An animal working round the ring can arrive at
the target on a fairly straight final leg, and calling that spatial would overstate its
memory. Direction reversals are allowed inside a serial run, because a real animal doubles
back a hole and carries on; demanding one consistent direction would file most genuine serial
searches under random. Confidence in random is capped at 0.5, because random is what is left
when nothing else matched, and a leftover is weaker evidence than a positive hit.

The rigorous version of this is BUNS (Illouz 2016), a support vector machine over a similar
set of trajectory features. I deliberately did not ship a trained model. A model shipped
without its training data is a black box the user cannot check, which cuts against the whole
point of the tool. The rule-based version here uses the same kind of features, states its
reasoning in plain words, and can be overridden. An override is stored as a human decision and
the original automatic reasoning is kept alongside it in the export, so nothing is lost.

## Tracked fraction

The fraction of frames where the animal's position is known.

Frames where the animal is down a hole count as known: we know exactly where it is, it just is
not visible. Only genuinely unexplained frames count against this. Scoring hole entries as
tracking failures would flag good trials for review that do not need it.

This is the number to read first. It tells you how much to trust everything above it.