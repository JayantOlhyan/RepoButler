import RepoButlerCore
import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            AccountTab().tabItem { Label("Account", systemImage: "person.crop.circle") }
            RepositoriesTab().tabItem { Label("Repositories", systemImage: "folder") }
            GeneralTab().tabItem { Label("General", systemImage: "gearshape") }
        }
        .frame(width: 520, height: 460)
    }
}

// MARK: - Account

private struct AccountTab: View {
    @Environment(AppModel.self) private var model
    @State private var token = ""
    @State private var error: String?
    @State private var working = false

    private static let tokenURL = URL(string: "https://github.com/settings/personal-access-tokens/new")!

    var body: some View {
        Form {
            if model.hasToken {
                Section {
                    LabeledContent("Signed in as") {
                        Text(model.viewerLogin.map { "@\($0)" } ?? "Unknown")
                    }
                    LabeledContent("Token") { Text("Stored in your Keychain").foregroundStyle(.secondary) }
                    Button("Sign Out and Delete Local Data", role: .destructive) { model.signOut() }
                } footer: {
                    Text("Signing out deletes the token from the Keychain and removes all cached repository data from this Mac.")
                }
            } else {
                Section {
                    SecureField("github_pat_…", text: $token)
                        .onSubmit(connect)
                    HStack {
                        Link("Create a token on GitHub", destination: Self.tokenURL)
                        Spacer()
                        if working { ProgressView().controlSize(.small) }
                        Button("Connect", action: connect)
                            .keyboardShortcut(.defaultAction)
                            .disabled(working || token.isEmpty)
                    }
                    if let error {
                        Text(error).foregroundStyle(.red).font(.callout)
                    }
                } header: {
                    Text("GitHub token")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Use a fine-grained token with **read-only** access to the repositories you want to watch:")
                        Text("Metadata · Contents · Issues · Pull requests · Actions")
                            .font(.callout.monospaced())
                        Text("RepoButler only reads from GitHub. The token stays in your Keychain and is sent only to api.github.com.")
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private func connect() {
        guard !working else { return }
        working = true
        error = nil
        Task {
            error = await model.connect(token: token)
            if error == nil { token = "" }
            working = false
        }
    }
}

// MARK: - Repositories

private struct RepositoriesTab: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var hideArchived = true

    private var filtered: [RepoInfo] {
        model.availableRepos.filter { repo in
            (!hideArchived || !repo.isArchived)
                && (search.isEmpty || repo.fullName.localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("Filter repositories", text: $search)
                    .textFieldStyle(.roundedBorder)
                Toggle("Hide archived", isOn: $hideArchived)
                Button {
                    Task { await model.loadRepositories() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("Reload repository list")
                .disabled(!model.hasToken)
            }
            .padding(12)

            if !model.hasToken {
                ContentUnavailableView("Connect GitHub first", systemImage: "key",
                                       description: Text("Add a token in the Account tab."))
            } else if model.isLoadingRepos && model.availableRepos.isEmpty {
                ProgressView().frame(maxHeight: .infinity)
            } else {
                List(filtered) { repo in
                    Toggle(isOn: Binding(get: { model.isTracked(repo) },
                                         set: { model.setTracked(repo, $0) })) {
                        HStack(spacing: 6) {
                            Text(repo.fullName)
                            if repo.isPrivate { Image(systemName: "lock.fill").foregroundStyle(.tertiary) }
                            if repo.isFork { Text("fork").font(.caption).foregroundStyle(.secondary) }
                            if repo.isArchived { Text("archived").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
            }

            Divider()
            HStack {
                Text("\(model.trackedRepos.count) watched")
                if model.trackedRepos.count > AppModel.recommendedMaxRepos {
                    Text("· More than \(AppModel.recommendedMaxRepos) may hit GitHub rate limits at short intervals")
                        .foregroundStyle(.orange)
                }
                Spacer()
                Button("Sync Now") { Task { await model.refresh() } }
                    .disabled(!model.hasToken || model.trackedRepos.isEmpty)
            }
            .font(.callout)
            .padding(12)
        }
        .task {
            if model.hasToken && model.availableRepos.isEmpty { await model.loadRepositories() }
        }
    }
}

// MARK: - General

private struct GeneralTab: View {
    @Environment(AppModel.self) private var model
    @State private var launchAtLogin = false
    @State private var launchError: String?

    var body: some View {
        Form {
            Section("Sync") {
                Picker("Check GitHub every", selection: Binding(get: { model.pollMinutes },
                                                               set: { model.setPollMinutes($0) })) {
                    ForEach(AppModel.pollChoices, id: \.self) { Text("\($0) minutes").tag($0) }
                }
                Toggle("Notify me about new high-priority items",
                       isOn: Binding(get: { model.notificationsEnabled },
                                     set: { model.setNotificationsEnabled($0) }))
                Toggle("Open at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, on in
                        guard on != model.launchAtLogin else { return } // initial sync from onAppear
                        launchError = model.setLaunchAtLogin(on)
                        if launchError != nil { launchAtLogin = model.launchAtLogin }
                    }
                if let launchError {
                    Text(launchError).foregroundStyle(.red).font(.callout)
                }
            }

            Section {
                threshold("Repo is stale after", \.staleRepoThresholdDays, 3...180)
                threshold("Others' PRs need review after", \.prReviewThresholdDays, 1...30)
                threshold("My PRs are stale after", \.stalePRThresholdDays, 1...60)
                threshold("Issues are stale after", \.staleIssueThresholdDays, 1...180)
            } header: {
                Text("Attention rules")
            } footer: {
                Text("Changes apply on the next sync.")
            }
        }
        .formStyle(.grouped)
        .onAppear { launchAtLogin = model.launchAtLogin }
    }

    private func threshold(_ title: String, _ keyPath: WritableKeyPath<MonitorSettings, Int>,
                           _ range: ClosedRange<Int>) -> some View {
        Stepper(value: Binding(get: { model.settings[keyPath: keyPath] },
                               set: { var s = model.settings; s[keyPath: keyPath] = $0; model.updateSettings(s) }),
                in: range) {
            LabeledContent(title) { Text("\(model.settings[keyPath: keyPath]) days").monospacedDigit() }
        }
    }
}
