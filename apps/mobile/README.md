# T3 Code Mobile

Expo app for monitoring and controlling T3 Code sessions from iOS.

## Run In The iOS Simulator

The iOS Simulator runs on the Mac and uses the Mac's network path. For local simulator development, pair against the desktop server through `127.0.0.1`.

1. Start T3 Code on the Mac and confirm the server is reachable:

   ```sh
   curl http://127.0.0.1:3773/.well-known/t3/environment
   ```

2. Create a one-time pairing URL:

   ```sh
   env -u T3CODE_BOOTSTRAP_FD bun ../../apps/server/src/bin.ts auth pairing create --base-dir ~/.t3 --base-url http://127.0.0.1:3773 --json
   ```

3. Launch the simulator app with the pairing URL:

   ```sh
   EXPO_PUBLIC_T3_MOBILE_PAIRING_URL="http://127.0.0.1:3773/pair#token=..." bun run ios -- --device "iPhone 17"
   ```

The `EXPO_PUBLIC_T3_MOBILE_PAIRING_URL` value is a dev-only bootstrap convenience. Do not commit real pairing URLs or put them in shared env files.

## Physical Phone Over Tailnet

For a real iPhone, keep Tailscale connected on both the phone and the Mac, then create the pairing URL with a Tailnet-reachable base URL instead of localhost:

```sh
env -u T3CODE_BOOTSTRAP_FD bun ../../apps/server/src/bin.ts auth pairing create --base-dir ~/.t3 --base-url http://<mac-tailnet-host-or-ip>:3773 --json
```

Open the generated `t3code-mobile://pair?...` deep link on the phone, or launch a dev build with the generated HTTP pairing URL via `EXPO_PUBLIC_T3_MOBILE_PAIRING_URL`.
