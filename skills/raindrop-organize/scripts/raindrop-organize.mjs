#!/usr/bin/env node
/**
 * raindrop-organize: keep a Raindrop.io library tidy, with an AI agent (or you) making the calls.
 *
 *   audit                         read-only health check (Unsorted, misplaced, tag rules, duplicate URLs)
 *   context                       Unsorted bookmarks + every folder with examples of what is already in it
 *   apply <manifest.json>         preview the moves (default) ...
 *   apply <manifest.json> --yes   ... or write them; needs "review": "APPROVED"; reads each bookmark back
 *   rollback <journal.jsonl>      undo an apply, only where nothing changed since
 *   deadlinks [--folder <id>] [--limit N] [--block-host h]   report links that look dead; never deletes
 *
 * Common options: --json (machine output), --config <file>.
 * Needs RAINDROP_TOKEN (test token from https://app.raindrop.io/settings/integrations).
 * Exit codes: 0 ok / clean, 1 error, 2 usage, 3 audit found issues or apply refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RaindropApi } from './lib/api.mjs';
import { loadConfig } from './lib/config.mjs';
import { audit, formatAudit } from './lib/audit.mjs';
import { buildContext, formatContext } from './lib/context.mjs';
import { planMoves, formatPlan, applyOps, rollback } from './lib/apply.mjs';
import { probeAll, formatLinks, isUploadedFile } from './lib/links.mjs';

export function parseArgs(argv) {
  const o = { _: [], blockHost: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--yes') o.yes = true;
    else if (a === '--config') o.config = argv[++i];
    else if (a === '--folder') o.folder = Number(argv[++i]);
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--journal') o.journal = argv[++i];
    else if (a === '--block-host') o.blockHost.push(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export async function main(argv, { env = process.env, out = (s) => process.stdout.write(`${s}\n`), apiFactory } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { out(e.message); return 2; }
  const cmd = o._[0];
  if (!['audit', 'context', 'apply', 'rollback', 'deadlinks'].includes(cmd)) {
    out('usage: raindrop-organize audit|context|apply <manifest> [--yes]|rollback <journal>|deadlinks [--folder id] [--limit n] [--json] [--config file]');
    return 2;
  }
  const config = loadConfig(o.config, env);
  const api = apiFactory ? apiFactory() : new RaindropApi(env.RAINDROP_TOKEN);
  const print = (data, text) => out(o.json ? JSON.stringify(data, null, 2) : text);

  if (cmd === 'audit') {
    const [collections, bookmarks] = await Promise.all([api.collections(), api.bookmarks(0)]);
    const r = audit({ collections, bookmarks, config });
    print(r, formatAudit(r));
    return r.clean ? 0 : 3;
  }

  if (cmd === 'context') {
    const [collections, bookmarks] = await Promise.all([api.collections(), api.bookmarks(0)]);
    const ctx = buildContext({ collections, bookmarks, config });
    print(ctx, formatContext(ctx));
    return 0;
  }

  if (cmd === 'apply') {
    const file = o._[1];
    if (!file) { out('apply needs a manifest file'); return 2; }
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const collections = await api.collections();
    const current = new Map();
    for (const m of manifest.moves || []) {
      const b = await api.bookmark(Number(m.id)).catch(() => null);
      if (b) current.set(b._id, b);
    }
    const { ops, errors } = planMoves(manifest, { collections, current, config });
    if (errors.length) { print({ ops, errors }, `Refused, fix the manifest first:\n${errors.map((e) => `  - ${e}`).join('\n')}`); return 3; }
    if (!o.yes) {
      print({ ops, dryRun: true }, `${formatPlan(ops)}\n\nDRY RUN: nothing changed. ${ops.length} move(s). Show this to the human; after they agree set "review": "APPROVED" and re-run with --yes.`);
      return 0;
    }
    if (manifest.review !== 'APPROVED') { out('Refused: the manifest is not approved. Set "review": "APPROVED" after a human has looked at the dry run.'); return 3; }
    if (!ops.length) { out('Nothing to change.'); return 0; }
    const journal = o.journal || path.join(path.dirname(path.resolve(file)), `journal-${stamp()}.jsonl`);
    const done = await applyOps(api, ops, journal, o.json ? () => {} : out);
    print({ applied: done, journal }, `Applied ${done.length}/${ops.length}, each read back. Journal: ${journal}\nUndo: raindrop-organize rollback "${journal}"`);
    return 0;
  }

  if (cmd === 'rollback') {
    const file = o._[1];
    if (!file) { out('rollback needs a journal file'); return 2; }
    const r = await rollback(api, file, o.json ? () => {} : out);
    print(r, `Restored ${r.restored}; skipped ${r.skipped.length} that changed since.`);
    return 0;
  }

  // deadlinks
  let items = await api.bookmarks(Number.isInteger(o.folder) ? o.folder : 0);
  items = items.filter((b) => !config.skipCollections.includes(b.collection?.$id) && !isUploadedFile(b.link)).map((b) => ({ id: b._id, title: b.title || '', link: b.link }));
  if (o.limit > 0) items = items.slice(0, o.limit);
  const blockHosts = [...(config.blockHosts || []), ...o.blockHost];
  const results = await probeAll(items, { blockHosts });
  print(results, formatLinks(results));
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`raindrop-organize: ${e.message}\n`); process.exitCode = 1; });
}
