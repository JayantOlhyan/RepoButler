import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import RepoButlerCore

final class GitHubAuthTests: XCTestCase {
    func testRequestDeviceCodeSuccess() async throws {
        let t = FakeTransport()
        t.on("/login/device/code", status: 200, body: """
        {
            "device_code": "dev123",
            "user_code": "USER-456",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 900,
            "interval": 5
        }
        """)

        let resp = try await GitHubAuth.requestDeviceCode(clientID: "test-client-id", transport: t)
        XCTAssertEqual(resp.deviceCode, "dev123")
        XCTAssertEqual(resp.userCode, "USER-456")
        XCTAssertEqual(resp.verificationURI.absoluteString, "https://github.com/login/device")
        XCTAssertEqual(resp.expiresIn, 900)
        XCTAssertEqual(resp.interval, 5)

        let req = t.requests.first
        XCTAssertEqual(req?.httpMethod, "POST")
        XCTAssertEqual(req?.url?.path, "/login/device/code")
        if let bodyData = req?.httpBody, let bodyStr = String(data: bodyData, encoding: .utf8) {
            XCTAssertTrue(bodyStr.contains("client_id=test-client-id"))
        } else {
            XCTFail("Request missing body")
        }
    }

    func testPollForTokenHappyPath() async throws {
        let t = FakeTransport()
        t.on("/login/oauth/access_token", status: 200, body: """
        {
            "access_token": "ghu_secret123",
            "token_type": "bearer",
            "scope": ""
        }
        """)

        let token = try await GitHubAuth.pollForToken(
            clientID: "test-client-id",
            deviceCode: "dev123",
            initialInterval: 5,
            transport: t,
            sleeper: { _ in }
        )
        XCTAssertEqual(token, "ghu_secret123")
    }

    func testPollForTokenPendingThenSuccess() async throws {
        let t = FakeTransport()
        var calls = 0
        t.on("/login/oauth/access_token") { _ in
            calls += 1
            if calls < 3 {
                return .init(status: 200, body: #"{"error": "authorization_pending"}"#)
            } else {
                return .init(status: 200, body: #"{"access_token": "ghu_success_token", "token_type": "bearer"}"#)
            }
        }

        var sleepDurations: [UInt64] = []
        let token = try await GitHubAuth.pollForToken(
            clientID: "test-client-id",
            deviceCode: "dev123",
            initialInterval: 5,
            transport: t,
            sleeper: { ns in sleepDurations.append(ns) }
        )

        XCTAssertEqual(token, "ghu_success_token")
        XCTAssertEqual(calls, 3)
        XCTAssertEqual(sleepDurations.count, 2)
        XCTAssertEqual(sleepDurations, [5_000_000_000, 5_000_000_000])
    }

    func testPollForTokenSlowDownIncreasesInterval() async throws {
        let t = FakeTransport()
        var calls = 0
        t.on("/login/oauth/access_token") { _ in
            calls += 1
            if calls == 1 {
                return .init(status: 200, body: #"{"error": "slow_down"}"#)
            } else {
                return .init(status: 200, body: #"{"access_token": "ghu_slowdown_recovered"}"#)
            }
        }

        var sleepDurations: [UInt64] = []
        let token = try await GitHubAuth.pollForToken(
            clientID: "test-client-id",
            deviceCode: "dev123",
            initialInterval: 5,
            transport: t,
            sleeper: { ns in sleepDurations.append(ns) }
        )

        XCTAssertEqual(token, "ghu_slowdown_recovered")
        XCTAssertEqual(calls, 2)
        // Interval was 5s, slow_down added 5s -> next sleep should be 10s
        XCTAssertEqual(sleepDurations, [10_000_000_000])
    }

    func testPollForTokenExpired() async throws {
        let t = FakeTransport()
        t.on("/login/oauth/access_token", status: 200, body: #"{"error": "expired_token"}"#)

        do {
            _ = try await GitHubAuth.pollForToken(
                clientID: "client",
                deviceCode: "dev",
                initialInterval: 5,
                transport: t,
                sleeper: { _ in }
            )
            XCTFail("Expected expired_token error")
        } catch let err as GitHubAuthError {
            XCTAssertEqual(err, .expiredToken)
            XCTAssertEqual(err.localizedDescription, "Code expired. Try again.")
        }
    }

    func testPollForTokenAccessDenied() async throws {
        let t = FakeTransport()
        t.on("/login/oauth/access_token", status: 200, body: #"{"error": "access_denied"}"#)

        do {
            _ = try await GitHubAuth.pollForToken(
                clientID: "client",
                deviceCode: "dev",
                initialInterval: 5,
                transport: t,
                sleeper: { _ in }
            )
            XCTFail("Expected access_denied error")
        } catch let err as GitHubAuthError {
            XCTAssertEqual(err, .accessDenied)
            XCTAssertEqual(err.localizedDescription, "Authorization was cancelled on GitHub.")
        }
    }

    func testPollForTokenCancellation() async throws {
        let t = FakeTransport()
        t.on("/login/oauth/access_token", status: 200, body: #"{"error": "authorization_pending"}"#)

        let task = Task {
            try await GitHubAuth.pollForToken(
                clientID: "client",
                deviceCode: "dev",
                initialInterval: 5,
                transport: t,
                sleeper: { _ in
                    try await Task.sleep(nanoseconds: 100_000_000)
                }
            )
        }

        try await Task.sleep(nanoseconds: 20_000_000)
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
    }
}
