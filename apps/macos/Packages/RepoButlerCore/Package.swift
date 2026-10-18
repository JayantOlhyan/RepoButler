// swift-tools-version:5.10
import PackageDescription

// Platform-neutral core for the RepoButler macOS app.
// Foundation only: no SwiftUI/AppKit here, so the rules and the GitHub
// client can be unit-tested with `swift test` (also on Linux CI).
let package = Package(
    name: "RepoButlerCore",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "RepoButlerCore", targets: ["RepoButlerCore"]),
    ],
    targets: [
        .target(name: "RepoButlerCore"),
        .testTarget(name: "RepoButlerCoreTests", dependencies: ["RepoButlerCore"]),
    ]
)
