import ActivityKit
import SwiftUI
import WidgetKit

/// "Einkauf läuft" – lock screen banner and Dynamic Island (attributes: Shared/ShoppingTripAttributes.swift).
struct TripActivityWidget: Widget {
    private let green = Color(red: 0.09, green: 0.42, blue: 0.31)
    private let mint = Color(red: 0.45, green: 0.80, blue: 0.64)

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShoppingTripAttributes.self) { context in
            lockScreen(context.state)
                .padding(14)
                .activityBackgroundTint(Color(red: 0.06, green: 0.08, blue: 0.07))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "tohuus://shopping"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("\(context.state.basket)", systemImage: "basket.fill")
                        .font(.title3.weight(.semibold)).foregroundStyle(mint)
                        .accessibilityLabel(LF("%d in the basket", context.state.basket))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(LF("%d open", context.state.open)).font(.headline).foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.store ?? L("Shopping")).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !context.state.addOns.isEmpty {
                        Text(LF("Bring along: %@", context.state.addOns.joined(separator: ", ")))
                            .font(.subheadline).foregroundStyle(mint).lineLimit(2)
                    }
                }
            } compactLeading: {
                Image(systemName: "basket.fill").foregroundStyle(mint)
            } compactTrailing: {
                Text("\(context.state.open)").font(.headline.monospacedDigit()).foregroundStyle(.white)
                    .accessibilityLabel(LF("%d open", context.state.open))
            } minimal: {
                Text("\(context.state.open)").font(.caption.weight(.bold)).foregroundStyle(mint)
            }
            .widgetURL(URL(string: "tohuus://shopping"))
        }
    }

    private func lockScreen(_ s: ShoppingTripAttributes.ContentState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(s.store ?? L("Shopping"), systemImage: "cart.fill").font(.headline).foregroundStyle(.white)
                Spacer()
                Text(LF("%d open", s.open)).font(.headline.monospacedDigit()).foregroundStyle(mint)
            }
            Text(LF("%d in the basket", s.basket)).font(.subheadline).foregroundStyle(.white.opacity(0.8))
            if !s.addOns.isEmpty {
                Text(LF("Bring along: %@", s.addOns.joined(separator: ", "))).font(.subheadline.weight(.semibold)).foregroundStyle(mint).lineLimit(2)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
