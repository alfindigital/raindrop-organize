---
name: raindrop-organize
description: >-
  Keep a Raindrop.io bookmark library tidy: audit it, file Unsorted bookmarks into the right folder with
  the right tags, undo a bad batch, and find dead links without deleting live ones. Use when the user says
  "organize my raindrop", "sort my bookmarks", "empty unsorted", "is my raindrop tidy?", "check dead links".
  Never creates, renames or deletes folders or tags, and never deletes bookmarks.
---
# Raindrop Organize

You (the agent) decide where each bookmark goes; the bundled CLI does the reading, the checking, the writing,
the read-back and the undo. Nothing is written until the human has seen a dry run and approved it.

CLI: `node <this skill's folder>/scripts/raindrop-organize.mjs <command>` (Node 20+, no install).
It needs `RAINDROP_TOKEN` in the environment: a test token from https://app.raindrop.io/settings/integrations.
Never print, log or ask the user to paste the token into the chat; if it is missing, tell them to set it.

Rules come from `raindrop-organize.json` (current folder, `~/.config/`, or `--config`). See
`raindrop-organize.example.json` next to this file. Without one, any tag is allowed, max 3 tags, at most one
of free/freemium/paid.

## Commands

| Command | Writes? | Use it to |
|---|---|---|
| `audit` | no | Health check: Unsorted, bookmarks sitting in a root folder that has subfolders, tags off the vocabulary or over the limit, the same URL saved twice, empty folders. Exit 0 = clean, 3 = issues |
| `context` | no | Print the rules, every folder that can receive bookmarks **with the titles already in it**, and the Unsorted bookmarks. This is your input for triage |
| `apply <manifest.json>` | no | Dry run: validates the manifest against the live library and prints the plan |
| `apply <manifest.json> --yes` | yes | Only with `"review": "APPROVED"`. Moves/tags one bookmark at a time, reads each back, journals before/after |
| `rollback <journal.jsonl>` | yes | Undo an apply, newest first; skips any bookmark that changed since |
| `deadlinks [--folder id] [--limit n]` | no | Classify links: alive / moved / walled / blocked / down / dead?. Never deletes |

Add `--json` for machine-readable output.

## Triage Unsorted

1. `audit`. If Unsorted is 0, say so and stop.
2. `context`. Read it fully: the example titles show how this library is actually organized; follow them
   over what a folder's name suggests.
3. For each Unsorted bookmark choose one folder id, and tags only when the evidence is clear
   (no tag beats a guessed tag). Pick the folder by what the page is *for*, not by a buzzword in the title:
   an AI video editor goes with video tools, not with AI. Unsure between two folders: open the page; still
   unsure: leave it out of the manifest and ask the human, naming both options.
4. Write the manifest:
   ```json
   { "review": "PENDING",
     "moves": [ { "id": 123, "to": 456, "addTags": ["free"], "reason": "short why" } ] }
   ```
   Optional per move: `"from": <collection id>` (refuse if it moved meanwhile), `"removeTags": [...]`.
5. `apply manifest.json` (dry run). Fix every refusal it reports. Show the plan to the human as a table:
   bookmark, from, to, tags.
6. Only after the human agrees: set `"review": "APPROVED"`, run `apply manifest.json --yes`.
7. Report: how many moved where, the journal path, and that `audit` is clean (run it again).

## Dead links

`deadlinks` errs on the side of "alive". Bot challenges, login walls (401/403/429/999), region or ISP
blocks, renamed sites and 5xx outages are not dead. Only `dead?` (404/410, DNS failure, parked domain) is
a candidate, and even then: confirm from a second network or a day later, and get the human's explicit
OK per bookmark before deleting anything. Deleting is not part of this skill.

## Never

- Create, rename or delete folders or tags. Suggest them to the human instead.
- Delete bookmarks, or move them to Trash. (In Raindrop, deleting something already in Trash is permanent.)
- Change a bookmark's URL, title, note or highlights while triaging.
- Treat two pages on the same domain as duplicates just because the domain matches; `audit` already
  normalizes URLs (tracking parameters, `www`, trailing slash) and keeps `#/route` fragments apart.
- Run `apply --yes` on a manifest the human has not seen as a dry run.
