# Remote Access

Use this when you want to connect to a T3 Code server from another device such as a phone, tablet, or separate desktop app.

## Recommended Setup

Use a trusted private network that meshes your devices together, such as a tailnet.

That gives you:

- a stable address to connect to
- transport security at the network layer
- less exposure than opening the server to the public internet

## Enabling Network Access

There are two ways to expose your server for remote connections: from the desktop app or from the CLI.

### Option 1: Desktop App

If you are already running the desktop app and want to make it reachable from other devices:

1. Open **Settings** → **Connections**.
2. Under **Manage Local Backend**, toggle **Remote access** on. The desktop app will restart in the recommended Tailnet mode by default.
3. If Tailscale is available, the settings panel will show the Tailnet-specific address the server is reachable at (for example `http://mackbook.tailnet.ts.net:3773` or `http://100.x.y.z:3773`).
4. Use **Create Link** to generate a pairing link. The link uses that Tailnet endpoint, so opening or scanning it from another device stays on your tailnet.
5. Tailnet remains the recommended desktop path. If you need a generic private-network or LAN address instead, use the **Use LAN instead** action in the same settings panel to switch modes.
6. Use the CLI option below for headless or custom host setups.

### Option 2: Headless Server (CLI)

Use this when you want to run the server without a GUI, for example on a remote machine over SSH.

Run the server with `t3 serve`.

```bash
npx t3 serve --host "$(tailscale ip -4)"
```

`t3 serve` starts the server without opening a browser and prints:

- a connection string
- a pairing token
- a pairing URL
- a QR code for the pairing URL

From there, connect from another device in either of these ways:

- scan the QR code on your phone
- in the desktop app, enter the full pairing URL
- in the desktop app, enter the host and token separately

Use `t3 serve --help` for the full flag reference. It supports the same general startup options as the normal server command, including an optional `cwd` argument.

> Note
> The GUIs do not currently support adding projects on remote environments.
> For now, use `t3 project ...` on the server machine instead.
> Full GUI support for remote project management is coming soon.

## How Pairing Works

The remote device does not need a long-lived secret up front.

Instead:

1. `t3 serve` issues a one-time owner pairing token.
2. The remote device exchanges that token with the server.
3. The server creates an authenticated session for that device.

After pairing, future access is session-based. You do not need to keep reusing the original token unless you are pairing a new device.

## Managing Access Later

Use `t3 auth` to manage access after the initial pairing flow.

Typical uses:

- issue additional pairing credentials
- inspect active sessions
- revoke old pairing links or sessions

Use `t3 auth --help` and the nested subcommand help pages for the full reference.

## Security Notes

- Treat pairing URLs and pairing tokens like passwords.
- Prefer binding `--host` to a trusted private address, such as a Tailnet IP, instead of exposing the server broadly.
- Anyone with a valid pairing credential can create a session until that credential expires or is revoked.
- Use `t3 auth` to revoke credentials or sessions you no longer trust.
