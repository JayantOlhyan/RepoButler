import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import RepoButlerCore

/// Serves canned responses keyed by URL path (+ "?state=closed" style hints) and records requests.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply { var status: Int; var body: String; var headers: [String: String] = [:] }
    private let lock = NSLock()
    private var routes: [(match: (URLRequest) -> Bool, reply: (URLRequest) -> Reply)] = []
    private(set) var requests: [URLRequest] = []

    func on(_ path: String, query: String? = nil, _ reply: @escaping (URLRequest) -> Reply) {
        routes.append(({ req in
            req.url!.path == path && (query == nil || (req.url!.query ?? "").contains(query!))
        }, reply))
    }
    func on(_ path: String, query: String? = nil, status: Int = 200, body: String, headers: [String: String] = [:]) {
        on(path, query: query) { _ in Reply(status: status, body: body, headers: headers) }
    }

    private func record(_ request: URLRequest) -> [(match: (URLRequest) -> Bool, reply: (URLRequest) -> Reply)] {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        return routes
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let routes = record(request)
        guard let route = routes.last(where: { $0.match(request) }) else {
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!)
        }
        let r = route.reply(request)
        return (Data(r.body.utf8),
                HTTPURLResponse(url: request.url!, statusCode: r.status, httpVersion: nil, headerFields: r.headers)!)
    }
}

let repoJSON = """
{"id": 42, "name": "app", "full_name": "me/app", "owner": {"login": "me"}, "description": null,
 "html_url": "https://github.com/me/app", "private": true, "archived": false, "fork": false,
 "default_branch": "trunk", "pushed_at": "2026-10-01T10:00:00Z"}
"""

