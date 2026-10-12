import SwiftUI
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
    private let green = Color(red: 0.09, green: 0.42, blue: 0.31)

    var body: some View {
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
        .containerBackground(for: .widget) { Color.white }
        .widgetURL(URL(string: "tohuus://shopping"))
    }
}

struct ShoppingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ToHuusShopping", provider: ShoppingProvider()) { entry in
            ShoppingWidgetView(entry: entry)
        }
        .configurationDisplayName(L("Shopping"))
        .description(L("What's missing at home, at a glance."))
        .supportedFamilies([.systemSmall])
    }
}

@main
struct ToHuusWidgets: WidgetBundle {
    var body: some Widget { ShoppingWidget() }
}
