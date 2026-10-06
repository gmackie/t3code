# Unity gameplay hooks

Agents can inspect game-owned variables in Unity Editor Play Mode and instrumented
development players with `unity_hooks`. Your Unity project needs the GMacko
Pipeline package with agent hooks; game components register the values they want
to expose. A registered setter lets the agent change a value through the game's
own rules. Read-only values cannot be changed.

Install Unity CLI on the machine running T3 and Unity. Use an absolute project
path for the Editor, or the player's `.unity-pipeline-runtime-port` file for a
standalone build. Start with `list`, then use the returned generation and handles
for `read`, `write`, `assert`, or `watch`. Rediscover handles after Play Mode,
scene reloads, or component replacement. Agents need full-access/default mode.

From a terminal, the same operations are available as JSON:

```sh
t3 unity-hooks '{"action":"list","target":{"kind":"editor","projectPath":"/absolute/path/to/project"}}'
```

Watches run in Unity for a bounded duration and retain their latest samples.
Use `watch_read` to retrieve them, and `watch_stop` with `forget: true` when done.
A watch reports dropped samples; it does not imply that a disconnected or paused
game has kept advancing. Writes are transient gameplay changes. If a write times
out, read its value before retrying because the game may already have applied it.

For a pinned CLI installation, set `T3CODE_UNITY_CLI` to its executable path before
starting T3. CLI and Pipeline versions must be compatible; the initial tested
pair is Unity CLI `1.0.0-beta.6` with Pipeline `0.5.0-exp.1`.

This first hook integration does not yet provide a live game viewer, continuous
T3 monitor, or input ownership controls. Watch snapshots can supply data for
[visual replies](html-renders.md).
