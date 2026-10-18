# RepoButler for macOS

A native menu bar app and desktop widget that watches your GitHub repositories and
tells you what needs attention: failing CI, PRs waiting on you, stale issues, and
repositories that have gone quiet. Each item links to its evidence on GitHub.

Everything runs on your Mac. There is no RepoButler server and no account: the app
polls the GitHub API with a read-only token stored in your Keychain.

> Status: early prototype (v0.1). The rules engine and GitHub client are unit-tested;
> the UI has not yet been tested on a wide range of accounts.

## Requirements

- macOS 14 Sonoma or later
- Xcode 16 or later
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`
- An Apple ID signed into Xcode (a free Personal Team is enough to run locally)

## Run it

```bash
cd apps/macos
cp Configs/Local.xcconfig.example Configs/Local.xcconfig   # set DEVELOPMENT_TEAM
xcodegen generate
open RepoButler.xcodeproj
```

Choose the **RepoButler** scheme and press ⌘R. A box icon appears in the menu bar
(there is no Dock icon). It changes to a check when everything is clear, or a warning
with a count when something needs you. Open Settings, then:

1. **Account:** create a [fine-grained token](https://github.com/settings/personal-access-tokens/new)
   with read-only access to Metadata, Contents, Issues, Pull requests and Actions, then
   paste it and click Connect. Organization repos may need the org to approve the token.
2. **Repositories:** your 8 most recently pushed repos are selected automatically. Add or
   remove any.
3. **Widget:** right-click the desktop → Edit Widgets → search "RepoButler".

`DEVELOPMENT_TEAM` is needed because the widget reads the app's data through a shared
App Group, and macOS only allows that for signed builds. Without it the menu bar app
still works, but the widget shows "Open RepoButler to connect GitHub".

## Tests

The rules and GitHub client live in a Foundation-only Swift package, so they test
without Xcode (and on Linux):

```bash
cd apps/macos/Packages/RepoButlerCore
swift test
```

CI (`.github/workflows/macos.yml`) runs these tests and an unsigned build of the app
and widget on every change under `apps/macos/`.

## How it works

```text
┌────────────── Menu bar app (sandboxed) ──────────────┐
│ AppModel: poll loop · Keychain token · notifications │
│        │                                              │
│        ▼                                              │
│ RepoButlerCore                                        │
│   GitHubClient ── ETag requests ──► api.github.com    │
│   HealthCalculator  (0–100 score per repo)            │
│   AttentionEngine   (prioritized, evidence-linked)    │
│   Triage            (dismiss / snooze / notify)       │
│        │                                              │
│        ▼                                              │
│ snapshot.json + dismissals.json  (App Group folder)   │
└────────┬─────────────────────────────────────────────┘
         ▼
   Widget (reads files only; no network, no token)
```

**GitHub usage.** Each sync makes about 7 requests per repository. Requests carry
ETags, and an unchanged resource returns `304 Not Modified`, which does not count
against GitHub's 5,000 requests/hour limit. 30 repos every 5 minutes is well within
budget.

**Rules.** These are ported from the web app (`src/lib/health/calculator.ts` and
`src/lib/attention/engine.ts`) with the same weights and thresholds, except:

| Change | Why |
| --- | --- |
| CI looks at the default branch only | Failures on feature branches aren't "your CI is broken" |
| `cancelled`, `skipped` and `neutral` runs are ignored | Superseded runs were being counted as failures |
| "Your PR" means the signed-in user, not the repo owner | The owner check broke for organization repos |
| Maintenance uses `pushed_at`, not `updated_at` | Stars and settings changes aren't activity |

**Notifications.** You're notified only when a High or Critical item first appears or
gets more severe, never on the first sync after install. Bursts are collapsed into one
notification.

**Dismiss vs. snooze.** Dismiss hides an item until something new happens to it (another
CI failure, new PR activity). Snooze hides it for 24 hours regardless.

## Privacy

- The token is stored in the macOS Keychain and sent only to `api.github.com`.
- Repository data is cached in the app's sandboxed App Group folder. Signing out
  deletes the token and the cache.
- No analytics, no third-party services, no AI calls.

## Not built yet

- GitHub sign-in without a token (OAuth device flow; needs a registered OAuth app)
- AI-written daily briefings (the web app has these)
- Health history and trends
- Signed and notarized release builds
