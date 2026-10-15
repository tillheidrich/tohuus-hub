import Foundation

// Models for the 0.3 cooking parity (week plan 2, "Was essen wir?", recipe page, house version, votes).
// Decoded with convertFromSnakeCase: "recipe_id" → recipeId. Server shapes: server/routes/{recipes,plan2,cook2,people,shop}.ts.

// MARK: - week plan

/// GET /api/plan → entries with plan2 extras (one-off servings, source, recipe servings).
struct WeekPlan: Decodable, Sendable {
    var days: [String]
    @Lossy var entries: [WeekEntry]
}

struct WeekEntry: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var day: String
    var slot: String?
    var recipeId: Int?
    var title: String
    var note: String?
    var cooked: JSONValue?
    var imagePath: String?
    var thermomix: JSONValue?
    var timeMin: Double?
    /// one-off servings for this entry, nil = as usual
    var servings: Int?
    var recipeServings: Double?
    var variantServings: Double?
    /// manual | suggest | rotation | vote | cookidoo | assistant
    var source: String?

    var isCooked: Bool { cooked?.bool ?? false }
    var isThermomix: Bool { thermomix?.bool ?? false }
    var isLunch: Bool { slot == "mittag" }
    /// household base: our servings (variant), else the recipe's
    var baseServings: Int? {
        let b = (variantServings ?? 0) > 0 ? variantServings : recipeServings
        return b.map { Int($0) }.flatMap { $0 > 0 ? $0 : nil }
    }
}

/// GET /api/plan2/week → marks, open votes, rotation
struct WeekOverlay: Decodable, Sendable {
    @Lossy var marks: [PlanDayMark]
    var votes: Int?
    var rotation: PlanRotation?
}

struct PlanDayMark: Decodable, Sendable, Hashable {
    var day: String
    /// away | out
    var kind: String
    var note: String?
    /// plan | away (vacation mode)
    var source: String?

    var label: String {
        if source == "away" { return LC("Away (vacation)") }
        return kind == "away" ? LC("Not at home") : LC("Eating out")
    }
}

struct PlanRotation: Decodable, Sendable {
    var templateIds: [Int] = []
    var anchor: String?
    var auto: Bool?
    var avoidDays: Int?
    @Lossy var weeks: [Week]
    var lastAuto: String?

    struct Week: Decodable, Sendable, Hashable {
        var monday: String
        var index: Int
        var templateId: Int?
        var name: String?
    }

    enum CodingKeys: String, CodingKey { case templateIds, anchor, auto, avoidDays, weeks, lastAuto }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        templateIds = (try? c.decodeIfPresent([Int].self, forKey: .templateIds)) ?? []
        anchor = try? c.decodeIfPresent(String.self, forKey: .anchor)
        auto = try? c.decodeIfPresent(Bool.self, forKey: .auto)
        avoidDays = try? c.decodeIfPresent(Int.self, forKey: .avoidDays)
        _weeks = try c.decode(Lossy<Week>.self, forKey: .weeks)
        lastAuto = try? c.decodeIfPresent(String.self, forKey: .lastAuto)
    }
}

struct PlanTemplate: Decodable, Sendable, Identifiable {
    var id: Int
    var name: String
    @Lossy var items: [Item]

    struct Item: Decodable, Sendable, Hashable {
        var id: Int?
        var weekday: Int
        var slot: String?
        var recipeId: Int?
        var title: String
        var servings: Int?
    }
}

/// POST /api/plan2/templates/:id/apply, /api/plan2/rotation/apply
struct PlanApplyResult: Decodable, Sendable {
    var added: Int?
    var skippedFilled: Int?
    var skippedMarked: Int?
    var replaced: [JSONValue]?

    var message: String {
        let n = added ?? 0
        if n > 0 {
            var parts = [n == 1 ? LC("1 meal planned") : LCF("%d meals planned", n)]
            let r = replaced?.count ?? 0
            if r > 0 { parts.append(r == 1 ? LC("1 dish swapped because you had it recently") : LCF("%d dishes swapped because you had them recently", r)) }
            if (skippedMarked ?? 0) > 0 { parts.append(LC("marked days left free")) }
            return parts.joined(separator: " · ")
        }
        return (skippedFilled ?? 0) > 0 ? LC("Nothing to add – those days are already planned") : LC("Nothing to add")
    }
}

