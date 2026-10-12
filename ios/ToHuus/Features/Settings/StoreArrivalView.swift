import CoreLocation
import SwiftUI
import UIKit

/// Mehr › Hinweis im Laden: opt-in, explained before iOS asks; shop places stay on this iPhone.
struct StoreArrivalView: View {
    let store: ServerStore
    @State private var arrival = StoreArrival.shared
    @State private var name = ""
    @State private var storeId: Int?

    var body: some View {
        Form {
            Section {
                Toggle(L("Hint when I arrive at a shop"), isOn: Binding(get: { arrival.enabled }, set: { on in
                    if on { Task { await arrival.enable() } } else { arrival.disable() }
                }))
            } footer: {
                Text(L("When you get to a shop you saved here, ToHuus asks: “You're at Lidl – open the list?”. For this, iOS has to let ToHuus notice the place even when the app is closed (“Always”). Your location is never sent anywhere – the shop places and the check stay on this iPhone."))
            }

            if arrival.enabled {
                Section {
                    switch arrival.authorization {
                    case .authorizedAlways:
                        Label(L("Allowed: always"), systemImage: "location.fill").foregroundStyle(Theme.primaryText)
                    case .authorizedWhenInUse:
                        Label(L("Allowed only while the app is open – the hint needs “Always”."), systemImage: "location")
                        Button(L("Allow “Always”")) { arrival.requestAlways() }
                    case .denied, .restricted:
                        Label(L("Location is switched off for ToHuus."), systemImage: "location.slash")
                        Button(L("Open iPhone settings")) {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    default:
                        ProgressView()
                    }
                } header: {
                    Text(L("Permission"))
                }

                Section {
                    ForEach(arrival.shops) { s in
                        Label(s.name, systemImage: "storefront")
                            .swipeActions { Button(role: .destructive) { arrival.remove(s) } label: { Label(L("Remove"), systemImage: "trash") } }
                    }
                    if arrival.shops.isEmpty {
                        Text(L("No shops saved yet.")).foregroundStyle(Theme.ink3)
                    }
                } header: {
                    Text(L("Saved shops"))
                } footer: {
                    if !arrival.shops.isEmpty { Text(L("Swipe to remove a shop.")) }
                }

                Section {
                    if !store.list.stores.isEmpty {
                        Picker(L("Shop"), selection: $storeId) {
                            Text(L("Other")).tag(Int?.none)
                            ForEach(store.list.stores) { s in Text(s.name).tag(Int?.some(s.id)) }
                        }
                        .onChange(of: storeId) { _, id in
                            if let id, let s = store.list.stores.first(where: { $0.id == id }) { name = s.name }
                        }
                    }
                    TextField(L("Name, e.g. Lidl Hauptstraße"), text: $name)
                    Button {
                        arrival.addHere(name: name.trimmingCharacters(in: .whitespaces), storeId: storeId)
                        name = ""
                        storeId = nil
                    } label: {
                        HStack {
                            Label(L("I'm at this shop right now – save it"), systemImage: "mappin.and.ellipse")
                            if arrival.locating { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || arrival.locating)
                    if let e = arrival.error { Text(e).font(.footnote).foregroundStyle(Theme.empty) }
                } header: {
                    Text(L("Add a shop"))
                } footer: {
                    Text(L("Stand in or in front of the shop and save it. Up to 20 shops."))
                }
            }
        }
        .navigationTitle(L("Hint in the shop"))
    }
}
