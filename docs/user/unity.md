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
A watch may include a `predicate` with a discovered `handle`, an `operator`
(`eq`, `ne`, `lt`, `lte`, `gt`, or `gte`), and an `expected` value. Ordering
comparisons require a numeric scalar. A matching condition records one receipt
with the observed sample; repeated reads return the same receipt ID. Use
`watch_rearm` explicitly to allow another match, up to 32 receipts per watch.
The viewer offers the same condition and rearm controls. Receipts remain available
until the watch is forgotten, even when their samples leave the rolling history.

Successful writes include the previous, requested and observed values. An
`adjusted` outcome means the game's setter applied a different value. Active
watches retain these mutations, and saved reports include the underlying JSON
observations and receipts.

A watch reports dropped samples; it does not imply that a disconnected or paused
game has kept advancing. Writes are transient gameplay changes. If a write times
out, read its value before retrying because the game may already have applied it.

For a pinned CLI installation, set `T3CODE_UNITY_CLI` to its executable path before
starting T3. CLI and Pipeline versions must be compatible; the initial tested
pair is Unity CLI `1.0.0-beta.6` with Pipeline `0.5.0-exp.1`.

## View and control a game

Add `com.gmacko.pipeline.game` alongside Pipeline in your Unity project, then
enter Play Mode or launch a development player. In T3, choose **Game** in the
workspace switcher; on mobile, use **Open Unity game** in the thread header.
Select Editor and enter its project path, or select Player and enter its port
file. Paths refer to the machine hosting that T3 environment.

The viewer works through your existing environment connection. It displays
package-captured H.264 video with a JPEG fallback and provides keyboard,
pointer and touch controls. Keep the Editor Game view visible and large enough
to render. On Macs where a player stalls in Metal presentation, disable vsync
and set an explicit frame rate in the test project.

Choose **Take control** to play or edit variables. A person can take control
from an agent or another viewer; the previous controller loses access. **Release**,
leaving the viewer, or a disconnected heartbeat releases held inputs. Individual
input packets expire within one second; control expires after 1.5 seconds.

Select variables and start a monitor to collect up to 60 seconds of observations,
retaining at most 256 samples. Writable variables use their game-owned setters;
a stale value is rejected rather than overwriting a concurrent change. Stop a
monitor to preserve its final history. Starting another replaces the target's
shared viewer monitor. **Save report** stores an HTML snapshot and displays it
beneath the live view. Agents use `unity_game` for the same sessions, expiring
controls and reports, use `unity_game_snapshot` to see the latest frame, and can include the report in [visual replies](html-renders.md).
Disconnect before changing to a different target or after a Play Mode reload.

## Commands and jobs

Ask the agent to discover commands with `unity_command` and `action: "catalog"`.
The catalog includes project-defined actions registered with `GmackoCommand` and
Editor operations supported by the installed Pipeline package. Vector hooks use
numeric arrays of two to four components; enum hooks use a discovered choice name.

Submit a command with `action: "submit"`, its name, parameters and an explicit
target. Retain the returned job ID and use `status` to inspect completion and the
engine result. `cancel` requests cancellation; a completed or non-cancellable
engine operation may still take effect. Jobs remain in Unity across T3 reconnects
but can be lost when the target reloads or exits. Rediscover the target after a
reload instead of silently resubmitting work.

The same operations are available from `t3 unity-command '<request JSON>'`.

## Video and controllers

On macOS, build the game package’s optional VideoToolbox plugin with its
`Native/build-macos.sh` script before importing or building the Unity project.
The viewer uses H.264 when the target and browser support it, with JPEG fallback.
Actual frame rate depends on the game’s rendering cadence and host load.

Enable **Gamepad** to pass a connected standard controller to Unity. Use **Drag
to look** for touch or mouse camera movement, or **Lock pointer** on desktop.
Input requires control ownership; backgrounding or releasing the viewer clears
held controls. The project must use Unity’s Input System or provide an adapter.
