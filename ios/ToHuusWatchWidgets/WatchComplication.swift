import SwiftUI
import WidgetKit

/// Watch face complication and Smart Stack widget: how much is open on the list and what is probably due next.
/// Reads the snapshot the watch app writes into the App Group (Shared/WidgetSnapshot.swift).
struct ListEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    var relevance: TimelineEntryRelevance? {
        // the Smart Stack moves the widget up while something is open
        TimelineEntryRelevance(score: Float(min(snapshot?.open ?? 0, 20)) * 5)
    }
}

struct ListProvider: TimelineProvider {
    func placeholder(in context: Context) -> ListEntry { ListEntry(date: .now, snapshot: .placeholderWatch) }

    func getSnapshot(in context: Context, completion: @escaping (ListEntry) -> Void) {
        completion(ListEntry(date: .now, snapshot: context.isPreview ? .placeholderWatch : WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ListEntry>) -> Void) {
        // the watch app reloads the timelines whenever the list changes
        completion(Timeline(entries: [ListEntry(date: .now, snapshot: WidgetSnapshot.load())], policy: .after(.now.addingTimeInterval(3600))))
    }
}

extension WidgetSnapshot {
    static let placeholderWatch = WidgetSnapshot(open: 4, items: ["Milch", "Brot"], household: nil, updatedAt: .now, nextDue: "Bananen")
}

struct ListComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ListEntry

    private var open: Int { entry.snapshot?.open ?? 0 }

    var body: some View {
        Group {
            switch family {
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Label(LF("%d open", open), systemImage: "cart")
                        .font(.headline)
                        .widgetAccentable()
                    if let due = entry.snapshot?.nextDue {
                        Text(LF("Probably due: %@", due)).font(.caption).lineLimit(1)
                    } else if let first = entry.snapshot?.items.first {
                        Text(first).font(.caption).lineLimit(1)
                    } else {
                        Text(L("Nothing missing right now.")).font(.caption).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            case .accessoryInline:
                Label(LF("%d open", open), systemImage: "cart")
            case .accessoryCorner:
                Image(systemName: "cart")
                    .font(.title3)
                    .widgetAccentable()
                    .widgetLabel(LF("%d open", open))
            default:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Image(systemName: "cart").font(.caption)
                        Text("\(open)").font(.title3.weight(.semibold)).widgetAccentable()
                    }
                }
            }
        }
        .containerBackground(.clear, for: .widget)
        .widgetURL(URL(string: "tohuus://shopping"))
    }
}

@main
struct ToHuusWatchComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ToHuusWatchList", provider: ListProvider()) { entry in
            ListComplicationView(entry: entry)
        }
        .configurationDisplayName(L("Shopping"))
        .description(L("What's missing at home, at a glance."))
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}
