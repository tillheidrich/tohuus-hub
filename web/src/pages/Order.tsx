import type { Me } from '../App';
import { api, post } from '../api';
import { t } from '../i18n';
import { OrderMenu } from './Guest';
import { EditMenuButton } from './Menu';

/** Household members order from the sofa: the bar menu plus everything that is in the house. */
export function Order({ me }: { me: Me }) {
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('From the sofa')}</div>
          <h1>{t('Order')}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{t('Pick something, add a note if you like – the others get a push and bring it.')}</p>
        </div>
        {!me.actor.houseGuest && (
          <div className="actions">
            <EditMenuButton />
          </div>
        )}
      </header>
      <OrderMenu
        src={{
          key: `member-${me.actor.userId ?? me.actor.name}`,
          // a signed-in person orders under their own name; a shared device without a person (kiosk token) asks like a guest
          member: me.actor.kind === 'user' ? me.actor.name : undefined,
          menu: () => api('/bar/menu'),
          orders: () => api('/bar/my-orders'),
          send: (b) => post('/bar/orders', b),
        }}
      />
    </div>
  );
}
