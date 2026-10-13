// web/src/a11y.ts – field labels get linked to their controls (WCAG 1.3.1 / 4.1.2), on a tiny DOM shim (no jsdom).
import { describe, expect, it } from 'vitest';
import { linkFieldLabels, type El } from '../web/src/a11y';

/** Matches compound selectors without combinators: tag, .class, [attr], [attr="v"], :not(…), comma lists. */
function matches(el: Node, sel: string): boolean {
  return splitTop(sel, ',').some((one) => matchOne(el, one.trim()));
}
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
function matchOne(el: Node, sel: string): boolean {
  let rest = sel;
  const tag = /^[a-z]+/i.exec(rest)?.[0];
  if (tag) {
    if (el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    rest = rest.slice(tag.length);
  }
  while (rest) {
    let m: RegExpExecArray | null;
    if ((m = /^\.([\w-]+)/.exec(rest))) {
      if (!el.classes.includes(m[1])) return false;
    } else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) {
      const v = el.getAttribute(m[1]);
      if (v === null || (m[2] !== undefined && v !== m[2])) return false;
    } else if ((m = /^:not\(((?:[^()]|\([^()]*\))*)\)/.exec(rest))) {
      if (matches(el, m[1])) return false;
    } else throw new Error(`unsupported selector ${rest}`);
    rest = rest.slice(m[0].length);
  }
  return true;
}

class Node implements El {
  attrs = new Map<string, string>();
  children: Node[] = [];
  parent: Node | null = null;
  constructor(
    public tagName: string,
    public classes: string[] = [],
    attrs: Record<string, string> = {},
    public text = '',
  ) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  get id() {
    return this.attrs.get('id') ?? '';
  }
  set id(v: string) {
    this.attrs.set('id', v);
  }
  get textContent(): string {
    return this.text + this.children.map((c): string => c.textContent).join('');
  }
  add(...c: Node[]) {
    for (const x of c) {
      x.parent = this;
      this.children.push(x);
    }
    return this;
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  hasAttribute(n: string) {
    return this.attrs.has(n);
  }
  all(): Node[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelectorAll(sel: string) {
    return this.all().filter((n) => matches(n, sel));
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  contains(o: El | null) {
    return o === this || this.all().includes(o as Node);
  }
}
const h = (tag: string, cls = '', attrs: Record<string, string> = {}, text = '') => new Node(tag, cls.split(' ').filter(Boolean), attrs, text);

describe('linkFieldLabels', () => {
  it('links a bare label to the first control of its field', () => {
    const input = h('input', 'input', { type: 'text' });
    const label = h('label', '', {}, 'Name');
    const root = h('div').add(h('div', 'field').add(label, input));
    expect(linkFieldLabels(root)).toBe(1);
    expect(input.id).toMatch(/^fld-/);
    expect(label.getAttribute('for')).toBe(input.id);
  });

  it('keeps an existing id, and works for selects and textareas', () => {
    const sel = h('select', 'input', { id: 'pick' });
    const ta = h('textarea');
    const root = h('div').add(h('div', 'field').add(h('label', '', {}, 'Wann'), sel), h('div', 'field').add(h('label', '', {}, 'Notiz'), ta));
    expect(linkFieldLabels(root)).toBe(2);
    expect(root.querySelector('label[for="pick"]')).not.toBeNull();
    expect(ta.id).not.toBe('');
  });

  it('leaves fields alone that already have a name or a wrapping label', () => {
    const named = h('input', '', { 'aria-label': 'Suche' });
    const linked = h('input', '', { id: 'x' });
    const wrapped = h('label', '', {}, 'Menge').add(h('input'));
    const root = h('div').add(
      h('div', 'field').add(h('label', '', {}, 'Suche'), named),
      h('div', 'field').add(h('label', '', { for: 'x' }, 'Feld'), linked),
      h('div', 'field').add(wrapped),
      h('div', 'field').add(h('label', '', {}, ''), h('input')),
    );
    expect(linkFieldLabels(root)).toBe(0);
    expect(named.id).toBe('');
  });

  it('skips checkboxes (they carry their own label) and is idempotent', () => {
    const root = h('div').add(h('div', 'field').add(h('label', '', {}, 'Ja'), h('input', '', { type: 'checkbox' })), h('div', 'field').add(h('label', '', {}, 'Tag'), h('input', '', { type: 'date' })));
    expect(linkFieldLabels(root)).toBe(1);
    expect(linkFieldLabels(root)).toBe(0);
  });
});
