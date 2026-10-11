/**
 * Generic two-way sync engine (pure – no database, no network) for "Home Assistant already does this".
 *
 * One run reconciles one topic on one Home Assistant entity (e.g. the shopping list ⇄ todo.einkauf):
 *
 * - **Links** connect a local item (ToHuus id) with a remote one (HA uid) and remember the fields both sides had
 *   at the last sync (`base`). Changes are detected per field with a three-way merge: changed only here → goes
 *   there; changed only there → comes here.
 * - **Conflicts** (same field changed on both sides): the source of the topic wins (`from_ha` → HA, `to_ha` →
 *   ToHuus); in `two_way` the last writer wins. Local change times come from database triggers, the remote change
 *   time is when Home Assistant last changed the entity (an upper bound, good enough with live pushes).
 * - **Deletions** are tombstones: a deleted item is removed on the other side, unless that side changed it after the
 *   deletion (last writer wins again). A remote item whose local twin was deleted is never re-imported.
 * - **Creation direction** follows the mode: `two_way` both ways, `from_ha` only HA → here, `to_ha` only here → HA.
 *   Items that are already done are never created on the other side.
 * - **Dedupe**: unlinked items with the same normalised key on both sides are linked instead of created twice.
 * - **Origin markers**: a remote item that carries our own id (e.g. a calendar event we wrote) is linked back,
 *   never imported as new – no ping-pong.
 * - **Private** local items never leave ToHuus; a linked item that turns private is removed remotely.
 */

export type SyncMode = 'off' | 'two_way' | 'from_ha' | 'to_ha';
export type FieldValue = string | number | boolean | null;
export type Fields = Record<string, FieldValue>;

export interface LocalItem {
  id: string;
  /** normalised identity for dedupe ("milch", "2026-10-12|lasagne") */
  key: string;
  fields: Fields;
  /** last local change (ISO), from triggers; null = unknown */
  touchedAt: string | null;
  private?: boolean;
}

export interface RemoteItem {
  uid: string;
  key: string;
  fields: Fields;
  /** local id carried by an origin marker we wrote ourselves */
  origin?: string | null;
}

export interface Link {
  localId: string | null;
  remoteUid: string | null;
  base: Fields;
  /** last time this link was reconciled (ISO) */
  syncedAt: string;
  /** created remotely, uid not known yet */
  pendingSince?: string | null;
  /** local item deleted, remote delete requested – don't re-import */
  tombstoneAt?: string | null;
}

export type LocalOp = { op: 'create'; fields: Fields; remoteUid: string } | { op: 'update'; id: string; patch: Fields } | { op: 'delete'; id: string };
export type RemoteOp = { op: 'create'; fields: Fields; localId: string } | { op: 'update'; uid: string; patch: Fields; fields: Fields } | { op: 'delete'; uid: string };

export interface ReconcileInput {
  mode: SyncMode;
  local: LocalItem[];
  remote: RemoteItem[];
  links: Link[];
  /** local id → deletion time (ISO), from triggers */
  localDeleted?: Map<string, string>;
  /** when the remote side last changed (ISO) */
  remoteChangedAt: string;
  now: string;
  /** a remote create without a uid waits this long to be matched by key (default 10 min) */
  pendingTtlMs?: number;
  /** tombstones are forgotten after this (default 7 days) */
  tombstoneTtlMs?: number;
}

export interface ReconcileResult {
  local: LocalOp[];
  remote: RemoteOp[];
  /** links to keep (updated); links for creates are added by the caller once ids are known */
  links: Link[];
  conflicts: number;
  stats: { linked: number; deduped: number };
}

const same = (a: FieldValue | undefined, b: FieldValue | undefined) => (a ?? null) === (b ?? null);
const later = (a: string | null | undefined, b: string | null | undefined) => Boolean(a) && (!b || a! > b);
const age = (now: string, at: string) => Date.parse(now) - Date.parse(at);

