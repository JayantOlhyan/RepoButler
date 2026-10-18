import Foundation
@testable import RepoButlerCore

let now = Date(timeIntervalSince1970: 1_790_000_000) // fixed clock
func daysAgo(_ d: Double) -> Date { now.addingTimeInterval(-d * 86_400) }
func hoursAgo(_ h: Double) -> Date { now.addingTimeInterval(-h * 3_600) }
let gh = URL(string: "https://github.com/me/app")!

func makeRepo(description: String? = "A repo", pushedAt: Date? = daysAgo(1), archived: Bool = false) -> RepoInfo {
    RepoInfo(id: 1, owner: "me", name: "app", fullName: "me/app", description: description, htmlURL: gh,
             isPrivate: false, isArchived: archived, isFork: false, defaultBranch: "main", pushedAt: pushedAt)
}

func pr(_ n: Int, by author: String = "someone", updated: Date, draft: Bool = false) -> PullRequestInfo {
    PullRequestInfo(number: n, title: "PR \(n)", authorLogin: author, isDraft: draft,
                    createdAt: updated.addingTimeInterval(-86_400), updatedAt: updated, htmlURL: gh)
}

func issue(_ n: Int, updated: Date) -> IssueInfo {
    IssueInfo(number: n, title: "Issue \(n)", authorLogin: "someone", createdAt: updated, updatedAt: updated, htmlURL: gh)
}

func wfRun(_ id: Int, _ conclusion: String?, at date: Date, name: String = "CI", status: String = "completed") -> WorkflowRunInfo {
    WorkflowRunInfo(id: id, name: name, status: status, conclusion: conclusion, branch: "main", createdAt: date, htmlURL: gh)
}

func commit(_ message: String = "feat: thing", at date: Date, author: String = "me") -> CommitInfo {
    CommitInfo(sha: UUID().uuidString, message: message, authorLogin: author, date: date)
}

/// A repo in perfect health: green CI, 5 recent commits, recent release, description.
func healthyData() -> RepoData {
    RepoData(repo: makeRepo(), openPullRequests: [], openIssues: [],
             workflowRuns: [wfRun(1, "success", at: hoursAgo(2))],
             latestRelease: ReleaseInfo(tagName: "v1", publishedAt: daysAgo(10), htmlURL: gh),
             recentCommits: (0..<5).map { commit(at: daysAgo(Double($0))) },
             lastMergedPullRequestAt: nil, lastClosedIssueAt: nil)
}
