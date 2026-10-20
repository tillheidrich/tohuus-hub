/** "I'll take care of it" for planned meals: who cooks. No points, no ranking – just so nobody does it twice. */
import { ChefHat } from '@phosphor-icons/react';
import { useMemo } from 'react';
import type { Me } from '../App';
import { invalidate, post, useApi } from '../api';
import { useHousehold } from '../household';
import { t } from '../i18n';
import { Avatar, useToast } from '../ui';
import type { Claim } from './sections';

/** ref_id → claim for meal plan entries (refreshes with the plan). */
export function usePlanClaims() {
  const q = useApi<(Claim & { ref_id: number })[]>(['plan', 'claims'], '/claims?kind=plan');
  return useMemo(() => new Map((q.data ?? []).map((c) => [c.ref_id, c])), [q.data]);
}

export interface CookSuggestion {
  entry_id: number;
  day: string;
  user_id: number;
  name: string;
  color: string;
  why: 'weekday' | 'lately';
}

/** entry id → who probably cooks (server: habits.ts – weekday habit, else who cooked lately). Only a suggestion. */
export function useCookSuggestions(from: string, to: string) {
  const q = useApi<{ suggestions: CookSuggestion[] }>(['plan', 'cook-suggest', from, to], `/habits/cook?from=${from}&to=${to}`);
  return useMemo(() => new Map((q.data?.suggestions ?? []).map((s) => [s.entry_id, s])), [q.data]);
}

export function ClaimAvatar({ claim, suggested, size = 22 }: { claim?: Claim | null; suggested?: CookSuggestion | null; size?: number }) {
  if (!claim && suggested)
    return (
      <span className="claim-av suggested" title={t('Probably {name} cooks', { name: suggested.name })}>
        <Avatar name={suggested.name} color={suggested.color} size={size} />
      </span>
    );
  if (!claim) return null;
  return (
    <span className="claim-av" title={t('{name} cooks', { name: claim.name })}>
      <Avatar name={claim.name} color={claim.color} size={size} />
    </span>
  );
}

/** Member picker in the meal sheet: tap a person to say who cooks, tap again to clear. */
export function CookPicker({ entryId, claim, suggested }: { entryId: number; claim?: Claim | null; suggested?: CookSuggestion | null }) {
  const me = useApi<Me>('me', '/me');
  const members = useApi<{ id: number; name: string; color: string }[]>(['shopping', 'members'], '/shop/members');
  const toast = useToast();
  const home = useHousehold();
  const set = async (userId: number, on: boolean) => {
    try {
      await post('/claims', { kind: 'plan', id: entryId, on, user_id: userId });
      invalidate('plan');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  // area: home – nobody to share cooking with when living alone
  if (!members.data?.length || !home.ui.claims) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="eyebrow row" style={{ gap: 6 }}>
        <ChefHat size={14} /> {claim ? t('{name} cooks', { name: claim.name }) : t('Who cooks?')}
      </div>
      {!claim && suggested && (
        <p className="small muted" style={{ margin: 0 }}>
          {suggested.why === 'weekday'
            ? t('{name} usually cooks on this weekday.', { name: suggested.name })
            : t('{name} has cooked most of the time lately.', { name: suggested.name })}
        </p>
      )}
      <div className="who-pick">
        {members.data.map((m) => {
          const on = claim?.user_id === m.id;
          return (
            <button key={m.id} className={on ? 'on' : !claim && suggested?.user_id === m.id ? 'suggested' : ''} onClick={() => set(m.id, !on)}>
              <Avatar name={m.name} color={m.color} size={30} />
              <span>{m.id === me.data?.actor.userId ? t('Me') : m.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
