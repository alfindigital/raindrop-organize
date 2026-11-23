# raindrop-organize

An agent skill plus a zero-dependency CLI that keeps a [Raindrop.io](https://raindrop.io) bookmark library tidy.
Your AI agent (Claude Code, Codex, ...) decides where each bookmark belongs; the CLI does the safe parts:
reading, checking, writing one bookmark at a time, reading it back, and undoing.

- **audit**: Unsorted count, bookmarks sitting loose in a parent folder, tags outside your vocabulary or over the limit, the same URL saved twice (tracking params and `www` ignored, `#/routes` kept apart), empty folders. Read-only.
- **context**: every folder that can take bookmarks, **with the titles already in it**, plus your rules and the Unsorted items. Folder names alone are ambiguous; showing what already lives in each folder is what makes the agent file things the way *you* do.
- **apply**: a manifest of moves is validated against the live library and shown as a dry run. It only writes with `"review": "APPROVED"` and `--yes`, then reads every bookmark back and journals before/after.
- **rollback**: undo an apply from its journal, skipping anything that changed since.
- **deadlinks**: sorts links into alive / moved / walled / blocked / down / dead?. Cloudflare challenges, login walls, ISP blocks and 5xx outages are **not** dead. It never deletes.

It never creates, renames or deletes folders or tags, and never deletes bookmarks.

## Install

As an agent skill:

```sh
npx skills add alfindigital/raindrop-organize
```

or copy `skills/raindrop-organize/` into your agent's skills folder (Claude Code: `~/.claude/skills/`).

Then give it a token (Raindrop → Settings → Integrations → create app → *test token*):

```sh
export RAINDROP_TOKEN=...            # PowerShell: $env:RAINDROP_TOKEN="..."
```

and ask your agent: *"organize my raindrop"*, *"is my raindrop tidy?"*, *"check my bookmarks for dead links"*.

The CLI also works on its own (Node 20+):

```sh
node skills/raindrop-organize/scripts/raindrop-organize.mjs audit
node skills/raindrop-organize/scripts/raindrop-organize.mjs context > context.md
node skills/raindrop-organize/scripts/raindrop-organize.mjs apply moves.json          # dry run
node skills/raindrop-organize/scripts/raindrop-organize.mjs apply moves.json --yes    # after review
node skills/raindrop-organize/scripts/raindrop-organize.mjs rollback journal-<time>.jsonl
node skills/raindrop-organize/scripts/raindrop-organize.mjs deadlinks --limit 200
```

## Your rules

Put a `raindrop-organize.json` in the working directory or `~/.config/` (start from
[`raindrop-organize.example.json`](skills/raindrop-organize/raindrop-organize.example.json)):

| Key | Default | Meaning |
|---|---|---|
| `tags` | `null` (any) | Allowed tag vocabulary |
| `maxTags` | `3` | Max tags per bookmark (`null` = no limit) |
| `priceTags` | `free, freemium, paid` | At most one of these per bookmark |
| `rootMustBeEmpty` | `true` | A parent folder holds subfolders, not bookmarks |
| `skipCollections` | `[]` | Folder ids the tool never audits or routes into (e.g. one a script fills) |
| `rules` | `[]` | Plain-language routing rules handed to the agent by `context` |
| `blockHosts` | `[]` | Hosts of ISP / national filter block pages, so redirects there count as *blocked*, not dead |

## Manifest

```json
{
  "review": "PENDING",
  "moves": [
    { "id": 812345678, "from": -1, "to": 4567890, "addTags": ["open-source"], "reason": "agent sandbox tool" }
  ]
}
```

Optional per move: `"from"` (refuse if the bookmark moved since you looked) and `"removeTags"`.
Refused with a reason each: unknown bookmark or folder, a parent folder that has subfolders, Unsorted or Trash as target, a skipped folder, a stale `from`, a tag outside the vocabulary, a second price tag, or the same bookmark twice.

## How it was tested

Unit tests run against an in-memory library (`npm test`, CI on Linux/Windows/macOS). On a real library of
955 bookmarks in 62 folders (22 Nov 2026): `audit` found the one Unsorted item and a real duplicate
(same page saved with and without `fbclid`); its first version also flagged two Google Analytics
properties as duplicates, which is why `#/route` fragments are now kept. `apply` dry runs and refusals were
checked live; writes, read-back and rollback are covered by the tests.

A headless Claude Code agent (Sonnet) given only this skill and "organize my Raindrop, stop at the dry run" ran
`audit` and `context`, wrote a manifest, got it refused once (it had written `"from": 0` for Unsorted; the
stale-manifest check caught it), fixed it, showed the dry-run plan, and wrote nothing. 9 turns.

Extracted from the rules and lessons behind one person's daily Raindrop cleanup (including an 853-link
dead-link audit that taught what *not* to delete).

## License

MIT
