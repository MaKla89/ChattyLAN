# Changelog

All notable changes to ChattyLAN are documented here.
Versions follow the git tags (`v1.0` …); the newest entry may still be unreleased.

## Unreleased — v1.5 (Notebooks)

New: **Notebooks** — group related chats and give them shared context.

- Create notebooks in the sidebar; chats nest under them and can be moved in, out, or
  between notebooks with the folder icon. Chats without a notebook behave exactly as before
- Each notebook can generate a **summary** (one model call, on demand): a short digest of
  all its chats, automatically injected as context into every message inside that notebook —
  so a question in one chat can build on the others
- The summary **streams into the notebook overview** while it is written; the timeout is
  idle-based (180 s for the first token, then 60 s of silence) instead of a fixed
  wall-clock limit, so slow local models and cold loads no longer abort a working run
- **Summary detail** per notebook: Brief / Standard / Detailed / Very detailed
  (250 / 500 / 1000 / 2000 words) — word budget, source material per chat and storage cap
  scale together
- Summaries are manual snapshots: a badge marks a notebook when chats changed since the
  last update, and each chat shows whether it is covered — nothing refreshes on its own
- The context usage bar counts the notebook summary's tokens (it is a fixed overhead per
  request, not growing with the chat)
- Mode 2: notebooks sync across devices like chats (encrypted at rest when `DATA_KEY` is
  set); no migration needed — existing data is untouched
