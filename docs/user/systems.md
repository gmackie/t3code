# Systems mode

Use **Systems** in the thread header, the command palette (**Switch to Systems mode**), or the panel add menu to open the Systems Workbench beside your conversation. It simulates block-diagram and statechart models written in the RFC-001 format and keeps every run. **Code** returns to the panel you were using before. Systems is available on web and desktop, not in the mobile app.

Everything runs on the connected environment, including when you connect remotely.

## Open a systems project

A systems project is a folder in the thread's project that contains `systems.project.json`. Enter its path relative to the project, or leave it empty for the project root. The workbench reads only the files the project refers to: its lock file and libraries, its entrypoint models, their statecharts, and the experiments and expected traces you use. Paths that leave the project or pass through a symbolic link are refused.

Validation lists each problem with its code (such as `E-UNIT-001`), the element it concerns, and the file and JSON pointer to fix. Compiling shows each entrypoint's semantic and plan digests and its schedule. Moving things on a canvas never changes a digest; changing behavior always does.

## Run an experiment

Experiments are the `*.run.json` files under `experiments/`. Choose **Run** to start one. A run belongs to the environment, not to the thread or your connection: closing the tab or losing the connection doesn't stop it, and reconnecting shows the same run where it got to. Two runs execute at once per environment; later ones wait their turn. **Cancel** stops a run between steps and keeps everything it produced.

A run never changes after it finishes. It records the digests of the model, plan, experiment and inputs, the solver, seed, runtime version and runner capabilities, so you can tell exactly what ran. Editing the model and running again creates a new run. If the environment restarts during a run, that run is marked failed as interrupted and keeps what it had recorded.

## Read a run

Open a run to see its status and digests, the trace one page at a time, and plots of its probes. Plots show both sides of a jump at the same instant. Long runs are drawn from each interval's minimum and maximum, so peaks are never smoothed away.

When an expected trace under `expected/` or `conformance/expected/` names the run's experiment, the run shows whether it matches and lists each difference with its time.