export const createsLocal = (m: SyncMode) => m === 'two_way' || m === 'from_ha';
export const createsRemote = (m: SyncMode) => m === 'two_way' || m === 'to_ha';

/** Three-way merge of one linked pair. */
export function mergeFields(mode: SyncMode, base: Fields, local: Fields, remote: Fields, localAt: string | null, remoteAt: string) {
  const toLocal: Fields = {};
  const toRemote: Fields = {};
  const merged: Fields = { ...base };
  let conflicts = 0;
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    const l = local[k] ?? null;
    const r = remote[k] ?? null;
    const lc = !same(l, base[k]);
    const rc = !same(r, base[k]);
    if (same(l, r)) {
      merged[k] = l;
      continue;
    }
    let winner: 'local' | 'remote';
    if (lc && !rc) winner = 'local';
    else if (rc && !lc) winner = 'remote';
    else {
      // both changed (or no base yet): the topic's source wins, two-way → last writer wins
      conflicts += lc && rc ? 1 : 0;
      winner = mode === 'from_ha' ? 'remote' : mode === 'to_ha' ? 'local' : later(localAt, remoteAt) ? 'local' : 'remote';
    }
    if (winner === 'local') {
      toRemote[k] = l;
      merged[k] = l;
    } else {
      toLocal[k] = r;
      merged[k] = r;
    }
  }
  return { toLocal, toRemote, merged, conflicts };
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { mode, now, remoteChangedAt } = input;
  const pendingTtl = input.pendingTtlMs ?? 10 * 60_000;
  const tombTtl = input.tombstoneTtlMs ?? 7 * 86_400_000;
  const out: ReconcileResult = { local: [], remote: [], links: [], conflicts: 0, stats: { linked: 0, deduped: 0 } };
  if (mode === 'off') return { ...out, links: input.links };

  const local = new Map(input.local.map((l) => [l.id, l]));
  const remote = new Map(input.remote.map((r) => [r.uid, r]));
  const usedLocal = new Set<string>();
  const usedRemote = new Set<string>();
  const deleted = input.localDeleted ?? new Map<string, string>();

  // remote items that are not linked yet, by key / by origin marker (for pending links and dedupe)
  const linkedUids = new Set(input.links.map((l) => l.remoteUid).filter(Boolean) as string[]);
  const takeRemote = (pred: (r: RemoteItem) => boolean) => input.remote.find((r) => !linkedUids.has(r.uid) && !usedRemote.has(r.uid) && pred(r));

  for (const link0 of input.links) {
    const link: Link = { ...link0 };

    // ---- tombstone: local is gone, remote delete was requested
    if (link.tombstoneAt) {
      if (!link.remoteUid || !remote.has(link.remoteUid) || age(now, link.tombstoneAt) > tombTtl) continue;
      usedRemote.add(link.remoteUid);
      // still there after a while → ask again (the first delete may have been lost)
      if (age(now, link.tombstoneAt) > 2 * 60_000 && age(now, link.syncedAt) > 2 * 60_000) {
        out.remote.push({ op: 'delete', uid: link.remoteUid });
        link.syncedAt = now;
      }
      out.links.push(link);
      continue;
    }

    // ---- pending: created remotely, uid unknown – match by origin or key
    if (!link.remoteUid) {
      const l = link.localId ? local.get(link.localId) : undefined;
      if (!l) continue;
      const hit = takeRemote((r) => r.origin === l.id) ?? takeRemote((r) => r.key === l.key);
      if (hit) {
        link.remoteUid = hit.uid;
        link.pendingSince = null;
        linkedUids.add(hit.uid);
      } else {
        usedLocal.add(l.id);
        if (link.pendingSince && age(now, link.pendingSince) > pendingTtl) {
          // never showed up: forget, the local item is created again below
          usedLocal.delete(l.id);
          continue;
        }
        out.links.push(link);
        continue;
      }
    }

    const l = link.localId ? local.get(link.localId) : undefined;
    const r = remote.get(link.remoteUid!);
    if (l) usedLocal.add(l.id);
    if (r) usedRemote.add(r.uid);

    if (l && r) {
      if (l.private) {
        out.remote.push({ op: 'delete', uid: r.uid });
        continue;
      }
      const m = mergeFields(mode, link.base, l.fields, r.fields, later(l.touchedAt, link.syncedAt) ? l.touchedAt : null, remoteChangedAt);
      out.conflicts += m.conflicts;
      if (Object.keys(m.toLocal).length) out.local.push({ op: 'update', id: l.id, patch: m.toLocal });
      if (Object.keys(m.toRemote).length) out.remote.push({ op: 'update', uid: r.uid, patch: m.toRemote, fields: m.merged });
      out.links.push({ ...link, base: m.merged, syncedAt: now });
      out.stats.linked++;
      continue;
    }

    if (l && !r) {
      // deleted in Home Assistant
      const changedHereSince = later(l.touchedAt, link.syncedAt) && later(l.touchedAt, remoteChangedAt);
      if (changedHereSince && mode !== 'from_ha' && !l.private) {
        // edited here after HA deleted it → last writer wins: create it again there
        out.remote.push({ op: 'create', fields: l.fields, localId: l.id });
      } else {
        out.local.push({ op: 'delete', id: l.id });
      }
      continue;
    }

    if (!l && r) {
      // deleted here
      const deletedAt = (link.localId && deleted.get(link.localId)) || now;
      const changedThere = Object.keys(r.fields).some((k) => !same(r.fields[k], link.base[k]));
      if (changedThere && later(remoteChangedAt, deletedAt) && mode !== 'to_ha') {
        out.local.push({ op: 'create', fields: r.fields, remoteUid: r.uid });
      } else {
        out.remote.push({ op: 'delete', uid: r.uid });
        out.links.push({ ...link, localId: null, tombstoneAt: deletedAt, syncedAt: now });
      }
      continue;
    }
    // both gone: forget the link
  }

  // ---- unlinked remote items: origin marker → relink, same key → dedupe, else import
  for (const r of input.remote) {
    if (linkedUids.has(r.uid) || usedRemote.has(r.uid)) continue;
    const byOrigin = r.origin ? local.get(r.origin) : undefined;
    const twin = byOrigin && !usedLocal.has(byOrigin.id) ? byOrigin : input.local.find((l) => !usedLocal.has(l.id) && !l.private && l.key === r.key);
    if (twin && !twin.private) {
      usedLocal.add(twin.id);
      usedRemote.add(r.uid);
      // the source decides the starting point: from_ha → HA's fields come here, otherwise ours go there
      const base = mode === 'from_ha' ? twin.fields : r.fields;
      const m = mergeFields(mode, base, twin.fields, r.fields, twin.touchedAt, remoteChangedAt);
      if (Object.keys(m.toLocal).length) out.local.push({ op: 'update', id: twin.id, patch: m.toLocal });
      if (Object.keys(m.toRemote).length) out.remote.push({ op: 'update', uid: r.uid, patch: m.toRemote, fields: m.merged });
      out.links.push({ localId: twin.id, remoteUid: r.uid, base: m.merged, syncedAt: now });
      out.stats.deduped++;
      continue;
    }
    if (r.origin) continue; // ours, but the local twin is gone – the tombstone logic handles it
    if (!createsLocal(mode) || r.fields.done === true) continue;
    usedRemote.add(r.uid);
    out.local.push({ op: 'create', fields: r.fields, remoteUid: r.uid });
  }

  // ---- unlinked local items → create remotely
  if (createsRemote(mode)) {
    for (const l of input.local) {
      if (usedLocal.has(l.id) || l.private || l.fields.done === true) continue;
      out.remote.push({ op: 'create', fields: l.fields, localId: l.id });
    }
  }
  return out;
}
