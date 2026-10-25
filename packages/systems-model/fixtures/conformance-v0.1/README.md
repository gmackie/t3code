# Systems Workbench — draft conformance fixtures v0.1

This folder accompanies **RFC-001: Model IR and Execution Semantics**.

It contains **sample semantic models, chart files, simulation requests, expected trace vectors, and structural JSON Schemas**, plus a small static validator. It does **not** contain a simulator or demonstrate that any backend passes conformance.

- `models/pump.system.json` is an eight-block sampled controller + tank example with a continuous integrator and explicit sampling/hold adapters.
- `statecharts/pump.chart.json` defines an exclusive sampled controller, with guard transitions at 3 m and 1 m.
- `expected/pump-nominal.trace.json` is the required observation trace at integer seconds (0 through 6).
- `models/cross-clock.system.json` records the simultaneous-clock `previous_committed` rule; `models/exponential-decay.system.json` is an analytical RK4 check.
- `statecharts/zero-time-cycle.chart.json` intentionally models an infinite eventless cascade to require `E-TIME-002`.
- `statecharts/hierarchy.chart.json` tests descendant-before-ancestor transition priority; `statecharts/timer.chart.json` tests exact `after(3/2)` expiry.
- `negative/` contains deliberately invalid models (unit conversion `m → s`, instantaneous gain-to-gain loop).
- `systems.project.json` lists the model entrypoints and the version-pinned library lock.
- `libraries/std.blocks.json` and `systems.lock.json` are a **draft** builtin block registry and content-pinned lock manifest. Their metadata is not a released software package.
- `schemas/` are draft *structural* JSON Schemas; actual unit, port, clock, statechart, and scheduler validation requires the compiler specified by RFC-001.

## Validate structural fixtures

From the repository root: `vp test run packages/systems-model`. The original draft shipped a Python validator (`tools/validate_fixtures.py`); `packages/systems-model` replaces it with the Effect Schema contracts and static diagnostics, and its tests check the same properties. The validator ensures the JSON is well formed, matches the document schemas, references existing nodes/ports/states, uses normalized rational values, has a consistent library lock hash, and that the two deliberately invalid examples exhibit their expected diagnostic class. It also checks the pump's expected trace against the simple *hand-specified analytical piecewise-linear trajectory*. **This does not execute the model or certify an engine.**

## Proposed runner behavior

A future simulation implementation can load `manifest.json`, dispatch the `source` model or experiment to a conforming engine, capture structured signals/events, and compare them against the supplied expected file. A failure should include model entity IDs, physical time, chart transition IDs and a numerical tolerance report.

## Stable namespace / versions

- `format: sw.system | sw.statechart | sw.run | sw.expectedTrace | sw.layout`
- `schemaVersion: 0.1.0`, `semanticsVersion: 0.1` (where applicable)
- This is **not** a stable, released interchange standard yet; do not publish generated code or safety claims on this draft.
