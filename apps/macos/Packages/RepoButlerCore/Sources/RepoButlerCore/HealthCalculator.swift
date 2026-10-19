import Foundation

/// Deterministic 0–100 repository health score.
///
/// Port of `src/lib/health/calculator.ts`. Weights and formulas are identical;
/// intentional differences are marked `DIFF:`.
public enum HealthCalculator {
    public static let weights = (ci: 0.20, pr: 0.15, issue: 0.15, activity: 0.15,
                                 maintenance: 0.15, documentation: 0.10, release: 0.10)

    public static func calculate(_ data: RepoData, now: Date) -> HealthBreakdown {
        var reasons: [String] = []
        var recommendations: [String] = []

        // 1. CI reliability — last 15 default-branch runs.
        // DIFF: cancelled/skipped/neutral runs are excluded instead of counted as failures.
        let decided = data.workflowRuns.prefix(15).filter { $0.outcome == .passed || $0.outcome == .failed }
        var ciScore = 100
        if !decided.isEmpty {
            let passed = decided.filter { $0.outcome == .passed }.count
            ciScore = jsRound(Double(passed) / Double(decided.count) * 100)
            if ciScore < 90 {
                let failed = decided.count - passed
                reasons.append("CI failed \(failed) time\(failed > 1 ? "s" : "") in recent runs")
                recommendations.append("Fix failing builds in workflow pipelines")
            }
        }

        // 2. PR health — stale after 7 days without activity.
        var prScore = 100
        let openPRs = data.openPullRequests
        if !openPRs.isEmpty {
            let cutoff = now.addingTimeInterval(-7 * Time.day)
            let stale = openPRs.filter { $0.updatedAt < cutoff }
            prScore = max(0, 100 - jsRound(Double(stale.count) / Double(openPRs.count) * 50) - stale.count * 5)
            if let first = stale.first {
                reasons.append("\(stale.count) pull request\(stale.count > 1 ? "s are" : " is") stale (no activity for 7+ days)")
                recommendations.append("Review and merge or close stale PRs (e.g. PR #\(first.number))")
            }
        }

        // 3. Issue health — stale after 14 days without activity.
        var issueScore = 100
        let openIssues = data.openIssues
        if !openIssues.isEmpty {
            let cutoff = now.addingTimeInterval(-14 * Time.day)
            let stale = openIssues.filter { $0.updatedAt < cutoff }
            issueScore = max(0, 100 - jsRound(Double(stale.count) / Double(openIssues.count) * 40) - stale.count * 3)
            if let first = stale.first {
                reasons.append("\(stale.count) issue\(stale.count > 1 ? "s are" : " is") stale (inactive for 14+ days)")
                recommendations.append("Respond to or resolve open stale issues (e.g. Issue #\(first.number))")
            }
        }

        // 4. Activity — commits on the default branch in the last 14 days.
        let activityCutoff = now.addingTimeInterval(-14 * Time.day)
        let recentCommits = data.recentCommits.filter { $0.date >= activityCutoff }.count
        var activityScore = 100
        if recentCommits == 0 {
            activityScore = 20
            reasons.append("No active commits pushed in the last 14 days")
            recommendations.append("Push updates or refactor code to resume activity momentum")
        } else if recentCommits < 5 {
            activityScore = 70
        }

        // 5. Maintenance — days since last push.
        // DIFF: uses `pushed_at` rather than `updated_at` (stars/settings changes don't count).
        var maintenanceScore = 100
        if let pushedAt = data.repo.pushedAt {
            let days = Time.days(from: pushedAt, to: now)
            if days > 7 {
                maintenanceScore = max(0, jsRound(100 - (days - 7) * 2))
                if days > 14 { reasons.append("Repository has not been updated in \(jsRound(days)) days") }
            }
        } else {
            maintenanceScore = 0
            reasons.append("Repository has never been pushed to")
        }

        // 6. Documentation — description present.
        let hasDescription = !(data.repo.description ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        let documentationScore = hasDescription ? 100 : 50
        if !hasDescription {
            reasons.append("Repository is missing a description")
            recommendations.append("Add a descriptive summary in GitHub repository settings")
        }

        // 7. Release health.
        var releaseScore = 100
        if let release = data.latestRelease {
            let days = Time.days(from: release.publishedAt, to: now)
            if days > 90 {
                releaseScore = max(0, jsRound(80 - (days - 90) * 0.2))
                reasons.append("No new release version published in \(jsRound(days)) days")
                recommendations.append("Publish a new release tag for recent code improvements")
            }
        } else {
            releaseScore = 50
            recommendations.append("Create a release version tag to establish stable milestones")
        }

        let w = weights
        let weighted = Double(ciScore) * w.ci + Double(prScore) * w.pr + Double(issueScore) * w.issue
            + Double(activityScore) * w.activity + Double(maintenanceScore) * w.maintenance
            + Double(documentationScore) * w.documentation + Double(releaseScore) * w.release

        return HealthBreakdown(
            score: jsRound(weighted), ciScore: ciScore, prScore: prScore, issueScore: issueScore,
            activityScore: activityScore, maintenanceScore: maintenanceScore,
            documentationScore: documentationScore, releaseScore: releaseScore,
            reasons: reasons, recommendations: recommendations)
    }
}
