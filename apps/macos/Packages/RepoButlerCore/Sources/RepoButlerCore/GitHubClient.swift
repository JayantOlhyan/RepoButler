import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum GitHubError: Error, Equatable, LocalizedError {
    case unauthorized
    case rateLimited(resetAt: Date?)
    case notFound(String)
    case http(status: Int, path: String)
    case decoding(path: String, detail: String)
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .unauthorized:
            "GitHub rejected the token. Check that it hasn't expired and has read access to your repositories."
        case .rateLimited(let reset):
            if let reset { "GitHub rate limit reached. Resets at \(Format.dateTime(reset))." }
            else { "GitHub rate limit reached. Try again later." }
        case .notFound(let path): "Not found on GitHub (\(path)). The repo may be private to another account or renamed."
        case .http(let status, let path): "GitHub returned HTTP \(status) for \(path)."
        case .decoding(let path, let detail): "Unexpected response from GitHub for \(path): \(detail)"
        case .transport(let detail): "Network error: \(detail)"
        }
    }

    /// Errors that make the rest of a sync pointless.
    public var abortsSync: Bool {
        switch self { case .unauthorized, .rateLimited: true; default: false }
    }
}

/// Seam for tests: performs one HTTP request.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    let session: URLSession
    public init(session: URLSession = .shared) { self.session = session }
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GitHubError.transport("Non-HTTP response") }
        return (data, http)
    }
}

