import Foundation

/// Cooking parity 0.3: week plan 2, "Was essen wir?", recipe page, house version, votes and rotation.
/// Shapes: server/routes/recipes.ts, plan2.ts, cook2.ts, people.ts, shop.ts (claims), labels.ts.
extension APIClient {
    // MARK: week plan

    func weekPlan(from: String, days: Int = 7) async throws -> WeekPlan {
        try await get("api/plan", query: [URLQueryItem(name: "from", value: from), URLQueryItem(name: "days", value: String(days))])
    }
    /// GET /api/plan2/week → marks, open votes, rotation
    func weekOverlay(from: String, days: Int = 7) async throws -> WeekOverlay {
        try await get("api/plan2/week", query: [URLQueryItem(name: "from", value: from), URLQueryItem(name: "days", value: String(days))])
    }
    /// POST /api/plan/autofill { from } → { added } – "Woche füllen" from what is at home (Plus)
    func autofillWeek(from: String) async throws -> Int {
        try await send("POST", "api/plan/autofill", json: ["from": from], as: JSONValue.self)["added"]?.int ?? 0
    }
    /// POST /api/plan/shopping { from } → { added }
    func shopForWeek(from: String) async throws -> Int {
        try await send("POST", "api/plan/shopping", json: ["from": from, "days": 7], as: JSONValue.self)["added"]?.int ?? 0
    }
    /// POST /api/plan2/entries { day, slot, recipe_id | title, servings } – free text ("Pizza") and one-off servings
    func planEntry(day: String, slot: String = "abend", recipeId: Int?, title: String?, servings: Int?, note: String? = nil) async throws {
        var body: [String: Any] = ["day": day, "slot": slot]
        if let recipeId { body["recipe_id"] = recipeId }
        if let title { body["title"] = title }
        if let note { body["note"] = note }
        body["servings"] = servings.map { $0 as Any } ?? NSNull()
        _ = try await send("POST", "api/plan2/entries", json: body, as: Ignored.self)
    }
    func planEntryDetail(_ id: Int) async throws -> PlanEntryDetail { try await get("api/plan2/entries/\(id)") }
    /// PATCH /api/plan2/entries/:id/servings { servings | null }
    func setEntryServings(_ id: Int, _ servings: Int?) async throws {
        _ = try await send("PATCH", "api/plan2/entries/\(id)/servings", json: ["servings": servings.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }
    /// POST /api/plan/shift { from, by, slot? } → { moved } – "we're eating out": this and every later meal one day back
    func shiftPlan(from: String, by: Int = 1, slot: String? = nil) async throws -> Int {
        var body: [String: Any] = ["from": from, "by": by]
        if let slot { body["slot"] = slot }
        return try await send("POST", "api/plan/shift", json: body, as: JSONValue.self)["moved"]?.int ?? 0
    }
    /// PUT /api/plan2/days/:day { kind: away|out|null }
    func setDayMark(_ day: String, kind: String?) async throws {
        _ = try await send("PUT", "api/plan2/days/\(day)", json: ["kind": kind.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }
    /// GET /api/claims?kind=plan – who cooks
    func planClaims() async throws -> [PlanClaim] {
        try await get("api/claims", query: [URLQueryItem(name: "kind", value: "plan")], as: Lossy<PlanClaim>.self).wrappedValue
    }
    /// POST /api/claims { kind: plan, id, on, user_id }
    func setCook(entry: Int, userId: Int, on: Bool) async throws {
        _ = try await send("POST", "api/claims", json: ["kind": "plan", "id": entry, "on": on, "user_id": userId], as: Ignored.self)
    }
    func houseMembers() async throws -> [HouseMember] { try await get("api/shop/members", as: Lossy<HouseMember>.self).wrappedValue }
    /// actor.userId from GET /api/me
    func myUserId() async -> Int? { (try? await me())?.actor?["userId"]?.int }

    // MARK: templates & rotation

    func planTemplates() async throws -> [PlanTemplate] { try await get("api/plan2/templates", as: Lossy<PlanTemplate>.self).wrappedValue }
    func planRotation() async throws -> PlanRotation { try await get("api/plan2/rotation") }
    /// POST /api/plan2/templates { name, from, template_id? } – saves the shown week
    func saveWeekTemplate(name: String, from: String, replacing: Int?) async throws {
        var body: [String: Any] = ["name": name, "from": from]
        if let replacing { body["template_id"] = replacing }
        _ = try await send("POST", "api/plan2/templates", json: body, as: Ignored.self)
    }
    func deleteTemplate(_ id: Int) async throws { _ = try await send("DELETE", "api/plan2/templates/\(id)", as: Ignored.self) }
    func applyTemplate(_ id: Int, from: String) async throws -> PlanApplyResult {
        try await send("POST", "api/plan2/templates/\(id)/apply", json: ["from": from])
    }
    /// PUT /api/plan2/rotation { template_ids?, next_index?, auto?, avoid_days? }
    func saveRotation(_ body: [String: Any]) async throws { _ = try await send("PUT", "api/plan2/rotation", json: body, as: Ignored.self) }
    func applyRotation(weeks: Int) async throws -> PlanApplyResult { try await send("POST", "api/plan2/rotation/apply", json: ["weeks": weeks]) }

    // MARK: votes

    func votes(all: Bool = true) async throws -> [FoodVote] {
        try await get("api/plan2/votes", query: all ? [URLQueryItem(name: "all", value: "1")] : [], as: Lossy<FoodVote>.self).wrappedValue
    }
    func vote(_ id: Int, voter: String?) async throws -> FoodVote {
        try await get("api/plan2/votes/\(id)", query: voter.map { [URLQueryItem(name: "voter", value: $0)] } ?? [])
    }
    func voteIdeas() async throws -> VoteIdeas { try await get("api/plan2/vote-ideas") }
    func voteMembers() async throws -> [VoteMember] { try await get("api/plan2/members", as: Lossy<VoteMember>.self).wrappedValue }
    func startVote(from: String, to: String, mode: String, candidates: [VoteIdea], voters: [String]) async throws -> FoodVote {
        let c: [[String: Any]] = candidates.map { i in
            var o: [String: Any] = ["title": i.title, "source": i.source ?? "free"]
            o["recipe_id"] = i.recipeId.map { $0 as Any } ?? NSNull()
            return o
        }
        return try await send("POST", "api/plan2/votes", json: ["day_from": from, "day_to": to, "mode": mode, "candidates": c, "voters": voters])
    }
    func castBallots(_ id: Int, voter: String?, ballots: [(Int, Int)]) async throws {
        var body: [String: Any] = ["ballots": ballots.map { ["candidate_id": $0.0, "value": $0.1] }]
        if let voter { body["voter"] = voter }
        _ = try await send("POST", "api/plan2/votes/\(id)/ballots", json: body, as: Ignored.self)
    }
    func closeVote(_ id: Int) async throws { _ = try await send("POST", "api/plan2/votes/\(id)/close", as: Ignored.self) }
    func applyVote(_ id: Int, candidates: [Int]) async throws -> VoteApplyResult {
        try await send("POST", "api/plan2/votes/\(id)/apply", json: ["candidate_ids": candidates])
    }
    func deleteVote(_ id: Int) async throws { _ = try await send("DELETE", "api/plan2/votes/\(id)", as: Ignored.self) }

    // MARK: what do we eat

    func whatToEat(_ f: WteFilters) async throws -> WhatToEat { try await get("api/cook2/what-to-eat", query: f.query) }
    func pickMeal(_ f: WteFilters, exclude: [String]) async throws -> WtePick? {
        try await send("POST", "api/cook2/what-to-eat/pick", json: ["filters": f.body, "exclude": exclude], as: WtePickResponse.self).pick
    }
    /// POST /api/cook2/missing-to-list { recipe_id, text } → { created }
    func missingLineToList(recipeId: Int, text: String) async throws -> Bool {
        try await send("POST", "api/cook2/missing-to-list", json: ["recipe_id": recipeId, "text": text], as: JSONValue.self)["created"]?.bool ?? true
    }
    /// POST /api/fresh/leftovers/:productId/eat → { eaten, left }
    func eatLeftover(_ productId: Int) async throws -> Int {
        try await send("POST", "api/fresh/leftovers/\(productId)/eat", json: [:], as: JSONValue.self)["left"]?.int ?? 0
    }

    // MARK: recipe page

    func recipeFull(_ id: Int) async throws -> RecipeFull { try await get("api/recipes/\(id)") }
    func recipeMatchLines(_ id: Int) async throws -> [RecipeMatchLine] {
        try await get("api/recipes/\(id)/match", as: Lossy<RecipeMatchLine>.self).wrappedValue
    }
    func setFavorite(_ id: Int, _ on: Bool) async throws { _ = try await send("PATCH", "api/recipes/\(id)/favorite", json: ["favorite": on], as: Ignored.self) }
    /// POST /api/recipes/:id/shopping { servings? } → { added }
    func recipeToList(_ id: Int, servings: Int?) async throws -> Int {
        try await send("POST", "api/recipes/\(id)/shopping", json: servings.map { ["servings": $0] } ?? [:], as: JSONValue.self)["added"]?.int ?? 0
    }
    /// POST /api/recipes/:id/cooked { rating, consume_qty, plan_entry_id }
    func logCooked(_ id: Int, rating: Int?, consume: [(productId: Int, qty: Double)], planEntryId: Int?) async throws {
        var body: [String: Any] = ["consume_qty": consume.map { ["product_id": $0.productId, "qty": $0.qty] }]
        body["rating"] = rating.map { $0 as Any } ?? NSNull()
        body["plan_entry_id"] = planEntryId.map { $0 as Any } ?? NSNull()
        _ = try await send("POST", "api/recipes/\(id)/cooked", json: body, as: Ignored.self)
    }
    /// POST /api/labels/boxes – leftovers as containers (no label printing from the phone)
    func saveLeftoverBoxes(recipeId: Int, planEntryId: Int?, portions: Int, place: String) async throws {
        var body: [String: Any] = ["recipe_id": recipeId, "portions": portions, "place": place, "labelled": false]
        if let planEntryId { body["plan_id"] = planEntryId }
        _ = try await send("POST", "api/labels/boxes", json: body, as: Ignored.self)
    }
    /// PUT /api/recipes/:id – the whole recipe (same body as the web editor)
    func saveRecipe(_ id: Int, body: [String: Any]) async throws { _ = try await send("PUT", "api/recipes/\(id)", json: body, as: Ignored.self) }
    func deleteRecipe(_ id: Int) async throws { _ = try await send("DELETE", "api/recipes/\(id)", as: Ignored.self) }
    /// GET /api/recipes/search?with=Hähnchen, Paprika
    func searchRecipes(with terms: String) async throws -> [IngredientSearchHit] {
        try await get("api/recipes/search", query: [URLQueryItem(name: "with", value: terms)], as: Lossy<IngredientSearchHit>.self).wrappedValue
    }

    // MARK: ratings per person

    func recipeRatings(_ id: Int) async throws -> RecipeRatings { try await get("api/people/recipes/\(id)/ratings") }
    func ratePerson(_ recipeId: Int, person: String, value: Int?) async throws {
        _ = try await send("PUT", "api/people/recipes/\(recipeId)/ratings", json: ["person": person, "value": value.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }
    /// POST /api/people/recipes/:id/meal { entries: [{ person, value }] } – one tap per person after cooking
    func saveMealRatings(_ recipeId: Int, _ entries: [String: Int]) async throws {
        guard !entries.isEmpty else { return }
        _ = try await send("POST", "api/people/recipes/\(recipeId)/meal", json: ["entries": entries.map { ["person": $0.key, "value": $0.value] }], as: Ignored.self)
    }

    // MARK: house version & swap rules

    func recipeVariant(_ id: Int) async throws -> RecipeVariantView { try await get("api/cook2/recipes/\(id)/variant") }
    func saveVariant(_ id: Int, changes: [RecipeVariantView.Change], note: String?, servings: Int?, timeMin: Int?) async throws {
        _ = try await send("PUT", "api/cook2/recipes/\(id)/variant", json: [
            "changes": changes.map(\.json),
            "note": note.map { $0 as Any } ?? NSNull(),
            "servings": servings.map { $0 as Any } ?? NSNull(),
            "time_min": timeMin.map { $0 as Any } ?? NSNull(),
        ], as: Ignored.self)
    }
    /// POST /api/cook2/recipes/:id/variant/change { kind, ingredient, to?, today }
    func variantChange(_ id: Int, ingredient: String, to: String?, today: Bool) async throws {
        var body: [String: Any] = ["kind": to == nil ? "remove" : "swap", "ingredient": ingredient, "today": today]
        if let to { body["to"] = to }
        _ = try await send("POST", "api/cook2/recipes/\(id)/variant/change", json: body, as: Ignored.self)
    }
    func deleteVariant(_ id: Int) async throws { _ = try await send("DELETE", "api/cook2/recipes/\(id)/variant", as: Ignored.self) }
    func swapRules() async throws -> [SwapRule] { try await get("api/cook2/swap-rules", as: Lossy<SwapRule>.self).wrappedValue }
    func addSwapRule(from: String, to: String, tags: [String] = []) async throws {
        var body: [String: Any] = ["from_text": from, "to_text": to]
        if !tags.isEmpty { body["tags"] = tags }
        _ = try await send("POST", "api/cook2/swap-rules", json: body, as: Ignored.self)
    }
    func setSwapRule(_ id: Int, active: Bool) async throws { _ = try await send("PATCH", "api/cook2/swap-rules/\(id)", json: ["active": active], as: Ignored.self) }
    func deleteSwapRule(_ id: Int) async throws { _ = try await send("DELETE", "api/cook2/swap-rules/\(id)", as: Ignored.self) }
    /// POST /api/cook2/swap-rules/:id/skip { recipe_id } – toggles "not in this recipe"
    func skipSwapRule(_ id: Int, recipeId: Int) async throws {
        _ = try await send("POST", "api/cook2/swap-rules/\(id)/skip", json: ["recipe_id": recipeId], as: Ignored.self)
    }
}
