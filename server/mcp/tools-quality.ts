/** MCP tools: receipt recognition – learned rules, recognition statistics, recognition report per import */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { QualityError, deleteRule, importReport, listRules, recognitionStats } from '../lib/quality.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'list_receipt_rules',
    {
      title: 'Receipt rules learned from corrections',
      description:
        'Lists the household rules learned from corrections in the receipt review: receipt text (and store) → product, pack size (qty_factor: one receipt line counts as N), unit, or "ignore this line"; plus learned store names (kind "store"). New imports apply these rules first and mark the lines as learned.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const rules = listRules();
      return text({ count: rules.length, rules });
    },
  );

  s.registerTool(
    'delete_receipt_rule',
    {
      title: 'Forget a learned receipt rule',
      description: 'Deletes one learned receipt rule by id (from list_receipt_rules). Future receipts are recognised without it again.',
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        return text(deleteRule(id));
      } catch (e) {
        if (e instanceof QualityError) return fail(e.message);
        throw e;
      }
    },
  );

  s.registerTool(
    'receipt_recognition_stats',
    {
      title: 'How well receipts are recognised',
      description:
        'Share of receipt lines recognised without anybody having to correct them, over the last imports – overall, per store and per import (share 0–1), plus how many lines came from learned rules and how many were corrected. A household view, never per person.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional().describe('number of recent imports, default 20') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => text(recognitionStats(limit ?? 20)),
  );

  s.registerTool(
    'receipt_recognition_report',
    {
      title: 'Recognition report of one import',
      description:
        'For one import: how the store was recognised (store_via: header, text, layout, learned, corrected, model, unknown), whether the line sum matches the receipt total, and per line a grade (learned, sure, suggested, unmatched, ignored, none for deposits) with the match confidence.',
      inputSchema: { import_id: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ import_id }) => {
      try {
        return text(importReport(import_id));
      } catch (e) {
        if (e instanceof QualityError) return fail(e.message);
        throw e;
      }
    },
  );
}
