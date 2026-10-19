import AppKit
import Foundation
import Observation
import RepoButlerCore
import ServiceManagement
import UserNotifications
import WidgetKit

/// App state: token, auth mode, device flow, tracked repos, polling loop, latest snapshot, dismissals.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case needsToken
        case idle
        case syncing
        case error(String)
    }

    /// State of the interactive GitHub App device flow.
    enum DeviceFlowState: Equatable {
        case idle
        case requestingCode
        case polling(userCode: String, verificationURI: URL)
        case error(String)
    }

    // MARK: State

    private(set) var phase: Phase = .needsToken
    private(set) var authMode: AuthMode?
    private(set) var deviceFlowState: DeviceFlowState = .idle
    private(set) var snapshot: DashboardSnapshot?
    private(set) var viewerLogin: String?
    private(set) var availableRepos: [RepoInfo] = []
    private(set) var isLoadingRepos = false
    private(set) var rateLimitRemaining: Int?
    private(set) var dismissals: [String: Dismissal] = [:]

    private(set) var trackedRepos: [String]
    private(set) var settings: MonitorSettings
    private(set) var pollMinutes: Int
    private(set) var notificationsEnabled: Bool

    // MARK: Dependencies

    @ObservationIgnored private let store = SnapshotStore(directory: AppGroup.containerURL)
    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var client: GitHubClient?
    @ObservationIgnored private var pollTask: Task<Void, Never>?
    @ObservationIgnored private var deviceFlowTask: Task<Void, Never>?

    private enum Key {
        static let tracked = "trackedRepos"
        static let settings = "monitorSettings"
        static let poll = "pollMinutes"
        static let notifications = "notificationsEnabled"
        static let viewer = "viewerLogin"
    }

    static let pollChoices = [5, 10, 15, 30, 60]
    /// Each repo costs ~7 requests per sync (most become free 304s). 30 repos every
    /// 5 minutes stays far below GitHub's 5,000 requests/hour.
    static let recommendedMaxRepos = 30

    /// GitHub App client ID configured in Info.plist.
    var clientID: String {
        Bundle.main.object(forInfoDictionaryKey: "GitHubClientID") as? String ?? ""
    }

    /// GitHub App slug configured in Info.plist.
    var appSlug: String {
        Bundle.main.object(forInfoDictionaryKey: "GitHubAppSlug") as? String ?? ""
    }

    /// URL to install the GitHub App or configure repositories.
    var installURL: URL {
        if !appSlug.isEmpty {
            return URL(string: "https://github.com/apps/\(appSlug)/installations/new")!
        }
        return URL(string: "https://github.com")!
    }

    init() {
        trackedRepos = defaults.stringArray(forKey: Key.tracked) ?? []
        settings = (defaults.data(forKey: Key.settings))
            .flatMap { try? JSONDecoder().decode(MonitorSettings.self, from: $0) } ?? .default
        let savedPoll = defaults.integer(forKey: Key.poll)
        pollMinutes = Self.pollChoices.contains(savedPoll) ? savedPoll : 10
        notificationsEnabled = defaults.object(forKey: Key.notifications) as? Bool ?? true
        viewerLogin = defaults.string(forKey: Key.viewer)
        snapshot = store.load()
        dismissals = store.loadDismissals()

        if let creds = Keychain.readCredentials() {
            authMode = creds.mode
            client = GitHubClient(token: creds.token)
            phase = .idle
            startPolling()
        }
    }

    // MARK: Derived

    var hasToken: Bool { client != nil }

    var visibleItems: [AttentionItem] {
        Triage.visible(snapshot?.allItems ?? [], dismissals: dismissals, now: Date())
    }

    var hiddenCount: Int { (snapshot?.allItems.count ?? 0) - visibleItems.count }

    /// Repos ordered worst health first.
    var reports: [RepoReport] {
        (snapshot?.reports ?? []).sorted { $0.health.score < $1.health.score }
    }

    var launchAtLogin: Bool { SMAppService.mainApp.status == .enabled }

    // MARK: Account & Device Flow

    /// Begins the GitHub App device authorization flow.
    func startDeviceFlow() {
        deviceFlowTask?.cancel()
        let cid = clientID
        guard !cid.isEmpty else {
            deviceFlowState = .error("Missing GitHub Client ID in app configuration.")
            return
        }

        deviceFlowState = .requestingCode
        deviceFlowTask = Task { [weak self] in
            do {
                let resp = try await GitHubAuth.requestDeviceCode(clientID: cid)
                guard !Task.isCancelled else { return }

                // Automatically open verification URI in browser and start polling
                NSWorkspace.shared.open(resp.verificationURI)
                self?.deviceFlowState = .polling(userCode: resp.userCode, verificationURI: resp.verificationURI)

                let token = try await GitHubAuth.pollForToken(
                    clientID: cid,
                    deviceCode: resp.deviceCode,
                    initialInterval: resp.interval
                )
                guard !Task.isCancelled else { return }

                if let error = await self?.finishSignIn(token: token, mode: .githubApp) {
                    self?.deviceFlowState = .error(error)
                }
            } catch is CancellationError {
                self?.deviceFlowState = .idle
            } catch {
                self?.deviceFlowState = .error(error.localizedDescription)
            }
        }
    }

    func cancelDeviceFlow() {
        deviceFlowTask?.cancel()
        deviceFlowTask = nil
        deviceFlowState = .idle
    }

    /// Personal Access Token connect flow.
    func connect(token raw: String) async -> String? {
        let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return "Paste a token first." }
        return await finishSignIn(token: token, mode: .personalToken)
    }

    @discardableResult
    private func finishSignIn(token: String, mode: AuthMode) async -> String? {
        let candidate = GitHubClient(token: token)
        do {
            let login = try await candidate.viewerLogin()
            try Keychain.saveToken(token, mode: mode)
            client = candidate
            authMode = mode
            deviceFlowState = .idle
            setViewer(login)
            phase = .idle
            await loadRepositories()
            if trackedRepos.isEmpty { autoSelectRepos() }
            if notificationsEnabled { requestNotificationPermission() }
            startPolling()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func signOut() {
        pollTask?.cancel()
        deviceFlowTask?.cancel()
        deviceFlowState = .idle
        Keychain.deleteCredentials()
        store.delete()
        client = nil
        authMode = nil
        snapshot = nil
        dismissals = [:]
        availableRepos = []
        setViewer(nil)
        setTrackedRepos([])
        phase = .needsToken
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Clears authentication state on revoked/expired token while keeping last snapshot visible.
    func handleSessionRevocation() {
        pollTask?.cancel()
        Keychain.deleteCredentials()
        client = nil
        authMode = nil
        availableRepos = []
        phase = .error("GitHub access was revoked or expired. Sign in again.")
    }

    private func setViewer(_ login: String?) {
        viewerLogin = login
        defaults.set(login, forKey: Key.viewer)
    }

    // MARK: Repositories

    func loadRepositories() async {
        guard let client else { return }
        isLoadingRepos = true
        defer { isLoadingRepos = false }
        do {
            if authMode == .githubApp {
                availableRepos = try await client.listAppInstallationRepositories()
            } else {
                availableRepos = try await client.listRepositories()
            }
        } catch {
            if (error as? GitHubError) == .unauthorized {
                handleSessionRevocation()
            } else {
                phase = .error(error.localizedDescription)
            }
        }
    }

    func isTracked(_ repo: RepoInfo) -> Bool {
        trackedRepos.contains { $0.caseInsensitiveCompare(repo.fullName) == .orderedSame }
    }

    func setTracked(_ repo: RepoInfo, _ on: Bool) {
        var next = trackedRepos.filter { $0.caseInsensitiveCompare(repo.fullName) != .orderedSame }
        if on { next.append(repo.fullName) }
        setTrackedRepos(next)
    }

    /// First run: the 8 most recently pushed repos that aren't archived or forks.
    private func autoSelectRepos() {
        let picks = availableRepos.filter { !$0.isArchived && !$0.isFork }.prefix(8).map(\.fullName)
        setTrackedRepos(Array(picks))
    }

    private func setTrackedRepos(_ repos: [String]) {
        trackedRepos = repos
        defaults.set(repos, forKey: Key.tracked)
        // Drop reports for repos that are no longer tracked.
        if var snap = snapshot {
            let keep = Set(repos.map { $0.lowercased() })
            snap.reports.removeAll { !keep.contains($0.repo.fullName.lowercased()) }
            snapshot = snap
            try? store.save(snap)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    // MARK: Settings

    func updateSettings(_ next: MonitorSettings) {
        settings = next
        if let data = try? JSONEncoder().encode(next) { defaults.set(data, forKey: Key.settings) }
    }

    func setPollMinutes(_ minutes: Int) {
        guard Self.pollChoices.contains(minutes) else { return }
        pollMinutes = minutes
        defaults.set(minutes, forKey: Key.poll)
        startPolling()
    }

    func setNotificationsEnabled(_ on: Bool) {
        notificationsEnabled = on
        defaults.set(on, forKey: Key.notifications)
        if on { requestNotificationPermission() }
    }

    func setLaunchAtLogin(_ on: Bool) -> String? {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: Sync

    func startPolling() {
        pollTask?.cancel()
        guard client != nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                let minutes = self?.pollMinutes ?? 10
                try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
            }
        }
    }

    func refresh() async {
        guard let client, phase != .syncing else { return }
        guard !trackedRepos.isEmpty else { phase = .idle; return }
        phase = .syncing
        do {
            let login: String
            if let viewerLogin {
                login = viewerLogin
            } else {
                login = try await client.viewerLogin()
                setViewer(login)
            }
            let previous = snapshot
            let next = try await SyncEngine.sync(client: client, fullNames: trackedRepos, viewerLogin: login,
                                                 settings: settings, previous: previous)
            let newAlerts = Triage.itemsToNotify(previous: previous?.allItems, current: next.allItems,
                                                 dismissals: dismissals, now: Date())
            snapshot = next
            dismissals = Triage.prune(dismissals, keeping: next.allItems)
            persist()
            rateLimitRemaining = await client.rateLimitRemaining
            phase = .idle
            if notificationsEnabled { post(newAlerts) }
        } catch {
            if (error as? GitHubError) == .unauthorized {
                handleSessionRevocation()
            } else {
                phase = .error(error.localizedDescription)
            }
        }
    }

    // MARK: Triage

    func dismiss(_ item: AttentionItem) {
        dismissals[item.id] = Dismissal(eventDate: item.eventDate)
        persist()
    }

    func snooze(_ item: AttentionItem, hours: Double = 24) {
        dismissals[item.id] = Dismissal(eventDate: item.eventDate, snoozedUntil: Date().addingTimeInterval(hours * 3600))
        persist()
    }

    func restoreHidden() {
        dismissals = [:]
        persist()
    }

    private func persist() {
        if let snapshot { try? store.save(snapshot) }
        try? store.saveDismissals(dismissals)
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: Notifications

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            if !granted {
                Task { @MainActor [weak self] in self?.setNotificationsEnabled(false) }
            }
        }
    }

    private func post(_ items: [AttentionItem]) {
        guard !items.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        // Collapse bursts into one notification.
        let content = UNMutableNotificationContent()
        if items.count == 1, let item = items.first {
            content.title = item.title
            content.subtitle = item.repoFullName
            content.body = item.description
            if let url = item.url { content.userInfo = ["url": url.absoluteString] }
        } else {
            content.title = "\(items.count) repositories need attention"
            content.body = items.prefix(3).map(\.title).joined(separator: "\n")
        }
        content.sound = items.contains { $0.severity == .critical } ? .default : nil
        center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    // MARK: Links

    func open(_ url: URL?) {
        guard let url else { return }
        NSWorkspace.shared.open(url)
    }
}
