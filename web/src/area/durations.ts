/** times in a recipe step → seconds (pure, no DOM; the same pattern as `CookTimers.durations` on the iPhone) */
const DURATION_RE =
  /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|bis|to|or|oder)\s*(\d+(?:[.,]\d+)?))?\s*(stunden|stunde|std\.?|hours?|hrs?|h|minuten|minutes?|min\.?|mins?|sekunden|sek\.?|seconds?|secs?|s)(?![\p{L}])/giu;

/** seconds for every time in the text and the appliance time (the longer end of a range), at most three, 5 s … 8 h */
export function stepDurations(text: string, deviceTime?: string | null): number[] {
  const out: number[] = [];
  for (const src of [text, deviceTime ?? '']) {
    if (!src) continue;
    for (const m of src.matchAll(DURATION_RE)) {
      const a = Number(m[1].replace(',', '.'));
      const b = m[2] ? Number(m[2].replace(',', '.')) : 0;
      if (!Number.isFinite(a)) continue;
      const n = Math.max(a, b);
      const unit = m[3].toLowerCase();
      const mult = unit.startsWith('h') || unit.startsWith('std') || unit.startsWith('stund') ? 3600 : unit.startsWith('s') ? 1 : 60;
      const secs = Math.round(n * mult);
      if (secs < 5 || secs > 8 * 3600 || out.includes(secs)) continue;
      out.push(secs);
    }
  }
  return out.slice(0, 3);
}

export const fmtTimer = (s: number) => {
  const v = Math.max(0, Math.round(s));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

