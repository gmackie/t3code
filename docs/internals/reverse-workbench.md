# Reverse Workbench architecture

The Reverse workspace runs in the existing T3 environment server and Electron/web renderer. It does not spawn Ghidra Swing.

## Ownership

- T3 owns interactive investigations, Ghidra Java subprocess lifecycle, firmware extraction subprocesses, QEMU/GDB sessions, UI, and agent orchestration.
- Veritas owns boards, revisions, immutable capture provenance, station resource leases, validation policies and release decisions.
- REA provides agent-facing investigation tools. Initially use an isolated sidecar; later connect it to the persistent Ghidra program.
- All binary bytes and captures are stored as immutable content-addressed artifacts. The orchestration event log stores identifiers, not binary payloads.

## One service, two transports

[`ReverseWorkbench`](../../apps/server/src/reverse/ReverseWorkbench.ts) owns the investigation store, the native analyzers, the Ghidra session pool and the Veritas client. It also checks that the project exists. The `reverse.*` WebSocket RPCs and `POST /api/reverse/workbench` both call it, so add capabilities as service methods, not in either transport.

- **Ghidra JVMs live as long as the service.** The pool is disposed with the server, which also aborts an import in flight. The WebSocket layer is rebuilt per connection, so it must reuse the server's captured instance. A per-connection instance would start a second pool, and a disconnect would kill shared sessions.
- **The board revision comes from saved linkage.** Veritas registration uses the board revision saved by `reverse.link`, never one supplied with the publish request, because every caller shares the environment's Veritas token.
- **The HTTP protocol has its own vocabulary over the same analyzers.** `scan`, `analysis` and `emulate` are translated in the service onto the analyzers the RPCs use. Ghidra disassembly, references and the call graph come from the function view. Only `lab` has no backend; it waits for station arbitration in Veritas.

## Analysis paths

Ghidra function/decompiler/disassembly, strings, Binwalk/Unblob extraction, ROP/JOP/COP gadget candidates, control-flow, memory-safety triage, boot-chain checks, firmware diffing, and protocol correlation.

Gadget candidates must preserve architecture, mode, address space, executable region, and tool/version provenance. Candidate gadgets are not verified exploits.

## Safety

Firmware parsing, QEMU, and extraction run in supervised, resource-limited subprocesses. No arbitrary firmware is executed on the host. Hardware operations require capability-scoped authorization and shared station leases. Observe is distinct from halt/reset, write, and flash. Physical validation cannot be inferred from simulation.

## Not built yet

- Station-owned serial, JTAG and SWD, plus GDB, verified flash acquisition, physical capture, and Veritas experiment correlation.
- The Veritas side of this is tracked in its `docs/reverse-workbench-integration.md`.

## First integration fixture

Known ARM Cortex-M ELF plus a raw firmware fixture. Import and decompile; persist symbol rename; index strings and gadget candidates; attach GDB to a supported target; record separately attributed physical and simulated observations.
