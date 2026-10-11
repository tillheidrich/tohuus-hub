import type { Me } from '../App';
import { api, post } from '../api';
import { currentBrand } from '../brand';
import { t } from '../i18n';
import { OrderMenu } from './Guest';
import { EditMenuButton } from './Menu';

/** Household members order from the sofa: the bar menu plus everything that is in the house. */
export function Order({ me }: { me: Me }) {
  const fredi = currentBrand() === 'fredirando';
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{fredi ? t('Fredirando delivers') : t('From the sofa')}</div>
          <h1>{fredi ? t('What can we bring you?') : t('Order')}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{t('Pick something, add a note if you like – the others get a push and bring it.')}</p>
        </div>
        {!me.actor.houseGuest && (
          <div className="actions">
            <EditMenuButton />
          </div>
        )}
      </header>
      <OrderMenu
        fredi={fredi}
        src={{
          key: `member-${me.actor.userId ?? me.actor.name}`,
          member: me.actor.name,
          menu: () => api('/bar/menu'),
          orders: () => api('/bar/my-orders'),
          send: (b) => post('/bar/orders', b),
        }}
      />
    </div>
  );
}
