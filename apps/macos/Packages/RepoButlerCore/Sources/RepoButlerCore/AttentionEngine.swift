import Foundation

/// Turns repository data into a prioritized, evidence-backed attention queue.
///
/// Port of `src/lib/attention/engine.ts` (rules A–F and the scoring formula).
/// Intentional differences are marked `DIFF:`.
public enum AttentionEngine {
    public static let weights = (urgency: 0.30, impact: 0.25, age: 0.20, relevance: 0.15, confidence: 0.10)

    struct BaseScores { var urgency, impact, relevance, confidence: Double }

    static func baseScores(for type: AttentionType) -> BaseScores {
        switch type {
        case .repeatedCIFailure: BaseScores(urgency: 95, impact: 90, relevance: 90, confidence: 100)
        case .failedCI:          BaseScores(urgency: 85, impact: 80, relevance: 85, confidence: 100)
        case .prAwaitingReview:  BaseScores(urgency: 80, impact: 75, relevance: 80, confidence: 100)
        case .stalePR:           BaseScores(urgency: 50, impact: 50, relevance: 60, confidence: 100)
        case .staleIssue:        BaseScores(urgency: 30, impact: 30, relevance: 50, confidence: 100)
        case .staleRepo:         BaseScores(urgency: 40, impact: 45, relevance: 50, confidence: 100)
        }
    }

    /// 0–100. Age contributes 10 points per day, capped at 100.
    static func score(type: AttentionType, ageDays: Double) -> Int {
        let b = baseScores(for: type)
        let ageScore = Double(min(100, jsRound(max(0, ageDays) * 10)))
        let w = weights
        let raw = b.urgency * w.urgency + b.impact * w.impact + ageScore * w.age
            + b.relevance * w.relevance + b.confidence * w.confidence
        return min(100, max(0, jsRound(raw)))
    }

