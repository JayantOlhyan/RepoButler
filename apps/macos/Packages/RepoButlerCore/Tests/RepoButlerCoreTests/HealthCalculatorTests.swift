import XCTest
@testable import RepoButlerCore

final class HealthCalculatorTests: XCTestCase {
    func testHealthyRepoScores100() {
        let h = HealthCalculator.calculate(healthyData(), now: now)
        XCTAssertEqual(h.score, 100)
        XCTAssertTrue(h.reasons.isEmpty)
    }

    func testCIScoreIgnoresCancelledRuns() {
        var d = healthyData()
        d.workflowRuns = [wfRun(1, "failure", at: hoursAgo(1)), wfRun(2, "cancelled", at: hoursAgo(2)),
                          wfRun(3, "success", at: hoursAgo(3))]
        let h = HealthCalculator.calculate(d, now: now)
        XCTAssertEqual(h.ciScore, 50) // 1 of 2 decided runs passed
        XCTAssertTrue(h.reasons.contains("CI failed 1 time in recent runs"))
    }

    func testStalePRFormulaMatchesWebApp() {
        // 1 stale of 2 open: 100 - round(0.5*50) - 1*5 = 70
        var d = healthyData()
        d.openPullRequests = [pr(1, updated: daysAgo(8)), pr(2, updated: daysAgo(1))]
        XCTAssertEqual(HealthCalculator.calculate(d, now: now).prScore, 70)
    }

    func testStaleIssueFormulaMatchesWebApp() {
        // 2 stale of 2 open: 100 - round(1*40) - 2*3 = 54
        var d = healthyData()
        d.openIssues = [issue(1, updated: daysAgo(20)), issue(2, updated: daysAgo(15))]
        XCTAssertEqual(HealthCalculator.calculate(d, now: now).issueScore, 54)
    }

    func testActivityBands() {
        var d = healthyData()
        d.recentCommits = [commit(at: daysAgo(30))]
        XCTAssertEqual(HealthCalculator.calculate(d, now: now).activityScore, 20)
        d.recentCommits = [commit(at: daysAgo(1)), commit(at: daysAgo(2))]
        XCTAssertEqual(HealthCalculator.calculate(d, now: now).activityScore, 70)
    }

    func testMaintenanceDecaysAfterAWeek() {
        var d = healthyData()
        d.repo.pushedAt = daysAgo(17) // 100 - (17-7)*2 = 80
        let h = HealthCalculator.calculate(d, now: now)
        XCTAssertEqual(h.maintenanceScore, 80)
        XCTAssertTrue(h.reasons.contains("Repository has not been updated in 17 days"))
    }

    func testDocumentationAndReleaseScores() {
        var d = healthyData()
        d.repo.description = "  "
        d.latestRelease = nil
        let h = HealthCalculator.calculate(d, now: now)
        XCTAssertEqual(h.documentationScore, 50)
        XCTAssertEqual(h.releaseScore, 50)
        d.latestRelease = ReleaseInfo(tagName: "v1", publishedAt: daysAgo(140), htmlURL: gh) // 80 - 50*0.2 = 70
        XCTAssertEqual(HealthCalculator.calculate(d, now: now).releaseScore, 70)
    }

    func testWeightedTotal() {
        // ci 0, everything else 100 → 80
        var d = healthyData()
        d.workflowRuns = [wfRun(1, "failure", at: hoursAgo(1))]
        XCTAssertEqual(HealthCalculator.calculate(d, now: now).score, 80)
    }
}
