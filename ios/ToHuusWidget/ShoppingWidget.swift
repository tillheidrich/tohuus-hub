import SwiftUI
import UIKit
import WidgetKit

struct ShoppingEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct ShoppingProvider: TimelineProvider {
    func placeholder(in context: Context) -> ShoppingEntry { ShoppingEntry(date: Date(), snapshot: .placeholder) }

    func getSnapshot(in context: Context, completion: @escaping (ShoppingEntry) -> Void) {
        completion(ShoppingEntry(date: Date(), snapshot: context.isPreview ? .placeholder : WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ShoppingEntry>) -> Void) {
        // the app reloads the timeline whenever the list changes; this is only a fallback
        let entry = ShoppingEntry(date: Date(), snapshot: WidgetSnapshot.load())
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
    }
}

struct ShoppingWidgetView: View {
    let entry: ShoppingEntry
    @Environment(\.widgetFamily) private var family
    /// brand green, lighter in dark mode (Theme.primaryText)
    private let green = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.45, green: 0.80, blue: 0.64, alpha: 1) : UIColor(red: 0.09, green: 0.42, blue: 0.31, alpha: 1) })
    private let surface = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.09, green: 0.13, blue: 0.11, alpha: 1) : .white })

    var body: some View {
        switch family {
        case .accessoryInline:
            // lock screen, one line above the time
            if let s = entry.snapshot {
                Label(s.open == 0 ? L("Nothing missing") : LF("%d missing", s.open), systemImage: "cart")
                    .containerBackground(for: .widget) { Color.clear }
            } else {
                Label(L("Shopping"), systemImage: "cart").containerBackground(for: .widget) { Color.clear }
            }
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "cart").font(.caption)
                    Text("\(entry.snapshot?.open ?? 0)").font(.title3.weight(.semibold)).contentTransition(.numericText())
                }
            }
            .accessibilityLabel(LF("%d missing", entry.snapshot?.open ?? 0))
            .containerBackground(for: .widget) { Color.clear }
            .widgetURL(URL(string: "tohuus://shopping"))
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Label(LF("%d missing", entry.snapshot?.open ?? 0), systemImage: "cart").font(.headline).widgetAccentable()
                ForEach((entry.snapshot?.items ?? []).prefix(2), id: \.self) { Text($0).font(.caption).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(for: .widget) { Color.clear }
            .widgetURL(URL(string: "tohuus://shopping"))
        case .systemMedium:
            HStack(alignment: .top, spacing: 16) {
                small.frame(width: 110, alignment: .leading)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach((entry.snapshot?.items ?? []).prefix(4), id: \.self) { name in
                        Label(name, systemImage: "circle").font(.subheadline).lineLimit(1).labelStyle(.titleAndIcon)
                    }
                    if let due = entry.snapshot?.nextDue {
                        Text(LF("Probably due: %@", due)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }
            }
            .containerBackground(for: .widget) { surface }
            .widgetURL(URL(string: "tohuus://shopping"))
        default:
            small
                .containerBackground(for: .widget) { surface }
                .widgetURL(URL(string: "tohuus://shopping"))
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "cart").foregroundStyle(green)
                Text(L("Shopping")).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            if let s = entry.snapshot {
                Text("\(s.open)").font(.system(size: 34, weight: .semibold, design: .rounded)).foregroundStyle(green)
                    .contentTransition(.numericText())
                if s.items.isEmpty {
                    Text(L("Nothing missing right now.")).font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(s.items.prefix(3), id: \.self) { name in
                        Text(name).font(.caption).lineLimit(1)
                    }
                }
            } else {
                Text(L("Open ToHuus once to see your list here.")).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ShoppingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ToHuusShopping", provider: ShoppingProvider()) { entry in
            ShoppingWidgetView(entry: entry)
        }
        .configurationDisplayName(L("Shopping"))
        .description(L("What's missing at home, at a glance."))
        // home screen small/medium, lock screen round, rectangular and one line (also StandBy and the Smart Stack)
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct ToHuusWidgets: WidgetBundle {
    var body: some Widget {
        ShoppingWidget()
        TripActivityWidget()
    }
}
