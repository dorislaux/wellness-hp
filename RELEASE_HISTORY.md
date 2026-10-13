# Release history

This project uses `1.XX` names for Sites versions. Sites assigns the immutable number; GitHub and Sites can have different commit hashes for the same code. Dates below use the household's Asia/Shanghai timezone.

| Release | Sites version | Published | GitHub code commit | Sites source commit | Summary |
| --- | ---: | --- | --- | --- | --- |
| `1.01` | 1 | 2026-09-04 | `3423ba0` | `370096d` | Added the production Oura and WHOOP dashboard integration. |
| `1.02` | 2 | Unverified | `ca1d088` | `1e6e0af` | Accepted WHOOP timestamps that use the UTC timezone designator. |
| `1.03` | 3 | 2026-09-04 | `8603a4a` | `174a674` | Added owner-managed household members and provider pairing by member. |
| `1.04` | 4 | 2026-09-04 | `e672646` | `a6741f2` | Added current provider synchronization and connection-status states. |
| `1.05` | 5 | 2026-09-04 | `6d1473a` | `de309ba` | Batched Oura sleep-stage persistence for reliable D1 writes. |
| `1.06` | 6 | 2026-09-05 | `3045227` | `6ccc7f8` | Handled live WHOOP collection responses and current-day normalization. |
| `1.07` | 7 | 2026-09-05 | `ea2677c` | `6798605` | Formatted WHOOP strain consistently to one decimal place. |
| `1.08` | 8 | 2026-09-05 | `1cd5aff` | `4440180` | Provisioned invited household viewers on their first authenticated visit. |
| `1.09` | 9 | 2026-09-05 | `26cd900` | `494bffb` | Added a seven-day average default, recent-date filtering, historical synchronization, and an empty-data message. |
| `1.10` | 10 | 2026-09-05 | `fc5e0be` | `e79a54c` | Added preloaded 7/14/30-day ranges, sync status, system-aware dark mode, one-decimal metrics, revised readiness colors, and household appearance settings. |
| `1.11` | 11 | 2026-09-06 | `4eeb800` | `26d54b1` | Added compact mobile cards with Oura daily calories, bottom-row WHOOP metrics, and weekly snap-scrolling mobile timelines. |
| `1.12` | 12 | 2026-09-07 | `8a3bd13` | `7d0043b` | Added isolated multi-household onboarding, email-bound invitations, owner approval, read-only viewers, and household access management. |
| `1.13` | 13 | 2026-09-08 | `9dc3de7` | `3f3565e` | Removed a requested beta household and its locally stored membership, provider credentials, and wellness history. |
| `1.14` | 14 | 2026-09-08 | `36f123f` | `febf073` | Added automatic personal cards for approved joiners and restricted device authorization to each joiner's own card. |
| `1.15` | 15 | 2026-09-08 | `0c7c4cb` | `88393a4` | Completed the multi-household rollout on `main` and improved the mobile pending-approval actions so labels stay on one line. |
| `1.16` | 16 | 2026-09-08 | `75bc29d` | `75bc29d` | Added the local-time Today view, detailed Oura sleep stages, temperature and respiratory metrics, compact mobile controls, and WHOOP sleep and calorie fallback. |
| `1.17` | 17 | 2026-09-08 | `274e701` | `274e701` | Added WHOOP HRV, resting-heart-rate, and temperature fallback; faster incremental provider refresh; a household-scoped first-screen snapshot cache; and the mobile household-selector fix. |
| `1.18` | 18 | 2026-09-09 | `ed2cdec` | `ed2cdec` | Hid the empty Oura readiness panel for WHOOP-only members while preserving a compact refresh notice when a connected Oura source is temporarily unavailable. |
| `1.19` | 19 | 2026-09-17 | `447c0df` | `447c0df` | Repaired recent incomplete Oura history without erasing complete metrics and added WHOOP recovery fallback for cards and timeline scores when Oura readiness is unavailable. |
| `1.20` | 20 | 2026-09-17 | `f0746e1` | `f0746e1` | Invalidated pre-1.19 dashboard snapshots and rejected incompatible cached data to prevent the first-screen error 1101. |
| `1.21` | 21 | 2026-09-18 | `ae5edd0` | `ae5edd0` | Stacked 7/14/28-day timelines by week with household averages, opened Timeline at 7D, and added member and family Analysis trends for heart rate, HRV, temperature, sleep, and Oura active calories without a family-chart area fill. |
| `1.22` | 22 | 2026-09-24 | `57ff2e7` | `57ff2e7` | Switched Oura-connected cards to active calories, added resumable historical Oura calorie backfill and cache invalidation, made date-range options divide evenly, and applied provider-specific timeline score colors. |
| `1.23` | 23 | 2026-10-12 | — | `cd20ebb` | Added owner-authorized, resumable 180-day Oura and WHOOP history backfills in bounded chunks; deployed and ran the historical backfill. |
| `1.24` | 24 | 2026-10-12 | — | `a8372b8` | Temporarily deployed an owner-only, read-only Oura sleep-boundary diagnostic. |
| `1.25` | 25 | 2026-10-12 | — | `0b50aab` | Removed the temporary sleep-boundary diagnostic after confirming the upstream start-date omission. |
| `1.26` | 26 | 2026-10-12 | — | `0012468` | Corrected the shared Oura sleep request boundary and ran a bounded, Dory-only historical sleep repair using a temporary owner-only control. |
| `1.27` | 27 | 2026-10-12 | `2164cff` | `aa8266c` | Removed the temporary repair control while retaining the sleep-boundary fix; this is the current deployed release. |

## Numbering convention

- The next release is `1.28`, corresponding to Sites version 28.
- Increment the final two digits for each published release: `1.16`, `1.17`, and so on.
- Record each saved Sites version, but mark publication unverified unless a successful deployment is linked.
- Sites version numbers remain system-managed; this file is the canonical product-release history.
- Temporary deployed operator-only versions also receive `1.XX` release names so the mapping remains one-to-one.
- `1.02` is a saved Sites version with no linked deployment record in the current Sites history. Its publication cannot be verified; this does not prove it was never live. Version 1.03 includes the WHOOP timestamp change.
- Releases 1.23–1.26 were preserved as exact Sites source commits rather than separate GitHub code commits. The final deployed 1.27 code was mirrored to GitHub in `2164cff`; temporary diagnostic and repair routes are not in that final code.
- GitHub `main` currently ends at 1.15. The `codex/whoop-metrics-performance` branch holds the 1.16–1.27 code and this release ledger; merging is a separate decision.
