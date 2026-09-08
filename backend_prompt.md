You are documenting the export schema for a behavioral analysis tool. Write reference documentation for researchers who will consume the exports, not build the tool.

## Structure
- Top section: workbook sheets, one subsection per sheet
- Then: CSV exports (one line each, mapping to sheets)
- Then: project file (JSON shape + any enum tables)

## Per-sheet format
- One sentence stating what a row represents
- If the unit of analysis is easy to mistake, bold a correction ("This is the analysis unit, and a trial is not an animal.")
- Table: Column | Type | Notes
- Type is terse: `string`, `int`, `float`, `bool`, `float 0-1`, `int or blank`, or a literal union like `` `spatial` | `serial` | `random` | `undetermined` ``
- Notes column carries the actual knowledge: what blank means, what's excluded, known failure modes, read-order dependencies between fields, what a value is measured relative to
- Bold the traps ("**Read before `primary_latency_s`.**", "**Blank means never reached. Not zero.**")

## Voice
- Terse. No marketing, no "comprehensive", no restating the column name in the notes.
- State limitations inline where the field is defined, not in a separate caveats section. "Under-reports when tracking is poor" sits next to `path_length_cm`.
- Explain *why* a field exists when non-obvious ("Anxiety readout that mimics poor memory", "being a residual category")
- When a downstream user is likely to do the wrong thing, tell them what to do instead ("Join group assignment from here rather than assuming it is on the trial rows.")

## For enum/state fields
Give a small table of the values with one-line meanings. Include what data is or isn't valid in each state.

## For the project file
Show the JSON shape in a fenced block with inline `// comments` on fields whose meaning isn't obvious from the name. Follow with tables for any nested enums.

Do not invent fields. Do not add sections the source material doesn't support (no "Overview", no "Getting Started"). Write only what a researcher opening the file needs to not misuse it.