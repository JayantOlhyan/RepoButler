import SwiftUI
import RepoButlerCore

extension Severity {
    var color: Color {
        switch self {
        case .critical: .red
        case .high: .orange
        case .medium: .yellow
        case .low: .secondary
        }
    }

    var label: String {
        switch self {
        case .critical: "Critical"
        case .high: "High"
        case .medium: "Medium"
        case .low: "Low"
        }
    }
}

enum ScoreStyle {
    static func color(_ score: Int?) -> Color {
        guard let score else { return .secondary }
        if score >= 80 { return .green }
        if score >= 60 { return .orange }
        return .red
    }
}

/// Circular 0–100 health gauge.
struct ScoreRing: View {
    let score: Int?
    var lineWidth: CGFloat = 5
    var font: Font = .system(.title3, design: .rounded).weight(.semibold)

    var body: some View {
        ZStack {
            Circle().stroke(.quaternary, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: CGFloat(score ?? 0) / 100)
                .stroke(ScoreStyle.color(score), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(score.map(String.init) ?? "–")
                .font(font)
                .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(score.map { "Health score \($0) out of 100" } ?? "No health score yet")
    }
}

struct SeverityDot: View {
    let severity: Severity
    var body: some View {
        Circle()
            .fill(severity.color)
            .frame(width: 8, height: 8)
            .accessibilityLabel("\(severity.label) priority")
    }
}
