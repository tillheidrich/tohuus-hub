import Foundation
import UIKit
import Vision

/// Text recognition on the iPhone (Apple Vision) – for receipts and handwritten/printed paper lists when the household
/// has no AI, or as a first pass. Nothing is sent anywhere by this type.
enum DeviceOCR {
    struct Fragment: Sendable {
        let text: String
        let box: CGRect
    }

    /// Recognised lines, top to bottom. Pieces on the same height (item left, price right) become one line.
    static func lines(in image: UIImage) async throws -> [String] {
        guard let cg = image.cgImage else { return [] }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        let fragments = try await Task.detached(priority: .userInitiated) { () throws -> [Fragment] in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["de-DE", "en-US"]
            request.usesLanguageCorrection = true
            // perform() runs the request synchronously on this background task
            try VNImageRequestHandler(cgImage: cg, orientation: orientation).perform([request])
            return (request.results ?? []).compactMap { o in
                o.topCandidates(1).first.map { Fragment(text: $0.string, box: o.boundingBox) }
            }
        }.value
        return merge(fragments)
    }

    /// Receipts (18 Oct 2026, Lidl: the light blue "Lidl Plus Rabatt" row and a faint "Pfand" row were missing): two
    /// passes – the photo as it is, and an "ink" version where every coloured or light print turns dark (the darkest
    /// colour channel, contrast stretched) – merged by position. No language correction (it "fixes" prices and
    /// shop abbreviations), small text allowed. Lines are rebuilt by height: "Name … Price" on one line, the indented
    /// discount row under its item.
    static func receiptLines(in image: UIImage) async throws -> [String] {
        guard let cg = image.cgImage else { return [] }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        let fragments = try await Task.detached(priority: .userInitiated) { () throws -> [Fragment] in
            let first = try recognize(cg, orientation)
            guard let ink = inkImage(cg) else { return first }
            let second = try recognize(ink, orientation)
            return mergePasses(first, second)
        }.value
        return merge(fragments)
    }

    private static func recognize(_ cg: CGImage, _ orientation: CGImagePropertyOrientation) throws -> [Fragment] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["de-DE", "en-US"]
        // language correction turns "OKT 6St" or "0,25 EM" into words – prices and till abbreviations stay as printed
        request.usesLanguageCorrection = false
        request.minimumTextHeight = 0.008
        try VNImageRequestHandler(cgImage: cg, orientation: orientation).perform([request])
        return (request.results ?? []).compactMap { o in
            o.topCandidates(1).first.map { Fragment(text: $0.string, box: o.boundingBox) }
        }
    }

    /// Pure: fragments of the second pass that the first one did not have (no overlapping box) are added.
    static func mergePasses(_ a: [Fragment], _ b: [Fragment]) -> [Fragment] {
        var out = a
        for f in b {
            let covered = a.contains { g in
                let i = g.box.intersection(f.box)
                guard !i.isNull, i.width > 0, i.height > 0 else { return false }
                let smaller = min(g.box.width * g.box.height, f.box.width * f.box.height)
                return smaller > 0 && (i.width * i.height) / smaller > 0.4
            }
            if !covered { out.append(f) }
        }
        return out
    }

    /// Grey image from the darkest colour channel, contrast stretched: light blue, red or grey print becomes dark,
    /// the paper stays white. At most 3000 px on the long side.
    static func inkImage(_ cg: CGImage) -> CGImage? {
        let scale = min(1, 3000 / Double(max(cg.width, cg.height)))
        let w = max(1, Int(Double(cg.width) * scale)), h = max(1, Int(Double(cg.height) * scale))
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(data: &rgba, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var grey = [UInt8](repeating: 255, count: w * h)
        // the paper's brightness: the bright end of the darkest channel (98th percentile of a sample)
        var hist = [Int](repeating: 0, count: 256)
        let step = max(1, (w * h) / 200_000)
        var i = 0
        while i < w * h {
            let p = i * 4
            hist[Int(min(rgba[p], rgba[p + 1], rgba[p + 2]))] += 1
            i += step
        }
        let total = hist.reduce(0, +)
        var acc = 0, paper = 255
        for v in 0..<256 { acc += hist[v]; if acc >= total * 98 / 100 { paper = v; break } }
        let white = max(120, paper - 25), black = max(0, white - 110)
        for k in 0..<(w * h) {
            let p = k * 4
            let m = Int(min(rgba[p], rgba[p + 1], rgba[p + 2]))
            let v = m >= white ? 255 : m <= black ? 0 : (m - black) * 255 / (white - black)
            grey[k] = UInt8(v)
        }
        guard let provider = CGDataProvider(data: Data(grey) as CFData) else { return nil }
        return CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }

    /// Pure and unit-tested: groups fragments whose vertical centres are close into one line, left to right.
    static func merge(_ fragments: [Fragment]) -> [String] {
        // Vision's boxes are normalised with the origin at the bottom left
        let sorted = fragments.sorted { $0.box.midY > $1.box.midY }
        var rows: [[Fragment]] = []
        for f in sorted {
            if let last = rows.last?.first, abs(last.box.midY - f.box.midY) < max(last.box.height, f.box.height) * 0.5 {
                rows[rows.count - 1].append(f)
            } else {
                rows.append([f])
            }
        }
        return rows.map { row in
            row.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: "  ")
        }
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    }

    /// A paper shopping list: drops headings, prices and dates, keeps the things to buy.
    static func listItems(_ lines: [String]) -> [String] {
        lines.compactMap { line in
            var s = line.trimmingCharacters(in: .whitespaces)
            s = s.replacingOccurrences(of: #"^[\-\*•·–☐□○o]\s*"#, with: "", options: .regularExpression)
            s = s.replacingOccurrences(of: #"^\[\s?[xX ]?\s?\]\s*"#, with: "", options: .regularExpression)
            guard s.count >= 2, s.count <= 60 else { return nil }
            if s.range(of: #"^\d{1,2}[./]\d{1,2}([./]\d{2,4})?$"#, options: .regularExpression) != nil { return nil }
            if s.range(of: #"^[\d\s.,€-]+$"#, options: .regularExpression) != nil { return nil }
            let lower = s.lowercased()
            if ["einkaufsliste", "einkauf", "liste", "shopping list", "to buy"].contains(lower.trimmingCharacters(in: CharacterSet(charactersIn: ":"))) { return nil }
            return s
        }
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
