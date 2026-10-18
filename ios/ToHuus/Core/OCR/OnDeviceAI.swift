import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Apple Intelligence on this iPhone (13 Oct 2026): the on-device language model (Foundation Models, iOS 26+) tidies
/// up what the camera read before anything is sent – receipt lines and handwritten paper lists. Nothing leaves the
/// device for this step; ToHuus only gets the cleaned-up text, exactly as with plain on-device reading.
///
/// It is the person's own choice: off by default, switched on in Einstellungen › Mit oder ohne KI or in the tour,
/// per device (`ai.onDevice`). A child whose AI an adult switched off never gets it. Without a supported device,
/// Apple Intelligence switched off in the system settings or the model still loading, everything works as before.
enum OnDeviceAI {
    static let key = "ai.onDevice"

    /// the person's choice on this device
    static var chosen: Bool {
        get { SharedConfig.defaults.bool(forKey: key) }
        set { SharedConfig.defaults.set(newValue, forKey: key) }
    }

    enum State: Equatable {
        case available
        /// iPhone without Apple Intelligence (or iOS before 26)
        case notSupported
        /// switched off in Einstellungen › Apple Intelligence & Siri
        case notEnabled
        /// still downloading or preparing
        case notReady
        /// the model is there, but not for the iPhone's language (Apple adds languages step by step)
        case languageNotSupported
    }