/// GET /api/claims?kind=plan
struct PlanClaim: Decodable, Sendable, Hashable {
    var refId: Int
    var userId: Int
    var name: String
    var color: String?
}

/// GET /api/shop/members
struct HouseMember: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var color: String?
}

// MARK: - votes

/// GET /api/plan2/members – people who can vote (members, children, profiles)
struct VoteMember: Decodable, Sendable, Identifiable, Hashable {
    var key: String
    var name: String
    var color: String?
    var kind: String?
    var login: Bool?
    var guest: Bool?
    var id: String { key }
}

struct VoteIdea: Decodable, Sendable, Hashable, Identifiable {
    var recipeId: Int?
    var title: String
    var imagePath: String?
    var source: String?
    var why: String?
    var id: String { recipeId.map { "r\($0)" } ?? "t" + title.lowercased() }
}

struct VoteIdeas: Decodable, Sendable {
    @Lossy var suggestions: [VoteIdea]
    @Lossy var favourites: [VoteIdea]
    @Lossy var cookidoo: [VoteIdea]
}

struct FoodVote: Decodable, Sendable, Identifiable {
    var id: Int
    var title: String?
    var dayFrom: String
    var dayTo: String
    /// secret | together
    var mode: String
    /// open | closed
    var status: String?
    var revealed: Bool?
    var startedBy: String?
    var isStarter: Bool?
    @Lossy var candidates: [Candidate]
    @Lossy var voters: [Voter]
    var me: String?
    var voter: String?
    var mine: [String: Int]?
    var results: [Result]?
    var matches: [Result]?

    struct Candidate: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var recipeId: Int?
        var title: String
        var source: String?
        var imagePath: String?
        var timeMin: Double?
        var thermomix: Bool?
        var plannedEntryId: Int?
    }

    struct Voter: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var name: String
        var color: String?
        var kind: String?
        var login: Bool?
        var done: Bool?
        var started: Bool?
        var canVoteHere: Bool?
        var id: String { key }
    }

    struct Result: Decodable, Sendable, Identifiable, Hashable {
        var candidateId: Int
        var recipeId: Int?
        var title: String
        var yes: Int?
        var `super`: Int?
        var no: Int?
        var match: Bool?
        var score: Double?
        var plannedEntryId: Int?
        var id: Int { candidateId }
    }

    var isRevealed: Bool { revealed ?? false }
    var isSecret: Bool { mode == "secret" }

    var displayTitle: String {
        if let title, !title.isEmpty { return title }
        if dayFrom == dayTo { return LCF("Dinner on %@", CookDay.long(dayFrom)) }
        return LCF("Dinners %@", "\(CookDay.short(dayFrom)) – \(CookDay.short(dayTo))")
    }
}

/// POST /api/plan2/votes/:id/apply
struct VoteApplyResult: Decodable, Sendable {
    @Lossy var placed: [Placed]
    struct Placed: Decodable, Sendable { var day: String; var title: String }
}

// MARK: - what do we eat

/// GET /api/cook2/what-to-eat
struct WhatToEat: Decodable, Sendable {
    var recipes: Int?
    var empty: Bool?
    var hasVegetarian: Bool?
    var hasThermomix: Bool?
    @Lossy var planned: [Planned]
    @Lossy var ready: [WteCard]
    @Lossy var oneMissing: [WteCard]
    @Lossy var leftovers: [WteCard]
    @Lossy var quick: [WteCard]
    var more: Int?

    struct Planned: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var recipeId: Int?
        var title: String
        var slot: String?
        var imagePath: String?
        var timeMin: Double?
        var cooked: Bool?
        var source: String?
        var ready: Bool?
        var why: String?
    }

    var nothing: Bool { ready.isEmpty && oneMissing.isEmpty && leftovers.isEmpty && quick.isEmpty }
}

