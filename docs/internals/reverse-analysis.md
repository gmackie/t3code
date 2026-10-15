# Reverse analysis runtime

The Reverse workspace now uses one persistent Ghidra JVM per project/artifact/loader/version identity. Import completes once; a framed Java post-script then serves bounded function pages, on-demand decompilation, token addresses, assembly bytes, xrefs, calls, reviewed renames and comments. Every mutation has a Ghidra transaction and saves before its response. A stale expected symbol name is rejected. Worker death or timeout never replays an edit.

## Host setup

Use a Linux/macOS analysis host with Ghidra 12.1.4 and JDK 21+, setting absolute `GHIDRA_INSTALL_DIR` and `T3_REVERSE_GHIDRA_SCRIPTS` (the latter points at `apps/server/src/reverse/scripts` or its separately deployed copy). Windows clients may connect to such a host. Up to four programs remain live; inactive workers are closed after ten minutes.

Install the external tools explicitly: Binwalk 3, Unblob, ROPgadget, REA and qemu-system-arm. No analyzer auto-installs dependencies. `T3_REVERSE_SANDBOX_COMMAND` must be a JSON argv array beginning with an absolute, operator-installed launcher. The launcher receives the executable and exact arguments, with no shell. It must isolate firmware parsing/emulation from host credentials and files, disable unintended networking, and enforce CPU/memory/process/storage quotas. Output and timeout limits alone are NOT isolation. The application fails closed when no launcher is configured. The `/usr/bin/env` launcher in CI is exclusively for the generated trusted test fixture, not a deployment recommendation.

Binwalk scans signatures; Unblob separately extracts files. Extraction receipts record relative paths, sizes and digests and skip symlinks/reject hardlinks. Hard disk quotas belong to the isolated worker, not the post-run manifest limit. Extracted children remain in their receipt directory; importing them into another investigation is not yet an automatic action.

Gadget classifications are syntactic ROP/JOP/COP candidates. Register effects, reachability and exploitability are not inferred. Raw gadget profiles label addresses as file offsets. ELF posture reports file-header observations, not runtime ASLR, MPU/XN, secure-boot or canary verification. Raw Ghidra imports need explicit language/base information and may require entry-point recovery; CPU decoding support does not guarantee automatic board reconstruction.

QEMU observation supports LM3S6965EVB and MPS2-AN385 machine profiles. Timeout output is retained and results remain `inconclusive`, never physical qualification. REA remains a separate tool process, not yet a live shared-session provider. All receipts bind original bytes, tool versions, parameters and source; none automatically satisfies a Veritas release policy.

## Tests

`node --test scripts/reverse-runtime-smoke.ts` exercises real process transport, cancellation, limits, UTF-8 framing, no replay, gadget classification and 64-bit mapping. `node scripts/reverse-ghidra-smoke.ts` requires the real Ghidra installation and tests import, decompile, rename conflict, save and reopen. The dedicated PR workflow downloads a checksum-pinned release and runs both. Hardware measurements are outside these tests.
