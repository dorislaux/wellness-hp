# Dashboard (planned)

This directory is a placeholder for code that combines data from more than one
provider skill (currently `oura/` at the repo root and `whoop/`) into a single
view — for example, sourcing sleep from Oura and workouts from Whoop for the
same person, or rendering both side by side.

Nothing here is built yet. It's reserved so that future dashboard work has one
place to live, instead of being scattered across the provider skills or
improvised ad hoc in chat.

## Scope, once built

- **Metric-to-provider mapping**: letting a person say "use Whoop for
  workouts, Oura for sleep" and having that preference respected consistently.
- **Visualization**: charts/HTML views built on top of the provider CLIs'
  `daily` output.

## Explicitly out of scope here

- OAuth and token storage — that stays in each provider's own skill
  (`oura/`'s `~/.config/oura`, `whoop/`'s `~/.config/whoop`). This directory
  should only ever consume already-authorized data from those skills, never
  duplicate their credential handling.
- Merging different people's data. Multi-person comparisons must keep every
  metric labeled by person and provider; never average or combine numbers
  across people.

## Simple case needs no code here

For a basic "show me both providers for the same day" request, no dashboard
code is required: ask the relevant skill(s) to run their `daily` command for
the date range and present the results together. This directory is for logic
that goes beyond that — cross-provider metric selection and visualization.