/// A dish (kind "recipe") or leftover portions (kind "leftover") – one shape for both.
struct WteCard: Decodable, Sendable, Identifiable {
    var kind: String
    var key: String
    var recipeId: Int?
    var productId: Int?
    var title: String
    var imagePath: String?
    var timeMin: Double?
    var thermomix: Bool?
    var favorite: Bool?
    @Lossy var missing: [Missing]
    var swaps: [String]?
    var why: String?
    var warnings: [String]?
    var qty: Double?
    var daysLeft: Int?
    var id: String { key }
    var isLeftover: Bool { kind == "leftover" }

    struct Missing: Decodable, Sendable {
        var text: String
        var productId: Int?
        @Lossy var alternatives: [Alt]
    }
    struct Alt: Decodable, Sendable, Hashable { var productId: Int; var name: String }

    enum CodingKeys: String, CodingKey {
        case kind, key, recipeId, productId, title, name, imagePath, timeMin, thermomix, favorite, missing, swaps, why, warnings, qty, daysLeft
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "recipe"
        key = try c.decode(String.self, forKey: .key)
        recipeId = try? c.decodeIfPresent(Int.self, forKey: .recipeId)
        productId = try? c.decodeIfPresent(Int.self, forKey: .productId)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        imagePath = try? c.decodeIfPresent(String.self, forKey: .imagePath)
        timeMin = try? c.decodeIfPresent(Double.self, forKey: .timeMin)
        thermomix = try? c.decodeIfPresent(Bool.self, forKey: .thermomix)
        favorite = try? c.decodeIfPresent(Bool.self, forKey: .favorite)
        _missing = try c.decode(Lossy<Missing>.self, forKey: .missing)
        swaps = try? c.decodeIfPresent([String].self, forKey: .swaps)
        why = try? c.decodeIfPresent(String.self, forKey: .why)
        warnings = try? c.decodeIfPresent([String].self, forKey: .warnings)
        qty = try? c.decodeIfPresent(Double.self, forKey: .qty)
        daysLeft = try? c.decodeIfPresent(Int.self, forKey: .daysLeft)
    }
}

/// POST /api/cook2/what-to-eat/pick → { pick }
struct WtePick: Decodable, Sendable {
    var item: WteCard
    /// leftovers | ready | one_missing
    var bucket: String
    var cycled: Bool?
    var left: Int?
}
struct WtePickResponse: Decodable, Sendable { var pick: WtePick? }

/// Filters of "Was essen wir?" (kept per device like the web keeps them in localStorage).
struct WteFilters: Codable, Equatable, Sendable {
    /// "" all, "1" only Thermomix, "0" without
    var tm = ""
    /// "", "20", "40"
    var max = ""
    var veg = false
    var noshop = false

    var isActive: Bool { !tm.isEmpty || !max.isEmpty || veg || noshop }
    var query: [URLQueryItem] {
        var q: [URLQueryItem] = []
        if !tm.isEmpty { q.append(.init(name: "tm", value: tm)) }
        if !max.isEmpty { q.append(.init(name: "max", value: max)) }
        if veg { q.append(.init(name: "veg", value: "1")) }
        if noshop { q.append(.init(name: "noshop", value: "1")) }
        return q
    }
    var body: [String: Any] { ["tm": tm, "max": max, "veg": veg ? "1" : "", "noshop": noshop ? "1" : ""] }

    private static let key = "cook.wte.filters"
    static func load() -> WteFilters {
        guard let d = UserDefaults.standard.data(forKey: key), let f = try? JSONDecoder().decode(WteFilters.self, from: d) else { return WteFilters() }
        return f
    }
    func save() { if let d = try? JSONEncoder().encode(self) { UserDefaults.standard.set(d, forKey: Self.key) } }
}

// MARK: - recipe page

