# Reverse mode

Use **Reverse** in the thread header, the command palette (**Switch to Reverse mode**), or the panel add menu to open the firmware workbench beside your conversation. It works on the thread's project, and **Code** returns to the panel you were using before. Reverse is available on web and desktop.

Everything runs on the connected environment, including when you connect remotely. Firmware bytes stay on that environment; only identities and findings you choose to publish leave it.

## Set up the environment

Open **Toolchain** under the workbench title to see what this environment can run, which analyses each tool enables, and how to install what is missing. Nothing is executed to check.

- Native tools always run inside an isolating launcher. Set `T3_REVERSE_SANDBOX_COMMAND` to a JSON argument list whose first entry is the absolute path of that launcher, such as a container or bubblewrap wrapper. Without it, analyzers refuse to start.
- Ghidra needs Ghidra 12.1, a Java 21 runtime, `GHIDRA_INSTALL_DIR`, and `T3_REVERSE_GHIDRA_SCRIPTS` pointing at the folder that contains `ReverseBridge.java`.
- Binwalk, Unblob, ROPgadget, REA, and `qemu-system-arm` are each optional; install the ones you need.

Strings and the ELF layout check need no extra tools.

## Investigate firmware

Enter a path relative to the project and choose **Import firmware**. The file is copied and identified by its SHA-256, so later edits to the original don't change the investigation. Importing the same bytes again opens the existing investigation.

- **Strings and file offsets** lists printable strings when you open it. Values longer than 512 characters are shortened.
- **Ghidra** keeps a program open between requests. List functions, open one to read its pseudocode, instructions, callers and callees, then rename or comment and save. Up to four programs stay open per environment, two per project; an idle one closes after ten minutes, and a busy one is never closed under you.
- **Gadgets** finds ROP/JOP/COP candidates. For a raw image without headers, pick the matching raw profile (Thumb, Arm, Arm64 or MIPS). Candidates are syntactic; they make no reachability or exploitability claim.
- **Binwalk** and **Unblob** look inside images. Extraction stops at 512 MiB or 5,000 files.
- **QEMU** boots the image for a few seconds on a supported Cortex-M machine with no network and shows its serial output. A QEMU run is an observation, never physical evidence.

Two analyses run at once per environment and a few more wait; beyond that, try again when one finishes. Each analysis keeps a receipt for a week.

**Delete investigation** removes it from the project. The firmware copy is removed once no project uses it.

## Link and publish to Veritas

Under **Veritas linkage**, record the Veritas project and board revision the firmware belongs to. Empty a field and save to clear it. Linking changes nothing in Veritas.

**Register in Veritas** publishes the firmware's digest, size, provenance and saved board revision to the Veritas server configured on this environment (`VERITAS_URL` and `VERITAS_API_TOKEN`). Save the board revision before registering. The bytes never leave the environment.

## Agents

Agents in the thread can check the toolchain, list investigations, read strings, import, link, analyze and emulate through T3's tools. Publishing to Veritas and deleting investigations stay with you.
