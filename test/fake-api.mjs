// In-memory stand-in for RaindropApi, shaped like the real REST responses.
export function library() {
  return {
    roots: [
      { _id: 10, title: 'Dev', count: 1 },
      { _id: 20, title: 'Design', count: 0 },
      { _id: 30, title: 'Inbox (auto)', count: 1 },
    ],
    children: [
      { _id: 11, title: 'Tools', parent: { $id: 10 }, count: 2 },
      { _id: 12, title: 'Guides', parent: { $id: 10 }, count: 1 },
      { _id: 21, title: 'Icons', parent: { $id: 20 }, count: 0 },
    ],
    bookmarks: [
      { _id: 1, title: 'ripgrep', link: 'https://github.com/BurntSushi/ripgrep', collection: { $id: 11 }, tags: ['open-source'], created: '2026-01-03' },
      { _id: 2, title: 'jq manual', link: 'https://jqlang.org/manual/', collection: { $id: 12 }, tags: ['reference'], created: '2026-01-02' },
      { _id: 3, title: 'fd', link: 'https://www.github.com/sharkdp/fd/?utm_source=x', collection: { $id: 11 }, tags: [], created: '2026-01-04' },
      { _id: 4, title: 'Phosphor icons', link: 'https://phosphoricons.com', collection: { $id: -1 }, tags: [], created: '2026-01-05' },
      { _id: 5, title: 'loose in root', link: 'https://example.com/root', collection: { $id: 10 }, tags: ['free', 'paid', 'x', 'y'], created: '2026-01-01' },
      { _id: 6, title: 'fd again', link: 'http://github.com/sharkdp/fd#install', collection: { $id: 11 }, tags: [], created: '2026-01-06' },
      { _id: 7, title: 'auto inbox item', link: 'https://social.example/post/1', collection: { $id: 30 }, tags: [], created: '2026-01-07' },
    ],
  };
}

export class FakeApi {
  constructor(lib = library(), { breakWrites = false } = {}) {
    this.lib = lib;
    this.breakWrites = breakWrites;
    this.writes = [];
  }
  async collections() { return { roots: this.lib.roots, children: this.lib.children }; }
  async bookmarks(collectionId = 0) {
    return structuredClone(this.lib.bookmarks.filter((b) => collectionId === 0 || b.collection.$id === collectionId));
  }
  async bookmark(id) {
    const b = this.lib.bookmarks.find((x) => x._id === id);
    if (!b) throw new Error('HTTP 404');
    return structuredClone(b);
  }
  async update(id, fields) {
    this.writes.push({ id, fields });
    const b = this.lib.bookmarks.find((x) => x._id === id);
    if (this.breakWrites) return structuredClone(b);
    if (fields.collection) b.collection = { $id: fields.collection.$id };
    if (fields.tags) b.tags = [...fields.tags];
    return structuredClone(b);
  }
}
