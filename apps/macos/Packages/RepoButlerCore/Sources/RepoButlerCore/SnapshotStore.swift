import Foundation

/// Reads/writes the latest dashboard snapshot as JSON. The app writes it into the
/// shared App Group container; the widget only reads it.
public struct SnapshotStore: Sendable {
    public let fileURL: URL

    public init(directory: URL) {
        self.fileURL = directory.appendingPathComponent("snapshot.json")
    }

    public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.sortedKeys]
        return e
    }()

    public static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    public func load() -> DashboardSnapshot? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? Self.decoder.decode(DashboardSnapshot.self, from: data)
    }

    public func save(_ snapshot: DashboardSnapshot) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try Self.encoder.encode(snapshot).write(to: fileURL, options: .atomic)
    }

    // MARK: Dismissals (shared so the widget hides what the user dismissed)

    var dismissalsURL: URL { fileURL.deletingLastPathComponent().appendingPathComponent("dismissals.json") }

    public func loadDismissals() -> [String: Dismissal] {
        guard let data = try? Data(contentsOf: dismissalsURL) else { return [:] }
        return (try? Self.decoder.decode([String: Dismissal].self, from: data)) ?? [:]
    }

    public func saveDismissals(_ dismissals: [String: Dismissal]) throws {
        try FileManager.default.createDirectory(at: dismissalsURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try Self.encoder.encode(dismissals).write(to: dismissalsURL, options: .atomic)
    }

    /// Removes the snapshot and dismissals (used on sign-out).
    public func delete() {
        try? FileManager.default.removeItem(at: fileURL)
        try? FileManager.default.removeItem(at: dismissalsURL)
    }
}
