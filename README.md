# code-prism-cli

| Command | Role |
|---------|------|
| **`prism`** | Backends → system cache |
| **`prism-mcp`** | MCP over that cache |

```bash
cd ~/Documents/Code/code-prism-cli && npm link
# or: export PATH="$HOME/bin:$PATH"
```

## `prism`

```bash
prism plugins
prism detect  --root /path/to/project
prism analyze --root /path/to/project
prism swift   --root /path/to/project
```

## `prism-mcp` (simple)

```bash
prism-mcp .                 # current folder
prism-mcp game              # short name from cache (e.g. game-<hash>)
prism-mcp ~/path/to/project
prism-mcp which
```

`--lang` optional (omit = all languages for that project).

### MCP client config (short)

After you’ve analyzed once (`prism analyze --root …`):

```json
{
  "mcpServers": {
    "code-prism": {
      "command": "prism-mcp",
      "args": ["game"]
    }
  }
}
```

Or for “whatever folder I’m in”:

```json
{
  "mcpServers": {
    "code-prism": {
      "command": "prism-mcp",
      "args": ["."]
    }
  }
}
```

(If the host doesn’t set cwd to the workspace, use the short cache name or an absolute path.)

## Env

| Variable | Meaning |
|----------|---------|
| `PRISM_CWD` | Project pointer (set automatically by `prism-mcp`) |
| `CODE_PRISM_LANG` | Optional language filter |
| `CODE_PRISM_BACKEND_<ID>` | Override backend binary |
| `CODE_PRISM_MCP_SERVER` | Override mcp-prism `dist/server.js` |
