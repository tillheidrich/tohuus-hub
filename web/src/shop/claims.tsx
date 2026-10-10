/** "I'll take care of it" for planned meals: who cooks. No points, no ranking – just so nobody does it twice. */
import { HandHeart } from '@phosphor-icons/react';
import { useMemo } from 'react';
import type { Me } from '../App';
import { invalidate, post, useApi } from '../api';
import { t } from '../i18n';
import { Avatar, useToast } from '../ui';
import type { Claim } from './sections';

/** ref_id → claim for meal plan entries (refreshes with the plan). */
export function usePlanClaims() {
  const q = useApi<(Claim & { ref_id: number })[]>(['plan', 'claims'], '/claims?kind=plan');
  return useMemo(() => new Map((q.data ?? []).map((c) => [c.ref_id, c])), [q.data]);
}

export function ClaimAvatar({ claim, size = 22 }: { claim?: Claim | null; size?: number }) {
  if (!claim) return null;
  return (
    <span className="claim-av" title={t('{name} cooks', { name: claim.name })}>
      <Avatar name={claim.name} color={claim.color} size={size} />
    </span>
  );
}

/** Member picker in the meal sheet: tap a person to say who cooks, tap again to clear. */
export function CookPicker({ entryId, claim }: { entryId: number; claim?: Claim | null }) {
  const me = useApi<Me>('me', '/me');
  const members = useApi<{ id: number; name: string; color: string }[]>(['shopping', 'members'], '/shop/members');
  const toast = useToast();
  const set = async (userId: number, on: boolean) => {
    try {
      await post('/claims', { kind: 'plan', id: entryId, on, user_id: userId });
      invalidate('plan');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  if (!members.data?.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="eyebrow row" style={{ gap: 6 }}>
        <HandHeart size={14} /> {claim ? t('{name} cooks', { name: claim.name }) : t('Who cooks?')}
      </div>
      <div className="who-pick">
        {members.data.map((m) => {
          const on = claim?.user_id === m.id;
          return (
            <button key={m.id} className={on ? 'on' : ''} onClick={() => set(m.id, !on)}>
              <Avatar name={m.name} color={m.color} size={30} />
              <span>{m.id === me.data?.actor.userId ? t('Me') : m.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
