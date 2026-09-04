# RepoButler

> Your GitHub repositories have a butler now.

## Overview
RepoButler is an AI-enhanced personal developer assistant that monitors GitHub repositories, aggregates cross-repository activity, computes actionable health metrics, and surfaces priorities that require developer attention (such as failing pipelines, stale pull requests, and neglected projects). It delivers deterministic health scores and generates concise daily briefings.

## Why This Project Exists
Developers managing multiple repositories often struggle with context switching. Checking 20 repositories one by one for CI failures, stale pull requests, or unaddressed issues is inefficient. RepoButler solves this by providing a unified attention queue, letting developers focus only on what genuinely requires their response.

## Target Users
- Open source maintainers managing multiple projects.
- Solo developers or indie hackers balancing several side projects.
- Small engineering teams wanting a centralized repository health overview without enterprise-scale noise.

## Features

### Implemented
- **Attention Queue**: Heuristic rules scan for open PRs awaiting review, stale issues, and consecutive workflow build failures, surfacing them as `AttentionItems`.
- **Actionable Health Score**: Deterministic 0–100 health scoring based on repository activity, CI stability, PR/Issue resolution times, and documentation. Includes deductions and recommended actions.
- **Daily Briefing**: A chronological summary of repository activity across the developer's portfolio, delivered as a clean overview.
- **Weekly Reports**: Weekly summarized reports of repository activity and current attention items.
- **AI Summarization (Optional)**: Integration with Gemini and OpenAI to generate natural-language daily and weekly briefs, with a deterministic template fallback.
- **Developer Simulation Environment**: A local, deterministic testing environment to simulate GitHub events (e.g., "Repeated CI Failure") without hitting live GitHub APIs.
- **Webhook Integration**: Real-time event synchronization via GitHub App webhooks.

### Planned / Not Yet Implemented
- Slack and Discord webhook integrations.
- RepoButler CLI tool.
- Multi-account organization permissions.
- Hosted SaaS features (Stripe integration, hosted cron).
- Richer project memories grounded in codebase summaries.
- Email delivery for daily briefs (configuration placeholders exist, but no delivery logic is currently active).

## Architecture

### High-Level Architecture
```mermaid
flowchart TD
    GitHub[GitHub App Webhooks & Octokit API] --> |Real-time Events & Historical Sync| NextAPI[Next.js API Routes]
    NextAPI --> WebhookVerify[Webhook Signature Verification]
    WebhookVerify --> AttentionEngine[Attention Engine & Health Rules]
    AttentionEngine --> DB[(SQLite / Prisma)]
    DB --> Dashboard[Next.js App Router Dashboard]
    DB --> Cron[Cron Jobs]
    Cron --> AIService[AI Summarization Service]
    AIService --> |Gemini / OpenAI| DailyBrief[Daily Brief Generation]
```

### Request Lifecycle (GitHub Webhook)
```text
GitHub Webhook (POST /api/webhooks)
 ↓
Signature Verification (HMAC SHA-256)
 ↓
Event Parsing (Push, PR, Issue, Workflow)
 ↓
Prisma DB Update (ActivityEvent, Commit, PR, etc.)
 ↓
Trigger Attention Engine Evaluation
 ↓
Update Repository Health Snapshot
```

## Tech Stack
- **Frontend**: Next.js 16.3 (App Router), React 19, Tailwind CSS v4, Lucide React.
- **Backend**: Next.js API Routes (Node.js runtime).
- **Database**: SQLite (via Prisma ORM 6.19).
- **Authentication**: NextAuth.js (v4) with GitHub OAuth.
- **External Integrations**: `@octokit/rest` for GitHub API, Google Gemini / OpenAI APIs for optional text summarization.
- **Testing**: Vitest 4.1.

## Repository Structure
```text
RepoButler/
├── prisma/                 # Database schema and seed scripts
├── scripts/                # Developer simulation & seed execution scripts
├── src/
│   ├── app/                # Next.js App Router (Frontend pages & API routes)
│   │   ├── api/            # API endpoints (Auth, Cron, Webhooks, GitHub setup)
│   │   └── dashboard/      # Main authenticated user interface
│   ├── components/         # Reusable React UI components
│   └── lib/                # Core business logic
│       ├── ai/             # Gemini/OpenAI integration and deterministic fallbacks
│       ├── attention/      # Heuristic rules for surfacing priorities
│       ├── health/         # Repository health scoring algorithms
│       ├── security/       # Webhook signature validation (HMAC SHA-256)
│       ├── simulator/      # Mock event generation for local testing
│       └── webhooks/       # GitHub event parsers and handlers
├── tests/                  # Unit tests for scoring rules and calculations
└── ...
```

## Database (Prisma / SQLite)

RepoButler relies on a relational SQLite schema to track state.

```mermaid
erDiagram
    USER ||--o{ GITHUB_INSTALLATION : owns
    USER ||--o{ DAILY_BRIEF : receives
    GITHUB_INSTALLATION ||--o{ REPOSITORY : tracks
    REPOSITORY ||--o{ ACTIVITY_EVENT : logs
    REPOSITORY ||--o{ ATTENTION_ITEM : generates
    REPOSITORY ||--o{ HEALTH_SNAPSHOT : records
    REPOSITORY ||--|| REPOSITORY_SETTINGS : configures
    ATTENTION_ITEM ||--o{ DAILY_BRIEF_ITEM : referenced_by
```
*Key Models:*
- **Repository**: Core entity tracking GitHub repository metadata.
- **AttentionItem**: Represents a surfaced priority (e.g., `FAILED_CI`, `STALE_PR`). Has severity and status.
- **HealthSnapshot**: Point-in-time calculation of repository health metrics (0-100).
- **ActivityEvent**: Raw or parsed events from GitHub webhooks.
- **DailyBrief**: Generated summaries for users.

