# CAD workspace tools

Code and CAD share the existing project, thread, provider session, and connected environment. Mode selection is client presentation state; it does not emit orchestration commands or change agent permissions.

On web and desktop, the KiCad singleton in the thread-scoped right-panel store represents CAD mode. Its descriptor retains the previous Code panel selection and visibility. Returning to Code restores surviving resources; it never recreates a terminal or reopens a file that was closed. The header, panel launcher, and command palette use the same store actions. Mobile uses a native CAD screen and returns to the originating thread through the navigation stack.

The viewer is a separate `kicad.html` build entry. The chat bundle loads its panel lazily. Switching to Code unmounts the viewer; a hidden document also pauses manifest polling. Viewer assets are shipped with both hosted web and the bundled server. Desktop permits network frames only in the CAD document to support configured analysis dashboards; the main application's frame policy stays restricted.

`POST /api/kicad/viewer-session` authenticates with the environment's existing read scope and issues a one-hour, workspace-scoped viewer token. The client uses its prepared cookie, bearer, or DPoP authentication to mint that token. Subsequent viewer requests use the short-lived token. The URL fragment transfers the token to the standalone viewer; the viewer does not need provider credentials. File access resolves only discovered CAD files within the canonical workspace root. Conversion caches and BOM preparation use temporary directories, never the source project.

`kicad-cli` and Python run on the connected environment. PCB and schematic inspection use the vendored browser viewer. Native CAD editing remains the responsibility of KiCad or the agent's filesystem tools. The analysis view prepares specifications and embeds an independently configured dashboard; it does not execute a solver.

The initial adapter import is from T3CAD commit `bb429b380407f0914e2101daab3d3a6380a3deff`. Viewer vendor provenance and license notices are retained in `apps/web/public/kicad-viewer/README.md` and the adjacent license files. Update those together with imported viewer artifacts.

Veritas credentials belong to the environment, while linkage belongs to the canonical workspace directory. All clients reach the same server adapter through the viewer. Its short-lived session carries the operation permission from the original environment authentication; a read-only viewer cannot promote itself into a writer. Snapshot download capabilities expose one immutable CAD-only archive, not a directory or the live workspace. Their lifetime is persisted so queued reviews survive a T3 restart.

Veritas mutations do not currently offer a shared idempotency key. The adapter records pending submission state before sending them and preserves that state on an uncertain response. It never automatically retries those mutations: the user reconciles the review/run identity in Veritas. This avoids creating duplicate reviews or production runs after a dropped response. Preparing a run always takes the BOM from the selected completed review, never a mixture of current workspace files and older review parts.
