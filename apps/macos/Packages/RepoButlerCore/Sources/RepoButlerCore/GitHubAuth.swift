import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Device authorization grant error codes and failures returned by GitHub.
public enum GitHubAuthError: Error, Equatable, LocalizedError {
    case authorizationPending
    case slowDown
    case expiredToken
    case accessDenied
    case incorrectDeviceCode
    case deviceFlowDisabled
    case unknown(String)
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .authorizationPending:
            "Authorization is pending."
        case .slowDown:
            "Polling too quickly."
        case .expiredToken:
            "Code expired. Try again."
        case .accessDenied:
            "Authorization was cancelled on GitHub."
        case .incorrectDeviceCode:
            "Invalid device code."
        case .deviceFlowDisabled:
            "Device flow is not enabled for this application."
        case .unknown(let msg):
            "Authentication error: \(msg)"
        case .transport(let detail):
            "Network error: \(detail)"
        }
    }
}

/// Information returned after requesting a device code from GitHub.
public struct DeviceCodeResponse: Equatable, Sendable {
    public let deviceCode: String
    public let userCode: String
    public let verificationURI: URL
    public let expiresIn: Int
    public let interval: Int

    public init(deviceCode: String, userCode: String, verificationURI: URL, expiresIn: Int, interval: Int) {
        self.deviceCode = deviceCode
        self.userCode = userCode
        self.verificationURI = verificationURI
        self.expiresIn = expiresIn
        self.interval = interval
    }
}

/// Authentication service for the GitHub App device flow.
public enum GitHubAuth {
    public static let githubBase = URL(string: "https://github.com")!

    private struct DeviceCodeDTO: Decodable {
        let deviceCode: String
        let userCode: String
        let verificationUri: URL
        let expiresIn: Int
        let interval: Int?
    }

    private struct TokenResponseDTO: Decodable {
        let accessToken: String?
        let tokenType: String?
        let scope: String?
        let error: String?
        let errorDescription: String?
    }

    /// Requests a user and device verification code from GitHub.
    public static func requestDeviceCode(
        clientID: String,
        transport: HTTPTransport = URLSessionTransport()
    ) async throws -> DeviceCodeResponse {
        var request = URLRequest(url: githubBase.appendingPathComponent("login/device/code"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("RepoButler-macOS", forHTTPHeaderField: "User-Agent")

        let bodyParams = ["client_id": clientID]
        request.httpBody = formURLEncode(bodyParams).data(using: .utf8)

        let data: Data, response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch let err as GitHubAuthError {
            throw err
        } catch {
            throw GitHubAuthError.transport(error.localizedDescription)
        }

        guard response.statusCode == 200 else {
            throw GitHubAuthError.transport("HTTP \(response.statusCode)")
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let dto = try decoder.decode(DeviceCodeDTO.self, from: data)
        return DeviceCodeResponse(
            deviceCode: dto.deviceCode,
            userCode: dto.userCode,
            verificationURI: dto.verificationUri,
            expiresIn: dto.expiresIn,
            interval: dto.interval ?? 5
        )
    }

    /// Polls GitHub's token endpoint until the user authorizes, denies, or the code expires.
    /// Supports Task cancellation.
    public static func pollForToken(
        clientID: String,
        deviceCode: String,
        initialInterval: Int = 5,
        transport: HTTPTransport = URLSessionTransport(),
        sleeper: @Sendable (UInt64) async throws -> Void = { nanoseconds in
            try await Task.sleep(nanoseconds: nanoseconds)
        }
    ) async throws -> String {
        var currentInterval = max(initialInterval, 1)

        while !Task.isCancelled {
            try Task.checkCancellation()

            var request = URLRequest(url: githubBase.appendingPathComponent("login/oauth/access_token"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.setValue("RepoButler-macOS", forHTTPHeaderField: "User-Agent")

            let params = [
                "client_id": clientID,
                "device_code": deviceCode,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
            ]
            request.httpBody = formURLEncode(params).data(using: .utf8)

            let data: Data, response: HTTPURLResponse
            do {
                (data, response) = try await transport.send(request)
            } catch let err as GitHubAuthError {
                throw err
            } catch {
                throw GitHubAuthError.transport(error.localizedDescription)
            }

            guard response.statusCode == 200 else {
                throw GitHubAuthError.transport("HTTP \(response.statusCode)")
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let tokenDTO = try decoder.decode(TokenResponseDTO.self, from: data)

            if let token = tokenDTO.accessToken, !token.isEmpty {
                return token
            }

            guard let errorCode = tokenDTO.error else {
                throw GitHubAuthError.unknown("Missing access_token and error in response")
            }

            switch errorCode {
            case "authorization_pending":
                // Wait the current interval and retry
                try await sleeper(UInt64(currentInterval) * 1_000_000_000)
            case "slow_down":
                currentInterval += 5
                try await sleeper(UInt64(currentInterval) * 1_000_000_000)
            case "expired_token":
                throw GitHubAuthError.expiredToken
            case "access_denied":
                throw GitHubAuthError.accessDenied
            case "incorrect_device_code":
                throw GitHubAuthError.incorrectDeviceCode
            case "device_flow_disabled":
                throw GitHubAuthError.deviceFlowDisabled
            default:
                throw GitHubAuthError.unknown(tokenDTO.errorDescription ?? errorCode)
            }
        }

        throw CancellationError()
    }

    private static func formURLEncode(_ parameters: [String: String]) -> String {
        parameters.map { key, value in
            let escapedKey = key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? key
            let escapedVal = value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
            return "\(escapedKey)=\(escapedVal)"
        }.joined(separator: "&")
    }
}
