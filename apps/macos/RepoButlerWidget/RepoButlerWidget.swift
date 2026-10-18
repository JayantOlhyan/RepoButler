import RepoButlerCore
import SwiftUI
import WidgetKit

// The widget never talks to GitHub. It only renders the snapshot the menu bar
// app writes to the shared App Group container, so it holds no token.

struct WidgetItem: Hashable {
    let title: String
    let repo: String
    let severity: Severity
}

struct RepoButlerEntry: TimelineEntry {
    let date: Date
    let overallScore: Int?
    let repoCount: Int
    let attentionCount: Int
    let topItems: [WidgetItem]
    let syncedAt: Date?
    let connected: Bool

    static let sample = RepoButlerEntry(
        date: Date(), overallScore: 85, repoCount: 6, attentionCount: 2,
        topItems: [WidgetItem(title: "CI failing repeatedly", repo: "you/api", severity: .critical),
                   WidgetItem(title: "PR #84 awaiting review", repo: "you/web", severity: .high)],
        syncedAt: Date(), connected: true)
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> RepoButlerEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (RepoButlerEntry) -> Void) {
        completion(context.isPreview ? .sample : load())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RepoButlerEntry>) -> Void) {
        // The app reloads timelines after every sync; this is only a fallback refresh.
        completion(Timeline(entries: [load()], policy: .after(Date().addingTimeInterval(30 * 60))))
    }

    private func load() -> RepoButlerEntry {
        let store = SnapshotStore(directory: AppGroup.containerURL)
        guard let snapshot = store.load() else {
            return RepoButlerEntry(date: Date(), overallScore: nil, repoCount: 0, attentionCount: 0,
                                   topItems: [], syncedAt: nil, connected: false)
        }
        let items = Triage.visible(snapshot.allItems, dismissals: store.loadDismissals(), now: Date())
        return RepoButlerEntry(
            date: Date(), overallScore: snapshot.overallScore, repoCount: snapshot.reports.count,
            attentionCount: items.count,
            topItems: items.prefix(3).map {
                WidgetItem(title: $0.title, repo: $0.repoFullName.components(separatedBy: "/").last ?? $0.repoFullName,
                           severity: $0.severity)
            },
            syncedAt: snapshot.generatedAt, connected: true)
    }
}

struct RepoButlerWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RepoButlerEntry

    var body: some View {
        Group {
            if !entry.connected {
                VStack(spacing: 6) {
                    Image(systemName: "shippingbox").font(.title2).foregroundStyle(.secondary)
                    Text("Open RepoButler to connect GitHub")
                        .font(.caption).multilineTextAlignment(.center).foregroundStyle(.secondary)
                }
            } else if family == .systemSmall {
                small
            } else {
                medium
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private var status: some View {
        Group {
            if entry.attentionCount == 0 {
                Label("All clear", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            } else {
                Label("\(entry.attentionCount) need attention", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(entry.topItems.first?.severity.color ?? .orange)
            }
        }
        .font(.caption.weight(.medium))
        .lineLimit(1)
    }

    private var synced: some View {
        Group {
            if let syncedAt = entry.syncedAt {
                Text("Synced \(syncedAt, style: .relative) ago")
            } else {
                Text(" ")
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                ScoreRing(score: entry.overallScore, lineWidth: 6,
                          font: .system(.title2, design: .rounded).weight(.bold))
                    .frame(width: 58, height: 58)
                Spacer()
            }
            status
            synced
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                ScoreRing(score: entry.overallScore, lineWidth: 6,
                          font: .system(.title2, design: .rounded).weight(.bold))
                    .frame(width: 62, height: 62)
                Text("\(entry.repoCount) repos").font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                synced
            }
            VStack(alignment: .leading, spacing: 6) {
                status
                if entry.topItems.isEmpty {
                    Text("Nothing needs you right now.").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(entry.topItems, id: \.self) { item in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            SeverityDot(severity: item.severity)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(item.title).font(.caption.weight(.medium)).lineLimit(1)
                                Text(item.repo).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@main
struct RepoButlerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RepoButlerWidget", provider: Provider()) { entry in
            RepoButlerWidgetView(entry: entry)
        }
        .configurationDisplayName("Repository Health")
        .description("Your overall repository health and what needs attention.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
