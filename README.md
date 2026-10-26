# VL Lens

A read-only VL patch explorer with a web viewer, public GitHub browsing, structural Git diffs and a native Windows desktop app.

[Live site](https://vl-lens.vercel.app) · [Open in Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdomjancik%2Fvl-lens) · [Download Windows app](https://github.com/domjancik/vl-lens/releases/latest/download/VL-Lens-Windows-x64.zip) · [Deployment guide](docs/DEPLOYMENT.md)

## Run locally

Python 3.12+ and a modern browser. No Python packages are needed for the web server.

```powershell
python run.py
# Landing page: http://127.0.0.1:8768/
# Viewer:       http://127.0.0.1:8768/viewer
python run.py --root C:/Projects/MyVLProject
# Optional generated C# correspondence:
python run.py --root C:/Projects/MyVLProject --exports C:/Projects/MyVLProject/Exports/src
```

The server binds only to loopback. Project reads are confined to VL files inside the selected root. Hidden directories, dependencies and build folders are excluded. Symlink escapes and traversal paths are rejected. The app does not save or modify VL files or repositories.

## First-use guidance

A short, skippable tour introduces repository connection, file browsing, the canvas and Git history. When history first opens, a separate guide highlights branch browsing, **A / Before**, **B / After** and **Compare range**.

Replay through **Help → Quick tour**, **Help → How to choose a diff range**, or **Range guide** inside history. Dismissal is remembered in this browser. The desktop app also stores non-sensitive guidance flags in loopback cookies so they survive its changing local port. Storage failures fall back to page-local memory. The tours do not select commits or apply ranges for you.

## Explore

- **Ctrl+P / Cmd+P** opens quick file selection with filename/path search, keyboard navigation, and workspace-specific recents.
- **Files / Definitions** separates project browsing from the selected document. Project / Opened / Recent sources retain full paths.
- Open or drop individual files, or import a folder. Imports index File handles first and parse on selection.
- Pan, zoom, fit and export the graph as SVG. Inspect nodes, pins, links, XML and saved attributes.
- Local generated C# lookup is optional and uses only the explicitly configured export directory.

## GitHub repositories

Use the landing page's repository field or **Connect GitHub** in the viewer. Enter `owner/repository` or a public `https://github.com/owner/repository` URL. An optional branch, tag or commit chooses the initial snapshot.

Shareable URL:

```text
/viewer?repo=owner%2Frepository&ref=main#file=path%2FPatch.vl
```

The catalog resolves its branch to a commit, then pins subsequent file reads to that commit. Git comparisons independently resolve and pin both revisions. Refresh project rereads the branch. No clone, checkout, filesystem cache or Git executable is required for GitHub browsing.

Public repositories only. No OAuth or browser token entry is implemented. Even with a host-side token, private repositories are rejected before reading any tree/blob. The optional `VL_LENS_GITHUB_TOKEN` environment variable improves the public API quota; keep it in the deployment's secret settings.

The provider reads Git trees and blobs through api.github.com. It compares exact selected snapshots, including divergent branches. Identical moved blobs are reported as renames; edited moves appear as delete/add. The revision menu shows up to 30 commits and 100 branches; other branch names, tags and full commit SHAs can be entered directly. Truncated GitHub trees fail with an explicit message.

## Visual Git history

Open **History** in the header, or **Choose range visually** beside the comparison inputs.

- Browse a colored commit graph with actual parent/merge links, branch and local tag labels, author, date and commit ID.
- Select **A (Base / Before)** and **B (Target / After)** from commit rows or branch heads, then choose **Compare range**. The current patch stays selected when it exists in the range; changed patches remain in the file list.
- Click a commit to set the active endpoint. Shift-click sets Base. With a commit focused, arrow keys navigate and **A / B** choose endpoints. Swap reverses a commit comparison.
- **Review commit** (the arrow on a row) selects its first parent → commit. **Latest commit** selects the newest loaded commit and first parent. Root commits have no parent, so choose two snapshots explicitly.
- Local Git also offers **Working tree**, **Staged** and **Unstaged** presets. These mutable states appear as endpoint choices, not invented commit nodes.
- Search loaded commits by subject, author, branch badge or SHA. Filter branch names or open a branch, tag or commit directly.
- Select a branch and **Load older commits** for pinned history pages, up to 600 commits in the browser. Dashed edges mark unloaded or filtered parents. Counts explicitly describe loaded history.

Local **All branches** reads the currently available local/remote refs without fetching. GitHub **Branch overview** combines up to six branch tips, including the default branch, with 50 commits per tip. The branch list shows the first 100 GitHub branches plus the default branch; open another branch/tag by name when needed. Selecting a branch loads its individual history and enables pagination.

Range shading uses the loaded commit ancestry. It labels forward, reverse, cross-branch and incomplete ancestry separately. Applying a range compares the two exact snapshots, so divergent branches are not silently replaced by their merge base. The graph never claims unloaded ancestors are present.

## Other file types in Git diffs

Git comparisons list all repository files, including source code, Markdown, JSON/YAML, dotfiles, images and other assets. Use **Filter changed files** or the file picker to find a path.

- VL files retain the visual graph diff.
- Text files use a full-width unified diff with old/new line numbers, addition/removal counts, Before/After source views and optional line wrapping. HTML and SVG are displayed as inert text.
- Binary files show side-by-side sizes and content/object identities. File content is not executed or decoded as an image preview.
- Added, deleted and renamed files preserve their missing-side and original-path information. Symbolic link targets are shown without following the link; submodules show their Git object pointers.
- Local worktree reads are limited to Git-listed, non-ignored files inside the selected project. Git metadata and paths that escape the project remain blocked. No general-purpose filesystem read endpoint is exposed.

Text previews are capped at 128,000 characters per file and 6,000 diff/source rows, with explicit partial-preview notices. GitHub files above 3 MiB and local files above 12 MiB retain metadata rather than failing the file browser. Non-Unicode text may be reported as binary. Normal file/folder imports outside Git mode remain VL-only.

## Git diff

**Git diff** compares two saved snapshots using DocumentId and element IDs. Added, removed and changed nodes/pins/links are highlighted. Before/After, Show removals, Ignore Bounds and a unified XML diff support review.

Local projects support `HEAD → WORKTREE`, `HEAD → INDEX`, `INDEX → WORKTREE`, arbitrary commits, branches and tags, including untracked files and renames. Git must be installed. The app performs read operations only.

GitHub mode defaults to the latest commit's first parent → latest commit. It has no INDEX or WORKTREE. Existing local snapshot bookmarks cannot be applied to a remote repository.

Structural comparisons preserve saved attributes and leaf text. A changed DocumentId prevents matching. Duplicate IDs disable structural comparison. Malformed snapshots retain a text diff. “Changed” describes saved XML, not a proven runtime behavior change.

## Windows desktop

[Download the portable ZIP](https://github.com/domjancik/vl-lens/releases/latest/download/VL-Lens-Windows-x64.zip), extract it and run **VL-Lens.exe**. Keep the included `_internal` directory beside it.

The app runs in a native WebView2 window with **File → Open project folder**. No Python or gamma installation is required. Windows 10/11 x64 and WebView2 Runtime are required; Git is optional for local diff. This is an unsigned preview.

To build from source:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-desktop.txt
.venv/Scripts/python scripts/build_desktop.py
```

Outputs `dist/VL-Lens-Windows-x64.zip`. Pushing a `v*` tag builds and publishes Windows assets through GitHub Actions. CI also runs on Windows and Linux. macOS/Linux desktop binaries and code signing are not included in this release.

## Deploy

Import this repository into Vercel with the included `vercel.json`. Static assets come from `static/`; `api/index.py` is the Python Function. No database, build step or frontend dependency installation is required.

The hosted handler has no local filesystem or local Git endpoints. It supports public GitHub snapshots and uploaded VL parsing. Local browser uploads are sent to the hosting server for parsing, held in memory, and not saved. Use the desktop app for local-only parsing. GitHub API responses have a short, bounded in-memory cache.

Hosted source/upload payloads are capped at 3 MiB, parsed responses at 4 MiB, and text diffs at 512,000 characters. A complex file can hit the response cap below the source cap; the error directs you to desktop. Desktop/local source files support up to 12 MiB. Large repository trees that GitHub marks truncated require a local clone.

See [deployment and security details](docs/DEPLOYMENT.md), including API quotas, deployment-wide rate limits, rollback, and the path to private repository support.

## Verify

```powershell
python -m unittest discover -s tests -p "test_*.py"
node --test tests/model.test.mjs tests/diff.test.mjs tests/files.test.mjs tests/remote.test.mjs tests/history.test.mjs tests/comparison-selection.test.mjs tests/guidance.test.mjs
python tests/check_corpus.py
# Optional external corpus (read-only; no files copied into this repository):
python tests/check_corpus.py C:/Projects/MyVLProject
# Emulate the Vercel API locally:
python run.py --hosted
```

Node.js 22+ is used for tests only. Unit tests cover parser fidelity, malformed/entity input, path confinement, host/origin restrictions, snapshot identity, local Git behavior, file search and public GitHub authorization. The corpus check runs documents through the actual scene model and verifies finite bounds/routes and unchanged self-comparisons.

## Scope

This is a structural viewer, not gamma's compiler, runtime or patch editor. It draws serialized graph elements and saved layouts. Implicit pins, inferred types, overload resolution, execution scheduling and compiler-backed dependency resolution are unavailable. Unplaced links and source findings are reported without claiming compilation validity.

The source repository contains only the viewer, synthetic examples, tests and packaging. No originating application's patches, generated exports, credentials or Git history are included.

MIT licensed. Independent community tooling; not an official vvvv product.
