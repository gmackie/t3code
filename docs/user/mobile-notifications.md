# Mobile notifications

Sign in to T3 Connect, link your environments, and enable **Device Notifications** in **Settings → Notifications** to receive alerts when an agent finishes, fails, needs approval, or asks for input. Tap a notification to open its thread. Your environment must have agent activity publishing enabled.

Enable **Ongoing Agent Activity** on Android or **Live Activity Updates** on iOS to follow work without opening the app. Finished results remain visible for up to 15 minutes. You can dismiss an Android activity card without disabling alerts; turn off ongoing activity in Settings to stop future cards.

Ordinary alerts stay quiet while the mobile app is in the foreground. Ongoing activity continues to update. Viewing a thread on another device does not silence your phone's alerts.

Android notifications require Android 7.0 or newer and Google Play services. Android 16 and newer can promote ongoing activity to a Live Update, subject to system settings and device support. Other devices show a regular ongoing notification. Android 7's battery-saving modes can delay removal of expired cards.

Notification permission and Android notification channels are controlled in system Settings. Background delivery requires T3 Connect; a direct or Tailscale connection alone does not enable push notifications. The mobile app does not need to maintain a connection to your environment. Force-stopping the Android app in system Settings prevents push delivery until you open it again.

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
