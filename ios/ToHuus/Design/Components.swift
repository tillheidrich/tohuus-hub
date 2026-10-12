import SwiftUI
import UIKit

/// A flat card with a contour (the web is flat with contours; only floating layers cast a shadow).
struct Card<Content: View>: View {
    var title: String?
    var systemImage: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            if let title {
                HStack(spacing: Theme.Space.s2) {
                    if let systemImage { Image(systemName: systemImage).foregroundStyle(Theme.primaryText) }
                    Text(title).font(.headline).foregroundStyle(Theme.ink)
                    Spacer(minLength: 0)
                }
                .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }
}

/// Small pill with text and a dot (status: never colour alone).
struct StatusPill: View {
    let text: String
    let status: String?

    var body: some View {
        let c = StatusStyle.colors(status) ?? (Theme.ink2, Theme.surface2)
        HStack(spacing: 4) {
            Circle().fill(c.fg).frame(width: 6, height: 6)
            Text(text).font(.caption.weight(.medium))
        }
        .foregroundStyle(c.fg)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(c.bg, in: Capsule())
    }
}

struct EmptyStateView: View {
    let systemImage: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: Theme.Space.s3) {
            Image(systemName: systemImage)
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(Theme.sage)
            Text(title).font(.headline).foregroundStyle(Theme.ink)
            if let message {
                Text(message).font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            }
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity)
    }
}

/// Inline error with retry.
struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(Theme.low)
            Text(message).font(.subheadline).foregroundStyle(Theme.ink)
            Spacer(minLength: 0)
            if let retry { Button(L("Try again"), action: retry).font(.subheadline.weight(.semibold)) }
        }
        .padding(Theme.Space.s3)
        .background(Theme.lowSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
    }
}

/// Offline / pending indicator for the list.
struct SyncBadge: View {
    let online: Bool
    let pending: Int

    var body: some View {
        if !online || pending > 0 {
            HStack(spacing: 6) {
                Image(systemName: online ? "arrow.triangle.2.circlepath" : "wifi.slash")
                Text(online ? LF("%d changes are being sent", pending) : (pending > 0 ? LF("Offline · %d changes wait", pending) : L("Offline")))
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(Theme.info)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.infoSoft, in: Capsule())
            .accessibilityElement(children: .combine)
        }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.onPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(configuration.isPressed ? Theme.primaryDark : Theme.primary, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.11), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Theme.primaryText)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(configuration.isPressed ? Theme.primarySoft : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.lineStrong, lineWidth: 1))
    }
}

/// Image from the server, loaded with the session token (cloud images are not public).
struct RemoteImage: View {
    let url: URL?
    let api: APIClient?
    var placeholder = "photo"
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Theme.surface2
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: placeholder).foregroundStyle(Theme.ink3)
            }
        }
        .clipped()
        .task(id: url) { await load() }
    }

    private func load() async {
        guard let url else { return }
        if let cached = ImageCache.shared.image(for: url) { image = cached; return }
        var req = URLRequest(url: url)
        if let token = api?.token, url.host() == api?.baseURL.host() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let hh = api?.householdId, url.host() == api?.baseURL.host() { req.setValue(hh, forHTTPHeaderField: "X-Household") }
        guard let (data, _) = try? await URLSession.shared.data(for: req), let img = UIImage(data: data) else { return }
        ImageCache.shared.set(img, for: url)
        image = img
    }
}

final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()
    private let cache = NSCache<NSURL, UIImage>()
    func image(for url: URL) -> UIImage? { cache.object(forKey: url as NSURL) }
    func set(_ img: UIImage, for url: URL) { cache.setObject(img, forKey: url as NSURL) }
}

enum Haptics {
    @MainActor static func tick() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    @MainActor static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}

enum Money {
    static func format(_ value: Double?, currency: String? = nil) -> String {
        guard let value else { return "–" }
        let code = currency ?? (Locale.current.currency?.identifier ?? "EUR")
        return value.formatted(.currency(code: code).precision(.fractionLength(value.rounded() == value ? 0 : 2)))
    }
}

extension View {
    /// Screen background in the brand canvas colour.
    func canvasBackground() -> some View {
        background(Theme.canvas.ignoresSafeArea())
    }
}
