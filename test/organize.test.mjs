import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeApi, library } from './fake-api.mjs';
import { normalize } from '../skills/raindrop-organize/scripts/lib/config.mjs';
import { normalizeUrl, audit, formatAudit } from '../skills/raindrop-organize/scripts/lib/audit.mjs';
import { buildContext, formatContext } from '../skills/raindrop-organize/scripts/lib/context.mjs';
import { planMoves, applyOps, rollback } from '../skills/raindrop-organize/scripts/lib/apply.mjs';
import { RaindropApi } from '../skills/raindrop-organize/scripts/lib/api.mjs';
import { main } from '../skills/raindrop-organize/scripts/raindrop-organize.mjs';

const cfg = (over = {}) => normalize({ tags: ['open-source', 'reference', 'free', 'freemium', 'paid', 'self-hosted'], skipCollections: [30], ...over });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rdo-'));

test('normalizeUrl: same page under different spellings, different SPA routes stay apart', () => {
  assert.equal(normalizeUrl('https://www.github.com/sharkdp/fd/?utm_source=x'), normalizeUrl('http://github.com/sharkdp/fd#install'));
  assert.equal(normalizeUrl('https://grupy.chat/?fbclid=abc'), normalizeUrl('https://grupy.chat/'));
  assert.notEqual(normalizeUrl('https://analytics.google.com/analytics/web#/a1p2/reports'), normalizeUrl('https://analytics.google.com/analytics/web#/a3p4/reports'));
  assert.notEqual(normalizeUrl('https://x.com/a?id=1'), normalizeUrl('https://x.com/a?id=2'));
  assert.notEqual(normalizeUrl('https://example.com/docs/a'), normalizeUrl('https://example.com/docs/b'));
});

test('audit finds every kind of mess and changes nothing', async () => {
  const api = new FakeApi();
  const r = audit({ collections: await api.collections(), bookmarks: await api.bookmarks(0), config: cfg() });
  assert.deepEqual(r.unsorted.map((x) => x.id), [4]);
  assert.deepEqual(r.inRoot.map((x) => x.id), [5]);
  assert.deepEqual(r.badTags.map((x) => x.id), [5]);
  assert.match(r.badTags[0].problems.join(' '), /outside the vocabulary: x, y/);
  assert.match(r.badTags[0].problems.join(' '), /4 tags \(max 3\)/);
  assert.match(r.badTags[0].problems.join(' '), /more than one price tag/);
  assert.deepEqual(r.duplicates.map((d) => d.items.map((i) => i.id).sort()), [[3, 6]]);
  assert.deepEqual(r.emptyFolders, ['Design / Icons']);
  assert.equal(r.clean, false);
  assert.equal(api.writes.length, 0);
  assert.match(formatAudit(r), /NEEDS ATTENTION/);
  // the skipped auto-inbox is ignored entirely
  assert.ok(!JSON.stringify(r).includes('auto inbox item'));
});

test('the example config in the skill folder is valid', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../skills/raindrop-organize/raindrop-organize.example.json', import.meta.url), 'utf8'));
  const c = normalize(raw);
  assert.equal(c.maxTags, 3);
  assert.ok(c.tags.includes('open-source'));
  assert.ok(c.rules.length > 3);
});

test('a tidy library audits clean', async () => {
  const lib = library();
  lib.bookmarks = lib.bookmarks.filter((b) => [1, 2, 7].includes(b._id));
  lib.children = lib.children.filter((c) => c._id !== 21);
  lib.roots = lib.roots.filter((c) => c._id !== 20);
  const api = new FakeApi(lib);
  const r = audit({ collections: await api.collections(), bookmarks: await api.bookmarks(0), config: cfg() });
  assert.equal(r.clean, true, formatAudit(r));
});

test('context: only leaf folders, newest examples first, titles quoted', async () => {
  const api = new FakeApi();
  const ctx = buildContext({ collections: await api.collections(), bookmarks: await api.bookmarks(0), config: cfg({ rules: ['Icon sets go to Design / Icons.'] }) });
  assert.deepEqual(ctx.folders.map((f) => f.path), ['Design / Icons', 'Dev / Guides', 'Dev / Tools']);
  assert.deepEqual(ctx.folders.find((f) => f.id === 11).examples, ['fd again', 'fd', 'ripgrep']);
  assert.deepEqual(ctx.unsorted.map((u) => u.id), [4]);
  const text = formatContext(ctx);
  assert.match(text, /11 \| Dev \/ Tools \| "fd again", "fd", "ripgrep"/);
  assert.match(text, /Icon sets go to Design \/ Icons\./);
  assert.match(text, /"review": "PENDING"/);
});

async function plan(manifest, over) {
  const api = new FakeApi();
  const current = new Map((await api.bookmarks(0)).map((b) => [b._id, b]));
  return planMoves(manifest, { collections: await api.collections(), current, config: cfg(over) });
}