/// GET /api/recipes/:id – the full recipe (tags, notes, Thermomix settings per step, cook log).
struct RecipeFull: Decodable, Sendable, Identifiable {
    var id: Int
    var title: String
    var description: String?
    var imagePath: String?
    var servings: Double?
    var timeMin: Double?
    var thermomix: Bool?
    var favorite: Bool?
    var tags: [String]?
    var notes: String?
    var sourceUrl: String?
    var sourceType: String?
    /// 0 = the steps live in the original app (Cookidoo, Monsieur Cuisine …) – recipes2
    var instructionsAvailable: JSONValue?
    @Lossy var steps: [Step]
    @Lossy var ingredients: [Ingredient]
    @Lossy var log: [LogEntry]

    struct Step: Decodable, Sendable, Hashable {
        var text: String
        var section: String?
        /// appliance settings { time, temp, speed, device, mode }
        var tm: JSONValue?

        init(text: String, section: String? = nil, tm: JSONValue? = nil) { self.text = text; self.section = section; self.tm = tm }
        init(from decoder: Decoder) throws {
            if let s = try? decoder.singleValueContainer().decode(String.self) { text = s; return }
            let c = try decoder.container(keyedBy: AnyKey.self)
            text = c.first(String.self, "text") ?? ""
            section = c.first(String.self, "section")
            tm = c.first(JSONValue.self, "tm")
        }
    }
    struct Ingredient: Decodable, Sendable, Hashable {
        var id: Int?
        var text: String
        var qty: Double?
        var unit: String?
        var productId: Int?
        var optional: JSONValue?
        var pantry: JSONValue?
        /// original line of a translated recipe (open recipe database)
        var orig: String?
        var isPantry: Bool { pantry?.bool ?? false }
    }
    struct LogEntry: Decodable, Sendable, Hashable {
        var cookedAt: String?
        var actor: String?
        var rating: Int?
    }

    var isFavorite: Bool { favorite ?? false }
    var baseServings: Int? { servings.map { Int($0) }.flatMap { $0 > 0 ? $0 : nil } }
}

/// GET /api/recipes/:id/match – the house version's lines with the stock product they match.
struct RecipeMatchLine: Decodable, Sendable, Identifiable, Hashable {
    var ingredientId: Int?
    var text: String
    var original: String?
    var change: String?
    var pantry: Bool?
    var product: Product?
    var id: String { "\(ingredientId ?? 0)-\(text)" }

    struct Product: Decodable, Sendable, Hashable {
        var id: Int
        var name: String?
        var unit: String?
        var trackMode: String?
        var total: Double?
    }

    var atHome: Bool {
        if pantry == true { return true }
        guard let p = product else { return false }
        return (p.total ?? 0) > 0 || p.trackMode == "none"
    }
    var isMissing: Bool { pantry != true && !atHome }
}

/// GET /api/cook2/recipes/:id/variant – "So machen wir das"
struct RecipeVariantView: Decodable, Sendable {
    var recipeId: Int?
    var variant: Variant?
    @Lossy var ingredients: [Line]
    @Lossy var rules: [SwapRule]

    struct Variant: Decodable, Sendable {
        @Lossy var changes: [Change]
        var note: String?
        var servings: Int?
        var timeMin: Int?
        var isEmpty: Bool { changes.isEmpty && (note ?? "").isEmpty && servings == nil && timeMin == nil }
    }
    struct Change: Codable, Sendable, Hashable {
        /// swap | remove | add
        var kind: String
        var ingredient: String?
        var to: String?
        var amount: String?
        var text: String?
        var day: String?
        var json: [String: Any] {
            var o: [String: Any] = ["kind": kind]
            if let ingredient { o["ingredient"] = ingredient }
            if let to { o["to"] = to }
            if let amount { o["amount"] = amount }
            if let text { o["text"] = text }
            if let day { o["day"] = day }
            return o
        }
    }
    struct Line: Decodable, Sendable, Hashable {
        var id: Int?
        var text: String
        var original: String?
        /// none | swap | remove | add
        var change: String?
        /// variant | today | rule
        var via: String?
        var ruleId: Int?
        var pantry: Bool?
        var optional: Bool?
    }

    var differs: Bool {
        ingredients.contains { ($0.change ?? "none") != "none" } || !(variant?.isEmpty ?? true)
    }
}

