/**
 * "Wer sieht das?" for whole lists (13 Oct 2026): shopping lists and wish lists can be for everyone, only for me,
 * or for me and the people I pick. Guests can never be picked (the server drops them too).
 */
import { LockSimple, UsersThree } from '@phosphor-icons/react';
import { useApi } from '../api';
import { t } from '../i18n';
import { Avatar, Seg } from '../ui';

export type ListVisibility = 'household' | 'private' | 'people';

export interface Member {
  id: number;
  name: string;
  color: string;
  kind?: string;
}

export function useMembers() {
  return useApi<Member[]>(['shopping', 'members'], '/shop/members');
}

/** Short words for a list badge: "Nur du", "Du + 2". */
export function visibilityLabel(v: ListVisibility, shareWith: number[] = [], owner?: string | null, mine = true): string {
  if (v === 'household') return t('Everyone');
  if (!mine && owner) return t('From {name}', { name: owner });
  if (v === 'private' || !shareWith.length) return t('Only you');
  return t('You + {n}', { n: shareWith.length });
}

export function VisibilityIcon({ v, size = 14 }: { v: ListVisibility; size?: number }) {
  if (v === 'household') return null;
  return v === 'private' ? <LockSimple size={size} weight="bold" aria-hidden /> : <UsersThree size={size} weight="bold" aria-hidden />;
}

/**
 * The picker: segment + member chips. `exclude` keeps someone out of the choice (the person a wish list is for).
 */
export function VisibilityPicker({
  value,
  shareWith,
  onChange,
  meId,
  exclude = [],
  hint,
}: {
  value: ListVisibility;
  shareWith: number[];
  onChange: (v: ListVisibility, shareWith: number[]) => void;
  meId?: number;
  exclude?: number[];
  hint?: string;
}) {
  const members = useMembers();
  const others = (members.data ?? []).filter((m) => m.id !== meId && m.kind !== 'guest' && !exclude.includes(m.id));
  return (
    <div className="stack vis-picker" style={{ gap: 10 }}>
      <div className="eyebrow">{t('Who sees it?')}</div>
      <Seg
        value={value}
        onChange={(v) => onChange(v, v === 'people' ? shareWith : [])}
        options={[
          ['household', t('Everyone')],
          ['private', t('Only me')],
          ['people', t('Chosen people')],
        ]}
        label={t('Who sees it?')}
      />
      {value === 'people' && (
        <div className="share-chips" role="group" aria-label={t('Chosen people')}>
          {others.length === 0 && <span className="small muted">{t('Nobody else with an own account yet.')}</span>}
          {others.map((m) => {
            const on = shareWith.includes(m.id);
            return (
              <button type="button" key={m.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(value, on ? shareWith.filter((x) => x !== m.id) : [...shareWith, m.id])}>
                <Avatar name={m.name} color={m.color} size={20} /> {m.name}
              </button>
            );
          })}
        </div>
      )}
      {value !== 'household' && <p className="small muted" style={{ margin: 0 }}>{hint ?? t('Everyone else doesn’t see this list – not on Today, not in notifications, not via the assistant, Home Assistant or exports. Guests never see it.')}</p>}
    </div>
  );
}
