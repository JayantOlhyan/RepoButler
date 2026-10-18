import XCTest
@testable import RepoButlerCore

final class AttentionEngineTests: XCTestCase {
    private func items(_ d: RepoData, viewer: String = "me", settings: MonitorSettings = .default) -> [AttentionItem] {
        AttentionEngine.items(for: d, viewerLogin: viewer, settings: settings, now: now)
    }

    func testHealthyRepoHasNoItems() {
        XCTAssertTrue(items(healthyData()).isEmpty)
    }

    func testSingleFailureIsHighFailedCI() {
        var d = healthyData()
        d.workflowRuns = [wfRun(2, "failure", at: hoursAgo(1)), wfRun(1, "success", at: hoursAgo(30))]
        let result = items(d)
        XCTAssertEqual(result.map(\.type), [.failedCI])
        XCTAssertEqual(result[0].severity, .high)
        XCTAssertEqual(result[0].id, "me/app#WORKFLOW_CI")
        XCTAssertEqual(result[0].url, gh)
    }

    func testThreeConsecutiveFailuresAreCritical() {
        var d = healthyData()
        d.workflowRuns = [wfRun(3, "failure", at: daysAgo(2)), wfRun(2, "timed_out", at: daysAgo(3)),
                          wfRun(1, "failure", at: daysAgo(4)), wfRun(0, "success", at: daysAgo(5))]
        let result = items(d)
        XCTAssertEqual(result.first?.type, .repeatedCIFailure)
        XCTAssertEqual(result.first?.severity, .critical)
    }

    func testTwoFailuresIn24hAreCritical() {
        var d = healthyData()
        d.workflowRuns = [wfRun(2, "failure", at: hoursAgo(1)), wfRun(1, "failure", at: hoursAgo(5))]
        XCTAssertEqual(items(d).first?.type, .repeatedCIFailure)
    }

    func testCancelledRunDoesNotHideOrCauseFailure() {
        var d = healthyData()
        d.workflowRuns = [wfRun(3, "cancelled", at: hoursAgo(1)), wfRun(2, "success", at: hoursAgo(2))]
        XCTAssertTrue(items(d).isEmpty)
        d.workflowRuns = [wfRun(3, "cancelled", at: hoursAgo(1)), wfRun(2, "failure", at: hoursAgo(30)),
                          wfRun(1, "success", at: hoursAgo(40))]
        XCTAssertEqual(items(d).map(\.type), [.failedCI])
    }

    func testRecoveredWorkflowHasNoItem() {
        var d = healthyData()
        d.workflowRuns = [wfRun(2, "success", at: hoursAgo(1)), wfRun(1, "failure", at: hoursAgo(2))]
        XCTAssertTrue(items(d).isEmpty)
    }

    func testInProgressRunIsSkipped() {
        var d = healthyData()
        d.workflowRuns = [wfRun(2, nil, at: hoursAgo(1), status: "in_progress"), wfRun(1, "failure", at: hoursAgo(30)),
                          wfRun(0, "success", at: hoursAgo(50))]
        XCTAssertEqual(items(d).map(\.type), [.failedCI])
    }

    func testWorkflowsAreEvaluatedSeparately() {
        var d = healthyData()
        d.workflowRuns = [wfRun(2, "success", at: hoursAgo(1), name: "Lint"), wfRun(1, "failure", at: hoursAgo(2), name: "Deploy")]
        XCTAssertEqual(items(d).map(\.id), ["me/app#WORKFLOW_Deploy"])
    }

    func testPRRules() {
        var d = healthyData()
        d.openPullRequests = [
            pr(1, by: "someone", updated: daysAgo(3)),           // awaiting your review
            pr(2, by: "someone", updated: daysAgo(1)),           // too fresh
            pr(3, by: "someone", updated: daysAgo(9), draft: true), // drafts ignored
            pr(4, by: "ME", updated: daysAgo(8)),                // your stale PR (case-insensitive)
            pr(5, by: "me", updated: daysAgo(3)),                // yours, not stale yet
        ]
        let byID = Dictionary(uniqueKeysWithValues: items(d).map { ($0.id, $0.type) })
        XCTAssertEqual(byID, ["me/app#PR_1": .prAwaitingReview, "me/app#PR_4": .stalePR])
    }

    func testStaleIssueThreshold() {
        var d = healthyData()
        d.openIssues = [issue(1, updated: daysAgo(11)), issue(2, updated: daysAgo(9))]
        XCTAssertEqual(items(d).map(\.id), ["me/app#ISSUE_1"])
    }

    func testStaleRepoUsesLatestMeaningfulActivity() {
        var d = healthyData()
        d.latestRelease = nil
        d.recentCommits = [commit("chore: bump", at: daysAgo(1)),  // not meaningful
                           commit("Merge pull request #1", at: daysAgo(2)),
                           commit("feat: real work", at: daysAgo(20))]
        let stale = items(d).filter { $0.type == .staleRepo }
        XCTAssertEqual(stale.count, 1)
        XCTAssertEqual(stale[0].eventDate, daysAgo(20))

        d.lastMergedPullRequestAt = daysAgo(3) // a recent merge counts as activity
        XCTAssertTrue(items(d).filter { $0.type == .staleRepo }.isEmpty)
    }

    func testStaleRepoRespectsSettingsAndArchive() {
        var d = healthyData()
        d.latestRelease = nil
        d.recentCommits = [commit(at: daysAgo(20))]
        XCTAssertTrue(items(d, settings: MonitorSettings(staleRepoThresholdDays: 30)).isEmpty)
        d.repo.isArchived = true
        XCTAssertTrue(items(d).isEmpty)
    }

    func testScoringFormulaMatchesWebApp() {
        // FAILED_CI, age 0: 85*.3 + 80*.25 + 0*.2 + 85*.15 + 100*.1 = 68.25 → 68
        XCTAssertEqual(AttentionEngine.score(type: .failedCI, ageDays: 0), 68)
        // STALE_ISSUE, age 20 (age capped at 100): 9 + 7.5 + 20 + 7.5 + 10 = 54
        XCTAssertEqual(AttentionEngine.score(type: .staleIssue, ageDays: 20), 54)
        // REPEATED, age 1: 28.5 + 22.5 + 2 + 13.5 + 10 = 76.5 → 77
        XCTAssertEqual(AttentionEngine.score(type: .repeatedCIFailure, ageDays: 1), 77)
    }

    func testItemsSortedByScore() {
        var d = healthyData()
        d.openIssues = [issue(1, updated: daysAgo(30))]
        d.workflowRuns = [wfRun(2, "failure", at: hoursAgo(1)), wfRun(1, "failure", at: hoursAgo(2))]
        XCTAssertEqual(items(d).first?.type, .repeatedCIFailure)
    }
}
