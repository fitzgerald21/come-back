import ActivityKit
import AppIntents
import Foundation

/// What the lock screen / Dynamic Island shows for a sit in progress. Compiled into both the app and the widget extension.
struct SitAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var paused: Bool
        var count: Int
        /// While running, elapsed time is `now - start` (start already skips any paused time).
        var start: Date
        /// Elapsed seconds at the moment the sit was paused.
        var frozen: TimeInterval
        /// Chosen length in seconds, or 0 for an open-ended sit.
        var limit: TimeInterval
    }
}

/// Where a lock-screen press is delivered. The app sets `handler` at launch; `perform` also leaves the request in
/// UserDefaults so it isn't lost if the app wasn't running yet.
enum SitCommandHub {
    static let pendingKey = "cb.pendingSitCommand"
    static var handler: ((Bool, Date) -> Void)?
}

/// The pause / play button on the Live Activity. The system runs this in the app's process, not the extension's.
struct SitPauseIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Pause or resume the sit"
    static let isDiscoverable = false
    /// Pausing a sit isn't sensitive; don't make anyone unlock the phone to do it from the lock screen.
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Pause") var pause: Bool

    init() {}
    init(pause: Bool) { self.pause = pause }

    func perform() async throws -> some IntentResult {
        let now = Date()
        UserDefaults.standard.set(["pause": pause, "at": now.timeIntervalSince1970], forKey: SitCommandHub.pendingKey)
        DispatchQueue.main.async { SitCommandHub.handler?(pause, now) }
        return .result()
    }
}
