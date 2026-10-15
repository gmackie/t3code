# Reverse Workbench architecture (initial integration)

The Reverse workspace runs in the existing T3 environment server and Electron/web renderer. It does not spawn Ghidra Swing. This document describes the implementation boundaries; integrations below are planned unless marked implemented.

## Ownership

- T3 owns interactive investigations, Ghidra Java subprocess lifecycle, firmware extraction subprocesses, QEMU/GDB sessions, UI, and agent orchestration.
- Veritas owns boards, revisions, immutable capture provenance, station resource leases, validation policies and release decisions.
- REA provides agent-facing investigation tools. Initially use an isolated sidecar; later connect it to the persistent Ghidra program.
- All binary bytes and captures are stored as immutable content-addressed artifacts. The orchestration event log stores identifiers, not binary payloads.

## Implemented foundation

`packages/contracts/src/reverse.ts` defines code locations, evidence references, findings, and investigation metadata. Wire these into RPC and the UI in the next change. They are not yet wired into runtime services.

## Analysis paths

Ghidra function/decompiler/disassembly, strings, Binwalk/Unblob extraction, ROP/JOP/COP gadget candidates, control-flow, memory-safety triage, boot-chain checks, firmware diffing, and protocol correlation.

Gadget candidates must preserve architecture, mode, address space, executable region, and tool/version provenance. Candidate gadgets are not verified exploits.

## Safety

Firmware parsing, QEMU, and extraction run in supervised, resource-limited subprocesses. No arbitrary firmware is executed on the host. Hardware operations require capability-scoped authorization and shared station leases. Observe is distinct from halt/reset, write, and flash. Physical validation cannot be inferred from simulation.

## PR milestones

1. Shared contracts, Veritas linking, persisted investigations and read-only evidence references.
2. Persistent Ghidra JVM bridge, React Reverse workspace, firmware extraction, strings, gadget discovery, REA and supported QEMU profiles.
3. Station-owned serial/JTAG/SWD, GDB, verified flash acquisition, physical capture, and Veritas experiment correlation.

## First integration fixture

Known ARM Cortex-M ELF plus a raw firmware fixture. Import and decompile; persist symbol rename; index strings and gadget candidates; attach GDB to a supported target; record separately attributed physical and simulated observations.
