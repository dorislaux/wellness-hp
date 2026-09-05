# Release history

This project uses `1.XX` release numbers for product releases. ChatGPT Sites also assigns each saved deployment an immutable sequential version number. The two numbers map as follows:

| Release | Sites version | Published | Repository commit | Summary |
| --- | ---: | --- | --- | --- |
| `1.01` | 1 | 2026-09-04 | `3423ba0` | Added the production Oura and WHOOP dashboard integration. |
| `1.02` | 2 | 2026-09-04 | `ca1d088` | Accepted WHOOP timestamps that use the UTC timezone designator. |
| `1.03` | 3 | 2026-09-04 | `8603a4a` | Added owner-managed household members and provider pairing by member. |
| `1.04` | 4 | 2026-09-04 | `e672646` | Added current provider synchronization and connection-status states. |
| `1.05` | 5 | 2026-09-04 | `6d1473a` | Batched Oura sleep-stage persistence for reliable D1 writes. |
| `1.06` | 6 | 2026-09-04 | `3045227` | Handled live WHOOP collection responses and current-day normalization. |
| `1.07` | 7 | 2026-09-05 | `ea2677c` | Formatted WHOOP strain consistently to one decimal place. |
| `1.08` | 8 | 2026-09-05 | `1cd5aff` | Provisioned invited household viewers on their first authenticated visit. |
| `1.09` | 9 | 2026-09-05 | `26cd900` | Added a seven-day average default, recent-date filtering, historical synchronization, and an empty-data message. |

## Numbering convention

- The next release is `1.10`, corresponding to Sites version 10.
- Increment the final two digits for each published release: `1.11`, `1.12`, and so on.
- Record a release here only after its Sites deployment succeeds.
- Sites version numbers remain system-managed; this file is the canonical product-release history.
