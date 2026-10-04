# Routing

If your OpenCode threads send requests through a Pistache router, T3 Code can show what the
router decided. Open **Routing** from the sidebar or the command palette, or bind `routing.open`
in **Settings → Keybindings**.

## Connect a router

Routing reads from the OpenCode provider instance named `pistache` in **Settings → Providers**.
Set two environment variables on that instance:

- `PISTACHE_API_KEY`, marked sensitive. This is the router's API key.
- The router's address: either `PISTACHE_BASE_URL`, or leave it to the `OPENCODE_CONFIG_CONTENT`
  you already give OpenCode, as long as its `pistache` provider has a `baseURL`.

Until both are present the page explains what is missing and makes no requests. Each connected
environment reads its own router, so a router configured on one server shows under that server.

## Read the page

Switch between the past 24 hours and 7 days. **Funnel** shows decisions per hour by who
classified the request, by the tier chosen, and by the model that ran it. **Downgrades** counts
automatic routes below the strongest tier and the share of those whose outcome failed, so a wrong
cheaper route is visible rather than silent. **Cache hit rate** compares cached and total input
tokens per model. **Subscription windows** show how much of each provider window remains and when
it resets, with the lowest first. Router alerts and operator counters appear when the router
reports them.

## The routing badge

On a thread whose model is the `pistache` instance, the composer shows the router's latest decision
beside the context meter, for example `Sol · T2`. Hover it for the full decision: the model and
tier, the task kind and confidence, who classified it, whether it was a downgrade, the router's
reasons, and any advice such as compacting the thread before the next turn. The badge appears
after the router has decided at least one request for the thread.
