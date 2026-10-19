import XCTest
@testable import RepoButlerCore

final class TriageTests: XCTestCase {
    private func item(_ id: String, _ severity: Severity = .high, event: Date = hoursAgo(1)) -> AttentionItem {
        AttentionItem(id: id, repoFullName: "me/app", type: .failedCI, severity: severity, title: "t",
                      description: "d", evidence: "e", recommendedAction: "a", eventDate: event, url: nil, score: 50)
    }

    func testDismissHidesUntilNewerEvent() {
        let d = ["a": Dismissal(eventDate: hoursAgo(1))]
        XCTAssertTrue(Triage.visible([item("a", event: hoursAgo(1))], dismissals: d, now: now).isEmpty)
        XCTAssertEqual(Triage.visible([item("a", event: hoursAgo(0.5))], dismissals: d, now: now).count, 1)
    }

    func testSnoozeHidesUntilTimeEvenWithNewEvents() {
        let d = ["a": Dismissal(eventDate: hoursAgo(5), snoozedUntil: now.addingTimeInterval(3600))]
        XCTAssertTrue(Triage.visible([item("a", event: hoursAgo(0.1))], dismissals: d, now: now).isEmpty)
        XCTAssertEqual(Triage.visible([item("a")], dismissals: d, now: now.addingTimeInterval(7200)).count, 1)
    }

    func testPruneDropsDismissalsForGoneItems() {
        let d = ["a": Dismissal(eventDate: now), "b": Dismissal(eventDate: now)]
        XCTAssertEqual(Set(Triage.prune(d, keeping: [item("a")]).keys), ["a"])
    }

    func testNoNotificationsOnFirstSync() {
        XCTAssertTrue(Triage.itemsToNotify(previous: nil, current: [item("a", .critical)], now: now).isEmpty)
    }

    func testNotifiesNewAndEscalatedOnly() {
        let previous = [item("existing"), item("escalates", .high), item("lowered", .critical)]
        let current = [item("existing"), item("escalates", .critical), item("lowered", .high),
                       item("new"), item("new-low", .medium)]
        let ids = Triage.itemsToNotify(previous: previous, current: current, now: now).map(\.id)
        XCTAssertEqual(ids, ["escalates", "new"])
    }

    func testDismissedItemsAreNotNotified() {
        let current = [item("new", event: hoursAgo(1))]
        let d = ["new": Dismissal(eventDate: hoursAgo(1))]
        XCTAssertTrue(Triage.itemsToNotify(previous: [], current: current, dismissals: d, now: now).isEmpty)
    }

    func testSnapshotRoundTripAndOverallScore() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = SnapshotStore(directory: dir)
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertNil(store.load())

        let data = healthyData()
        var report = RepoReport(repo: data.repo, health: HealthCalculator.calculate(data, now: now),
                                items: [item("a")], syncedAt: now)
        var second = report
        second.health.score = 61
        report.repo.id = 2
        let snapshot = DashboardSnapshot(generatedAt: now, viewerLogin: "me", reports: [report, second], failures: [:])
        try store.save(snapshot)

        let loaded = try XCTUnwrap(store.load())
        XCTAssertEqual(loaded.reports.count, 2)
        XCTAssertEqual(loaded.overallScore, 81) // (100 + 61) / 2 = 80.5 → 81
        XCTAssertEqual(loaded.allItems.count, 2)

        XCTAssertTrue(store.loadDismissals().isEmpty)
        try store.saveDismissals(["a": Dismissal(eventDate: now)])
        XCTAssertEqual(store.loadDismissals()["a"]?.eventDate, now)
        store.delete()
        XCTAssertNil(store.load())
        XCTAssertTrue(store.loadDismissals().isEmpty)
    }
}
