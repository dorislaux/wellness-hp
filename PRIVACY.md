# Privacy policy

This repository contains personal-use command-line tools (currently for Oura and WHOOP) that let their owner query their own wearable health data through each provider's official OAuth API. This policy covers what those tools do with data; it is not a policy for a hosted service, because there is no server component — everything runs locally, under the account holder's own control.

## What data is accessed

With the account holder's explicit OAuth authorization, the tools can read data made available by the connected provider's API — for example, sleep, readiness/recovery, activity, workouts, and basic profile information. Only the data resources a person explicitly requests are fetched, and only for the OAuth scopes they grant during authorization.

## Where data is stored

- OAuth application credentials and per-profile access/refresh tokens are stored locally, under the account holder's own `~/.config/` directory, in files created with owner-only permissions (`0600`/`0700`).
- No data is transmitted to any server operated by this project, because none exists. All API calls go directly from the tool, running on the account holder's own machine, to the provider's official API endpoints.
- Fetched health data is not persisted to disk by the tools themselves beyond what the account holder chooses to save from a command's output.

## Sharing

Data is never shared with, or sold to, any third party. It is not used for advertising, analytics, or any purpose other than displaying it back to the account holder who authorized access.

## Revoking access

An account holder can revoke access at any time from the provider's own account settings (WHOOP: account settings on whoop.com; Oura: the Oura Cloud OAuth applications page), independent of anything in this repository.

## Contact

For questions about this policy, open an issue on this repository.
