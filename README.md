# fastnpm

Install npm packages from the **fastest available mirror**, with **automatic fallback** when a mirror is down or doesn't have a package. Works as a drop-in front-end for `pnpm`, `npm`, and `yarn`.

## How it works

`fastnpm` boots a tiny HTTP proxy on a random local port that speaks the npm registry protocol, then runs your package manager with `--registry=http://127.0.0.1:<port>`.

For every package metadata or tarball request, the proxy:

1. Races the request across the configured mirrors in parallel.
2. Picks the **first mirror that actually starts streaming bytes** (not just the one with the lowest ping — true throughput).
3. Aborts the losers.
4. Falls back to the next mirror automatically on `404`, `5xx`, timeout, or connection failure.
5. Always falls back to the official `https://registry.npmjs.org` as a last resort, even if you didn't list it.

Tarball URLs in metadata responses are rewritten to canonical `registry.npmjs.org` URLs, so the lockfiles your package manager produces stay portable.

## Install

No install needed — just use `npx`:

```bash
npx fastnpm -c mirrors.yaml pnpm install
```

Or install globally:

```bash
npm install -g fastnpm
```

Requires Node.js >= 18.

## Usage

```
fastnpm [-c <mirrors.yaml>] [--verbose] <pnpm|npm|yarn> [args...]
```

Examples:

```bash
fastnpm -c mirrors.yaml pnpm install
fastnpm -c mirrors.yaml npm install lodash
fastnpm yarn add react              # no -c: only uses the official registry
fastnpm --verbose pnpm install      # prints proxy activity to stderr
```

Everything after the package manager name is forwarded to it untouched.

## Mirrors file

A simple YAML list:

```yaml
mirrors:
  - https://registry.npmjs.org
  - https://registry.npmmirror.com
  - https://mirrors.cloud.tencent.com/npm
```

A bare YAML array also works:

```yaml
- https://registry.npmjs.org
- https://registry.npmmirror.com
```

The `-c` flag is optional. If you don't pass it, `fastnpm` just uses the official npm registry (and still gives you graceful retries). The official registry is always added to the list as a final fallback even if you forget it.

## Behavior reference

| Situation                                    | What happens                                                  |
| -------------------------------------------- | ------------------------------------------------------------- |
| One mirror is faster                         | Wins the race; its bytes are streamed straight to the client. |
| Mirror returns 404 for a package             | Skipped; next mirror is tried.                                |
| Mirror returns 5xx / connection refused      | Skipped; next mirror is tried; failure recorded in stats.     |
| All mirrors return 404                       | `404` is returned to the package manager.                     |
| All mirrors fail with non-404 errors         | `502` is returned to the package manager.                     |
| One mirror is consistently slow              | Down-ranked over time via an EWMA-of-throughput score.        |
| Lockfile written by `pnpm`/`npm`/`yarn`      | Contains canonical `registry.npmjs.org` URLs (portable).      |

## Development

```bash
pnpm install
pnpm test
```

Tests use a set of in-process fake registries to verify race, fallback, and down-mirror behavior without hitting the network.

## Releasing

Releases are fully automated via GitHub Actions and [semantic-release](https://github.com/semantic-release/semantic-release).

Every push to `main` runs the test matrix; on success it analyzes the new commits using [Conventional Commits](https://www.conventionalcommits.org/), bumps the version accordingly (`fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` → major), updates `CHANGELOG.md`, tags the release, publishes to npm, and creates a GitHub release.

### One-time setup on the GitHub repo

1. Replace `OWNER` in `package.json` (`repository`, `homepage`, `bugs`) with your actual GitHub username/org.
2. Create an npm automation token: <https://www.npmjs.com/settings/YOUR-USER/tokens> (type **Automation**).
3. Add it as a repo secret named `NPM_TOKEN` under **Settings → Secrets and variables → Actions**.
4. Under **Settings → Actions → General → Workflow permissions**, enable **Read and write permissions** so the workflow can push the version bump and create releases.

`GITHUB_TOKEN` is provided by Actions automatically — no setup needed.

### Commit message format

Use Conventional Commits to drive versioning:

```
feat: add yarn berry support
fix: handle aborted streams gracefully
docs: clarify mirrors.yaml format
chore: update dependencies
feat!: drop Node 16 support      # major bump
```

Commits that don't match (e.g. `chore:`, `docs:`, `test:`) won't trigger a release.

### Local dry-run

To preview what semantic-release would do without publishing:

```bash
pnpm release:dry
```

## License

MIT
