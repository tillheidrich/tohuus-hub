import Foundation

/// Any JSON value. Used where the server's shape is loose or still moving, so decoding never fails on it.
/// Note: decoded with `convertFromSnakeCase`, so object keys arrive in camelCase ("image_url" → "imageUrl").
enum JSONValue: Codable, Sendable, Equatable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        if let c = try? decoder.container(keyedBy: AnyKey.self) {
            var out: [String: JSONValue] = [:]
            for k in c.allKeys { out[k.stringValue] = (try? c.decode(JSONValue.self, forKey: k)) ?? .null }
            self = .object(out)
            return
        }
        if var a = try? decoder.unkeyedContainer() {
            var out: [JSONValue] = []
            while !a.isAtEnd { out.append((try? a.decode(JSONValue.self)) ?? .null) }
            self = .array(out)
            return
        }
        let s = try decoder.singleValueContainer()
        if s.decodeNil() { self = .null }
        else if let b = try? s.decode(Bool.self) { self = .bool(b) }
        else if let d = try? s.decode(Double.self) { self = .number(d) }
        else if let str = try? s.decode(String.self) { self = .string(str) }
        else { self = .null }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let d): try c.encode(d)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }

    var string: String? {
        switch self {
        case .string(let s): return s
        case .number(let d): return d.rounded() == d ? String(Int(d)) : String(d)
        case .bool(let b): return b ? "true" : "false"
        default: return nil
        }
    }

    var double: Double? {
        switch self {
        case .number(let d): return d
        case .string(let s): return Double(s.replacingOccurrences(of: ",", with: "."))
        case .bool(let b): return b ? 1 : 0
        default: return nil
        }
    }

    var int: Int? { double.map { Int($0) } }

    var bool: Bool? {
        switch self {
        case .bool(let b): return b
        case .number(let d): return d != 0
        case .string(let s): return ["1", "true", "yes"].contains(s.lowercased())
        default: return nil
        }
    }

    var array: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
    var object: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }
    var isNull: Bool { self == .null }

    subscript(key: String) -> JSONValue? { object?[key] }

    /// First non-null value under any of the keys.
    func first(_ keys: String...) -> JSONValue? {
        for k in keys { if let v = object?[k], !v.isNull { return v } }
        return nil
    }
}

/// Dynamic coding key.
struct AnyKey: CodingKey, Hashable {
    var stringValue: String
    var intValue: Int?
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { stringValue = String(intValue); self.intValue = intValue }
}

extension KeyedDecodingContainer where Key == AnyKey {
    /// First key present with a decodable, non-null value.
    func first<T: Decodable>(_ type: T.Type, _ keys: String...) -> T? {
        for k in keys {
            if let v = try? decodeIfPresent(T.self, forKey: AnyKey(k)) { return v }
        }
        return nil
    }
}

/// An id the server may send as number or string.
struct FlexID: Codable, Sendable, Hashable, CustomStringConvertible {
    let value: String
    init(_ v: String) { value = v }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) { value = String(i) }
        else if let d = try? c.decode(Double.self) { value = String(Int(d)) }
        else { value = try c.decode(String.self) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        if let i = Int(value) { try c.encode(i) } else { try c.encode(value) }
    }
    var int: Int? { Int(value) }
    var description: String { value }
}

/// Array that drops elements it cannot decode instead of failing the whole payload; missing key → empty.
@propertyWrapper
struct Lossy<T: Decodable & Sendable>: Decodable, Sendable {
    var wrappedValue: [T]
    init(wrappedValue: [T] = []) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        guard var c = try? decoder.unkeyedContainer() else { wrappedValue = []; return }
        var out: [T] = []
        while !c.isAtEnd {
            if let v = try? c.decode(T.self) { out.append(v) } else { _ = try? c.decode(JSONValue.self) }
        }
        wrappedValue = out
    }
}

extension Lossy: Encodable where T: Encodable {
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}

extension KeyedDecodingContainer {
    func decode<T>(_ type: Lossy<T>.Type, forKey key: Key) throws -> Lossy<T> {
        (try? decodeIfPresent(type, forKey: key)) ?? Lossy(wrappedValue: [])
    }
}

/// A list element that may be a plain string or an object with a name/text.
struct NameItem: Decodable, Sendable, Hashable, Identifiable {
    var name: String
    var productId: Int?
    var id: String { name + (productId.map { "#\($0)" } ?? "") }

    init(name: String, productId: Int? = nil) { self.name = name; self.productId = productId }

    init(from decoder: Decoder) throws {
        if let s = try? decoder.singleValueContainer().decode(String.self) {
            name = s; productId = nil; return
        }
        let c = try decoder.container(keyedBy: AnyKey.self)
        guard let n = c.first(String.self, "name", "text", "title", "label") else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no name"))
        }
        name = n
        productId = c.first(Int.self, "productId", "id")
    }
}

enum JSONCoding {
    static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }

    static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return e
    }
}

/// Server timestamps: "2026-10-12 08:15:00" (SQLite, UTC), ISO 8601 or "2026-10-12".
enum ServerDate {
    static func parse(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: s) { return d }
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: s) { return d }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let d = f.date(from: s) { return d }
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: String(s.prefix(10)))
    }

    static func day(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// "vor 5 Min." / "5 min ago"
    static func relative(_ s: String?) -> String? {
        guard let d = parse(s) else { return nil }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: d, relativeTo: Date())
    }

    static func shortDay(_ s: String?) -> String? {
        guard let d = parse(s) else { return nil }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }
}
