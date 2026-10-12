import ActivityKit
import UIKit

/// Keeps the lock-screen Live Activity in step with the sit running in the web page, and carries the
/// Live Activity's pause / resume button back to the page (or holds it until the page is there to hear it).
final class SitCoordinator {
    static let shared = SitCoordinator()

    weak var web: WebViewController?
    private var pageReady = false
    private var activity: Activity<SitAttributes>?
    private var state: SitAttributes.ContentState?
    private var background = UIBackgroundTaskIdentifier.invalid

    /// A lock-screen press the page hasn't acknowledged yet.
    private var pending: (pause: Bool, at: Date)? {
        get {
            guard let d = UserDefaults.standard.dictionary(forKey: SitCommandHub.pendingKey),
                  let p = d["pause"] as? Bool, let t = d["at"] as? Double else { return nil }
            return (p, Date(timeIntervalSince1970: t))
        }
        set { if newValue == nil { UserDefaults.standard.removeObject(forKey: SitCommandHub.pendingKey) } }
    }

    private init() {
        SitCommandHub.handler = { [weak self] pause, at in self?.command(pause: pause, at: at) }
    }

    func start() {}   // touching `shared` is enough; this just reads better at the call site

    // MARK: page -> native

    func pageDidLoad() { pageReady = false }
    func pageTerminated() { pageReady = false }

    func pageIsReady() {
        pageReady = true
        flushPending()
    }

    func sit(_ m: [String: Any]) {
        let ack = m["ack"] as? Bool ?? false
        if ack { pending = nil; endBackground() }
        else if pending != nil { return }   // the page is describing a state older than the press we're about to deliver
        guard m["active"] as? Bool == true else { end(); return }
        func num(_ k: String) -> Double { (m[k] as? NSNumber)?.doubleValue ?? 0 }
        let start = Date(timeIntervalSince1970: num("start") / 1000)
        let paused = m["paused"] as? Bool ?? false
        let at = Date(timeIntervalSince1970: num("at") / 1000)
        push(.init(paused: paused, count: Int(num("count")), start: start,
                   frozen: paused ? max(0, at.timeIntervalSince(start)) : 0, limit: num("limit") / 1000))
    }

    // MARK: lock screen -> native

    private func command(pause: Bool, at: Date) {
        if background == .invalid {
            background = UIApplication.shared.beginBackgroundTask { [weak self] in self?.endBackground() }
        }
        // Show the new state on the lock screen straight away, without waiting for the page.
        if var s = state, s.paused != pause {
            if pause { s.frozen = max(0, at.timeIntervalSince(s.start)) }
            else { s.start = at.addingTimeInterval(-s.frozen) }
            s.paused = pause
            push(s)
        }
        if pageReady { flushPending() }
    }

    private func flushPending() {
        guard let p = pending else { return }
        web?.evaluate("window.CB_NATIVE_PAUSE && window.CB_NATIVE_PAUSE(\(p.pause), \(Int(p.at.timeIntervalSince1970 * 1000)))")
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.endBackground() }
    }

    private func endBackground() {
        if background != .invalid { UIApplication.shared.endBackgroundTask(background); background = .invalid }
    }

    // MARK: Live Activity

    private func push(_ s: SitAttributes.ContentState) {
        state = s
        let content = ActivityContent(state: s, staleDate: nil)
        if activity == nil { activity = Activity<SitAttributes>.activities.first }
        if let a = activity {
            Task { await a.update(content) }
        } else if ActivityAuthorizationInfo().areActivitiesEnabled {
            activity = try? Activity.request(attributes: SitAttributes(), content: content, pushType: nil)
        }
    }

    private func end() {
        state = nil
        activity = nil
        for a in Activity<SitAttributes>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } }
    }
}
