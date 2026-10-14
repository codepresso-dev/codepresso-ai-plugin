---
name: codepresso:llm-wiki
description: Maintain a personal, compounding LLM Wiki (Obsidian + git) — ingest sources, query knowledge, lint. Each teammate keeps their OWN vault. Invoke on "/codepresso:llm-wiki ...", "ingest <x> into my wiki", "what does my wiki say about <x>", "lint my wiki", or when a durable, cross-repo learning should outlive the conversation.
---

# llm-wiki

Helps the user maintain a personal **LLM Wiki**: a persistent markdown knowledge base that
an LLM curates and that compounds over time (pattern: Andrej Karpathy's "LLM Wiki",
<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>). It is the canonical
store for durable, repo-independent knowledge.

Each user keeps their **own** vault (an Obsidian vault + git repo). This skill ships no
content — it scaffolds an empty vault and then operates on it.

## When to invoke

- Manually: `/codepresso:llm-wiki <subcommand> [args]` where subcommand is
  `init` | `ingest` | `query` | `lint` | `auto-capture`.
- Automatically: when the user says things like "ingest this into my wiki", "add this to
  my wiki", "what does my wiki say about X", "lint my wiki", or when durable cross-repo
  knowledge should outlive the conversation.

## Step 0 — Resolve the vault

Resolve `<plugin-root>` from this skill's directory, then run:

```bash
node "<plugin-root>/scripts/wiki-cli.mjs" path
```

Parse the JSON:
- `enabled`, `vaultPath`, `exists`, `hasSchema`
- `autoCapture`, `autoSync`, `workHistoryPath`

Routing:
- `init`, or `hasSchema: false` → **Init**
- `auto-capture` → **OMP auto-capture**
- otherwise → **Operate**

## Init — create the user's vault

Only scaffolds; never overwrites an existing `CLAUDE.md`.

```bash
node "<plugin-root>/scripts/wiki-cli.mjs" init
# or, to choose a location:
node "<plugin-root>/scripts/wiki-cli.mjs" init "<absolute-or-~-path>"
```

This creates `CLAUDE.md` (schema), `README.md`, `index.md`, `log.md`, `sources/`,
`pages/`, a minimal `.obsidian/`, runs `git init` + an initial commit, and writes
`wiki.vaultPath` (with `enabled: true`) into `~/.codepresso/config.json`.

After init, tell the user:
- Where the vault is, and that it's a git repo + Obsidian vault.
- For multi-machine sync, they can add a private git remote (show the `git remote add` +
  `git push -u origin main` lines). Do NOT create a remote for them unless they ask.

Then continue to **Operate** if they gave an ingest/query target.

## OMP auto-capture

Enable or disable the OMP `session_stop` capture:

```bash
node "<plugin-root>/scripts/wiki-cli.mjs" auto-capture on
node "<plugin-root>/scripts/wiki-cli.mjs" auto-capture on "people/self/work-history.md"
node "<plugin-root>/scripts/wiki-cli.mjs" auto-capture off
```

`on` also enables the Wiki and persists the resolved vault path. The OMP extension captures only
completed or validated work, creates an immutable source, updates the configured work-history page
and `log.md`, then commits and pushes when `wiki.autoSync` is true. It never auto-merges diverged
branches and never adds a status-line indicator.

## Operate — ingest / query / lint

The vault's own `CLAUDE.md` is the authoritative schema. **Read it first**, then follow it:

```bash
cat "<vaultPath>/CLAUDE.md"
```

Work inside `<vaultPath>` (read/write files there), following that schema:

- **ingest `<url|path|pasted text>`** — capture the raw source into
  `sources/YYYY-MM-DD-<slug>.md` (faithful capture + canonical URL), integrate it into one
  or more `pages/`, add cross-links, update `index.md`, append a `## [YYYY-MM-DD] ingest |
  <title>` line to `log.md`.
- **query `<question>`** — search `index.md` + `pages/`, answer **with citations** to the
  pages used; if the answer is valuable and not already captured, file it back as a new page.
- **lint** — scan for contradictions, stale claims, orphan pages, missing links, gaps;
  fix trivial issues, surface judgment calls.

## Step N — Commit

After meaningful manual Wiki changes, commit only files touched by the current operation. If
`wiki.autoSync` is true and an upstream exists, fast-forward before editing and push afterwards.
Never auto-merge a diverged branch.

## Confidentiality note

This is the user's personal knowledge base. Treat its contents as private to them; never
copy vault content into shared repos, issues, or messages without explicit instruction.

## Failure handling

| Failure | Behavior |
|---------|----------|
| `wiki-cli.mjs path` shows `hasSchema: false` | Route to Init before any ingest/query. |
| `init` reports `alreadyInitialized` | Vault already exists; skip scaffolding, proceed to Operate. |
| `git commit` skipped (no git identity) | Report it; files are written and staged. Suggest setting `git config`. |
| Source URL can't be fetched in full | Store a faithful structured capture + the canonical URL; never drop the source silently. |
| User asks to push but no remote configured | Explain how to add a private remote; don't create one unprompted. |
