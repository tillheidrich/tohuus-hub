// German UI strings, keyed by the English source text. One fragment per area keeps merges painless.
import { app } from './app';
import { cook } from './cook';
import { guest } from './guest';
import { imports } from './imports';
import { stock } from './stock';
import { data } from './data';
import { party } from './party';
import { fresh } from './fresh';
import { shop } from './shop';
import { home } from './home';
import { kiosk } from './kiosk';
import { kids } from './kids';
import { onboard } from './onboard';
import { retail } from './retail';
import { ha } from './ha';
import { channels } from './channels';
import { intl } from './intl';
import { cook2 } from './cook2';
import { auth } from './auth';
import { spend2 } from './spend2';
import { print } from './print';


export const de: Record<string, string> = { ...app, ...stock, ...cook, ...imports, ...guest, ...data, ...party, ...fresh, ...shop, ...home, ...kiosk, ...kids, ...onboard, ...retail, ...ha, ...channels, ...intl, ...cook2, ...auth, ...spend2, ...print };
