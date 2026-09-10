# ChattyLAN

> ⚠️ **Vibe-coded project** — this code was written by an AI assistant without
> formal review or testing. It works for its intended purpose, but use it with
> adequate care: don't paste sensitive data into it, and review the code before
> trusting it with anything important.

A minimal, single-file web UI for chatting with a local LLM server on your LAN.
No backend, no build step, no dependencies — just one `index.html`.

Works with any **OpenAI-compatible** server: LM Studio, Unsloth Studio, llama.cpp `llama-server` (and friends like Ollama).

![ChattyLAN demo](Demo.png)

## Features

- Enter the server URL (e.g. `http://192.168.1.50:1234/v1`) and go — model list is fetched from `/v1/models`
- Token streaming (SSE) with a Stop button
- **Reasoning** shown in a collapsible block (reads `reasoning_content`, fallback `reasoning`)
- **Persistent history**: multiple conversations saved in your browser's `localStorage` (new / switch / rename / delete — hover a chat for the icons)
- **Save / load to file**: hover a chat in the sidebar — ⬇ downloads it as JSON (incl. reasoning, re-importable via ⬆ Import), `MD` exports it as Markdown (reasoning is omitted)
- **Regenerate / branch**: hover the last answer for ↻ regenerate (replaces it); hover one of your messages for ⑂ to branch off into a new chat with the history up to that point (ending at the previous complete answer — your message is not carried over)
- **Context usage bar**: shows estimated token usage of the current chat vs. the model's context length (read from `/v1/models`), turns yellow at 70% and red at 90%, with a warning near/over the limit
- Optional API key and system prompt, both persisted
- Minimal offline markdown rendering (code blocks, inline code, bold/italic, links)

## Run it

Any static file server works:

```sh
cd ChattyLAN
python3 -m http.server 8000
# → open http://localhost:8000
```

You can also just double-click `index.html` and open it directly — the servers allow
cross-origin requests by default, so `file://` works too.

## Server notes

| Server | URL to enter | Notes |
|---|---|---|
| LM Studio | `http://<ip>:1234/v1` | Start the local server in LM Studio; CORS is open by default |
| llama.cpp | `http://<ip>:8080/v1` | Bind to LAN: `llama-server -m model.gguf --host 0.0.0.0`. Reasoning: default `--reasoning-format auto` usually populates `reasoning_content`; force it with `--reasoning-format deepseek`. Optional auth: `--api-key KEY` (enter the key in the UI) |
| Unsloth Studio | `http://<ip>:<port>/v1` | Enable its built-in server; same OpenAI-compatible API |

If a server ever blocks cross-origin requests, set it to allow your browser's origin
(e.g. llama.cpp: `--cors-origins http://localhost:8000`) or serve this UI from the
same machine.

## Data & privacy

Everything (settings + chat history) lives in your browser's `localStorage` under
the keys `chatty.settings`, `chatty.chats`, `chatty.active`. Nothing leaves your LAN
except the chat requests themselves. Clearing site data wipes the history.

Note: `localStorage` is per browser *and* per origin (`file://` vs `http://localhost:8000`
are different stores), and has a ~5–10 MB quota. If it fills up, the app shows a warning
bar — export chats to file (⬇ / MD) or delete old ones. File export/import has no size
limit, so that's also the way to keep very large conversations: export → free space in
the browser → re-import later via ⬆ Import.
