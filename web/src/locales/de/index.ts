// German UI strings, keyed by the English source text. One fragment per area keeps merges painless.
import { app } from './app';
import { cook } from './cook';
import { guest } from './guest';
import { imports } from './imports';
import { stock } from './stock';

export const de: Record<string, string> = { ...app, ...stock, ...cook, ...imports, ...guest };
