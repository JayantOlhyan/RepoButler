# RepoButler

> **Your GitHub repositories have a butler now.**

RepoButler is a personal GitHub assistant that watches a developer's repositories, aggregates cross-repository activity, identifies priorities that deserve attention, detects neglected projects, and delivers a concise Daily Briefing.

---

## Core Product Vision

RepoButler is designed to answer one question for developers:
> **"Given everything happening across my repositories, what should I care about right now?"**

### What RepoButler Is
- **An Attention Engine**: Surfacing failing pipelines, stale PRs, and inactive projects.
- **A Actionable Health Metric**: A deterministic 0-100 score with full reasons and actions.
- **A Daily Briefing**: A prioritized, clean daily summary (AI-grounded or templated).

### What RepoButler is NOT
- A generic analytics dashboard with 40 charts.
- An AI code-review automation tool.
- An autonomous coding agent that commits code or opens PRs.
- A commit streak generator (RepoButler rewards real updates; streaks are excluded).

---

## Technical Architecture

```text
GitHub webhook (Real-time updates) ──┐
                                     ├──> Next.js API Routes ──> PostgreSQL (Prisma)
Octokit REST API (Historical sync) ──┘        │
                                              ├──> Attention Engine & Health Rules
                                              └──> Daily Brief (AI Summary / Email)
```

- **Frontend/Backend**: Next.js (App Router) + TypeScript.
- **Database**: PostgreSQL with Prisma ORM.
- **Styling**: Vanilla Tailwind CSS.
- **CI/Verification**: Vitest for fast, mocked intelligence testing.

---

## Quick Start (Local Setup)

### 1. Clone & Install
```bash
git clone https://github.com/your-username/RepoButler.git
cd RepoButler
npm install
```

### 2. Configure Database
RepoButler requires **PostgreSQL**. If you are on macOS:
```bash
# Install and start PostgreSQL via Homebrew
brew install postgresql@15
brew services start postgresql@15
```

Create a database named `repobutler` and set the connection string in your `.env`:
```bash
cp .env.example .env
# Edit .env and set:
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/repobutler?schema=public"
```

Synchronize the database schema and seed the mock data:
```bash
npx prisma db push
npx prisma db seed
```
This seeds deterministic mock repositories (`Acme-Web`, `Healthkinator`, `OpenCampus`, `Example-API`) representing healthy, stale, and failing configurations to support **Demo Mode**.

### 3. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to see RepoButler!

---

## Demo Mode

To preview the complete visual dashboard experience without connecting real GitHub keys:
1. Start the server.
2. Click **View Demo** on the Landing Page or navigate to [http://localhost:3000/dashboard?demo=true](http://localhost:3000/dashboard?demo=true).
3. The dashboard will load the seeded mock accounts and demonstrate failed CI builds, stale pull requests, and project memories cleanly.

---

## Developer Simulation Environment

RepoButler features a comprehensive **Developer Simulation Environment** that runs the real event processing pipelines locally without communicating with GitHub APIs.

### 1. Enable the Simulator
Add the following key to your `.env` configuration file:
```env
DEV_SIMULATOR_ENABLED=true
```
*Note: The simulator is strictly locked to local testing and is automatically disabled in production environments (`NODE_ENV === 'production'`).*

### 2. Run from the Web Control Center
1. Open [http://localhost:3000/dev/simulator](http://localhost:3000/dev/simulator).
2. Click **Seed Simulated Repos** to generate the mock developer profile and repositories.
3. Select a preset scenario (e.g. "Repeated CI Failure") to generate synthetic workflow events and observe changes on repository health.
4. Click **Generate Daily Brief** to test brief compile pipelines.
5. Navigate to [http://localhost:3000/dev/webhooks](http://localhost:3000/dev/webhooks) (or click **Inspect Webhooks**) to view captured event headers and raw payloads.
6. Click **Reset Simulation Data** to wipe all synthetic records.

### 3. Run from the CLI
We provide dedicated command line controls calling the same underlying services:
```bash
# Seed mock repositories
npm run dev:seed

# Wipe simulation records safely
npm run dev:reset

# Generate daily briefs on-demand
npm run dev:brief

# Run a scenario (e.g., repeated-ci-failure, stale-pr, busy-day)
npm run dev:simulate repeated-ci-failure
```

---

## Real GitHub App Integration

To monitor real repositories:
1. Register a new **GitHub App** in your developer settings.
2. Configure **Read-only** permissions:
   - Metadata: Read
   - Contents: Read
   - Issues: Read
   - Pull Requests: Read
   - Actions/Checks: Read
3. Set Webhook URLs to your local tunnel (e.g. using `ngrok`, `smee.io`, or `Cloudflare Tunnel`).
4. Generate a Private Key (PEM format) and copy it along with your App ID, Client ID, Client Secret, and Webhook Secret to your `.env` file.
5. Launch your tunnel proxy:
   ```bash
   # Example using smee
   smee --url https://smee.io/your-unique-channel --path /api/webhooks --port 3000
   ```
6. Open RepoButler, click **Connect GitHub**, sign in, and authorized repositories will start synchronizing automatically!

---

## Running Verification Tests
We maintain 100% mocked unit tests for the scoring rules, health calculations, and signature verification.
```bash
npm run test
```
All tests run inside a lightweight Node sandbox context.

---

## Open Source Foundation
The repository includes standard OSS configurations:
- [LICENSE](LICENSE) (MIT)
- [CONTRIBUTING.md](CONTRIBUTING.md) (Contribution rules)
- [SECURITY.md](SECURITY.md) (Reporting vulnerabilities)
- [ROADMAP.md](ROADMAP.md) (Future releases)
- [CHANGELOG.md](CHANGELOG.md) (WIP releases)
