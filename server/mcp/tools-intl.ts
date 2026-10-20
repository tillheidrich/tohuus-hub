/** MCP tools: Regions: currency, units, country receipts (UK, US, SE), OFF country */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regionInfo } from '../lib/region.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'region_info',
    {
      title: 'Household region, currency and units',
      description:
        'Where the household shops: country, currency (all prices and spending totals are in this currency), number/date locale, units for recipes (metric or US customary), first day of the week, Open Food Facts country, typical stores and which receipt layout is expected (de, uk, us, se). Read this before recording a purchase from a receipt photo so prices are given in the right currency and with a decimal point.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      text({
        ...regionInfo(),
        hints: {
          prices: 'Send prices as plain numbers with a decimal point (3.49), in the household currency.',
          receipts: 'Discount lines (Clubcard Price, Nectar, coupons, BOGO, Rabatt, Medlemspris) belong to the item above; deposits (Pant, BOTTLE DEP, CRV, Pfand) are deposit=true; tax/VAT/moms lines are not items.',
          change: 'An admin changes the region in the app under Settings › Household › Region & currency.',
        },
      }),
  );
}
