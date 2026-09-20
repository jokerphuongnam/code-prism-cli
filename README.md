# code-prism-cli

Unified CLIs for Code Prism:

| Command | Role |
|---------|------|
| **`prism`** | Talk to language **backends** (analyze → system cache) |
| **`prism-mcp`** | Run **mcp-prism** pointed at a user project |

## Install (PATH)

```bash
cd ~/Documents/Code/code-prism-cli
npm link
# or:
# sudo ln -sf "$PWD/bin/prism" /usr/local/bin/prism
# sudo ln -sf "$PWD/bin/prism-mcp" /usr/local/bin/prism-mcp
```

## `prism` (backends)

```bash
prism plugins
prism detect  --root /path/to/project
prism cache   --root /path/to/project
prism analyze --root /path/to/project              # all detected langs
prism analyze --root /path/to/project --lang swift # one lang
prism swift   --root /path/to/project
prism js      --root /path/to/project
```

Writes SoT under:

```text
~/Library/Caches/code-prism/<projectName>-<hash>/{lang}-prism/
```

## `prism-mcp` (MCP)

```bash
prism-mcp --cwd /path/to/project
prism-mcp serve --cwd . --lang swift
prism-mcp which
```

Sets `PRISM_CWD` (and optional `CODE_PRISM_LANG`) and runs `mcp-prism` over the cache.

## Env

| Variable | Meaning |
|----------|---------|
| `CODE_PRISM_BACKEND_<ID>` | Override binary for a plugin |
| `CODE_PRISM_MCP_SERVER` | Override path to mcp-prism `dist/server.js` |
| `PRISM_CWD` | Project pointer for MCP |
| `CODE_PRISM_LANG` | Optional language filter for MCP |
