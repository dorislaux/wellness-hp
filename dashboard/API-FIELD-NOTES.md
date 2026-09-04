# Dashboard API field notes

The frontend currently uses typed fictional data in `app/mock-data.ts`.

## Available from Oura Cloud API V2

- Daily readiness score and its contributor scores
- Detailed sleep-stage sequence (`sleep_phase_5_min`)
- Sleep start/end timestamps
- Average sleep heart rate and average HRV
- Deep, light, REM, awake, and total-sleep durations

## Available from WHOOP API

- Recovery score
- Cycle strain
- Recovery HRV and resting heart rate
- Sleep stage durations and sleep performance metrics

## Derived by this application

- Deep-sleep percentage: deep-sleep duration divided by total-sleep duration
- Personal 30-day averages and deltas: calculated from stored history
- Contributor labels `low`, `fair`, and `good`: Oura returns numeric contributor
  scores, so product thresholds must be defined and kept separate from Oura's
  official score
- Timeline cell colors: mapped from readiness scores by product thresholds
- Freshness state: determined by comparing the selected day with the newest
  complete record received from each source

## Not exposed as a direct API field

- The Oura contributor status words `low`, `fair`, and `good`
- The user's 30-day readiness, HRV, or heart-rate baseline as a ready-made field
- A single cross-provider freshness or synchronization status

Do not describe derived labels or baselines as values supplied directly by Oura
or WHOOP.
