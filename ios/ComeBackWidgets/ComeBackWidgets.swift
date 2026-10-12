import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct ComeBackWidgets: WidgetBundle {
    var body: some Widget { SitLiveActivity() }
}

private let night = Color(red: 0.051, green: 0.102, blue: 0.122)
private let glow = Color(red: 0.98, green: 0.80, blue: 0.55)

struct SitLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SitAttributes.self) { context in
            SitLockView(state: context.state)
                .padding(.horizontal, 20).padding(.vertical, 16)
                .activityBackgroundTint(night)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) { Orb(size: 22); Text(context.state.paused ? "Paused" : "Sitting").font(.subheadline).foregroundStyle(.secondary) }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    SitButton(paused: context.state.paused, size: 44)
                }
                DynamicIslandExpandedRegion(.center) {
                    SitTimer(state: context.state).font(.system(size: 34, weight: .light, design: .rounded))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(returnsText(context.state.count)).font(.footnote).foregroundStyle(.secondary)
                }
            } compactLeading: {
                Orb(size: 18)
            } compactTrailing: {
                SitTimer(state: context.state).frame(width: 52).foregroundStyle(glow)
            } minimal: {
                Orb(size: 18)
            }
        }
    }
}

private func returnsText(_ n: Int) -> String { n == 1 ? "1 return" : "\(n) returns" }

struct SitLockView: View {
    let state: SitAttributes.ContentState
    var body: some View {
        HStack(spacing: 14) {
            Orb(size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text(state.paused ? "Come back · Paused" : "Come back").font(.caption).foregroundStyle(.secondary)
                SitTimer(state: state).font(.system(size: 38, weight: .light, design: .rounded)).foregroundStyle(.white)
                Text(returnsText(state.count)).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            SitButton(paused: state.paused, size: 56)
        }
    }
}

/// Counts by itself on the lock screen with no updates from the app; when paused it holds still.
struct SitTimer: View {
    let state: SitAttributes.ContentState
    var body: some View {
        let span = state.limit > 0 ? state.limit : 86_400
        Text(timerInterval: state.start...state.start.addingTimeInterval(span),
             pauseTime: state.paused ? state.start.addingTimeInterval(state.frozen) : nil,
             countsDown: state.limit > 0,
             showsHours: state.limit >= 3600)
            .monospacedDigit()
            .lineLimit(1)
            .multilineTextAlignment(.leading)
    }
}

struct SitButton: View {
    let paused: Bool
    let size: CGFloat
    var body: some View {
        Button(intent: SitPauseIntent(pause: !paused)) {
            Image(systemName: paused ? "play.fill" : "pause.fill")
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(Circle().fill(Color.white.opacity(0.16)))
        }
        .buttonStyle(.plain)
    }
}

struct Orb: View {
    let size: CGFloat
    var body: some View {
        Circle()
            .fill(RadialGradient(colors: [glow, Color(red: 0.55, green: 0.38, blue: 0.22)], center: UnitPoint(x: 0.38, y: 0.34), startRadius: 0, endRadius: size * 0.7))
            .frame(width: size, height: size)
    }
}
