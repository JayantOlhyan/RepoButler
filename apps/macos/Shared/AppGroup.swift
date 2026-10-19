import Foundation

/// Shared storage location for the app and the widget.
///
/// The App Group ID comes from Info.plist (`AppGroupID`), which Xcode expands to
/// `<TeamID>.com.jayantsolution.repobutler` at build time. On macOS a team-prefixed
/// group ID needs no provisioning-profile registration.
enum AppGroup {
    static var identifier: String {
        Bundle.main.object(forInfoDictionaryKey: "AppGroupID") as? String ?? ""
    }

    static var containerURL: URL {
        if !identifier.isEmpty,
           let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) {
            return url
        }
        // Unsigned/local builds: fall back to the app's own container.
        // The widget can't read this, but the menu bar app still works.
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("RepoButler", isDirectory: true)
    }
}
