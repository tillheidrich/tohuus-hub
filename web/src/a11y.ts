/**
 * Small accessibility helpers that work across every page without touching each form (WCAG 1.3.1, 4.1.2):
 *
 * - Field labels: the app writes most fields as `<div class="field"><label>Name</label><input …/></div>`. A label
 *   that neither wraps its control nor points at it (`for`) names nothing for a screen reader. `linkFieldLabels`
 *   connects such a label with the first control of its field (giving the control an id if needed). Controls that
 *   already have a name (aria-label, aria-labelledby, a linked label) are left alone.
 * - It runs once at start and after DOM changes (debounced to one animation frame), so sheets and lazy pages get it
 *   too. New code should still use `htmlFor`/`id` – this is the safety net, not the pattern.
 *
 * Test: test/web-a11y.test.ts (jsdom-free: runs on a tiny DOM shim).
 */

const CONTROL = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea';

let seq = 0;

/** Minimal element surface used here – keeps the function testable without a DOM library. */
export interface El {
  id: string;
  htmlFor?: string;
  tagName: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): ArrayLike<El>;
  contains(other: El | null): boolean;
  textContent: string | null;
}

/** Has this control got an accessible name already (not counting placeholder/title)? */
function named(control: El, root: El): boolean {
  if (control.getAttribute('aria-label')?.trim() || control.getAttribute('aria-labelledby')) return true;
  if (control.id && root.querySelector(`label[for="${cssEscape(control.id)}"]`)) return true;
  return false;
}

const cssEscape = (s: string) => s.replace(/["\\]/g, '\\$&');

/**
 * Link every unlinked `.field > label` (also `.field label.label`) to the first unnamed control in the same field.
 * Returns how many labels were linked (for the test).
 */
export function linkFieldLabels(root: El): number {
  let n = 0;
  const fields = root.querySelectorAll('.field');
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const label = f.querySelector('label:not([for])');
    if (!label || !label.textContent?.trim()) continue;
    // a label that wraps its control already works
    if (label.querySelector(CONTROL)) continue;
    const control = f.querySelector(CONTROL);
    if (!control || named(control, root)) continue;
    if (!control.id) control.id = `fld-${++seq}`;
    label.setAttribute('for', control.id);
    n++;
  }
  return n;
}

/** Start the safety net for the whole document (called once from main.tsx). */
export function startA11yHelpers(doc: Document = document) {
  let queued = false;
  const run = () => {
    queued = false;
    linkFieldLabels(doc.body as unknown as El);
  };
  run();
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  }).observe(doc.body, { childList: true, subtree: true });
}
