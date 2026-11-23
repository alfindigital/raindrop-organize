// Apply a reviewed manifest of moves, one bookmark at a time, reading each one back. Every change is
// journaled (before + after) so `rollback` can undo it.
import fs from 'node:fs';
import path from 'node:path';
import { UNSORTED, TRASH, collectionOf } from './api.mjs';
import { folderIndex, tagProblems } from './audit.mjs';

const lower = (xs) => (xs || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean);

/** Turn manifest moves into checked operations against the live library. Nothing is written here. */
export function planMoves(manifest, { collections, current, config }) {
  const idx = folderIndex(collections);
  const errors = [];
  const ops = [];
  const seen = new Set();
  if (!manifest || !Array.isArray(manifest.moves)) return { ops, errors: ['manifest has no "moves" list'] };
  for (const [i, m] of manifest.moves.entries()) {
    const where = `moves[${i}] (id ${m?.id})`;
    const id = Number(m?.id);
    const to = Number(m?.to);
    if (!Number.isInteger(id)) { errors.push(`${where}: id must be a bookmark id`); continue; }
    if (seen.has(id)) { errors.push(`${where}: bookmark listed twice`); continue; }
    seen.add(id);
    const b = current.get(id);
    if (!b) { errors.push(`${where}: bookmark not found (deleted, or in Trash)`); continue; }
    const from = collectionOf(b);
    if (from === TRASH) { errors.push(`${where}: bookmark is in Trash; leave it alone`); continue; }
    if (m.from !== undefined && Number(m.from) !== from) { errors.push(`${where}: expected it in ${m.from} but it is in ${from} now (stale manifest)`); continue; }
    if (to === UNSORTED || to === TRASH) { errors.push(`${where}: moving into Unsorted/Trash is not a triage move`); continue; }
    if (!idx.byId.has(to)) { errors.push(`${where}: folder ${m.to} does not exist`); continue; }
    if (config.skipCollections.includes(to)) { errors.push(`${where}: folder ${to} is in skipCollections`); continue; }
    if (config.rootMustBeEmpty && idx.hasChildren.has(to)) { errors.push(`${where}: ${idx.pathOf(to)} has subfolders; pick one of them`); continue; }
    const before = lower(b.tags);
    const add = lower(m.addTags).filter((t) => !before.includes(t));
    const remove = lower(m.removeTags);
    const after = [...before.filter((t) => !remove.includes(t)), ...add];
    const tagsChange = add.length > 0 || after.length !== before.length;
    // Only complain about problems this move would create; old ones are the audit's business.
    const oldProblems = tagProblems(before, config);
    const newProblems = tagsChange ? tagProblems(after, config).filter((p) => !oldProblems.includes(p)) : [];
    if (newProblems.length) { errors.push(`${where}: ${newProblems.join('; ')}`); continue; }
    if (from === to && !tagsChange) continue; // already there
    ops.push({ id, title: b.title || '', link: b.link || '', from, to, fromPath: idx.pathOf(from) || 'Unsorted', toPath: idx.pathOf(to), tagsBefore: b.tags || [], tagsAfter: tagsChange ? after : (b.tags || []), reason: String(m.reason || '').slice(0, 200) });
  }
  return { ops, errors };
}

export function formatPlan(ops) {
  if (!ops.length) return 'Nothing to change.';
  return ops.map((o) => {
    const tags = o.tagsAfter.join(',') !== (o.tagsBefore || []).join(',') ? `  tags [${o.tagsBefore.join(', ')}] -> [${o.tagsAfter.join(', ')}]` : '';
    return `${o.id} ${o.title}\n    ${o.fromPath} -> ${o.toPath}${tags}${o.reason ? `\n    why: ${o.reason}` : ''}`;
  }).join('\n');
}

const sameTags = (a, b) => lower(a).sort().join('\n') === lower(b).sort().join('\n');

/** Write each op, read it back, journal it. Stops at the first failure. */
export async function applyOps(api, ops, journalFile, log = () => {}) {
  fs.mkdirSync(path.dirname(journalFile), { recursive: true });
  const done = [];
  for (const op of ops) {
    const fields = { collection: { $id: op.to } };
    if (!sameTags(op.tagsAfter, op.tagsBefore)) fields.tags = op.tagsAfter;
    await api.update(op.id, fields);
    const after = await api.bookmark(op.id);
    const ok = collectionOf(after) === op.to && sameTags(after.tags, op.tagsAfter) && after.link === op.link;
    fs.appendFileSync(journalFile, `${JSON.stringify({ at: new Date().toISOString(), id: op.id, link: op.link, from: op.from, to: op.to, tagsBefore: op.tagsBefore, tagsAfter: op.tagsAfter, verified: ok })}\n`);
    if (!ok) throw new Error(`readback failed for ${op.id}: now in ${collectionOf(after)} with tags [${(after.tags || []).join(', ')}]`);
    log(`OK ${op.id} -> ${op.toPath}`);
    done.push(op.id);
  }
  return done;
}

/** Undo a journal, newest first, only where the bookmark is still where we left it. */
export async function rollback(api, journalFile, log = () => {}) {
  const entries = fs.readFileSync(journalFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.verified).reverse();
  const result = { restored: 0, skipped: [] };
  for (const e of entries) {
    const now = await api.bookmark(e.id).catch(() => null);
    if (!now || collectionOf(now) !== e.to || !sameTags(now.tags, e.tagsAfter)) { result.skipped.push(e.id); log(`SKIP ${e.id}: changed since (or gone); not touched`); continue; }
    const fields = { collection: { $id: e.from } };
    if (!sameTags(e.tagsBefore, e.tagsAfter)) fields.tags = e.tagsBefore;
    await api.update(e.id, fields);
    const back = await api.bookmark(e.id);
    if (collectionOf(back) !== e.from || !sameTags(back.tags, e.tagsBefore)) throw new Error(`rollback readback failed for ${e.id}`);
    result.restored++;
    log(`RESTORED ${e.id} -> ${e.from}`);
  }
  return result;
}
