import AppKit
import RepoButlerCore
import SwiftUI

struct MenuBarView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            content
            Divider()
            footer
        }
        .frame(width: 380)
    }

    private func showSettings() {
        NSApp.activate(ignoringOtherApps: true)
        openSettings()
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 12) {
            ScoreRing(score: model.snapshot?.overallScore, lineWidth: 4,
                      font: .system(.callout, design: .rounded).weight(.semibold))
                .frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text("RepoButler").font(.headline)
                subtitle.font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if model.phase == .syncing {
                ProgressView().controlSize(.small)
            } else {
                Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless)
                    .help("Sync now")
                    .disabled(!model.hasToken)
            }
            Button(action: showSettings) { Image(systemName: "gearshape") }
                .buttonStyle(.borderless)
                .help("Settings")
        }
        .padding(12)
    }

    @ViewBuilder private var subtitle: some View {
        if let snapshot = model.snapshot {
            Text("\(snapshot.reports.count) repos · synced \(snapshot.generatedAt, style: .relative) ago")
        } else if model.hasToken {
            Text("Waiting for first sync…")
        } else {
            Text("Not connected")
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        if !model.hasToken {
            if case .error(let message) = model.phase {
                EmptyState(symbol: "lock.slash", title: "Access Revoked",
                           message: message,
                           action: ("Sign in again", showSettings))
            } else {
                EmptyState(symbol: "key", title: "Connect GitHub",
                           message: "Sign in with GitHub to start watching your repositories.",
                           action: ("Open Settings", showSettings))
            }
        } else if model.trackedRepos.isEmpty {
            EmptyState(symbol: "tray", title: "No repositories selected",
                       message: "Choose which repositories RepoButler should watch.",
                       action: ("Choose Repositories", showSettings))
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    banners
                    attentionSection
                    reposSection
                }
            }
            .frame(maxHeight: 460)
        }
    }

    @ViewBuilder private var banners: some View {
        if case .error(let message) = model.phase {
            Banner(symbol: "exclamationmark.triangle.fill", tint: .red, text: message)
        }
        if let failures = model.snapshot?.failures, !failures.isEmpty {
            Banner(symbol: "exclamationmark.circle", tint: .orange,
                   text: "Couldn't sync \(failures.keys.sorted().joined(separator: ", ")). Showing last known data.")
                .help(failures.values.joined(separator: "\n"))
        }
    }

    private var attentionSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader(title: "Needs attention", trailing: model.hiddenCount > 0 ? "\(model.hiddenCount) hidden" : nil) {
                if model.hiddenCount > 0 {
                    Button("Show hidden") { model.restoreHidden() }
                        .buttonStyle(.link).font(.caption)
                }
            }
            if model.visibleItems.isEmpty {
                Label(model.snapshot == nil ? "Syncing…" : "All clear", systemImage: "checkmark.circle")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12).padding(.vertical, 8)
            } else {
                ForEach(model.visibleItems.prefix(10)) { item in
                    AttentionRow(item: item)
                }
            }
        }
        .padding(.bottom, 8)
    }

    private var reposSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader(title: "Repositories")
            ForEach(model.reports) { report in
                RepoRow(report: report)
            }
        }
        .padding(.bottom, 8)
    }

    // MARK: Footer

    private var footer: some View {
        HStack {
            if let remaining = model.rateLimitRemaining {
                Text("GitHub API: \(remaining) requests left this hour")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }
                .buttonStyle(.borderless)
                .keyboardShortcut("q")
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }
}

// MARK: - Rows

private struct AttentionRow: View {
    @Environment(AppModel.self) private var model
    let item: AttentionItem
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            SeverityDot(severity: item.severity).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.callout.weight(.medium)).lineLimit(1)
                Text(item.repoFullName).font(.caption).foregroundStyle(.secondary)
                Text(item.evidence).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 4)
            Menu {
                Button("Open on GitHub") { model.open(item.url) }.disabled(item.url == nil)
                Divider()
                Button("Snooze for 24 hours") { model.snooze(item) }
                Button("Dismiss until it changes") { model.dismiss(item) }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.button)
            .buttonStyle(.borderless)
            .menuIndicator(.hidden)
            .fixedSize()
            .opacity(hovering ? 1 : 0.4)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(hovering ? Color.primary.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .padding(.horizontal, 4)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture { model.open(item.url) }
        .help(item.recommendedAction)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

private struct RepoRow: View {
    @Environment(AppModel.self) private var model
    let report: RepoReport
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            Text("\(report.health.score)")
                .font(.system(.callout, design: .rounded).weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(ScoreStyle.color(report.health.score))
                .frame(width: 28, alignment: .trailing)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(report.repo.name).font(.callout)
                    if report.repo.isPrivate {
                        Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                Text(report.health.reasons.first ?? "Healthy")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if !report.items.isEmpty {
                Text("\(report.items.count)")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 5)
        .background(hovering ? Color.primary.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .padding(.horizontal, 4)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture { model.open(report.repo.htmlURL) }
        .help(report.health.reasons.isEmpty ? "No issues found" : report.health.reasons.joined(separator: "\n"))
    }
}

// MARK: - Small components

private struct SectionHeader<Accessory: View>: View {
    let title: String
    let trailing: String?
    let accessory: () -> Accessory

    init(title: String, trailing: String? = nil, @ViewBuilder accessory: @escaping () -> Accessory) {
        self.title = title
        self.trailing = trailing
        self.accessory = accessory
    }

    var body: some View {
        HStack(spacing: 6) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            Spacer()
            if let trailing {
                Text(trailing).font(.caption2).foregroundStyle(.tertiary)
            }
            accessory()
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 2)
    }
}

extension SectionHeader where Accessory == EmptyView {
    init(title: String, trailing: String? = nil) {
        self.init(title: title, trailing: trailing) { EmptyView() }
    }
}

private struct Banner: View {
    let symbol: String
    let tint: Color
    let text: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.caption)
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 8).padding(.top, 8)
    }
}

private struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String
    let action: (String, () -> Void)

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.title2).foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(message).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button(action.0, action: action.1).buttonStyle(.borderedProminent).padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
    }
}
