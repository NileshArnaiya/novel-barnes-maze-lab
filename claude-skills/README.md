# barnes-maze-skills

A [Claude Code](https://claude.com/claude-code) skill for working with Barnes maze
behavioural data, particularly the exports produced by
[Barnes maze scorer](../README.md).

A skill gives Claude working knowledge of a domain: what the measures mean, how the data is
laid out, and the mistakes it should avoid. Without it, Claude will write analysis code that
runs and produces wrong answers, because most of the traps in this assay are statistical
and semantic rather than syntactic. Averaging trials as if they were independent, treating a
blank latency as zero, or reading a short latency as good learning when the animal searched
serially all produce plausible output and a wrong conclusion.'

This repository is derived from catalystneuro/claude-skills, copied from commit 901b3df (2026-07-03). The original work is © 2025 CatalystNeuro, released under the MIT License, which is retained verbatim in LICENSE.


## Skills

| Skill | Description |
| --- | --- |
| `analyzing-barnes-maze` | Measure definitions, the workbook and project-file schemas, importing SLEAP and DeepLabCut tracks, censoring, the serial-search confound, thigmotaxis, and how to choose an appropriate statistical model. |

## Installation

```
/plugin marketplace add NileshArnaiya/barnes-maze-skills
/plugin install analyzing-barnes-maze@barnes-maze-skills
/reload-plugins
```

Claude invokes it automatically when you work with Barnes maze data. You do not need to
mention it.

## Licence

MIT. See [LICENSE](LICENSE).
