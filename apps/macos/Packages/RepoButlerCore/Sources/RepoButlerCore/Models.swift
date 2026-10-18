import Foundation

// MARK: - Raw repository data (as fetched from GitHub)

public struct RepoInfo: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var owner: String
    public var name: String
    public var fullName: String
    public var description: String?
    public var htmlURL: URL
    public var isPrivate: Bool
    public var isArchived: Bool
    public var isFork: Bool
    public var defaultBranch: String
    /// Last push to any branch. Used instead of GitHub's `updated_at`,
    /// which also changes on stars/settings edits and would overstate activity.
    public var pushedAt: Date?
}

public struct PullRequestInfo: Codable, Hashable, Sendable {
    public var number: Int
    public var title: String
    public var authorLogin: String
    public var isDraft: Bool
    public var createdAt: Date
    public var updatedAt: Date
    public var htmlURL: URL
}

public struct IssueInfo: Codable, Hashable, Sendable {
    public var number: Int
    public var title: String
    public var authorLogin: String
    public var createdAt: Date
    public var updatedAt: Date
    public var htmlURL: URL
}

public struct WorkflowRunInfo: Codable, Hashable, Sendable {
    public var id: Int
    public var name: String
    public var status: String
    public var conclusion: String?
    public var branch: String
    public var createdAt: Date
    public var htmlURL: URL

    public enum Outcome: Sendable { case passed, failed, ignored, pending }

    /// `cancelled`, `skipped` and `neutral` are ignored rather than counted as
    /// failures: cancelled runs are usually superseded by a newer push and would
    /// otherwise create false CI alerts.
    public var outcome: Outcome {
        guard status == "completed", let conclusion else { return .pending }
        switch conclusion {
        case "success": return .passed
        case "cancelled", "skipped", "neutral", "stale": return .ignored
        default: return .failed // failure, timed_out, startup_failure, action_required
        }
    }
}

public struct ReleaseInfo: Codable, Hashable, Sendable {
    public var tagName: String
    public var publishedAt: Date
    public var htmlURL: URL
}

public struct CommitInfo: Codable, Hashable, Sendable {
    public var sha: String
    public var message: String
    public var authorLogin: String
    public var date: Date

    /// Same rule as the web app: merges, chores/docs/style and bots are not "meaningful".
    public var isMeaningful: Bool {
        let msg = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let isMerge = msg.hasPrefix("Merge ") || msg.contains("Merge pull request")
        let isChore = msg.hasPrefix("chore:") || msg.hasPrefix("docs:") || msg.hasPrefix("style:")
        let isBot = authorLogin.contains("dependabot") || authorLogin.contains("[bot]")
        return !isMerge && !isChore && !isBot && !msg.isEmpty
    }
}

/// Everything the rules need for one repository.
public struct RepoData: Codable, Sendable {
    public var repo: RepoInfo
    public var openPullRequests: [PullRequestInfo]
    public var openIssues: [IssueInfo]
    /// Newest first, default branch only.
    public var workflowRuns: [WorkflowRunInfo]
    public var latestRelease: ReleaseInfo?
    /// Newest first, default branch, up to 30.
    public var recentCommits: [CommitInfo]
    public var lastMergedPullRequestAt: Date?
    public var lastClosedIssueAt: Date?
}

// MARK: - Analysis output

public enum Severity: String, Codable, Sendable, Comparable, CaseIterable {
    case low = "LOW", medium = "MEDIUM", high = "HIGH", critical = "CRITICAL"

    var rank: Int {
        switch self { case .low: 0; case .medium: 1; case .high: 2; case .critical: 3 }
    }
    public static func < (a: Severity, b: Severity) -> Bool { a.rank < b.rank }
}

public enum AttentionType: String, Codable, Sendable {
    case prAwaitingReview = "PR_AWAITING_REVIEW"
    case failedCI = "FAILED_CI"
    case staleRepo = "STALE_REPO"
    case stalePR = "STALE_PR"
    case staleIssue = "STALE_ISSUE"
    case repeatedCIFailure = "REPEATED_CI_FAILURE"
}

public struct AttentionItem: Codable, Hashable, Sendable, Identifiable {
    /// Stable identity: `<repo full name>#<unique key>`, e.g. `jayant/app#PR_84`.
    public var id: String
    public var repoFullName: String
    public var type: AttentionType
    public var severity: Severity
    public var title: String
    public var description: String
    public var evidence: String
    public var recommendedAction: String
    /// The GitHub event this item is anchored to (failure time, last PR activity…).
    public var eventDate: Date
    /// Link to the evidence on GitHub.
    public var url: URL?
    /// 0–100 priority (urgency, impact, age, relevance, confidence).
    public var score: Int
}

public struct HealthBreakdown: Codable, Hashable, Sendable {
    public var score: Int
    public var ciScore: Int
    public var prScore: Int
    public var issueScore: Int
    public var activityScore: Int
    public var maintenanceScore: Int
    public var documentationScore: Int
    public var releaseScore: Int
    public var reasons: [String]
    public var recommendations: [String]
}

public struct RepoReport: Codable, Sendable, Identifiable {
    public var id: Int { repo.id }
    public var repo: RepoInfo
    public var health: HealthBreakdown
    public var items: [AttentionItem]
    public var syncedAt: Date
}

public struct DashboardSnapshot: Codable, Sendable {
    public var generatedAt: Date
    public var viewerLogin: String
    public var reports: [RepoReport]
    /// Repos that failed to sync this round: full name → error message.
    /// Their previous report (if any) is kept in `reports`.
    public var failures: [String: String]

    public init(generatedAt: Date, viewerLogin: String, reports: [RepoReport], failures: [String: String]) {
        self.generatedAt = generatedAt
        self.viewerLogin = viewerLogin
        self.reports = reports
        self.failures = failures
    }

    /// Plain average of repo health scores; nil when nothing is tracked.
    public var overallScore: Int? {
        guard !reports.isEmpty else { return nil }
        let total = reports.reduce(0) { $0 + $1.health.score }
        return Int((Double(total) / Double(reports.count)).rounded())
    }

    /// All items across repos, highest priority first.
    public var allItems: [AttentionItem] {
        reports.flatMap(\.items).sorted {
            $0.score != $1.score ? $0.score > $1.score : $0.severity > $1.severity
        }
    }
}

public struct MonitorSettings: Codable, Hashable, Sendable {
    public var staleRepoThresholdDays: Int
    public var prReviewThresholdDays: Int
    public var stalePRThresholdDays: Int
    public var staleIssueThresholdDays: Int

    public init(staleRepoThresholdDays: Int = 14, prReviewThresholdDays: Int = 2,
                stalePRThresholdDays: Int = 7, staleIssueThresholdDays: Int = 10) {
        self.staleRepoThresholdDays = staleRepoThresholdDays
        self.prReviewThresholdDays = prReviewThresholdDays
        self.stalePRThresholdDays = stalePRThresholdDays
        self.staleIssueThresholdDays = staleIssueThresholdDays
    }

    public static let `default` = MonitorSettings()
}

// MARK: - Helpers

enum Time {
    static let day: TimeInterval = 24 * 60 * 60
    static func days(from date: Date, to now: Date) -> Double { now.timeIntervalSince(date) / day }
}

func plural(_ n: Int, _ singular: String, _ pluralForm: String? = nil) -> String {
    "\(n) \(n == 1 ? singular : (pluralForm ?? singular + "s"))"
}

/// JS `Math.round` for non-negative values (half rounds up).
func jsRound(_ x: Double) -> Int { Int((x + 0.5).rounded(.down)) }
