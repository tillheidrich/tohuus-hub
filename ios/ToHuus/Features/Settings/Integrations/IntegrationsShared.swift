import SwiftUI
import UIKit
import CoreImage

// Shared helpers for Settings › Notifications, Connections and Data (docs/ios-native-integrations.md).

/// A key with its (already localised) label – for ForEach without tuples.
struct IxPair: Identifiable, Hashable, Sendable {
    var key: String
    var label: String
    var id: String { key }
    init(_ key: String, _ label: String) { self.key = key; self.label = label }
}

// MARK: plain JSON

extension APIClient {
    /// GET without snake-case conversion: event keys ("auth.new_device") and Home Assistant entity ids
    /// ("person.mika_b") are dictionary keys there and must stay exactly as the server sends them.
    func ixRaw(_ path: String, query: [URLQueryItem] = []) async throws -> JSONValue {
        let data = try await getData(path, query: query)
        do { return try JSONDecoder().decode(JSONValue.self, from: data) } catch { throw APIError.decoding(String(describing: error)) }
    }

    /// Any method, answer as plain JSON (no key conversion). An empty body is `.null`.
    /// Main actor: the `[String: Any]` body is serialised here, so nothing non-Sendable crosses into the network task.
    @MainActor
    func ixRawSend(_ method: String, _ path: String, json: [String: Any]? = nil, timeout: TimeInterval = 30) async throws -> JSONValue {
        var req = try request(method, path, timeout: timeout)
        var body: Data? = nil
        if let json {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            body = try JSONSerialization.data(withJSONObject: json)
        }
        let data = try await perform(req, body: body)
        if data.isEmpty { return .null }
        return (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? .null
    }

    /// Files (export, backups, move file): raw bytes with a long timeout.
    func ixDownload(_ path: String, query: [URLQueryItem] = [], timeout: TimeInterval = 300) async throws -> Data {
        try await perform(try request("GET", path, query: query, timeout: timeout))
    }

    /// Multipart upload, answer as plain JSON.
    @MainActor
    func ixUpload(_ path: String, multipart: Multipart, timeout: TimeInterval = 300) async throws -> JSONValue {
        var req = try request("POST", path, timeout: timeout)
        req.setValue(multipart.contentType, forHTTPHeaderField: "Content-Type")
        let data = try await perform(req, body: multipart.finished())
        if data.isEmpty { return .null }
        return (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? .null
    }
}

extension JSONValue {
    /// For JSONSerialization request bodies.
    var ixAny: Any {
        switch self {
        case .string(let s): return s
        case .number(let d): return d.rounded() == d && abs(d) < 1e15 ? Int(d) as Any : d as Any
        case .bool(let b): return b
        case .object(let o): return o.mapValues { $0.ixAny }
        case .array(let a): return a.map { $0.ixAny }
        case .null: return NSNull()
        }
    }

    var ixStrings: [String] { array?.compactMap(\.string) ?? [] }
}

enum IxFiles {
    /// Writes a download into the temporary folder, so the share sheet can save it to Files.
    static func temp(_ data: Data, name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: url)
        try data.write(to: url, options: .atomic)
        return url
    }

    /// Reads a file picked with `.fileImporter` (security-scoped).
    static func read(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return try Data(contentsOf: url)
    }

    static var today: String { ServerDate.day() }
}

/// Copies to the pasteboard; secrets only locally and for ten minutes.
@MainActor
enum IxClipboard {
    static func copy(_ value: String, secret: Bool = false) {
        if secret {
            UIPasteboard.general.setItems([["public.utf8-plain-text": value]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)])
        } else {
            UIPasteboard.general.string = value
        }
        Haptics.success()
    }
}

/// "22:00" ⇄ Date for DatePickers.
enum IxTime {
    static func date(_ hhmm: String, fallback: String = "22:00") -> Date {
        let parts = (hhmm.isEmpty ? fallback : hhmm).split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: parts.first ?? 22, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: Date()) ?? Date()
    }

    static func string(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// "Mi., 14. Okt., 03:00"
    static func when(_ s: String?) -> String {
        guard let d = ServerDate.parse(s) else { return s ?? "" }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
    }

    static func bytes(_ n: Double?) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(n ?? 0), countStyle: .file)
    }
}

/// A toggle as a chip (one channel of one event): 44 pt high, says on/off to VoiceOver.
struct IxToggleChip: View {
    let title: String
    let systemImage: String
    let on: Bool
    var enabled = true
    var a11yLabel: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: on ? "checkmark" : systemImage).font(.caption.weight(.semibold)).accessibilityHidden(true)
                Text(title).font(.subheadline)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .foregroundStyle(on ? Theme.onPrimary : Theme.ink)
            .background(on ? Theme.primary : Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(on ? Color.clear : Theme.line, lineWidth: 1))
            .contentShape(Capsule())
            .opacity(enabled ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(a11yLabel ?? title)
        .accessibilityValue(on ? L("on") : L("off"))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Label + monospaced value + copy button.
struct IxCopyRow: View {
    let title: String
    let value: String
    var secret = false
    var onCopied: (() -> Void)?

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(Theme.ink3)
                Text(value).font(.callout.monospaced()).textSelection(.enabled).lineLimit(4)
            }
            Spacer(minLength: 8)
            Button {
                IxClipboard.copy(value, secret: secret)
                onCopied?()
            } label: {
                Image(systemName: "doc.on.doc").frame(width: 44, height: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(LF("Copy %@", title))
        }
    }
}

/// A status line with a coloured dot (never colour alone: the text says it).
struct IxStatusLine: View {
    let text: String
    let ok: Bool?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: ok == true ? "checkmark.circle.fill" : ok == false ? "exclamationmark.triangle.fill" : "circle.dotted")
                .foregroundStyle(ok == true ? Theme.primaryText : ok == false ? Theme.low : Theme.ink3)
                .accessibilityHidden(true)
            Text(text).font(.footnote).foregroundStyle(ok == false ? Theme.low : Theme.ink2)
        }
    }
}

/// Loading row for lists.
struct IxLoadingRow: View {
    var body: some View {
        HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
    }
}

/// Square QR code for a link (tablet, Telegram).
struct IxQRCode: View {
    let text: String
    var size: CGFloat = 180

    var body: some View {
        if let img = IxQR.make(text) {
            Image(uiImage: img)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .padding(8)
                .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                .accessibilityLabel(L("QR code of the link"))
        }
    }
}

/// CoreImage QR (same as the house guide's).
enum IxQR {
    static func make(_ text: String) -> UIImage? {
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        f.setValue(Data(text.utf8), forKey: "inputMessage")
        f.setValue("M", forKey: "inputCorrectionLevel")
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
