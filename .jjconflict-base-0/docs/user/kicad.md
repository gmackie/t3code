# Code and CAD modes

Use **Code / CAD** in the thread header to switch tools within the same project. **CAD** opens the electronics viewer beside your conversation. **Code** restores the panel you were using before, including whether it was closed. Switching does not create a thread, change your provider, stop a running agent, or restart the environment. The selected mode is remembered per thread on this device.

The command palette also includes **Switch to Code mode** and **Switch to CAD mode**. The panel add menu offers **KiCad** and its **K** shortcut.

On mobile, use **Switch to CAD mode** in the thread toolbar. The viewer opens full screen; tap **Code** or use Back to return to the same conversation.

CAD features run on the connected environment, including when you connect remotely. That environment needs a T3 Code version with CAD support. Install `kicad-cli` there for 3D, BOM, and library previews, and Python 3 for Gerber rendering.

## Inspect saved designs

Open **KiCad** from a thread's right-panel add menu to inspect its PCB, schematic, Gerber layers, and 3D board using KiCAD-Prism's viewers. The panel follows the thread's workspace or worktree. It reads saved files without locking them; you can continue editing in KiCad or through your agent.

On mobile, open **KiCad** from the thread toolbar. The same read-only viewer opens in a full-screen native web view, with its PCB, Gerber, schematic, and 3D tabs available at the top. The viewer uses a short-lived session tied to the active environment; reconnect and tap **Retry** if that session expires.

For a workspace containing several boards, create `.k3eda.json` at its root:

```json
{
  "pcb": "hardware/controller.kicad_pcb",
  "schematic": "hardware/controller.kicad_sch",
  "gerbers": ["build/gerbers"]
}
```

Paths are relative to the workspace. Generated output is discovered even in Git-ignored folders. Saved changes refresh while the viewer is visible. Gerbers show the existing generated package; editing the board does not regenerate that package.

The 3D preview requires `kicad-cli` with GLB export on the environment running T3. The preview includes outer copper, pads, silkscreen, and translucent soldermask using the board’s stackup colors. Exports go into a separate temporary cache. Gerber rendering requires `python3` there. Neither operation modifies the project.

Use **Open KiCad viewer in browser** to let your agent inspect and interact with the viewer through the collaborative browser. Its link grants temporary read-only access to this workspace; reopen the panel after the link expires or the server restarts.

Find a component by its reference (such as `U1`), or enable **Net** to search by net name. Select a component and use **Show in schematic/PCB** to inspect its counterpart without losing the other view’s camera.

In Gerbers, use the arrow buttons or left/right arrow keys to flip layers. **Copper layers**, **Front placement**, and **Back placement** combine aligned layers from the current fabrication set. The viewer caches rendered layers and warms adjacent layers for faster switching. Placement presets use available silkscreen, fabrication, and paste artwork; they are not a component BOM or a substitute for populated assembly inspection.

Use **+ Open view** inside the KiCad viewer to open **BOM**, **Footprints**, **Symbols**, or **EMerge / Analysis**. Close an optional tab with its close button and reopen it from the same menu. These views are shared by web, desktop, and mobile.

The BOM follows the selected schematic and the current saved BOM settings in its matching `.kicad_pro`: visible fields, column labels, grouping, sorting, filtering, DNP handling, and output formatting. Changes saved in KiCad refresh the table. Select the root schematic when using a hierarchical design. If the matching project has no saved BOM settings, the viewer explicitly reports that it is using KiCad defaults. Search the table or download the exported BOM. Export runs against a temporary copy and leaves project files untouched; it is a preview, not a manufacturing release check.

Footprints (`.kicad_mod`) and symbol libraries (`.kicad_sym`) are discovered within the workspace. Select a library and then a symbol/unit to inspect its SVG preview. The BOM and library previews require `kicad-cli` on the connected environment.

The analysis view creates a planar antenna starter specification with feed and ground contacts and one or two target bands for the antenna-rl workflow. Export or copy the specification for your agent to use. EMerge results can be embedded by adding an `analysisUrl` to `.k3eda.json`, using a dashboard address reachable from every device that will open the viewer:

```json
{
  "analysisUrl": "https://antenna-dashboard.example.com"
}
```

The dashboard service must allow embedding; **Open dashboard** opens it separately. The openEMS option currently prepares a specification only; an openEMS execution adapter is not included. Exporting a specification does not start a solver or training job or qualify an antenna design.

## Connect CAD to Veritas

Open **CAD → Veritas** to share saved design snapshots, see sourced parts and review evidence, and prepare a production run from a completed review's BOM. Each workspace keeps its linked Veritas project, review, and production run on the connected T3 server, so the same connection is available from web, desktop, and mobile.

Configure the T3 server with:

- `VERITAS_URL`: your Veritas application URL.
- `VERITAS_API_TOKEN`: a Veritas service token with `forge:read` and `forge:write` access, plus access to production runs.
- `VERITAS_CAD_PUBLIC_URL`: this T3 server's address reachable by your paired Veritas review agent. This may be a private network address if that agent shares the network.

Restart the server after configuring these values. Credentials remain on that server. Read-only T3 connections can inspect linked results; submitting reviews, linking workspaces, and preparing production require workspace operation access.

**Send saved design for review** sends a ZIP containing the workspace's discovered CAD files, up to 40 MB. The archive is immutable and available to the review agent for 30 minutes, including across T3 server restarts. Unrelated source files and environment files are excluded. Save edits before submitting, and use **Refresh status** to see processing results. A paired Veritas review agent and its KiCad tooling must be available to process the job.

Parts and prices come from the linked review, and can be older than your current design. The panel shows when the workspace has changed since submission. Production requires a completed review with resolved part numbers and reference designators. Enter the board’s actual width, height, copper layer count, and finish for fabrication estimates. If the BOM reaches Veritas’s 500-line response limit, confirm the complete BOM and prepare production in Veritas. **Prepare production run** creates the fabrication, parts, and assembly work in Veritas; vendor orders are placed separately through its vendor workflow.

To use an existing project, expand **Link an existing Veritas project** and enter its project, review, or production run IDs. If a submission loses its connection, T3 preserves the uncertain operation and prevents automatic resubmission. Check Veritas, then link the resulting review or run. **Unlink workspace** removes the local association; it does not delete Veritas data.
