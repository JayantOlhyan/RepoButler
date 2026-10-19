import AppKit
import RepoButlerCore
import SwiftUI
import UserNotifications

@main
struct RepoButlerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environment(model)
        } label: {
            MenuBarLabel(model: model)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environment(model)
        }
    }
}

/// Icon in the menu bar: a check when clear, a warning + count when something needs you.
struct MenuBarLabel: View {
    let model: AppModel

    var body: some View {
        let items = model.visibleItems
        let worst = items.map(\.severity).max()
        if !model.hasToken {
            Image(systemName: "shippingbox")
        } else if case .error = model.phase {
            Image(systemName: "exclamationmark.icloud")
        } else if items.isEmpty {
            Image(systemName: "checkmark.seal")
        } else {
            HStack(spacing: 3) {
                Image(systemName: worst == .critical ? "exclamationmark.octagon.fill" : "exclamationmark.triangle")
                Text("\(items.count)")
            }
        }
    }
}

/// Lets notification clicks open the relevant GitHub page, and shows banners while the app is active.
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let string = response.notification.request.content.userInfo["url"] as? String,
           let url = URL(string: string) {
            NSWorkspace.shared.open(url)
        }
        completionHandler()
    }
}
