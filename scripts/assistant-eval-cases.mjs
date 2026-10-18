// Realistic German prompts for the assistant – shared by test/assistant-eval.test.ts (scripted fake model) and
// scripts/assistant-eval.mjs (a real model, for reading the answers by hand).
// mode: 'basic' = answered without a model; 'ai' = needs the model. tools: what the model must be offered.
export const CASES = [
  { id: 'list-simple', prompt: 'Milch, 2 Paprika und Brot', mode: 'basic', actions: ['list_add'] },
  { id: 'bare-list', prompt: 'Bananen und Haferflocken', mode: 'basic', actions: ['list_add'] },
  { id: 'bare-list-spoken', prompt: 'Joghurt und Äpfel.', mode: 'basic', actions: ['list_add'], voice: true },
  { id: 'used-up', prompt: 'Milch ist alle', mode: 'basic', actions: ['stock_used_up'] },
  { id: 'purchase', prompt: 'Hab bei Aldi Milch, Eier und Brot für 12,40 gekauft', mode: 'basic', actions: ['log_purchase'] },
  { id: 'remember', prompt: 'Merk dir, dass wir Hafermilch trinken', mode: 'basic', actions: ['remember'] },
  { id: 'show-list', prompt: 'Was steht auf der Liste?', mode: 'basic', actions: [] },
  { id: 'still-coffee', prompt: 'Haben wir noch Kaffee?', mode: 'ai', tools: ['stock_find'], actions: [] },
  { id: 'pancake-evening', prompt: 'Milch ist alle und wir brauchen was für einen Pfannkuchen-Abend am Sonntag', mode: 'ai', tools: ['check_at_home', 'list_add'], actions: ['list_add'] },
  { id: 'cheap-dinner', prompt: 'Was kann ich heute Abend für vier Personen kochen, das unter 10 Euro bleibt?', mode: 'ai', tools: ['cook_ideas', 'known_prices'], actions: [] },
  { id: 'month-spend', prompt: 'Was haben wir diesen Monat ausgegeben?', mode: 'ai', tools: ['money_summary'], actions: [] },
  { id: 'due', prompt: 'Was ist fällig?', mode: 'ai', tools: ['rhythm_due'], actions: [] },
  { id: 'plan', prompt: 'Plan Spaghetti Bolognese für morgen Abend', mode: 'ai', tools: ['plan_meal'], actions: ['plan_meal'] },
  { id: 'recipe-list', prompt: 'Setz die Zutaten für Spaghetti Bolognese auf die Liste', mode: 'ai', tools: ['recipe_to_list'], actions: ['recipe_to_list'] },
  { id: 'shops', prompt: 'Wo geben wir mehr Geld aus, bei REWE oder bei Lidl?', mode: 'ai', tools: ['money_summary'], actions: [] },
  { id: 'toilet-paper', prompt: 'Brauchen wir Klopapier?', mode: 'ai', tools: ['stock_find'], actions: [] },
  { id: 'forget', prompt: 'Vergiss das mit der Hafermilch', mode: 'basic', actions: ['forget'] },
  // help per screen (context = the screen the button was pressed on, server/lib/assistant-areas.ts)
  { id: 'tidy-list', context: 'shopping', prompt: 'Fass die doppelten Sachen auf der Liste zusammen', mode: 'ai', tools: ['list_tidy'], actions: ['list_tidy'] },
  { id: 'lasagne', context: 'shopping', prompt: 'Was brauche ich für Lasagne?', mode: 'ai', tools: ['recipe_get', 'check_at_home'], actions: [] },
  { id: 'use-soon', context: 'stock', prompt: 'Was muss bald weg?', mode: 'ai', tools: ['use_soon'], actions: [] },
  { id: 'adapt-veggie', context: 'cook', prompt: 'Mach die Spaghetti Bolognese vegetarisch und speicher sie als eigenes Rezept', mode: 'ai', tools: ['recipe_get', 'recipe_save_adapted'], actions: ['recipe_save_adapted'] },
  { id: 'week-from-home', context: 'cook', prompt: 'Plan mir die Woche mit dem, was da ist', mode: 'ai', tools: ['cook_ideas', 'plan_meal'], actions: [] },
  { id: 'why-expensive', context: 'money', prompt: 'Warum war der Oktober teurer?', mode: 'ai', tools: ['money_compare'], actions: [] },
  { id: 'house-alexa', context: 'house', prompt: 'Wir haben Alexa und Hue im Wohnzimmer – mach daraus was für den Babysitter', mode: 'ai', tools: ['house_draft_cards'], actions: ['house_draft_cards'] },
  { id: 'house-code', context: 'house', prompt: 'Wie ist der Code für die Haustür?', mode: 'ai', tools: ['house_info'], actions: [] },
  { id: 'visitors', context: 'guests', prompt: 'Wir feiern Samstag mit 12 Gästen, was muss ich einkaufen?', mode: 'ai', tools: ['check_at_home', 'list_add'], actions: [] },
];
