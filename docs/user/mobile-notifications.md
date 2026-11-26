# Mobile notifications

Get push alerts, Live Activities, and home-screen widgets on iOS and Android when agents finish, fail, or need your approval or input.

## Prerequisites

- Sign in to **T3 Connect** on both your phone and host machine (direct/Tailscale connections alone do not deliver background push notifications).
- Enable **Publish agent activity** in **Settings → Sharing & access** on the host.
- Enable **Device Notifications** in **Settings → Notifications** on mobile (Android requires Android 7.0+ and Google Play services).

## Live updates and widgets

- **Live progress**: Enable **Live Activity Updates** (iOS), **Agent Live Updates** (Android 16+, check **Live Update Settings** if missing), or **Ongoing Agent Activity** (older Android). Finished results stay visible for up to 15 minutes.
- **Silent live updates (Android 8+)**: Keep **Ongoing agent activity** on and disable **Agent alerts** in Android system notification settings.
- **iOS widget**: Add the **Agent Activity** widget to your Home Screen or Lock Screen (refreshes when you open T3; marks unfinished work stale after 10 minutes).

## Notes

- Ordinary alerts are muted while the mobile app is in the foreground, though viewing a thread on another device does not silence your phone.
- Force-stopping T3 Code in Android system Settings pauses push delivery until you reopen the app.

## GMACKO builds

GMACKO uses Expo for ordinary push alerts. Pair your phone with each environment, then enable
**Device Notifications** in **Settings → Notifications**. T3 Connect sign-in is not required;
direct and Tailscale connections work. Each environment must stay running with internet access,
but the phone does not need to keep its connection open. Check the registration status below the
switch. If an environment is offline when you change the setting, reconnect to finish applying it.
Revoking the phone’s paired session on an environment also stops its alerts.

On iOS, enable **Live Activities** in the same screen and open the app while an agent is working
to start a Lock Screen activity for each paired environment. It continues updating over cellular
while the app is suspended. The environment needs Live Activity delivery configured; Settings
shows when an environment needs setup or an update. Completed work ends the activity, and
turning off Live Activities removes its cards independently of ordinary alerts. Removing an
environment or signing out of its T3 account also removes its cards. An environment that stops
running cannot send updates; iOS marks its last status out of date after ten minutes.

If you also use another T3 Code app on the same phone, manage its notifications separately in
that app or in iOS Settings to avoid receiving both apps’ alerts.
