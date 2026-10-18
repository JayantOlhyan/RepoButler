import Foundation

public enum SyncEngine {
    /// Fetches and analyzes every tracked repo, at most `concurrency` at a time.
    ///
    /// A repo that fails keeps its previous report and is listed in `failures`.
    /// Auth and rate-limit errors abort the whole sync and are thrown.
    public static func sync(client: GitHubClient, fullNames: [String], viewerLogin: String,
                            settings: MonitorSettings, previous: DashboardSnapshot?,
                            now: Date = Date(), concurrency: Int = 4) async throws -> DashboardSnapshot {
        let previousByName = Dictionary(
            (previous?.reports ?? []).map { ($0.repo.fullName.lowercased(), $0) },
            uniquingKeysWith: { a, _ in a })

        var results: [String: Result<RepoReport, GitHubError>] = [:]

        try await withThrowingTaskGroup(of: (String, Result<RepoReport, GitHubError>).self) { group in
            var queue = fullNames[...]

            func enqueue() {
                guard let name = queue.popFirst() else { return }
                group.addTask {
                    do {
                        let data = try await client.fetchRepoData(fullName: name)
                        let report = RepoReport(
                            repo: data.repo,
                            health: HealthCalculator.calculate(data, now: now),
                            items: AttentionEngine.items(for: data, viewerLogin: viewerLogin,
                                                         settings: settings, now: now),
                            syncedAt: now)
                        return (name, .success(report))
                    } catch let error as GitHubError {
                        if error.abortsSync { throw error }
                        return (name, .failure(error))
                    } catch {
                        return (name, .failure(.transport(error.localizedDescription)))
                    }
                }
            }

            for _ in 0..<max(1, concurrency) { enqueue() }
            while let (name, result) = try await group.next() {
                results[name] = result
                enqueue()
            }
        }

        var reports: [RepoReport] = []
        var failures: [String: String] = [:]
        for name in fullNames {
            switch results[name] {
            case .success(let report):
                reports.append(report)
            case .failure(let error):
                failures[name] = error.errorDescription ?? "Sync failed"
                if let old = previousByName[name.lowercased()] { reports.append(old) }
            case nil:
                break
            }
        }

        return DashboardSnapshot(generatedAt: now, viewerLogin: viewerLogin, reports: reports, failures: failures)
    }
}
