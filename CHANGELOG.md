# Changelog

All notable changes to RepoButler will be documented in this file.

## [0.1.0] - 2026-08-16
### Added
- Next.js 16 bootstrap with TypeScript and Tailwind CSS configs.
- Prisma PostgreSQL database schema (User, Repository, Issues, PRs, WorkflowRuns, HealthSnapshots, AttentionItems, DailyBriefs, ProjectMemory).
- OAuth session handling and installation callback sync tracking.
- Client factory generating JWT tokens for GitHub App authentications.
- Attention scoring rule calculations and deduplications.
- Actions pipeline repeated build failure detection.
- Chronological timeline activity logs.
- Interactive settings form for monitoring triggers and data deletion.
- Demo mode reading seeded dummy data.
- Vitest unit tests verifying rules and signature verifications.
