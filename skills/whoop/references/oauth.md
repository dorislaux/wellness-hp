# WHOOP OAuth and family profiles

WHOOP uses OAuth 2.0 authorization code flow. Request `offline` to receive a
rotating refresh token and `read:profile` to verify the authorized WHOOP user.

WHOOP's published documentation does not specify an account-picker,
`prompt=login`, or browser-cache bypass parameter. Do not add undocumented
authorization parameters. A unique authorization URL and state value protect
the callback but do not clear WHOOP login cookies.

For each family member:

1. Select a generic local profile label such as `adult_a` or `teen_a`.
2. Start a new authorization attempt with a unique state bound to that label.
3. Open the URL in a fresh private window or a browser profile dedicated to that
   member, then confirm the displayed WHOOP account before granting access.
4. Fetch `/v2/user/profile/basic` with the new access token before persistence.
5. Bind the returned `user_id` to the local profile and reject it if that WHOOP
   user ID is already stored under another profile.
6. Store each profile's rotating token pair in its own private file.

Browser sessions are an operator concern: the application cannot safely clear
third-party WHOOP cookies. Duplicate user-ID detection is the final safeguard
against silently authorizing the cached account twice.

Never merge family profiles implicitly. Select and label each profile in every
aggregation, and provide a per-member way to revoke access.