/// Read-only GitHub REST client.
///
/// Uses ETags: unchanged resources return `304 Not Modified`, which GitHub does
/// not count against the rate limit, so frequent polling stays cheap.
public actor GitHubClient {
    public static let apiBase = URL(string: "https://api.github.com")!

    private let token: String
    private let transport: HTTPTransport
    private var etagCache: [String: (etag: String, body: Data)] = [:]
    public private(set) var rateLimitRemaining: Int?
    public private(set) var rateLimitResetAt: Date?

    public init(token: String, transport: HTTPTransport = URLSessionTransport()) {
        self.token = token
        self.transport = transport
    }

    // MARK: Low level

    /// Returns the body, or nil when the status is listed in `nilOn` (e.g. 404 for "no release").
    func get(_ path: String, query: [String: String] = [:], nilOn: Set<Int> = []) async throws -> Data? {
        let (data, _) = try await getWithResponse(path, query: query, nilOn: nilOn)
        return data
    }

    /// Performs a GET request, returning both body and HTTP response (e.g. for reading Link headers).
    func getWithResponse(_ path: String, query: [String: String] = [:], nilOn: Set<Int> = []) async throws -> (Data?, HTTPURLResponse) {
        var components = URLComponents(url: Self.apiBase.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        let url = components.url!
        let cacheKey = url.absoluteString

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData // we do conditional requests ourselves
        request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("RepoButler-macOS", forHTTPHeaderField: "User-Agent")
        if let cached = etagCache[cacheKey] {
            request.setValue(cached.etag, forHTTPHeaderField: "If-None-Match")
        }

        let data: Data, response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch let error as GitHubError {
            throw error
        } catch {
            throw GitHubError.transport(error.localizedDescription)
        }

        if let remaining = response.value(forHTTPHeaderField: "x-ratelimit-remaining").flatMap(Int.init) {
            rateLimitRemaining = remaining
        }
        if let reset = response.value(forHTTPHeaderField: "x-ratelimit-reset").flatMap(TimeInterval.init) {
            rateLimitResetAt = Date(timeIntervalSince1970: reset)
        }

        switch response.statusCode {
        case 200..<300:
            if let etag = response.value(forHTTPHeaderField: "ETag") {
                etagCache[cacheKey] = (etag, data)
            }
            return (data, response)
        case 304:
            guard let cached = etagCache[cacheKey] else { throw GitHubError.http(status: 304, path: path) }
            return (cached.body, response)
        case 401:
            throw GitHubError.unauthorized
        case 403, 429:
            if rateLimitRemaining == 0 || response.statusCode == 429
                || response.value(forHTTPHeaderField: "retry-after") != nil {
                throw GitHubError.rateLimited(resetAt: rateLimitResetAt)
            }
            if nilOn.contains(response.statusCode) { return (nil, response) }
            throw GitHubError.http(status: response.statusCode, path: path)
        default:
            if nilOn.contains(response.statusCode) { return (nil, response) }
            if response.statusCode == 404 { throw GitHubError.notFound(path) }
            throw GitHubError.http(status: response.statusCode, path: path)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data, path: String) throws -> T {
        do { return try GitHubMapping.decoder.decode(T.self, from: data) }
        catch { throw GitHubError.decoding(path: path, detail: String(describing: error)) }
    }

    // MARK: Endpoints

    public func viewerLogin() async throws -> String {
        let data = try await get("user")!
        return try decode(GitHubMapping.UserDTO.self, data, path: "user").login
    }

    /// Repositories the signed-in user owns or collaborates on, most recently pushed first (PAT flow).
    public func listRepositories(maxPages: Int = 3) async throws -> [RepoInfo] {
        var all: [RepoInfo] = []
        for page in 1...maxPages {
            let data = try await get("user/repos", query: [
                "affiliation": "owner,collaborator,organization_member",
                "sort": "pushed", "per_page": "100", "page": String(page),
            ])!
            let batch = try decode([GitHubMapping.RepoDTO].self, data, path: "user/repos").map(\.model)
            all += batch
            if batch.count < 100 { break }
        }
        return all
    }

    /// Fetches all installations accessible to this user access token, paginating through all pages.
    func listInstallations() async throws -> [GitHubMapping.InstallationDTO] {
        var installations: [GitHubMapping.InstallationDTO] = []
        var page = 1
        while true {
            let (data, response) = try await getWithResponse("user/installations", query: [
                "per_page": "100",
                "page": String(page)
            ])
            guard let data else { break }
            let dto = try decode(GitHubMapping.InstallationsResponseDTO.self, data, path: "user/installations")
            installations.append(contentsOf: dto.installations)

            if !Self.hasNextPage(response: response, fetchedCount: dto.installations.count) {
                break
            }
            page += 1
        }
        return installations
    }

    /// Lists repositories accessible via GitHub App installations (paginating installations & repos, de-duplicating).
    public func listAppInstallationRepositories() async throws -> [RepoInfo] {
        let installations = try await listInstallations()
        guard !installations.isEmpty else { return [] }

        var seenIDs = Set<Int>()
        var results: [RepoInfo] = []

        for installation in installations {
            var page = 1
            while true {
                let path = "user/installations/\(installation.id)/repositories"
                let (data, response) = try await getWithResponse(path, query: [
                    "per_page": "100",
                    "page": String(page)
                ])
                guard let data else { break }
                let dto = try decode(GitHubMapping.InstallationReposResponseDTO.self, data, path: path)
                for repoDTO in dto.repositories {
                    if seenIDs.insert(repoDTO.id).inserted {
                        results.append(repoDTO.model)
                    }
                }

                if !Self.hasNextPage(response: response, fetchedCount: dto.repositories.count) {
                    break
                }
                page += 1
            }
        }

        // Sort by pushed_at descending (nulls last)
        return results.sorted { lhs, rhs in
            switch (lhs.pushedAt, rhs.pushedAt) {
            case let (l?, r?): return l > r
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil): return lhs.fullName < rhs.fullName
            }
        }
    }

    /// Checks if a Link header or batch count indicates a next page.
    static func hasNextPage(response: HTTPURLResponse, fetchedCount: Int) -> Bool {
        if let linkHeader = response.value(forHTTPHeaderField: "Link") {
            return linkHeader.contains("rel=\"next\"")
        }
        return fetchedCount >= 100
    }


    /// Fetches everything the rules need for one repo (7 requests, mostly 304s after the first sync).
    public func fetchRepoData(fullName: String) async throws -> RepoData {
        let base = "repos/\(fullName)"
        let repoData = try await get(base)!
        let repo = try decode(GitHubMapping.RepoDTO.self, repoData, path: base).model

        async let pullsData = get("\(base)/pulls", query: ["state": "open", "per_page": "100"])
        async let issuesData = get("\(base)/issues", query: ["state": "open", "per_page": "100"])
        async let closedData = get("\(base)/issues", query: ["state": "closed", "sort": "updated",
                                                             "direction": "desc", "per_page": "30"])
        // 404 when Actions is disabled for the repo.
        async let runsData = get("\(base)/actions/runs", query: ["branch": repo.defaultBranch, "per_page": "30"],
                                 nilOn: [404])
        // 404 = no published release.
        async let releaseData = get("\(base)/releases/latest", nilOn: [404])
        // 409 = empty repository.
        async let commitsData = get("\(base)/commits", query: ["sha": repo.defaultBranch, "per_page": "30"],
                                    nilOn: [404, 409])

        let pulls = try decode([GitHubMapping.PullDTO].self, try await pullsData!, path: "\(base)/pulls")
        let openIssues = try decode([GitHubMapping.IssueDTO].self, try await issuesData!, path: "\(base)/issues")
        let closed = try decode([GitHubMapping.IssueDTO].self, try await closedData!, path: "\(base)/issues?closed")
        let runs = try await runsData.map {
            try decode(GitHubMapping.RunsDTO.self, $0, path: "\(base)/actions/runs").workflowRuns
        } ?? []
        let release = try await releaseData.map {
            try decode(GitHubMapping.ReleaseDTO.self, $0, path: "\(base)/releases/latest")
        }
        let commits = try await commitsData.map {
            try decode([GitHubMapping.CommitDTO].self, $0, path: "\(base)/commits")
        } ?? []

        return GitHubMapping.repoData(repo: repo, pulls: pulls, openIssues: openIssues, closedIssues: closed,
                                      runs: runs, release: release, commits: commits)
    }
}
