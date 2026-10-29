# GMACKO Live Activity delivery

GMACKO iOS activities use direct APNs from the paired environment. Ordinary alerts continue
through Expo. Both clients and the environment need a release with this delivery path.

On each environment host, install a JSON file at `~/.config/t3code/apns.json` with mode `0600`:

```json
{
  "teamId": "YOUR_APPLE_TEAM_ID",
  "keyId": "YOUR_APNS_KEY_ID",
  "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "bundleId": "com.gmacko.t3code",
  "environment": "production"
}
```

Use the APNs signing key assigned to this app's Apple developer team, not an App Store Connect
upload key. `production` is required for TestFlight; local development provisioning uses
`sandbox`. `T3CODE_APNS_CONFIG` overrides the file path. Restart the environment after changing
this configuration. Keep the credential on the environment host, outside source and build
artifacts; never include it in the mobile app or a support log. The host needs outbound HTTP/2
access to Apple's push service on port 443.

After pairing the phone, enable Live Activities under Settings → Notifications and open the app
while work is running. Each environment starts its own card. Native update tokens are bound to
the phone's paired session; removing that connection, disabling activities, or revoking the
session stops updates. Quiet work receives a refresh every five minutes. A host outage marks
the last content stale after ten minutes; iOS limits a single activity to eight hours, so reopen
the app to start a replacement for longer work.

For release acceptance, use a real TestFlight phone over cellular: start a turn, open the app,
lock the phone, verify a running-to-input or running-to-completed transition, then verify the
Live Activities switch removes the card. A foreground widget or an APNs request to an invalid
test token does not prove locked-phone delivery.