/// GET /api/cook2/swap-rules
struct SwapRule: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var fromText: String
    var toText: String
    var amount: String?
    var recipeIds: [Int]?
    var tags: [String]?
    var excludeIds: [Int]?
    var active: Bool?
}

/// GET /api/people/recipes/:id/ratings
struct RecipeRatings: Decodable, Sendable {
    var warnings: [String]?
    @Lossy var people: [Person]
    var avg: Double?
    var n: Int?

    struct Person: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var name: String
        var color: String?
        var kind: String?
        var value: Int?
        var by: String?
        var meals: Int?
        var id: String { key }
    }
}

/// GET /api/recipes/search?with= → recipes with these ingredients
struct IngredientSearchHit: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var matched: [String]
    var missing: [String]
}

/// GET /api/plan2/entries/:id
struct PlanEntryDetail: Decodable, Sendable {
    var id: Int
    var day: String
    var recipeId: Int?
    var servings: Int?
    var baseServings: Int?
}

/// Rating buckets (people/Ratings.tsx): not for me / okay / loved it = 1 / 3 / 5
enum MealRating: Int, CaseIterable, Identifiable {
    case no = 1, okay = 3, loved = 5
    var id: Int { rawValue }
    static func bucket(_ v: Int?) -> MealRating? {
        guard let v else { return nil }
        return v <= 2 ? .no : v >= 4 ? .loved : .okay
    }
    var label: String {
        switch self {
        case .no: return LC("Not for me")
        case .okay: return LC("Okay")
        case .loved: return LC("Loved it")
        }
    }
    var icon: String {
        switch self {
        case .no: return "hand.thumbsdown"
        case .okay: return "face.smiling"
        case .loved: return "heart"
        }
    }
}

/// Opens a recipe from anywhere (sheet item).
struct RecipeRef: Identifiable, Hashable, Sendable {
    let id: Int
    var planEntryId: Int?
}

// MARK: - dates in the plan

enum CookDay {
    private static func date(_ d: String) -> Date? { ServerDate.parse(d) }
    static func today() -> String { ServerDate.day() }
    static func add(_ d: String, _ n: Int) -> String {
        guard let x = date(d), let y = Calendar.current.date(byAdding: .day, value: n, to: x) else { return d }
        return ServerDate.day(y)
    }
    static func weekday(_ d: String) -> String { date(d)?.formatted(.dateTime.weekday(.abbreviated)) ?? d }
    static func dayOfMonth(_ d: String) -> String { date(d)?.formatted(.dateTime.day()) ?? "" }
    static func long(_ d: String) -> String { date(d)?.formatted(.dateTime.weekday(.wide).day().month(.wide)) ?? d }
    static func short(_ d: String) -> String { date(d)?.formatted(.dateTime.weekday(.abbreviated).day().month(.defaultDigits)) ?? d }
    static func weekdayLong(_ d: String) -> String { date(d)?.formatted(.dateTime.weekday(.wide)) ?? d }
    /// "heute", "morgen", "Donnerstag, 16.10."
    static func label(_ d: String) -> String {
        let t = today()
        if d == t { return LC("today") }
        if d == add(t, 1) { return LC("tomorrow") }
        return date(d)?.formatted(.dateTime.weekday(.wide).day().month(.defaultDigits)) ?? d
    }
    /// 0 = Monday … 6 = Sunday
    static func weekdayName(_ i: Int) -> String {
        var c = DateComponents(); c.year = 2024; c.month = 1; c.day = 1 + i; c.hour = 12
        return Calendar.current.date(from: c)?.formatted(.dateTime.weekday(.abbreviated)) ?? "\(i)"
    }
}

// MARK: - strings of this area

/// Strings of the cooking area live in Cooking.xcstrings (own table → no merge fights over Localizable);
/// falls back to Localizable for keys that already exist there.
func LC(_ key: String) -> String {
    let v = Bundle.main.localizedString(forKey: key, value: "\u{1}", table: "Cooking")
    return v == "\u{1}" ? L(key) : v
}

func LCF(_ key: String, _ args: CVarArg...) -> String {
    String(format: LC(key), locale: Locale.current, arguments: args)
}
