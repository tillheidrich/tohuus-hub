// Realistic German prompts for the assistant – shared by test/assistant-eval.test.ts (scripted fake model) and
// scripts/assistant-eval.mjs (a real model, for reading the answers by hand).
// mode: 'basic' = answered without a model; 'ai' = needs the model. tools: what the model must be offered.
export const CASES = [
  { id: 'list-simple', prompt: 'Milch, 2 Paprika und Brot', mode: 'basic', actions: ['list_add'] },
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
];
