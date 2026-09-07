# CAD workspace tools

Code and CAD share the existing project, thread, provider session, and connected environment. Mode selection is client presentation state; it does not emit orchestration commands or change agent permissions.

On web and desktop, the KiCad singleton in the thread-scoped right-panel store represents CAD mode. Its descriptor retains the previous Code panel selection and visibility. Returning to Code restores surviving resources; it never recreates a terminal or reopens a file that was closed. The header, panel launcher, and command palette use the same store actions. Mobile uses a native CAD screen and returns to the originating thread through the navigation stack.

The viewer is a separate `kicad.html` build entry. The chat bundle loads its panel lazily. Switching to Code unmounts the viewer; a hidden document also pauses manifest polling. Viewer assets are shipped with both hosted web and the bundled server. Desktop permits network frames only in the CAD document to support configured analysis dashboards; the main application's frame policy stays restricted.

`POST /api/kicad/viewer-session` authenticates with the environment's existing read scope and issues a one-hour, workspace-scoped viewer token. The client uses its prepared cookie, bearer, or DPoP authentication to mint that token. Subsequent viewer requests use the short-lived token. The URL fragment transfers the token to the standalone viewer; the viewer does not need provider credentials. File access resolves only discovered CAD files within the canonical workspace root. Conversion caches and BOM preparation use temporary directories, never the source project.

`kicad-cli` and Python run on the connected environment. PCB and schematic inspection use the vendored browser viewer. Native CAD editing remains the responsibility of KiCad or the agent's filesystem tools. The analysis view prepares specifications and embeds an independently configured dashboard; it does not execute a solver.

The initial adapter import is from T3CAD commit `bb429b380407f0914e2101daab3d3a6380a3deff`. Viewer vendor provenance and license notices are retained in `apps/web/public/kicad-viewer/README.md` and the adjacent license files. Update those together with imported viewer artifacts.
