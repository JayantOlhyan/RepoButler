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
    @State private var patError: String?
    @State private var patWorking = false
    @State private var copied = false

    private static let tokenURL = URL(string: "https://github.com/settings/personal-access-tokens/new")!
    private static let revokeURL = URL(string: "https://github.com/settings/apps/authorizations")!

    var body: some View {
        Form {
            if model.hasToken {
                Section {
                    LabeledContent("Signed in as") {
                        Text(model.viewerLogin.map { "@\($0)" } ?? "Unknown")
                    }
                    LabeledContent("Authentication") {
                        Text(model.authMode == .githubApp ? "GitHub App (Device Flow)" : "Personal Access Token")
                            .foregroundStyle(.secondary)
                    }
                    LabeledContent("Token storage") {
                        Text("Stored in your Keychain").foregroundStyle(.secondary)
                    }

                    if model.authMode == .githubApp {
                        Link("Manage authorizations on GitHub", destination: Self.revokeURL)
                            .font(.callout)
                    }

                    Button("Sign Out and Delete Local Data", role: .destructive) {
                        model.signOut()
                    }
                } footer: {
                    Text("Signing out deletes the credentials from the Keychain and removes all cached repository data from this Mac.")
                }
            } else {
                // Device Flow section
                Section {
                    deviceFlowContent
                } header: {
                    Text("Sign in with GitHub")
                } footer: {
                    Text("RepoButler uses a GitHub App with read-only access to your repositories, issues, PRs, and Actions.")
                }

                // Fallback PAT section
                Section {
                    DisclosureGroup("Use a personal access token instead") {
                        VStack(alignment: .leading, spacing: 10) {
                            SecureField("github_pat_…", text: $token)
                                .onSubmit(connectPAT)
                            HStack {
                                Link("Create a token on GitHub", destination: Self.tokenURL)
                                Spacer()
                                if patWorking { ProgressView().controlSize(.small) }
                                Button("Connect with Token", action: connectPAT)
                                    .disabled(patWorking || token.isEmpty)
                            }
                            if let patError {
                                Text(patError).foregroundStyle(.red).font(.callout)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Requires **read-only** access to:")
                                    .font(.caption).foregroundStyle(.secondary)
                                Text("Metadata · Contents · Issues · Pull requests · Actions")
                                    .font(.caption.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder
    private var deviceFlowContent: some View {
        switch model.deviceFlowState {
        case .idle:
            VStack(alignment: .leading, spacing: 12) {
                Text("Authorize RepoButler on GitHub using a one-time code.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Sign in with GitHub") {
                    model.startDeviceFlow()
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.vertical, 4)

        case .requestingCode:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Requesting code from GitHub…").font(.callout).foregroundStyle(.secondary)
            }
            .padding(.vertical, 8)

        case .awaitingUser(let userCode, let verificationURI), .polling(let userCode, let verificationURI):
            VStack(alignment: .leading, spacing: 14) {
                Text("Enter this code on GitHub to authorize RepoButler:")
                    .font(.callout)

                HStack(spacing: 12) {
                    Text(userCode)
                        .font(.system(.title2, design: .monospaced).weight(.bold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))

                    Button(copied ? "Copied!" : "Copy Code") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(userCode, forType: .string)
                        copied = true
                        Task {
                            try? await Task.sleep(nanoseconds: 2_000_000_000)
                            copied = false
                        }
                    }
                }

                HStack(spacing: 12) {
                    Link("Open GitHub Verification Page", destination: verificationURI)
                        .buttonStyle(.borderedProminent)

                    Button("Cancel") {
                        model.cancelDeviceFlow()
                    }
                }

                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Waiting for authorization on GitHub…")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)

        case .error(let message):
            VStack(alignment: .leading, spacing: 10) {
                Text(message)
                    .foregroundStyle(.red)
                    .font(.callout)

                HStack(spacing: 12) {
                    Button("Try Again") {
                        model.startDeviceFlow()
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Cancel") {
                        model.cancelDeviceFlow()
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func connectPAT() {
        guard !patWorking else { return }
        patWorking = true
        patError = nil
        Task {
            patError = await model.connect(token: token)
            if patError == nil { token = "" }
            patWorking = false
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
                .disabled(!model.hasToken || model.isLoadingRepos)
            }
            .padding(12)

            if !model.hasToken {
                ContentUnavailableView("Connect GitHub first", systemImage: "key",
                                       description: Text("Sign in or add a token in the Account tab."))
            } else if model.isLoadingRepos && model.availableRepos.isEmpty {
                ProgressView().frame(maxHeight: .infinity)
            } else if model.availableRepos.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "folder.badge.questionmark").font(.largeTitle).foregroundStyle(.secondary)
                    Text("No Repositories Available").font(.headline)
                    if model.authMode == .githubApp {
                        Text("RepoButler only has access to repositories granted to its GitHub App installation.")
                            .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                        Link("Choose Repositories on GitHub", destination: model.installURL)
                            .buttonStyle(.borderedProminent)
                        Button("Refresh") {
                            Task { await model.loadRepositories() }
                        }
                    } else {
                        Text("No repositories found for this account/token.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                .frame(maxHeight: .infinity)
                .padding(24)
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