test('planMoves refuses anything unsafe or unclear, with a reason each', async () => {
  const a = await plan({ moves: [
    { id: 4, to: 10 },                       // root that has subfolders
    { id: 4, to: 21 },                       // listed twice
    { id: 99, to: 21 },                      // missing
    { id: 1, to: 999 },                      // no such folder
    { id: 2, to: -99 },                      // to Trash
    { id: 3, to: 30 },                       // skipped collection
    { id: 6, to: 12, from: -1 },             // stale: it is in 11 now
  ] });
  const b = await plan({ moves: [
    { id: 1, to: 12, addTags: ['made-up'] }, // tag outside vocab
    { id: 2, to: 11, addTags: ['free', 'paid'] }, // two price tags
  ] });
  const errors = [...a.errors, ...b.errors];
  assert.equal(a.ops.length + b.ops.length, 0);
  const text = errors.join('\n');
  for (const want of [/has subfolders/, /listed twice/, /not found/, /does not exist/, /Unsorted\/Trash/, /skipCollections/, /stale manifest/, /outside the vocabulary: made-up/, /more than one price tag/]) assert.match(text, want);
  assert.equal(errors.length, 9);
});

test('planMoves merges tags and skips no-op moves', async () => {
  const { ops, errors } = await plan({ moves: [
    { id: 4, to: 21, addTags: ['FREE', 'open-source'], reason: 'icon set' },
    { id: 1, to: 11 }, // already there, nothing to do
  ] });
  assert.deepEqual(errors, []);
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].tagsAfter, ['free', 'open-source']);
  assert.equal(ops[0].toPath, 'Design / Icons');
});

test('apply reads every bookmark back and journals it; rollback undoes it', async () => {
  const api = new FakeApi();
  const current = new Map((await api.bookmarks(0)).map((b) => [b._id, b]));
  const { ops } = planMoves({ moves: [{ id: 4, to: 21, addTags: ['free'] }] }, { collections: await api.collections(), current, config: cfg() });
  const journal = path.join(tmp(), 'j.jsonl');
  assert.deepEqual(await applyOps(api, ops, journal), [4]);
  assert.equal((await api.bookmark(4)).collection.$id, 21);
  const line = JSON.parse(fs.readFileSync(journal, 'utf8').trim());
  assert.equal(line.verified, true);
  assert.deepEqual([line.from, line.to], [-1, 21]);

  const r = await rollback(api, journal);
  assert.equal(r.restored, 1);
  const back = await api.bookmark(4);
  assert.equal(back.collection.$id, -1);
  assert.deepEqual(back.tags, []);
});

test('rollback leaves alone a bookmark someone moved again since', async () => {
  const api = new FakeApi();
  const current = new Map((await api.bookmarks(0)).map((b) => [b._id, b]));
  const { ops } = planMoves({ moves: [{ id: 4, to: 21 }] }, { collections: await api.collections(), current, config: cfg() });
  const journal = path.join(tmp(), 'j.jsonl');
  await applyOps(api, ops, journal);
  await api.update(4, { collection: { $id: 12 } }); // a human re-filed it
  const r = await rollback(api, journal);
  assert.deepEqual(r, { restored: 0, skipped: [4] });
  assert.equal((await api.bookmark(4)).collection.$id, 12);
});

test('apply stops at the first write that does not read back', async () => {
  const api = new FakeApi(library(), { breakWrites: true });
  const current = new Map((await api.bookmarks(0)).map((b) => [b._id, b]));
  const { ops } = planMoves({ moves: [{ id: 4, to: 21 }, { id: 6, to: 12 }] }, { collections: await api.collections(), current, config: cfg() });
  const journal = path.join(tmp(), 'j.jsonl');
  await assert.rejects(applyOps(api, ops, journal), /readback failed for 4/);
  assert.equal(api.writes.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(journal, 'utf8').trim()).verified, false);
});

test('api: follows pages and backs off on 429', async () => {
  const calls = [];
  let limited = false;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (!limited) { limited = true; return { ok: false, status: 429, headers: { get: () => '1' }, text: async () => '' }; }
    const page = Number(new URL(url).searchParams.get('page'));
    const items = Array.from({ length: page === 0 ? 50 : 7 }, (_, i) => ({ _id: page * 50 + i }));
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: true, items }) };
  };
  const waits = [];
  const api = new RaindropApi('t', { fetchImpl, wait: async (ms) => { waits.push(ms); } });
  const all = await api.bookmarks(0);
  assert.equal(all.length, 57);
  assert.deepEqual(waits, [1000]);
  assert.equal(calls.length, 3);
  assert.throws(() => new RaindropApi(''), /RAINDROP_TOKEN/);
});

test('CLI: apply previews by default and needs an approved manifest to write', async () => {
  const dir = tmp();
  const file = path.join(dir, 'm.json');
  const run = async (args, api) => { const lines = []; const code = await main(args, { env: {}, out: (s) => lines.push(s), apiFactory: () => api }); return { code, text: lines.join('\n') }; };
  fs.writeFileSync(file, JSON.stringify({ review: 'PENDING', moves: [{ id: 4, to: 21 }] }));
  const api = new FakeApi();
  let r = await run(['apply', file], api);
  assert.equal(r.code, 0);
  assert.match(r.text, /DRY RUN: nothing changed/);
  r = await run(['apply', file, '--yes'], api);
  assert.equal(r.code, 3);
  assert.match(r.text, /not approved/);
  assert.equal(api.writes.length, 0);
  fs.writeFileSync(file, JSON.stringify({ review: 'APPROVED', moves: [{ id: 4, to: 21 }] }));
  r = await run(['apply', file, '--yes'], api);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /Applied 1\/1/);
  assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('journal-')).length, 1);
  r = await run(['audit'], new FakeApi());
  assert.equal(r.code, 3);
  r = await run(['bogus'], api);
  assert.equal(r.code, 2);
});
