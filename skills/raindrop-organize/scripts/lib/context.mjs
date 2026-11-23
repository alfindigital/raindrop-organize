// Everything an agent needs to file Unsorted bookmarks well, in one printout.
// Folder names alone are ambiguous ("Tools"? "Resources"?), so each folder comes with the titles of the
// bookmarks already in it. In the original private setup this took an LLM from 21/29 to near-perfect.
import { UNSORTED, TRASH, collectionOf } from './api.mjs';
import { folderIndex } from './audit.mjs';

export function targetFolders(collections, bookmarks, config) {
  const idx = folderIndex(collections);
  const skip = new Set(config.skipCollections);
  const recent = new Map();
  for (const b of [...bookmarks].sort((x, y) => String(y.created).localeCompare(String(x.created)))) {
    const id = collectionOf(b);
    const list = recent.get(id) || [];
    if (list.length < config.examplesPerFolder) list.push(String(b.title || b.domain || '').replace(/\s+/g, ' ').slice(0, 70));
    recent.set(id, list);
  }
  return [...idx.byId.values()]
    .filter((f) => !skip.has(f.id) && !(config.rootMustBeEmpty && idx.hasChildren.has(f.id)))
    .map((f) => ({ id: f.id, path: idx.pathOf(f.id), examples: recent.get(f.id) || [] }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function unsortedItems(bookmarks) {
  return bookmarks.filter((b) => collectionOf(b) === UNSORTED).map((b) => ({
    id: b._id,
    title: b.title || '',
    domain: b.domain || '',
    link: b.link || '',
    excerpt: String(b.excerpt || '').replace(/\s+/g, ' ').slice(0, 240),
    note: String(b.note || '').slice(0, 200),
    tags: b.tags || [],
  }));
}

export function buildContext({ collections, bookmarks, config }) {
  return {
    rules: config.rules,
    tags: config.tags,
    priceTags: config.priceTags,
    maxTags: config.maxTags,
    folders: targetFolders(collections, bookmarks, config),
    unsorted: unsortedItems(bookmarks),
  };
}

export function formatContext(ctx) {
  const out = ['# Raindrop triage context', ''];
  out.push('## Rules', '- Pick the folder by what the page is FOR, not by a buzzword in its title.');
  for (const r of ctx.rules) out.push(`- ${r}`);
  if (ctx.tags) out.push(`- Tags only from: ${ctx.tags.join(', ')}.`);
  if (ctx.maxTags) out.push(`- At most ${ctx.maxTags} tags per bookmark; at most one of ${ctx.priceTags.join('/')}.`);
  out.push('- No tag is better than a guessed tag. Unsure between two folders: read the page, or leave the bookmark out and ask.');
  out.push('', '## Folders (id | path | recent titles already in it, quoted)');
  for (const f of ctx.folders) out.push(`${f.id} | ${f.path}${f.examples.length ? ` | ${f.examples.map((e) => JSON.stringify(e)).join(', ')}` : ''}`);
  out.push('', `## Unsorted (${ctx.unsorted.length})`);
  for (const u of ctx.unsorted) out.push(JSON.stringify(u));
  out.push('', '## Manifest to write (then: apply --dry-run, show the human, set "review": "APPROVED", apply)');
  out.push('("from": -1 means "still in Unsorted"; the move is refused if the bookmark was moved meanwhile.)');
  out.push(JSON.stringify({ review: 'PENDING', moves: ctx.unsorted.slice(0, 1).map((u) => ({ id: u.id, from: -1, to: '<folder id>', addTags: [], reason: '<short why>' })) }, null, 2));
  return out.join('\n');
}

export { TRASH };
