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


export const de: Record<string, string> = { ...app, ...stock, ...cook, ...imports, ...guest, ...data, ...party, ...fresh, ...shop, ...home };
