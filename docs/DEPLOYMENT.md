# Deploying VL Lens

## Vercel

1. Import https://github.com/domjancik/vl-lens into your Vercel account.
2. Use framework **Other**, repository root, no build command. The checked-in configuration uses `static` as the output directory and a Python 3.12 Function in `api/index.py`.
3. Optionally set **VL_LENS_GITHUB_TOKEN** as a secret environment variable in Production and Preview. Use a token intended only for public-resource reads; do not grant private repository contents permissions.
4. Deploy. Open `/`, then `/viewer`. Test `/api/config` (hosted must be true) and connect a public VL library.
5. Git integration deploys main to production and creates previews for branches/PRs.

With the CLI:

```powershell
npx vercel
npx vercel --prod
```

Vercel must be signed in to your intended account/team. Deployment links and project identity are recorded in Vercel's ignored `.vercel` directory. No host account credentials belong in Git.

### How it runs

`/` rewrites to the landing page and `/viewer` to the workbench. Static JS and CSS are served directly by Vercel. API paths rewrite to the shared Python Function with an explicit route parameter, retaining repository/ref/path query parameters.

The function handles requests independently. Repository selection lives in each request's query, never in a mutable server-wide checkout. Immutable commit IDs travel with files and comparisons. API tokens stay server-side and the browser only contacts its own origin.

No subprocesses or local file reads are available through hosted API routes. The original loopback Handler remains for local projects and desktop only.

### Platform limits

Vercel Functions limit request and response payload sizes. VL Lens sets a 3 MiB upload/source cap and a 4 MiB response cap below the platform limit; normalized XML can be larger than the source. The desktop viewer handles larger files.

The GitHub tree API can truncate large recursive responses. This app refuses incomplete catalogs and directs the user to a local clone. It does not attempt a whole-repository clone in a serverless function.

GitHub's anonymous API quota is shared by the outgoing IP, so it can be exhausted on a busy deployment. The optional server token improves it. Responses are cached in memory for 30 seconds with a 32 MiB / 256-entry cap. This cache is an optimization and is not durable or shared across instances.

Request limiting in the handler is a best-effort per-instance guard (90 API requests per minute per observed client address). On Vercel, configure a deployment-wide Firewall rate-limit rule for `/api/*` and usage/spend alerts. Forwarded user IP headers are not trusted by the application for authorization. A shared gateway address may reach the instance guard collectively.

### Security boundaries

- Only fixed api.github.com endpoints are requested; arbitrary hosts, credentials in URLs, path traversal and redirects are rejected.
- Public visibility is checked before reading trees/blobs, even if the host token can access more.
- No credentials are accepted or saved in browser storage. Recent file metadata is scoped by repository/workspace; uploaded File objects live in the current page only.
- VL XML DTD/entities are rejected. Source size, nesting and element counts are bounded. Text is rendered using DOM text, not inserted as HTML.
- Hosted uploads are parsed on the server. They are not written to disk or intentionally logged. Infrastructure request logs remain subject to the host's settings.
- CSP, nosniff, same-origin resource policy and referrer policy are configured. API responses use no-store; no cross-origin API permission is granted.
- Desktop binds to a random loopback port, checks Host/Origin, and stops the server when its window closes.

### Verification / rollback

CI runs the Python and JS tests on Windows and Linux. For each deployment, smoke-test the landing page, empty viewer, GitHub catalog, a real patch, commit diff and desktop release download.

Use Vercel's dashboard to promote the previous successful deployment if necessary. There is no database migration to roll back.

## Windows releases

`scripts/build_desktop.py` uses pywebview and PyInstaller in an isolated Python environment. A `v*` Git tag triggers the Windows release workflow, produces the portable ZIP plus SHA-256 checksum and uploads them to GitHub Releases. The landing page points to the latest release's stable asset name.

The release is unsigned. A future production distribution should add code signing, automatic update verification and macOS notarization before advertising signed installers. Python/PyInstaller dependencies are pinned in `requirements-desktop.txt`; GitHub Actions keeps builds repeatable.

## Private repositories later

Private access requires an authorization layer, rather than exposing a shared host token:

1. Register a GitHub App with read-only Contents/Metadata and user-selected installations.
2. Add OAuth sign-in and a server-side session with Secure/HttpOnly/SameSite cookies.
3. Authorize every repository request against the current user's installation access.
4. Mint short-lived installation tokens on the server and partition caches by authorization context.
5. Add distributed per-user rate limits and audit/access logging with redacted credentials.

The existing provider interface (`resolve`, `revisions`, `documents`, `read`, `changes`) can remain. Public-only checks must be replaced by per-user authorization, not removed without replacement.

## Primary references

- [Vercel Python Functions](https://vercel.com/docs/functions/runtimes/python)
- [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [GitHub Git trees](https://docs.github.com/en/rest/git/trees)
- [GitHub API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [pywebview packaging](https://pywebview.flowrl.com/guide/freezing.html)
- [pywebview web engines](https://pywebview.flowrl.com/guide/web_engine)