## API Documentation

### Important Endpoints
- `POST /api/webhooks`: Ingests GitHub webhook events. Requires `x-hub-signature-256` header matching the `GITHUB_WEBHOOK_SECRET`.
- `GET /api/github/install`: Redirects to the GitHub App installation flow.
- `GET /api/cron/daily-brief`: Triggered via cron. Generates Daily Briefs for all users based on recent `AttentionItem`s and repository changes. Requires `Authorization: Bearer CRON_SECRET`.
- `GET /api/cron/weekly-report`: Triggered via cron. Generates weekly summaries. Requires `Authorization: Bearer CRON_SECRET`.

## Authentication & Security

- **Authentication**: Managed via NextAuth.js. Users authenticate exclusively via GitHub OAuth.
- **Authorization**: Route protection implemented in Next.js layouts (`getServerSession`). Users can only access repositories linked to their GitHub ID.
- **Webhook Security**: All incoming GitHub webhooks are verified using HMAC SHA-256 signatures (`crypto.timingSafeEqual`) to prevent spoofing.
- **Secrets Management**: Handled via `.env`.

## Environment Variables

| Variable | Required | Purpose | Example |
| -------- | -------- | ------- | ------- |
| `DATABASE_URL` | Yes | SQLite connection string | `file:./dev.db` |
| `GITHUB_APP_ID` | Yes | GitHub App ID | `123456` |
| `GITHUB_APP_PRIVATE_KEY` | Yes | RSA private key for GitHub App (PEM format) | `-----BEGIN RSA PRIVATE KEY-----...` |
| `GITHUB_WEBHOOK_SECRET` | Yes | Secret to verify webhook signatures | `my_secure_webhook_secret` |
| `NEXTAUTH_SECRET` | Yes | Secret for session encryption | `random_32_char_string` |
| `NEXTAUTH_URL` | Yes | Canonical URL of the deployment | `http://localhost:3000` |
| `CRON_SECRET` | Yes | Protection secret for cron API routes | `my_cron_secret` |
| `AI_PROVIDER` | No | Enables AI summaries (`gemini`, `openai`, `none`) | `gemini` |
| `AI_API_KEY` | No | API key for the chosen AI provider | `AIzaSy...` |
| `DEV_SIMULATOR_ENABLED`| No | Enables local mock simulation endpoints | `true` |

*(See `.env.example` for the full list.)*

## Installation & Local Development

### Prerequisites
- Node.js (v20+ recommended)
- npm package manager

### 1. Clone & Install
```bash
git clone <repository-url>
cd RepoButler
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
*(Update the variables in `.env` based on the table above. If running in Demo Mode, minimal configuration is required.)*

### 3. Initialize Database
RepoButler uses SQLite locally.
```bash
npx prisma db push
npx prisma generate
```

### 4. Start the Application
```bash
npm run dev
```

## Demo Mode & Simulation

RepoButler includes a powerful simulation environment for testing without connecting real GitHub APIs.

### Running Demo Mode
1. Ensure `DEV_SIMULATOR_ENABLED=true` in `.env`.
2. Seed the mock database:
   ```bash
   npm run dev:seed
   ```
3. Start the server (`npm run dev`) and visit `http://localhost:3000/dashboard?demo=true`.

### Simulator CLI Commands
- `npm run dev:seed`: Seeds deterministic mock repositories.
- `npm run dev:reset`: Wipes simulation data.
- `npm run dev:brief`: Generates a mock daily brief on-demand.
- `npm run dev:simulate <scenario>`: Injects mock events (e.g., `npm run dev:simulate repeated-ci-failure`).

## Testing
RepoButler uses Vitest for testing its core heuristic rules and health calculations.
```bash
npm run test
```

## Known Limitations
- **SQLite Concurrency**: The current implementation uses SQLite, which is excellent for single-tenant or local usage, but will face write-concurrency limitations if deployed for a large number of concurrent users.
- **AI Fallbacks**: AI summarization is strictly dependent on the provided prompt structure; if the API limits are reached, the system falls back to a deterministic string template, which is functional but less personalized.
- **No Email Delivery**: The `EMAIL_PROVIDER` variables exist in configuration, but actual email delivery (e.g. Resend) is not yet fully implemented across the notification engine.

## Architectural Trade-offs
- **SQLite vs PostgreSQL**: The project currently relies on SQLite (as verified in Prisma schema) to ensure zero-configuration local setups and easy Demo Mode operation. A migration to PostgreSQL would be required for a multi-tenant SaaS deployment.
- **Webhooks vs Polling**: The architecture relies on real-time webhooks for updates, preferring immediate state changes over Octokit polling. This saves API rate limits but requires a publicly accessible webhook endpoint (or tunnel like `smee.io`) during local development of real GitHub App integrations.

## Contributing
1. Fork and clone the repository.
2. Create a feature branch.
3. Make your changes and run `npm run lint` and `npm run test`.
4. Open a Pull Request detailing your changes.

## License
MIT License.
