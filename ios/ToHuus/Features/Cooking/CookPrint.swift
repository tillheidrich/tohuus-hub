import SwiftUI
import UIKit

/// Printing and sharing a recipe or the week plan (web: BonButton "Woche drucken", recipe ticket):
/// AirPrint or PDF from the system print dialog (a clean A4 page made here), plain text to share, and – on a
/// self-hosted server with a receipt printer – the same ticket as the web prints (POST /api/print/print).
enum CookPrint {
    private static func e(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    private static let css = """
    <style>
    body{font-family:-apple-system,Helvetica,sans-serif;color:#1f2a24;font-size:12pt;line-height:1.45}
    h1{font-family:Georgia,serif;font-size:24pt;margin:0 0 4pt} h2{font-size:13pt;margin:16pt 0 6pt;text-transform:uppercase;letter-spacing:.06em;color:#4b5a52}
    .meta{color:#5d6b63;font-size:10pt;margin-bottom:10pt} .note{background:#eef4ef;padding:8pt 10pt;border-radius:6pt;margin:8pt 0}
    ul{padding-left:16pt;margin:0} li{margin:2pt 0} ol{padding-left:18pt} ol li{margin:0 0 8pt}
    .chips{color:#4b5a52;font-size:10pt} .sec{font-weight:bold;color:#4b5a52;margin-top:8pt}
    img.hero{width:100%;max-height:220pt;object-fit:cover;border-radius:8pt;margin-bottom:10pt}
    table{width:100%;border-collapse:collapse} td{border-bottom:1px solid #d9e0db;padding:7pt 4pt;vertical-align:top}
    td.day{width:30%;font-weight:bold} .muted{color:#7a867f} .foot{margin-top:18pt;color:#7a867f;font-size:9pt}
    </style>
    """

    static func recipeHTML(_ r: RecipeFull, lines: [String], note: String?, servings: String?, image: UIImage?) -> String {
        var h = "<html><head><meta charset='utf-8'>\(css)</head><body>"
        if let image, let d = image.jpegData(compressionQuality: 0.7) {
            h += "<img class='hero' src='data:image/jpeg;base64,\(d.base64EncodedString())'>"
        }
        h += "<h1>\(e(r.title))</h1>"
        let meta = [servings, r.timeMin.map { LF("%d min", Int($0)) }, (r.tags ?? []).isEmpty ? nil : (r.tags ?? []).joined(separator: ", ")].compactMap { $0 }
        if !meta.isEmpty { h += "<div class='meta'>\(e(meta.joined(separator: " · ")))</div>" }
        if let d = r.description, !d.isEmpty { h += "<p>\(e(d))</p>" }
        if let note, !note.isEmpty { h += "<div class='note'><b>\(e(L("How we make it")))</b><br>\(e(note))</div>" }
        if !lines.isEmpty {
            h += "<h2>\(e(L("Ingredients")))</h2><ul>" + lines.map { "<li>\(e($0))</li>" }.joined() + "</ul>"
        }
        if !r.steps.isEmpty {
            h += "<h2>\(e(L("Steps")))</h2><ol>"
            for (i, s) in r.steps.enumerated() {
                if let sec = s.section, !sec.isEmpty, i == 0 || r.steps[i - 1].section != sec { h += "</ol><div class='sec'>\(e(sec))</div><ol start='\(i + 1)'>" }
                let chips = CookTimers.deviceChips(s.tm)
                h += "<li>\(e(s.text))" + (chips.isEmpty ? "" : "<div class='chips'>\(e(chips.joined(separator: " · ")))</div>") + "</li>"
            }
            h += "</ol>"
        }
        if let n = r.notes, !n.isEmpty { h += "<p class='muted'>\(e(n))</p>" }
        if let src = r.sourceUrl, !src.isEmpty { h += "<div class='foot'>\(e(src))</div>" }
        return h + "<div class='foot'>ToHuus</div></body></html>"
    }

    static func recipeText(_ r: RecipeFull, lines: [String], note: String?, servings: String?) -> String {
        var t = r.title
        if let servings { t += " (\(servings))" }
        t += "\n"
        if let note, !note.isEmpty { t += "\n\(L("How we make it")): \(note)\n" }
        if !lines.isEmpty { t += "\n\(L("Ingredients")):\n" + lines.map { "• \($0)" }.joined(separator: "\n") + "\n" }
        if !r.steps.isEmpty {
            t += "\n\(L("Steps")):\n" + r.steps.enumerated().map { i, s in
                let chips = CookTimers.deviceChips(s.tm)
                return "\(i + 1). \(s.text)" + (chips.isEmpty ? "" : " [\(chips.joined(separator: " · "))]")
            }.joined(separator: "\n") + "\n"
        }
        if let src = r.sourceUrl, !src.isEmpty { t += "\n\(src)\n" }
        return t
    }

    struct WeekDayRow {
        var day: String
        var entries: [WeekEntry]
        var mark: String?
        var cook: [Int: String]
    }

    @MainActor static func weekRows(_ model: WeekModel) -> [WeekDayRow] {
        model.days.map { d in
            WeekDayRow(day: d, entries: model.entries(d), mark: model.mark(d)?.label, cook: model.claims.mapValues(\.name))
        }
    }

    private static func entryLine(_ x: WeekEntry, cook: [Int: String]) -> String {
        var s = x.title
        var extra: [String] = []
        if x.isLunch { extra.append(L("Lunch")) }
        if let n = x.servings { extra.append(LF("for %d", n)) }
        if let c = cook[x.id] { extra.append(LF("%@ cooks", c)) }
        if !extra.isEmpty { s += " (" + extra.joined(separator: ", ") + ")" }
        return s
    }

    static func weekHTML(_ rows: [WeekDayRow], from: String) -> String {
        var h = "<html><head><meta charset='utf-8'>\(css)</head><body><h1>\(e(L("Meal plan")))</h1>"
        h += "<div class='meta'>\(e(LF("Week from %@", CookDay.long(from))))</div><table>"
        for r in rows {
            let body: String
            if r.entries.isEmpty { body = "<span class='muted'>\(e(r.mark ?? "–"))</span>" } else {
                body = r.entries.map { e(entryLine($0, cook: r.cook)) }.joined(separator: "<br>")
            }
            h += "<tr><td class='day'>\(e(CookDay.long(r.day)))</td><td>\(body)</td></tr>"
        }
        return h + "</table><div class='foot'>ToHuus</div></body></html>"
    }

    static func weekText(_ rows: [WeekDayRow], from: String) -> String {
        var t = L("Meal plan") + " · " + LF("Week from %@", CookDay.long(from)) + "\n\n"
        for r in rows {
            let body = r.entries.isEmpty ? (r.mark ?? "–") : r.entries.map { entryLine($0, cook: r.cook) }.joined(separator: " · ")
            t += "\(CookDay.short(r.day)): \(body)\n"
        }
        return t
    }

    /// AirPrint (or "Save as PDF" from the print dialog) – nothing is written to disk by the app
    @MainActor static func printHTML(_ html: String, title: String) {
        let pc = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = title
        pc.printInfo = info
        let f = UIMarkupTextPrintFormatter(markupText: html)
        f.perPageContentInsets = UIEdgeInsets(top: 42, left: 42, bottom: 42, right: 42)
        pc.printFormatter = f
        if UIDevice.current.userInterfaceIdiom == .pad,
           let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first?.keyWindow {
            pc.present(from: CGRect(x: window.bounds.maxX - 80, y: 60, width: 1, height: 1), in: window, animated: true, completionHandler: nil)
        } else {
            pc.present(animated: true, completionHandler: nil)
        }
    }
}

/// "Drucken" menu: print / PDF, share as text, and the household's receipt printers (self-hosted).
struct CookPrintMenu<Label: View>: View {
    let store: ServerStore
    /// ticket type on the server: recipe | week
    let ticketType: String
    var ticketId: Int?
    var ticketDay: String?
    let title: String
    let html: () -> String
    let text: () -> String
    var feedback: CookFeedback?
    @ViewBuilder var label: () -> Label
    @State private var printers: [PrintInfoLite.Printer] = []

    var body: some View {
        Menu {
            Button { CookPrint.printHTML(html(), title: title) } label: {
                SwiftUI.Label(L("Print or save as PDF"), systemImage: "printer")
            }
            ShareLink(item: text()) { SwiftUI.Label(L("Share as text"), systemImage: "square.and.arrow.up") }
            if !printers.isEmpty {
                Section(L("Receipt printer")) {
                    ForEach(printers) { p in
                        Button { Task { await ticket(p) } } label: { SwiftUI.Label(p.name, systemImage: "scroll") }
                    }
                }
            }
        } label: { label() }
        .task {
            // receipt printers exist only on self-hosted servers that have one set up
            if printers.isEmpty, let info = try? await store.api.printInfoLite() { printers = info.printers }
        }
    }

    private func ticket(_ p: PrintInfoLite.Printer) async {
        do {
            try await store.api.printTicket(type: ticketType, id: ticketId, day: ticketDay, printerId: p.id)
            Haptics.success()
            feedback?.say(LF("Sent to %@", p.name))
        } catch { feedback?.fail(error) }
    }
}
