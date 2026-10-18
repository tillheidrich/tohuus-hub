// ---------- parametrized reads
let today = ServerDate.day()
let month = String(today.prefix(7))
await check("shopList(decoded)") { try api.decode(ShopList.self, from: try await api.shopList()) }
await check("shopList(store mode)") { try api.decode(ShopList.self, from: try await api.shopList(storeId: nil, shopMode: true)) }
let lists = (try? await api.shopLists()) ?? []
for l in lists where l.id.value != "0" { await check("shopList(list \(l.id))") { try api.decode(ShopList.self, from: try await api.shopList(listId: l.id.value)) } }
let prods = (try? await api.products()) ?? []
for p in prods.prefix(25) {
    await check("product(\(p.id))") { try await api.product(p.id) }
    await check("productFull(\(p.id))") { try await api.productFull(p.id) }
    await check("freshProduct(\(p.id))") { try await api.freshProduct(p.id) }
    await check("prices(\(p.id))") { try await api.prices(product: p.id) }
    await check("priceHistory(\(p.id))") { try await api.priceHistory(p.id) }
}
let recs = (try? await api.recipes()) ?? []
for r in recs.prefix(15) {
    await check("recipe(\(r.id))") { try await api.recipe(r.id) }
    await check("recipeFull(\(r.id))") { try await api.recipeFull(r.id) }
    await check("recipeMatch(\(r.id))") { try await api.recipeMatch(r.id) }
    await check("recipeMatchLines(\(r.id))") { try await api.recipeMatchLines(r.id) }
    await check("recipeRatings(\(r.id))") { try await api.recipeRatings(r.id) }
    await check("recipeVariant(\(r.id))") { try await api.recipeVariant(r.id) }
}
await check("plan") { try await api.plan(from: today) }
await check("weekPlan") { try await api.weekPlan(from: today) }
await check("weekOverlay") { try await api.weekOverlay(from: today) }
if let wp = try? await api.weekPlan(from: today) { for e in wp.entries.prefix(5) { await check("planEntryDetail(\(e.id))") { try await api.planEntryDetail(e.id) } } }
await check("whatToEat") { try await api.whatToEat(WteFilters()) }
await check("searchRecipes") { try await api.searchRecipes(with: "Tomate, Nudeln") }
await check("recipeSuggestions") { try await api.recipeSuggestions(thermomix: nil) }
for i in ((try? await api.imports()) ?? []).prefix(6) {
    await check("importDetail(\(i.id))") { try await api.importDetail(i.id) }
    await check("recognitionReport(\(i.id))") { try await api.recognitionReport(i.id) }
    await check("importSplitInfo(\(i.id))") { try await api.importSplitInfo(i.id) }
    await check("spendReceipt(\(i.id))") { try await api.spendReceipt(i.id) }
}
await check("moneyOverview") { try await api.moneyOverview(month: month) }
await check("moneyOverview(mine)") { try await api.moneyOverview(month: month, view: "mine") }
for l in ((try? await api.moneyLists()) ?? []) { await check("moneyList(\(l.id))") { try await api.moneyList(l.id) } }
for period in ["week", "month", "year"] { await check("spendStats(\(period))") { try await api.spendStats(period: period, date: today, tag: nil) } }
await check("spendEntries") { try await api.spendEntries(from: String(today.prefix(4)) + "-01-01", to: today) }
for w in ((try? await api.wishLists()) ?? []) { await check("wishList(\(w.id))") { try await api.wishList(w.id) } }
await check("searchWishes") { try await api.searchWishes("a") }
await check("guardHints") { try await api.guardHints(text: "Milch") }
if let a = try? await api.awayOverview() { for t in a.trips.prefix(3) {
    await check("awayTrip(\(t.id))") { try await api.awayTrip(t.id) }
    await check("handoverOverview(\(t.id))") { try await api.handoverOverview(trip: t.id) }
    await check("handoverSources(\(t.id))") { try await api.handoverSources(trip: t.id) }
} }
if let c = try? await api.care() { for t in c.tasks.prefix(8) { await check("careTask(\(t.id))") { try await api.careTask(t.id) } } }
for p in ((try? await api.people()) ?? []) {
    await check("personProfile(\(p.key))") { try await api.personProfile(p.key) }
    await check("personTaste(\(p.key))") { try await api.personTaste(p.key) }
}
for q in ["Milch", "a", "Nudeln", "Bad"] { await check("search(\(q))") { try await api.search(q) } }
await check("find") { try await api.find("Milch") }
for pl in ((try? await api.places()) ?? []).prefix(4) { await check("checkStack(\(pl.id))") { try await api.checkStack(pl.id) } }
for l in lists where l.id.value != "0" && l.kind == "care" { if let n = l.id.int {
    await check("careCheck(\(n))") { try await api.careCheck(listId: n) }
    await check("careSpent(\(n))") { try await api.careSpent(listId: n) }
} }
await check("menuSuggestions") { try await api.menuSuggestions("Cola") }
await check("houseGuide") { try await api.get("api/house-guide", as: HouseGuide.self) }
await check("aiSettings") { try await api.get("api/ai/settings", as: AISettings.self) }
await check("myNotifyPrefs") { try await api.get("api/notify/prefs", as: MyNotifyPrefs.self) }
await check("quality rules") { try await api.get("api/quality/rules", as: RecognitionRules.self) }
await check("oauth connections") { try await api.get("api/oauth/connections", as: OAuthConnections.self) }
await check("tokens") { try await api.get("api/tokens", as: Lossy<AccessToken>.self) }
await check("print info") { try await api.get("api/print/info", as: PrintInfo.self) }
await check("modules") { try await api.get("api/modules", as: [String: Bool].self) }
for b in ((try? await api.boxes()) ?? []).prefix(3) { await check("box(\(b.code))") { try await api.box(b.code) } }
for k in ((try? await api.houseLog()) ?? []).prefix(1) { _ = k }
// ---------- mutations (scenario on a scratch household) – only when MUT=1
if ProcessInfo.processInfo.environment["MUT"] == "1" {
let me = try? await api.me()
_ = me
let products2 = (try? await api.products()) ?? []
let pid = products2.first?.id ?? 1
let pid2 = products2.dropFirst().first?.id ?? 2
let places2 = (try? await api.places()) ?? []
let placeId = places2.first?.id
// shopping
await check("parseQuickAdd") { try await api.parseQuickAdd("2 Milch, Brot") }
await check("sync add") { try await api.sync([PendingOp.add("Harness-Butter", localId: -1), PendingOp.add("Harness-Käse", productId: pid, qty: 2, localId: -2)]) }
let sl = try? api.decode(ShopList.self, from: try await api.shopList())
let rows = (sl?.sections.flatMap { $0.items } ?? [])
let rowId = rows.first?.id ?? 0
let rowId2 = rows.dropFirst().first?.id ?? 0
await check("sync basket") { try await api.sync([PendingOp.basket(rowId, on: true, storeId: nil)]) }
await check("sync check") { try await api.sync([PendingOp.check(rowId2, on: true)]) }
await check("restoreItem") { try await api.restoreItem(rowId2) as Any }
await check("updateItem") { try await api.updateItem(rowId, note: "harness", substitute: "ok") }
await check("patchItem") { try await api.patchItem(rowId, text: "Harness-Butter 2", qty: .some(3), note: .some(nil), substitute: .some("ask")) }
await check("claimItem") { try await api.claimItem(rowId, on: true) }
await check("setItemPrivacy") { try await api.setItemPrivacy(rowId, visibility: .discreet, shareWith: [], reveal: false, placeholder: "Geschenk") }
await check("setItemBuyAt") { try await api.setItemBuyAt(rowId, stores: ["REWE"]) }
await check("moveItem section") { try await api.moveItem(rowId, section: "chilled") }
await check("placeItem") { try await api.placeItem(rowId, section: "bakery") }
await check("setItemExtra") { try await api.setItemExtra(rowId, extra: true) }
await check("setItemOwner") { try await api.setItemOwner(rowId, userId: nil) }
await check("guardHints") { try await api.guardHints(text: "Milch") }
await check("setListPrefs") { try await api.setListPrefs(density: "compact", fontScale: 1.1) }
await check("createShopList") { try await api.createShopList(name: "Harness-Liste", kind: "other", visibility: "private", shareWith: []) as Any }
let lists2 = (try? await api.shopLists()) ?? []
if let nl = lists2.last?.id.int, nl != 0 {
    await check("updateShopList") { try await api.updateShopList(nl, name: "Harness-Liste 2", note: "n") }
    await check("setShopListVisibility") { try await api.setShopListVisibility(nl, visibility: "household", shareWith: []) }
    await check("moveItemToList") { try await api.moveItemToList(rowId, listId: nl) }
    await check("moveItemToList back") { try await api.moveItemToList(rowId, listId: 0) }
}
await check("createStore") { try await api.createStore(name: "Harness-Markt") }
if let st = (try? await api.stores())?.last {
    await check("renameStore") { try await api.renameStore(st.id, name: "Harness-Markt 2") }
    await check("setStoreOrder") { try await api.setStoreOrder(st.id, order: ["Obst & Gemüse", "Kühlregal"]) }
    await check("shopList store") { try api.decode(ShopList.self, from: try await api.shopList(storeId: st.id)) }
}
await check("setTripPrivacy") { try await api.setTripPrivacy(false) }
await check("finishShopping") { try await api.finishShopping(storeId: nil, toStock: true) }
await check("recentDone") { try await api.recentDone() }
await check("setLunchbox") { try await api.setLunchbox(enabled: true, items: ["Apfel"], weekday: 1) }
await check("lunchbox") { try await api.lunchbox() }
await check("setExtrasAllowance") { try await api.setExtrasAllowance(mode: "money", weekly: 15) }
await check("extrasWeek") { try await api.extrasWeek() }
// pantry
await check("adjustStock") { try await api.adjustStock(productId: pid, delta: 1, locationId: placeId) }
await check("addBatch") { try await api.addBatch(productId: pid, qty: 1, locationId: placeId, bestBefore: ServerDate.day(Date().addingTimeInterval(86400 * 5))) }
if let f = try? await api.freshProduct(pid) {
    for e in f.entries.prefix(1) {
        await check("patchBatch") { try await api.patchBatch(e.id, bestBefore: .some(ServerDate.day(Date().addingTimeInterval(86400 * 6))), locationId: placeId) }
        await check("freshAction open") { try await api.freshAction(pid, "open", entryId: e.id) }
    }
}
await check("freezeOrThaw") { try await api.freezeOrThaw(pid2, "freeze", qty: 1) }
await check("setShelfLife") { try await api.setShelfLife(pid, daysAfterOpening: 4, freezerDays: 90) }
await check("wasteProduct") { try await api.wasteProduct(pid2, qty: 1, reason: "spoiled") }
await check("markRunsOut") { try await api.markRunsOut(pid, true) }
await check("setProductBuyAt") { try await api.setProductBuyAt(pid, stores: ["Aldi"]) }
await check("patchProduct") { try await api.patchProduct(pid, body: try JSONSerialization.data(withJSONObject: ["min_qty": 2, "date_kind": "use_by", "notes": "harness"])) }
await check("product after patch") { try await api.productFull(pid) }
await check("createProduct") { try await api.createProduct(name: "Harness-Produkt", brand: "B", code: nil, imageURL: nil, initialQty: 2) as Any }
await check("usedUp") { try await api.usedUp(pid2) }
if let pl = placeId {
    await check("checkAnswer") { try await api.checkAnswer(locationId: pl, productId: pid, action: "ok") }
    await check("checkStack") { try await api.checkStack(pl) }
}
await check("putAwayLeftovers") { try await api.putAwayLeftovers(name: "Harness-Suppe", portions: 2, boxes: 1, place: "fridge", eatBy: nil) }
for b in ((try? await api.boxes()) ?? []).prefix(1) {
    await check("box") { try await api.box(b.code) }
    await check("boxAction eat") { try await api.boxAction(b.code, "eaten") }
    await check("undoBox") { try await api.undoBox(b.code) }
}
await check("portionProduct") { try await api.portionProduct(productId: pid, name: "Harness-Portion", portions: 2, boxes: 1, place: "freezer") }
await check("createPlace") { try await api.createPlace(name: "Harness-Regal", parentId: nil, climate: "ambient") }
await check("createCategory") { try await api.createCategory(name: "Harness-Kategorie") }
await check("freshStart") { try await api.freshStart() }
// cooking
let recs2 = (try? await api.recipes()) ?? []
let rid = recs2.first?.id ?? 1
await check("missingToList") { try await api.missingToList(rid) }
await check("recipeToList") { try await api.recipeToList(rid, servings: 2) }
await check("setFavorite") { try await api.setFavorite(rid, true) }
await check("ratePerson") { try await api.ratePerson(rid, person: "me", value: 5) }
await check("variantChange") { try await api.variantChange(rid, ingredient: "Salz", to: "Kräutersalz", today: false) }
await check("recipeVariant") { try await api.recipeVariant(rid) }
await check("addSwapRule") { try await api.addSwapRule(from: "Sahne", to: "Hafersahne") }
await check("addPlanEntry") { try await api.addPlanEntry(day: today, recipeId: rid, title: nil) as Any }
await check("planEntry") { try await api.planEntry(day: today, recipeId: nil, title: "Harness-Essen", servings: 3) }
if let wp = try? await api.weekPlan(from: today), let e = wp.entries.first {
    await check("setEntryServings") { try await api.setEntryServings(e.id, 4) }
    await check("movePlan") { try await api.movePlan(e.id, day: ServerDate.day(Date().addingTimeInterval(86400))) }
    await check("setPlanCooked") { try await api.setPlanCooked(e.id, true) }
    await check("planEntryDetail") { try await api.planEntryDetail(e.id) }
}
await check("setDayMark") { try await api.setDayMark(today, kind: "out") }
await check("planToList") { try await api.planToList(from: today) }
await check("shiftPlan") { try await api.shiftPlan(from: today) }
await check("saveWeekTemplate") { try await api.saveWeekTemplate(name: "Harness-Woche", from: today, replacing: nil) }
if let tpl = (try? await api.planTemplates())?.first { await check("applyTemplate") { try await api.applyTemplate(tpl.id, from: today) } }
await check("pickMeal") { try await api.pickMeal(WteFilters(), exclude: []) as Any }
await check("logCooked") { try await api.logCooked(rid, rating: 4, consume: [], planEntryId: nil) }
await check("cooked") { try await api.cooked(rid) }
let ideas = (try? await api.voteIdeas()) ?? nil
_ = ideas
// money
await check("addExpense") { try await api.addExpense(amount: 12.5, day: today, store: "Harness", category: "Sonstiges", note: "n", tags: ["x"]) }
await check("setBudget") { try await api.setBudget(category: nil, period: "month", amount: 400, notify: true) }
await check("createMoneyList") { try await api.createMoneyList(title: "Harness-Abend", people: [MoneyPersonInput(name: "Mira"), MoneyPersonInput(name: "Sam")], count: nil, from: nil, privateList: false, shareWith: []) }
if let ml = (try? await api.moneyLists())?.first {
    await check("addMoneyListItem") { try await api.addMoneyListItem(ml.id, name: "Pizza", amount: 20) }
    if let full = try? await api.moneyList(ml.id) {
        _ = full
    }
}
for i in ((try? await api.imports()) ?? []).prefix(1) {
    await check("setReceiptTags") { try await api.setReceiptTags(i.id, tags: ["harness"]) }
    await check("setReceiptPayer") { try await api.setReceiptPayer(i.id, userId: nil) }
}
await check("importLines") { try await api.importLines(["REWE", "Milch 1,29", "Brot 2,49", "SUMME 3,78"], mode: "receipt") }
await check("importText") { try await api.importText("Milch 1,29\nBrot 2,49") }
// care tasks (Aufgaben)
if let c = try? await api.care() {
    if let tpl = c.templates.first(where: { $0.added != true }) { await check("addCareTemplate") { try await api.addCareTemplate(tpl.key) } }
}
if let c = try? await api.care(), let t = c.tasks.first {
    await check("careDone") { try await api.careDone(t.id) }
    await check("careUndo") { try await api.careUndo(t.id) }
    await check("careClaim") { try await api.careClaim(t.id, true) }
    await check("careTask") { try await api.careTask(t.id) }
}
await check("careRecent") { try await api.careRecent() }
// house guide
await check("applyHouseTemplate") { try await api.applyHouseTemplate((try await api.houseTemplates()).first?.key ?? "wifi") }
await check("houseGuide after") { try await api.get("api/house-guide", as: HouseGuide.self) }
// treats & wishes
await check("createGuestLink") { try await api.createGuestLink(name: "Harness-Gast", scopes: ["bar"], locationIds: [], days: 2, note: nil) }
await check("setBlickCompare") { try await api.setBlickCompare(true) }
await check("answerPulse") { try await api.answerPulse("1-2") }
await check("setStartMode") { try await api.setStartMode("full") }
await check("today after") { try await api.today() }
await check("blick after") { try await api.blick() }
await check("search after") { try await api.search("Harness") }
await check("money after") { try await api.moneyOverview(month: month) }
await check("spendEntries after") { try await api.spendEntries(from: String(today.prefix(7)) + "-01", to: today) }
await check("shopList after") { try api.decode(ShopList.self, from: try await api.shopList()) }
}
// ---------- second scenario: away, kids, house guide, wishes – only when MUT2=1
if ProcessInfo.processInfo.environment["MUT2"] == "1" {
let tomorrow = ServerDate.day(Date().addingTimeInterval(86400))
let inAWeek = ServerDate.day(Date().addingTimeInterval(86400 * 7))
let tripBody: [String: Any] = ["name": "Harness-Reise", "place": "Ostsee", "start_day": tomorrow, "end_day": inAWeek, "travellers": [String](), "home": [String](),
                               "use_up_days": 2, "quiet": true, "pause_auto": true, "kitchen": true, "kitchen_store": NSNull()]
await check("create trip") { try await api.send("POST", "api/away/trips", json: tripBody, as: JSONValue.self) }
if let o = try? await api.awayOverview(), let t = o.trips.first {
    await check("awayTrip") { try await api.awayTrip(t.id) }
    await check("away pack") { try await api.awaySend("POST", "trips/\(t.id)/pack", ["text": "Sonnencreme"]) }
    await check("away meals") { try await api.awaySend("POST", "trips/\(t.id)/meals", ["day": tomorrow, "slot": "abend", "title": "Fisch"]) }
    await check("away kitchen-list") { try await api.awaySend("POST", "trips/\(t.id)/kitchen-list", ["text": "Brot"]) }
    await check("awayTrip after") { try await api.awayTrip(t.id) }
    await check("handoverOverview") { try await api.handoverOverview(trip: t.id) }
    await check("saveHandoverItem") { try await api.saveHandoverItem(id: nil, trip: t.id, HandoverItemInput(kind: "pet", title: "Katze füttern", instructions: "2x", rhythm: "daily", weekdays: [], day: nil, slots: ["morning"])) }
    await check("handoverOverview after") { try await api.handoverOverview(trip: t.id) }
    await check("awayOverview after") { try await api.awayOverview() }
}
if let k = (try? await api.kids())?.first {
    await check("pairKidDevice") { try await api.pairKidDevice(k.id, label: "iPad", days: 30) }
}
await check("saveHouseCard") { try await api.saveHouseCard(id: nil, ["type": "tip", "topic": "other", "title": "Müll", "body": "Dienstag", "detail": NSNull(), "area": NSNull(), "visibility": ["members": true, "guest_level": "order", "sitters": true, "links": [[String: Any]]()] as [String: Any]]) }
await check("saveHouseCode") { try await api.saveHouseCode(id: nil, ["kind": "wifi", "label": "WLAN", "area": NSNull(), "note": NSNull(), "visibility": ["members": true, "guest_level": NSNull(), "sitters": false, "links": [[String: Any]]()] as [String: Any], "value": "geheim123", "wifi": ["ssid": "Berg", "security": "WPA"] as [String: Any]]) }
await check("houseGuide full") { try await api.get("api/house-guide", as: HouseGuide.self) }
if let w = (try? await api.wishLists())?.first {
    await check("saveWish") { try await api.saveWish(id: nil, listId: w.id, body: try JSONSerialization.data(withJSONObject: ["title": "Harness-Wunsch", "note": NSNull(), "price": 19.99, "priority": 1, "links": [["url": "https://example.org/x", "label": NSNull(), "price": NSNull()]]])) }
    await check("wishList full") { try await api.wishList(w.id) }
}
await check("createInvite") { try await api.createInvite(name: "Mika", email: nil, role: "member", kind: "member", guestLevel: nil, message: nil, send: false) }
await check("invites") { try await api.invites() }
await check("people") { try await api.people() }
await check("kids") { try await api.kids() }
}
// ---------- third scenario: votes, offers, treats, memory, expenses – only when MUT3=1
if ProcessInfo.processInfo.environment["MUT3"] == "1" {
let d0 = ServerDate.day()
let d3 = ServerDate.day(Date().addingTimeInterval(86400 * 3))
if let vi = try? await api.voteIdeas() {
    let cands = Array((vi.suggestions + vi.favourites).prefix(3))
    let voters = ((try? await api.voteMembers()) ?? []).map(\.key)
    await check("startVote") { try await api.startVote(from: d0, to: d3, mode: "together", candidates: cands, voters: voters) }
}
if let v = (try? await api.votes())?.first {
    await check("vote") { try await api.vote(v.id, voter: nil) }
    if let fv = try? await api.vote(v.id, voter: nil), let c = fv.candidates.first {
        await check("castBallots") { try await api.castBallots(v.id, voter: nil, ballots: [(c.id, 2)]) }
        await check("vote after") { try await api.vote(v.id, voter: nil) }
    }
}
await check("scanOffers text") { try await api.scanOffers(text: "Butter 1,49 €\nMilch 0,99 €") }
await check("offers") { try await api.offers() }
let menu = (try? await api.treatMenu()) ?? []
if let m = menu.first {
    await check("askForTreat") { try await api.askForTreat(lines: [(productId: m.id, qty: 1, options: [])], note: "bitte", bringBy: nil) }
}
await check("myTreats") { try await api.myTreats() }
await check("treatRequests") { try await api.treatRequests() }
await check("remember") { try await api.remember("Mika mag keine Pilze", onlyMe: false) }
await check("memory") { try await api.memory() }
await check("addExpense") { try await api.addExpense(amount: 9.99, day: d0, store: "Kiosk", category: "Sonstiges", note: nil, tags: []) }
if let e = (try? await api.spendEntries(from: String(d0.prefix(7)) + "-01", to: d0))?.entries.first(where: { $0.isExpense }) {
    await check("expense") { try await api.expense(e.id) }
}
if let ml = (try? await api.moneyLists())?.first, let full = try? await api.moneyList(ml.id) {
    let ps = full.people.map(\.id)
    if ps.count >= 2 {
        await check("addMoneyListPayment") { try await api.addMoneyListPayment(ml.id, from: ps[0], to: ps[1], amount: 5) }
        await check("moneyListPaidAll") { try await api.moneyListPaidAll(ml.id, by: ps[0]) }
    }
}
await check("careRecent") { try await api.careRecent() }
if let t = (try? await api.care())?.tasks.first { await check("careDone2") { try await api.careDone(t.id) } }
await check("careRecent after") { try await api.careRecent() }
await check("planClaims") { try await api.planClaims() }
}