final class GitHubClientTests: XCTestCase {
    func testETagRevalidationReusesCachedBody() async throws {
        let t = FakeTransport()
        t.on("/user") { req in
            if req.value(forHTTPHeaderField: "If-None-Match") == "\"abc\"" {
                return .init(status: 304, body: "")
            }
            return .init(status: 200, body: #"{"login":"me"}"#, headers: ["ETag": "\"abc\""])
        }
        let client = GitHubClient(token: "t", transport: t)
        let first = try await client.viewerLogin()
        let second = try await client.viewerLogin()
        XCTAssertEqual(first, "me")
        XCTAssertEqual(second, "me")
        XCTAssertEqual(t.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "\"abc\"")
        XCTAssertEqual(t.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer t")
    }

    func testUnauthorizedAndRateLimit() async {
        let t = FakeTransport()
        t.on("/user", status: 401, body: "{}")
        do { _ = try await GitHubClient(token: "bad", transport: t).viewerLogin(); XCTFail() }
        catch { XCTAssertEqual(error as? GitHubError, .unauthorized) }

        let t2 = FakeTransport()
        t2.on("/user", status: 403, body: "{}", headers: ["x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000"])
        do { _ = try await GitHubClient(token: "t", transport: t2).viewerLogin(); XCTFail() }
        catch { XCTAssertEqual(error as? GitHubError, .rateLimited(resetAt: Date(timeIntervalSince1970: 1_790_000_000))) }
    }

    func testFetchRepoDataMapsEverything() async throws {
        let t = FakeTransport()
        t.on("/repos/me/app", body: repoJSON)
        t.on("/repos/me/app/pulls", body: """
            [{"number": 7, "title": "Add x", "user": {"login": "friend"}, "draft": false,
              "created_at": "2026-09-01T00:00:00Z", "updated_at": "2026-09-02T00:00:00Z",
              "html_url": "https://github.com/me/app/pull/7"}]
            """)
        t.on("/repos/me/app/issues", query: "state=open", body: """
            [{"number": 3, "title": "Bug", "user": {"login": "x"}, "created_at": "2026-09-01T00:00:00Z",
              "updated_at": "2026-09-01T00:00:00Z", "closed_at": null, "html_url": "https://github.com/me/app/issues/3"},
             {"number": 7, "title": "Add x", "user": null, "created_at": "2026-09-01T00:00:00Z",
              "updated_at": "2026-09-02T00:00:00Z", "html_url": "https://github.com/me/app/pull/7",
              "pull_request": {"merged_at": null}}]
            """)
        t.on("/repos/me/app/issues", query: "state=closed", body: """
            [{"number": 5, "title": "Merged", "user": {"login": "me"}, "created_at": "2026-09-01T00:00:00Z",
              "updated_at": "2026-09-10T00:00:00Z", "closed_at": "2026-09-10T00:00:00Z",
              "html_url": "https://github.com/me/app/pull/5", "pull_request": {"merged_at": "2026-09-10T00:00:00Z"}},
             {"number": 4, "title": "Fixed", "user": {"login": "me"}, "created_at": "2026-09-01T00:00:00Z",
              "updated_at": "2026-09-08T00:00:00Z", "closed_at": "2026-09-08T00:00:00Z",
              "html_url": "https://github.com/me/app/issues/4"}]
            """)
        t.on("/repos/me/app/actions/runs", body: """
            {"total_count": 2, "workflow_runs": [
              {"id": 1, "name": "CI", "status": "completed", "conclusion": "success", "head_branch": "trunk",
               "created_at": "2026-09-01T00:00:00Z", "html_url": "https://github.com/me/app/actions/runs/1"},
              {"id": 2, "name": "CI", "status": "completed", "conclusion": "failure", "head_branch": "trunk",
               "created_at": "2026-09-03T00:00:00Z", "html_url": "https://github.com/me/app/actions/runs/2"}]}
            """)
        t.on("/repos/me/app/releases/latest", status: 404, body: #"{"message":"Not Found"}"#)
        t.on("/repos/me/app/commits", body: """
            [{"sha": "abc", "commit": {"message": "feat: x", "author": {"name": "Me", "date": "2026-09-05T00:00:00Z"}},
              "author": null}]
            """)

        let data = try await GitHubClient(token: "t", transport: t).fetchRepoData(fullName: "me/app")
        XCTAssertEqual(data.repo.defaultBranch, "trunk")
        XCTAssertTrue(data.repo.isPrivate)
        XCTAssertEqual(data.openPullRequests.map(\.authorLogin), ["friend"])
        XCTAssertEqual(data.openIssues.map(\.number), [3], "PRs must be filtered out of issues")
        XCTAssertEqual(data.workflowRuns.map(\.id), [2, 1], "runs sorted newest first")
        XCTAssertNil(data.latestRelease)
        XCTAssertEqual(data.recentCommits.first?.authorLogin, "Me")
        XCTAssertEqual(data.lastMergedPullRequestAt, ISO8601DateFormatter().date(from: "2026-09-10T00:00:00Z"))
        XCTAssertEqual(data.lastClosedIssueAt, ISO8601DateFormatter().date(from: "2026-09-08T00:00:00Z"))

        let runsRequest = t.requests.first { $0.url!.path.hasSuffix("/actions/runs") }
        XCTAssertTrue(runsRequest?.url?.query?.contains("branch=trunk") ?? false, "runs limited to default branch")
    }

    func testEmptyRepoAndDisabledActionsAreNotErrors() async throws {
        let t = FakeTransport()
        t.on("/repos/me/app", body: repoJSON)
        t.on("/repos/me/app/pulls", body: "[]")
        t.on("/repos/me/app/issues", body: "[]")
        t.on("/repos/me/app/commits", status: 409, body: #"{"message":"Git Repository is empty."}"#)
        // actions/runs and releases/latest fall through to 404
        let data = try await GitHubClient(token: "t", transport: t).fetchRepoData(fullName: "me/app")
        XCTAssertTrue(data.recentCommits.isEmpty)
        XCTAssertTrue(data.workflowRuns.isEmpty)
    }

    func testSyncKeepsPreviousReportOnRepoFailureAndAbortsOnAuth() async throws {
        let t = FakeTransport()
        t.on("/repos/me/app", body: repoJSON)
        t.on("/repos/me/app/pulls", body: "[]")
        t.on("/repos/me/app/issues", body: "[]")
        t.on("/repos/me/app/commits", body: "[]")
        t.on("/repos/me/broken", status: 500, body: "{}")
        let client = GitHubClient(token: "t", transport: t)

        var old = healthyData()
        old.repo.fullName = "me/broken"
        old.repo.id = 9
        let previous = DashboardSnapshot(generatedAt: now, viewerLogin: "me", reports: [
            RepoReport(repo: old.repo, health: HealthCalculator.calculate(old, now: now), items: [], syncedAt: now),
        ], failures: [:])

        let snap = try await SyncEngine.sync(client: client, fullNames: ["me/app", "me/broken", "me/missing"],
                                             viewerLogin: "me", settings: .default, previous: previous, now: now)
        XCTAssertEqual(snap.reports.map(\.repo.fullName), ["me/app", "me/broken"])
        XCTAssertEqual(Set(snap.failures.keys), ["me/broken", "me/missing"])

        let t2 = FakeTransport()
        t2.on("/repos/me/app", status: 401, body: "{}")
        do {
            _ = try await SyncEngine.sync(client: GitHubClient(token: "x", transport: t2), fullNames: ["me/app"],
                                          viewerLogin: "me", settings: .default, previous: nil, now: now)
            XCTFail("auth errors must abort the sync")
        } catch {
            XCTAssertEqual(error as? GitHubError, .unauthorized)
        }
    }
}