    /// - Parameter viewerLogin: the signed-in GitHub user. Decides "your PR" vs "someone else's PR".
    ///   DIFF: the web app compared against the repo owner, which breaks for org repos.
    public static func items(for data: RepoData, viewerLogin: String,
                             settings: MonitorSettings = .default, now: Date) -> [AttentionItem] {
        let repo = data.repo
        var out: [AttentionItem] = []

        func add(_ type: AttentionType, _ severity: Severity, key: String, title: String, description: String,
                 evidence: String, action: String, eventDate: Date, url: URL?) {
            out.append(AttentionItem(
                id: "\(repo.fullName)#\(key)", repoFullName: repo.fullName, type: type, severity: severity,
                title: title, description: description, evidence: evidence, recommendedAction: action,
                eventDate: eventDate, url: url,
                score: score(type: type, ageDays: Time.days(from: eventDate, to: now))))
        }

        // Rules B & F — CI failures, grouped by workflow name (runs are newest first).
        var runsByName: [String: [WorkflowRunInfo]] = [:]
        var nameOrder: [String] = []
        for run in data.workflowRuns {
            if runsByName[run.name] == nil { nameOrder.append(run.name) }
            runsByName[run.name, default: []].append(run)
        }
        for name in nameOrder {
            let runs = runsByName[name] ?? []
            guard let latest = runs.first(where: { $0.outcome == .passed || $0.outcome == .failed }),
                  latest.outcome == .failed else { continue }

            var consecutive = 0
            var failureDates: [Date] = []
            for run in runs {
                if run.outcome == .passed { break }
                if run.outcome == .failed { consecutive += 1; failureDates.append(run.createdAt) }
            }
            let dayAgo = now.addingTimeInterval(-Time.day)
            let last24h = failureDates.filter { $0 > dayAgo }.count
            let when = Format.dateTime(latest.createdAt)

            if consecutive >= 3 || last24h >= 2 {
                add(.repeatedCIFailure, .critical, key: "WORKFLOW_\(name)",
                    title: "CI failing repeatedly on \(repo.name)",
                    description: "Workflow \"\(name)\" has failed \(consecutive) times consecutively (\(last24h) in the last 24h) on \(repo.defaultBranch).",
                    evidence: "\(plural(consecutive, "failure")) since the last green run. Latest at \(when).",
                    action: "Open the failing run and fix the build.",
                    eventDate: latest.createdAt, url: latest.htmlURL)
            } else {
                add(.failedCI, .high, key: "WORKFLOW_\(name)",
                    title: "\(repo.name) CI failed",
                    description: "The latest run of workflow \"\(name)\" failed on \(repo.defaultBranch).",
                    evidence: "Run concluded \"\(latest.conclusion ?? "failure")\" at \(when).",
                    action: "Open the failing run and fix the build.",
                    eventDate: latest.createdAt, url: latest.htmlURL)
            }
        }

        // Rules A & D — PRs.
        for pr in data.openPullRequests {
            let age = Time.days(from: pr.updatedAt, to: now)
            let isMine = pr.authorLogin.caseInsensitiveCompare(viewerLogin) == .orderedSame
            if !isMine && !pr.isDraft {
                if age >= Double(settings.prReviewThresholdDays) {
                    add(.prAwaitingReview, .high, key: "PR_\(pr.number)",
                        title: "PR #\(pr.number) awaiting review",
                        description: "PR #\(pr.number) \"\(pr.title)\" by @\(pr.authorLogin) has been waiting \(plural(jsRound(age), "day")).",
                        evidence: "Opened \(Format.date(pr.createdAt)). Last activity \(Format.date(pr.updatedAt)).",
                        action: "Review PR #\(pr.number).",
                        eventDate: pr.updatedAt, url: pr.htmlURL)
                }
            } else if isMine {
                if age >= Double(settings.stalePRThresholdDays) {
                    add(.stalePR, .medium, key: "PR_\(pr.number)",
                        title: "Stale PR #\(pr.number)",
                        description: "Your PR #\(pr.number) \"\(pr.title)\" has been inactive for \(plural(jsRound(age), "day")).",
                        evidence: "Last activity \(Format.date(pr.updatedAt)).",
                        action: "Merge, update, or close PR #\(pr.number).",
                        eventDate: pr.updatedAt, url: pr.htmlURL)
                }
            }
        }

        // Rule E — stale issues.
        for issue in data.openIssues {
            let age = Time.days(from: issue.updatedAt, to: now)
            if age >= Double(settings.staleIssueThresholdDays) {
                add(.staleIssue, .low, key: "ISSUE_\(issue.number)",
                    title: "Stale issue #\(issue.number)",
                    description: "Issue #\(issue.number) \"\(issue.title)\" has had no updates for \(plural(jsRound(age), "day")).",
                    evidence: "Last activity \(Format.date(issue.updatedAt)).",
                    action: "Reply to or close issue #\(issue.number).",
                    eventDate: issue.updatedAt, url: issue.htmlURL)
            }
        }

        // Rule C — stale repository (latest meaningful commit, merge, close or release).
        let activityDates = [
            data.recentCommits.first(where: \.isMeaningful)?.date,
            data.lastMergedPullRequestAt,
            data.lastClosedIssueAt,
            data.latestRelease?.publishedAt,
        ].compactMap { $0 }
        if !repo.isArchived, let latest = activityDates.max() {
            let days = Time.days(from: latest, to: now)
            if days >= Double(settings.staleRepoThresholdDays) {
                add(.staleRepo, .medium, key: "STALE_REPO",
                    title: "\(repo.name) inactive for \(plural(jsRound(days), "day"))",
                    description: "No meaningful commits, merges, closed issues or releases in \(repo.name) for \(plural(jsRound(days), "day")).",
                    evidence: "Last meaningful activity \(Format.date(latest)).",
                    action: "Decide whether to resume, hand off, or archive the project.",
                    eventDate: latest, url: repo.htmlURL)
            }
        }

        return out.sorted { $0.score != $1.score ? $0.score > $1.score : $0.severity > $1.severity }
    }
}

enum Format {
    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = format
        return f
    }
    private static let dateFormatter = formatter("d MMM yyyy")
    private static let dateTimeFormatter = formatter("d MMM, HH:mm")
    private static let lock = NSLock()

    static func date(_ d: Date) -> String { lock.lock(); defer { lock.unlock() }; return dateFormatter.string(from: d) }
    static func dateTime(_ d: Date) -> String { lock.lock(); defer { lock.unlock() }; return dateTimeFormatter.string(from: d) }
}
