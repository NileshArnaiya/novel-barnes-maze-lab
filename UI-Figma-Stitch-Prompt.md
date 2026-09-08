Barnes Maze Scorer — UI Design Prompt

Prompt

Design a desktop web app for scoring lab-animal behaviour videos (a "Barnes maze scorer"). It is a scientific tool for neuroscience researchers, not a consumer SaaS product. The whole feel should be calm, warm, and editorial, like a well-made research instrument, never a dark dashboard.

Visual style

Warm light theme.

Background paper: #FAF8F4

Raised surfaces: #FFFFFF

Sunken panels: #F2EDE5

Text ink: #26221F

Secondary text: #5F574F

Faint text: #918A80

Hairline borders: #E2DBD0

Stronger borders: #CFC5B7

Clay accent: #C05F3C — use for the single primary action per screen only.

Data teal: #1D7D62 — positive/target states.

Flag amber: #B0741A — warnings.

Typography:

Serif headings with an Iowan Old Style / Georgia feel.

Sans-serif for all controls and body text.

Monospace for numeric data so figures align.

Interaction and component rules:

Flat surfaces; no drop shadows.

Generous padding.

8px radius.

Large tap targets.

High contrast.

Never encode meaning by colour alone: pair every status colour with a text label or icon.

No emoji.

No sparkle or crown icons.

Layout

Top bar

Serif title: "Barnes maze scorer"

Subtitle: "Runs in your browser. Nothing is uploaded."

Right side:

Pill-shaped step ribbon with 5 numbered steps:

Load

Maze

Track

Review

Export

Current step outlined in clay.

Completed steps show a teal tick.

Far right: "How this works" text button.

Left rail (~230px)

Cohort list titled:

"N trials · M need a look"

Each row includes:

Animal ID

Filename

Day

Small status badges:

needs review — amber

scored — teal

edited — clay

Strategy label

Separate lower section:

"Example trials (generated)"

Include a "Remove examples" ghost button.

Main workspace

The main workspace changes according to the current step.

Screens to produce

Produce all five as connected desktop frames at 1440px wide, with consistent components and ready-to-prototype step-to-step navigation.

1. Load

Large dashed drop zone:

"Drop videos or tracked poses here"

Subtext: "MP4 video, or a SLEAP or DeepLabCut CSV export"

Clay "Choose files" button

Above the drop zone: small frame-rate number field.

Below: panel titled "No data to hand?"

"Load example trials" button.

2. Maze

Square canvas showing:

A circular platform.

Top-down greyscale maze photo.

Ring of ~20 hole circles overlaid in soft amber.

One hole filled teal as the escape hole.

Four small clay resize handles on the rim.

Clay centre crosshair.

Below canvas, number fields:

Centre x

Centre y

Radius (px)

Rotation (deg)

Below that:

"Reuse this across the cohort" panel with two buttons.

3. Track

Settings panel with two labelled sliders:

Difference threshold

Playback speed

Each slider has a one-line help caption.

Primary action:

Clay "Track this video" button.

Also show an alternate processing state:

Thin clay progress bar.

"Stop" button.

4. Review — Hero screen

Use the widest workspace for this screen.

Two columns.

Left column

Maze canvas.

Thin trajectory line drawn over it:

Cyan for automatic tracking.

Orange for corrected tracking.

Visible gaps.

Black playhead dot.

Horizontal timeline strip underneath with blue / amber / green segments.

Frame-step buttons below.

Right column

Stacked cards:

Measures

Grid of 8 metric tiles with large monospace numbers and small labels:

Primary latency

Total latency

Primary errors

Total errors

Path length

Mean speed

Target quadrant

Frames tracked

Search strategy

Dropdown showing "spatial"

Confidence note

3 bullet reasoning lines

How sensitive is this result?

Small data table

Figures

Tabs:

Trajectory

Occupancy heatmap

Scoring thresholds

List of labelled sliders

5. Export

Top section:

Learning-curve line chart.

Day on x-axis.

Latency on y-axis.

One line per cohort.

Error-bar whiskers.

Below, stacked export panels. Each has:

Title

One-line description

Download button

Panels:

Analysis-ready workbook

Trial summary

Events

Project file

Extras

Small circular floating "?" help button fixed bottom-right.

First-run modal:

Title: "This scores Barnes maze trials"

5 progress dots

Skip and Next buttons

Prototype requirements

Create all five screens as connected desktop frames at 1440px wide. Maintain a consistent design system, component styling, spacing, typography, status treatment, and navigation across every frame. The result should be ready for step-to-step prototyping