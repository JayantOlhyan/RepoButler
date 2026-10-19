import Foundation

/// GitHub REST payloads → app models. Kept separate from the client so it can be
/// tested against recorded JSON without a network.
enum GitHubMapping {
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    struct UserDTO: Decodable { let login: String }
    struct OwnerDTO: Decodable { let login: String }

    struct RepoDTO: Decodable {
        let id: Int
        let name: String
        let fullName: String
        let owner: OwnerDTO
        let description: String?
        let htmlUrl: URL
        let `private`: Bool
        let archived: Bool?
        let fork: Bool?
        let defaultBranch: String?
        let pushedAt: Date?

        var model: RepoInfo {
            RepoInfo(id: id, owner: owner.login, name: name, fullName: fullName, description: description,
                     htmlURL: htmlUrl, isPrivate: `private`, isArchived: archived ?? false, isFork: fork ?? false,
                     defaultBranch: defaultBranch ?? "main", pushedAt: pushedAt)
        }
    }

    struct PullDTO: Decodable {
        let number: Int
        let title: String
        let user: UserDTO?
        let draft: Bool?
        let createdAt: Date
        let updatedAt: Date
        let htmlUrl: URL
    }

    struct PullRefDTO: Decodable { let mergedAt: Date? }

    /// The issues endpoint also returns PRs; those carry a `pull_request` object.
    struct IssueDTO: Decodable {
        let number: Int
        let title: String
        let user: UserDTO?
        let createdAt: Date
        let updatedAt: Date
        let closedAt: Date?
        let htmlUrl: URL
        let pullRequest: PullRefDTO?
    }

    struct RunsDTO: Decodable { let workflowRuns: [RunDTO] }
    struct RunDTO: Decodable {
        let id: Int
        let name: String?
        let status: String?
        let conclusion: String?
        let headBranch: String?
        let createdAt: Date
        let htmlUrl: URL
    }

    struct ReleaseDTO: Decodable {
        let tagName: String
        let publishedAt: Date?
        let htmlUrl: URL
    }

    struct CommitDTO: Decodable {
        struct Inner: Decodable {
            struct Signature: Decodable { let name: String?; let date: Date? }
            let message: String
            let author: Signature?
            let committer: Signature?
        }
        let sha: String
        let commit: Inner
        let author: UserDTO?
    }

    static func repoData(repo: RepoInfo, pulls: [PullDTO], openIssues: [IssueDTO], closedIssues: [IssueDTO],
                         runs: [RunDTO], release: ReleaseDTO?, commits: [CommitDTO]) -> RepoData {
        let prs = pulls.map {
            PullRequestInfo(number: $0.number, title: $0.title, authorLogin: $0.user?.login ?? "ghost",
                            isDraft: $0.draft ?? false, createdAt: $0.createdAt, updatedAt: $0.updatedAt,
                            htmlURL: $0.htmlUrl)
        }
        let issues = openIssues.filter { $0.pullRequest == nil }.map {
            IssueInfo(number: $0.number, title: $0.title, authorLogin: $0.user?.login ?? "ghost",
                      createdAt: $0.createdAt, updatedAt: $0.updatedAt, htmlURL: $0.htmlUrl)
        }
        let lastMerged = closedIssues.compactMap { $0.pullRequest?.mergedAt }.max()
        let lastClosedIssue = closedIssues.filter { $0.pullRequest == nil }.compactMap(\.closedAt).max()
        let workflowRuns = runs
            .map { WorkflowRunInfo(id: $0.id, name: $0.name ?? "Workflow", status: $0.status ?? "unknown",
                                   conclusion: $0.conclusion, branch: $0.headBranch ?? repo.defaultBranch,
                                   createdAt: $0.createdAt, htmlURL: $0.htmlUrl) }
            .sorted { $0.createdAt > $1.createdAt }
        let latestRelease = release.flatMap { r in
            r.publishedAt.map { ReleaseInfo(tagName: r.tagName, publishedAt: $0, htmlURL: r.htmlUrl) }
        }
        let commitInfos: [CommitInfo] = commits.compactMap { c in
            guard let date = c.commit.author?.date ?? c.commit.committer?.date else { return nil }
            return CommitInfo(sha: c.sha, message: c.commit.message,
                              authorLogin: c.author?.login ?? c.commit.author?.name ?? "unknown", date: date)
        }.sorted { $0.date > $1.date }

        return RepoData(repo: repo, openPullRequests: prs, openIssues: issues, workflowRuns: workflowRuns,
                        latestRelease: latestRelease, recentCommits: commitInfos,
                        lastMergedPullRequestAt: lastMerged, lastClosedIssueAt: lastClosedIssue)
    }

    struct InstallationDTO: Decodable {
        let id: Int
    }

    struct InstallationsResponseDTO: Decodable {
        let totalCount: Int
        let installations: [InstallationDTO]
    }

    struct InstallationReposResponseDTO: Decodable {
        let totalCount: Int
        let repositories: [RepoDTO]
    }
}

