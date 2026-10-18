import Foundation

/// A user decision about an attention item.
public struct Dismissal: Codable, Hashable, Sendable {
    /// The item's `eventDate` when it was dismissed. A newer event (e.g. another
    /// CI failure, new PR activity) brings the item back automatically.
    public var eventDate: Date
    /// When set, this is a snooze: hidden until this time regardless of new events.
    public var snoozedUntil: Date?

    public init(eventDate: Date, snoozedUntil: Date? = nil) {
        self.eventDate = eventDate
        self.snoozedUntil = snoozedUntil
    }
}

public enum Triage {
    public static func isHidden(_ item: AttentionItem, by dismissal: Dismissal?, now: Date) -> Bool {
        guard let dismissal else { return false }
        if let until = dismissal.snoozedUntil { return now < until }
        return item.eventDate <= dismissal.eventDate
    }

    public static func visible(_ items: [AttentionItem], dismissals: [String: Dismissal], now: Date) -> [AttentionItem] {
        items.filter { !isHidden($0, by: dismissals[$0.id], now: now) }
    }

    /// Drops dismissals for items that no longer exist, so the store doesn't grow forever.
    public static func prune(_ dismissals: [String: Dismissal], keeping items: [AttentionItem]) -> [String: Dismissal] {
        let ids = Set(items.map(\.id))
        return dismissals.filter { ids.contains($0.key) }
    }

    /// Items worth a system notification after a sync: newly appeared or escalated
    /// items at or above `minimum` severity. Returns nothing on the very first sync
    /// (`previous == nil`) to avoid a burst of notifications at launch.
    public static func itemsToNotify(previous: [AttentionItem]?, current: [AttentionItem],
                                     dismissals: [String: Dismissal] = [:], now: Date,
                                     minimum: Severity = .high) -> [AttentionItem] {
        guard let previous else { return [] }
        let before = Dictionary(previous.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return current.filter { item in
            guard item.severity >= minimum, !isHidden(item, by: dismissals[item.id], now: now) else { return false }
            guard let old = before[item.id] else { return true }
            return item.severity > old.severity
        }
    }
}
