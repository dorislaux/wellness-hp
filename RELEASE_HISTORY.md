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
| `1.10` | 10 | 2026-09-05 | `fc5e0be` | Added preloaded 7/14/30-day ranges, sync status, system-aware dark mode, one-decimal metrics, revised readiness colors, and household appearance settings. |
| `1.11` | 11 | 2026-09-06 | `4eeb800` | Added compact mobile cards with Oura daily calories, bottom-row WHOOP metrics, and weekly snap-scrolling mobile timelines. |
| `1.12` | 12 | 2026-09-07 | `8a3bd13` | Added isolated multi-household onboarding, email-bound invitations, owner approval, read-only viewers, and household access management. |
| `1.13` | 13 | 2026-09-08 | `9dc3de7` | Removed a requested beta household and its locally stored membership, provider credentials, and wellness history. |
| `1.14` | 14 | 2026-09-08 | `36f123f` | Added automatic personal cards for approved joiners and restricted device authorization to each joiner's own card. |
| `1.15` | 15 | 2026-09-08 | `0c7c4cb` | Completed the multi-household rollout on `main` and improved the mobile pending-approval actions so labels stay on one line. |
| `1.16` | 16 | 2026-09-08 | `75bc29d` | Added the local-time Today view, detailed Oura sleep stages, temperature and respiratory metrics, compact mobile controls, and WHOOP sleep and calorie fallback. |
| `1.17` | 17 | 2026-09-08 | `274e701` | Added WHOOP HRV, resting-heart-rate, and temperature fallback; faster incremental provider refresh; a household-scoped first-screen snapshot cache; and the mobile household-selector fix. |
| `1.18` | 18 | 2026-09-09 | `ed2cdec` | Hid the empty Oura readiness panel for WHOOP-only members while preserving a compact refresh notice when a connected Oura source is temporarily unavailable. |
| `1.19` | 19 | 2026-09-17 | `447c0df` | Repaired recent incomplete Oura history without erasing complete metrics and added WHOOP recovery fallback for cards and timeline scores when Oura readiness is unavailable. |
| `1.20` | 20 | 2026-09-17 | `f0746e1` | Invalidated pre-1.19 dashboard snapshots and rejected incompatible cached data to prevent the first-screen error 1101. |
| `1.21` | 21 | 2026-09-18 | `ae5edd0` | Stacked 7/14/28-day timelines by week with household averages, opened Timeline at 7D, and added member and family Analysis trends for heart rate, HRV, temperature, sleep, and Oura active calories without a family-chart area fill. |
| `1.22` | 22 | 2026-09-24 | `57ff2e7` | Switched Oura-connected cards to active calories, added resumable historical Oura calorie backfill and cache invalidation, made date-range options divide evenly, and applied provider-specific timeline score colors. |

## Numbering convention

- The next release is `1.23`, corresponding to Sites version 23.
- Increment the final two digits for each published release: `1.16`, `1.17`, and so on.
- Record a release here only after its Sites deployment succeeds.
- Sites version numbers remain system-managed; this file is the canonical product-release history.
