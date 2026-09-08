---
name: analyzing-barnes-maze
description: Use when working with Barnes maze behavioural data — analysing escape latencies, error counts, search strategies or path measures; reading exports from Barnes maze scorer; importing SLEAP or DeepLabCut tracks from a Barnes maze; or writing statistics and figures for a Barnes maze experiment. Covers measure definitions, censoring, the serial-search confound, and choosing an appropriate statistical model.
---

# Analysing Barnes maze data

The Barnes maze is a dry-land spatial memory assay. A rodent is placed on a brightly lit
circular platform ringed with holes, one of which leads to a dark escape box. Over repeated
trials an animal that has learned the location goes more or less directly there.

The measures look simple and are not. Almost every mistake in analysing this assay produces
output that runs, looks reasonable, and is wrong. Read the pitfalls below before writing
code.

## The measures, and what each one is actually saying

**Primary latency** is time to first reach the target hole. **Total latency** is time to
enter the escape box. They are different numbers and papers report both.

**Primary errors** are non-target holes investigated before first reaching the target;
**total errors** are across the whole trial. The counting convention varies between labs:
distinct holes visited, or every visit including revisits. These give systematically
different numbers, especially for a serial searcher. Always check which convention produced
the data before comparing to a published value. Barnes maze scorer counts distinct holes and
records that in the parameters sheet.

**Path length** and **mean speed** are locomotor measures, not memory measures. A drug that
slows an animal down lengthens latency without touching memory. If latency differs between
groups, check speed before concluding anything about learning.

**Target quadrant time** is the standard probe-trial readout: an animal that remembers
concentrates its search in the right quarter of the platform.

**Search strategy** is the sensitive readout, and the one worth arguing about. Three
canonical categories:

- *spatial*: goes more or less directly to the target
- *serial*: works around the ring hole by hole until it finds it
- *random*: crosses the platform repeatedly with no system

Report strategy alongside latency and errors, never instead of them, and never latency
alone. See the serial-search pitfall below for why.

## Pitfalls, in the order they cause the most damage

**A trial is not an animal.** Multiple trials from one animal are not independent
observations. A t-test over trials treats one animal's four trials as four animals and
inflates n fourfold, which is the single most common error in behavioural analysis. Either
average within animal before a between-group test, or use a mixed-effects model with animal
as a random effect. In R: `lmer(latency ~ group * day + (1 | animal))`. Prefer the mixed
model when there is a day factor, because it uses the repeated structure rather than
throwing it away.

**A blank latency is not zero.** An animal that never found the target has a censored
observation, not a fast one. Barnes maze scorer pairs every latency column with an explicit
boolean (`reached_target`, `escaped`) precisely so this cannot be misread. Never
`fillna(0)`. The two defensible options are to assign the trial timeout and say so, or to
use survival analysis, which is the statistically correct treatment of censored time-to-event
data and is under-used in this literature. Silently dropping censored trials biases the group
mean toward the animals that learned.

**A serial searcher looks like both a good and a bad learner at once.** Working around the
ring produces a short latency and a large error count from a strategy that requires no
spatial memory at all. If a group's latency improves while its strategy stays serial, that
is not evidence of spatial learning. This is why strategy has to be reported.

**Thigmotaxis mimics forgetting.** An anxious animal hugging the platform edge has a long
latency and many errors for reasons that have nothing to do with memory. Check
`thigmotaxis_fraction` before interpreting a group difference as a memory effect,
particularly with anxiogenic treatments.

**Low `tracked_fraction` degrades every other number on that row.** It is the fraction of
frames where the animal's position was known. Path length in particular under-reports when
tracking was poor, because unobserved stretches are skipped rather than interpolated across.
Filter or flag rows below about 0.9 rather than pooling them silently.

**Probe trials have no escape box.** Total latency and escape events are undefined on them,
not zero. Filter on `trial_type` before computing anything involving escape.

**Pixels are not a unit.** Path length must be in centimetres, derived from the platform
diameter. Anything reporting pixels is not comparable between rigs or publishable.

## Reading Barnes maze scorer exports

The workbook has seven sheets. Read `Data dictionary` first: it defines every column, its
units, and the threshold that produced it, for the specific file in front of you.

```python
import pandas as pd

sheets = pd.read_excel("barnes-dataset.xlsx", sheet_name=None)
trials = sheets["Measurements"]   # one row per trial, the analysis unit
subjects = sheets["Subjects"]     # one row per animal: group, sex, treatment
events = sheets["Events"]         # one row per scored event, with frame numbers
params = sheets["Parameters"]     # every threshold used

# Group assignment lives on the animal, not the trial. Join, do not assume.
df = trials.merge(subjects[["animal_id", "treatment", "sex"]], on="animal_id", how="left")

# Censoring is explicit. Keep the flag; never fill the blank.
learned = df[df["reached_target"]]
```

Full schema in `references/schema.md`. Statistical recipes in `references/analysis.md`.

## Working with SLEAP and DeepLabCut tracks

Both are standard for tracking this assay, and both export CSV that Barnes maze scorer
imports directly, so a lab keeps the tracker it already trusts.

Score hole investigations from the **nose**, not the body centroid, whenever a nose keypoint
exists. A mouse running past a hole has its centroid pass within a few centimetres without
ever inspecting it, so centroid-based error counts are systematically inflated.

Respect the confidence column. A low-likelihood point is the network saying it could not
find the animal, not a position. Treat it as missing rather than plotting it.

**A pose estimator cannot tell you the animal went down a hole.** It reports "not found",
which is also what it reports when tracking fails. Those two mean opposite things: one is
the behaviour being measured, the other is a failure to measure it. Resolving the ambiguity
needs hole positions plus the last observed location plus how long the disappearance lasted.
Never interpolate across a gap to make the trajectory continuous; that manufactures a
confident wrong path and, at the target hole, a wrong escape latency.

## Writing about this in a paper

State the frame rate, the tracked body part, what defined a hole investigation with its
radius and dwell time, the error-counting convention, how missing frames were handled, how
the pixel-to-centimetre calibration was obtained, and what the experimental unit was. Barnes
maze scorer generates this paragraph from the settings actually used, in the `Methods` sheet.

## References

- Barnes CA (1979). Original description of the assay.
- Gawel K et al. (2019), *Pharmacological Reports*. Review of the measures and their
  confounds. The best single reference.
- Illouz T et al. (2016), *Bioinformatics* 32(21):3314. BUNS: SVM-based unbiased search
  strategy classification.
- Illouz T et al. (2020). Modified protocol; particularly good on the serial-search
  nuisance.
