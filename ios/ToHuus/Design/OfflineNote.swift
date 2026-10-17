import SwiftUI

/// "Offline · Stand von 14:32": shown instead of an error while a screen shows the last stored answer because
/// ToHuus can't be reached (ResponseCache / OfflineReads). Disappears by itself once a fresh answer arrives.
struct OfflineNote: View {
    let since: Date

    /// The note for these API paths (e.g. ["api/care"]), or nothing while they are fresh.
    @MainActor
    static func `for`(_ paths: [String]) -> OfflineNote? {
        OfflineReads.shared.since(paths).map { OfflineNote(since: $0) }
    }

    private var stamp: String {
        Calendar.current.isDateInToday(since)
            ? since.formatted(date: .omitted, time: .shortened)
            : since.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: "wifi.slash").foregroundStyle(Theme.info)
            VStack(alignment: .leading, spacing: 2) {
                Text(LF("Offline · as of %@", stamp)).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(L("You're seeing the last saved state. Changes work again once ToHuus is reachable."))
                    .font(.footnote).foregroundStyle(Theme.ink.opacity(0.75))
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.s3)
        .background(Theme.infoSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
        .accessibilityElement(children: .combine)
    }
}