    static var state: State {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let model = SystemLanguageModel.default
            switch model.availability {
            case .available:
                // German and English receipts: the model must speak the iPhone's language, otherwise it would throw
                // unsupportedLanguageOrLocale on every request – then the plain on-device reading is used, as before
                let code = Locale.current.language.languageCode
                return model.supportedLanguages.contains { $0.languageCode == code } ? .available : .languageNotSupported
            case .unavailable(.appleIntelligenceNotEnabled): return .notEnabled
            case .unavailable(.modelNotReady): return .notReady
            case .unavailable: return .notSupported
            @unknown default: return .notSupported
            }
        }
        #endif
        return .notSupported
    }

    /// chosen, allowed for this person and ready on this device
    @MainActor static func active(_ app: AppModel) -> Bool { chosen && !app.aiLocked && state == .available }

    /// The model is a help, never a wait: after `seconds` the caller goes on without it (nil); the model call is
    /// cancelled in the background.
    static func withTimeout<T: Sendable>(_ seconds: Double = 20, _ work: @escaping @Sendable () async -> T?) async -> T? {
        let once = ResumeOnce<T?>()
        return await withCheckedContinuation { (cont: CheckedContinuation<T?, Never>) in
            let job = Task { once.resume(cont, with: await work()) }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                job.cancel()
                once.resume(cont, with: nil)
            }
        }
    }

    // MARK: receipts

    /// Cleans the lines Apple Vision read from a receipt into "Name 1,99" lines plus the total, in the shape the
    /// server's receipt parser reads (`POST /api/imports/lines`). Since 18 Oct 2026 it is only a second reading sent
    /// next to Apple Vision's own lines (`alt`): the server takes it only when the plain lines do not add up and it does
    /// (the model had dropped a discount and a deposit row and read "Eier 6St" as 6 eggs). Guard against invented numbers: an item is only kept
    /// when its price appears in the recognised text. Returns nil when the model is not there or the result is thin –
    /// the caller then sends the raw lines as before.
    static func tidyReceipt(_ lines: [String]) async -> [String]? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), state == .available, !lines.isEmpty {
            do {
                let session = LanguageModelSession(instructions: """
                    You read the text of a German or English supermarket receipt that was recognised by OCR.
                    Return the shop name, every line with an amount in the order of the receipt, the total and the date \
                    as written. Copy names and numbers from the text, never invent anything. Discount rows (Rabatt, \
                    Lidl Plus Rabatt, Preisvorteil, Coupon) are lines with a negative price. Deposit rows (Pfand, \
                    Leergut, EM, EW) are lines too. The quantity is only what is printed as "2 x" or "1,19 x 2"; a pack \
                    size in the name ("6St", "10er", "500g", "1,5l") is part of the name, never the quantity. Leave out \
                    payment, tax and card lines.
                    """)
                let text = lines.prefix(160).joined(separator: "\n")
                let r = try await session.respond(to: text, generating: TidyReceipt.self).content
                let raw = lines.joined(separator: " ")
                let digitsOnly = raw.replacingOccurrences(of: ",", with: ".")
                func seen(_ p: Double) -> Bool { digitsOnly.contains(String(format: "%.2f", abs(p))) }
                let items = r.items.filter { $0.price != 0 && seen($0.price) && !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
                guard items.count >= max(1, r.items.count / 2) else { return nil }
                var out: [String] = []
                if let shop = r.shop, !shop.isEmpty { out.append(shop) }
                for i in items {
                    let price = String(format: "%.2f", i.price).replacingOccurrences(of: ".", with: ",")
                    out.append(i.quantity > 1 ? "\(i.quantity) x \(i.name) \(price)" : "\(i.name) \(price)")
                }
                if let total = r.total, total > 0 { out.append("SUMME " + String(format: "%.2f", total).replacingOccurrences(of: ".", with: ",")) }
                if let date = r.date, !date.isEmpty { out.append(date) }
                return out
            } catch {
                return nil
            }
        }
        #endif
        return nil
    }

    // MARK: paper lists

    /// Turns the recognised lines of a handwritten or printed shopping list into clean items ("2 Milch"), fixing
    /// obvious reading errors. nil when the model is not there – the caller keeps its own filter.
    static func tidyList(_ lines: [String]) async -> [String]? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), state == .available, !lines.isEmpty {
            do {
                let session = LanguageModelSession(instructions: """
                    The text is a handwritten or printed shopping list read by OCR. Return one entry per thing to buy, \
                    in the language of the list, with a quantity when one is written. Fix obvious reading errors of \
                    common grocery words, drop dates, headings and crossed-out marks. Never add things that are not there.
                    """)
                let r = try await session.respond(to: lines.prefix(120).joined(separator: "\n"), generating: TidyList.self).content
                let items = r.items.compactMap { i -> String? in
                    let name = i.name.trimmingCharacters(in: .whitespaces)
                    guard name.count >= 2 else { return nil }
                    return i.quantity > 1 ? "\(i.quantity) \(name)" : name
                }
                return items.isEmpty ? nil : items
            } catch {
                return nil
            }
        }
        #endif
        return nil
    }
}

/// resumes a continuation exactly once (the model's answer or the timeout, whichever comes first)
private final class ResumeOnce<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func resume(_ c: CheckedContinuation<T, Never>, with value: T) {
        lock.lock()
        defer { lock.unlock() }
        guard !done else { return }
        done = true
        c.resume(returning: value)
    }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
struct TidyReceipt {
    @Guide(description: "Shop name as printed at the top, if any")
    var shop: String?
    @Guide(description: "Bought items in the order of the receipt")
    var items: [TidyReceiptItem]
    @Guide(description: "Total amount paid, if printed")
    var total: Double?
    @Guide(description: "Date of the purchase as printed, e.g. 12.10.26")
    var date: String?
}

@available(iOS 26.0, *)
@Generable
struct TidyReceiptItem {
    @Guide(description: "Item name as printed")
    var name: String
    @Guide(description: "How many, 1 when not printed")
    var quantity: Int
    @Guide(description: "Amount printed for this line; negative for a discount")
    var price: Double
}

@available(iOS 26.0, *)
@Generable
struct TidyList {
    var items: [TidyListItem]
}

@available(iOS 26.0, *)
@Generable
struct TidyListItem {
    @Guide(description: "What to buy, e.g. Milch")
    var name: String
    @Guide(description: "How many, 1 when not written")
    var quantity: Int
}
#endif
