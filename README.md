# code-prism-cli

| Command | Role |
|---------|------|
| **`prism`** | Backends → system cache |
| **`prism-mcp`** | MCP over that cache |

## Setup (one line)

```bash
curl -fsSL https://raw.githubusercontent.com/jokerphuongnam/code-prism-cli/main/install.sh | bash
```

Installs `prism` + `prism-mcp` into `~/bin`, builds [mcp-prism](https://github.com/jokerphuongnam/mcp-prism), and clones language backends under `~/Documents/Code/code-prism/backends/`.

Requires **Node.js ≥ 20**, `git`, and `npm`.

## Quick start

```bash
prism plugins
prism analyze --root /path/to/project
prism-mcp .                 # MCP for current folder
```

## `prism`

```bash
prism plugins
prism detect   --root /path/to/project
prism projects --root /path/to/project
prism analyze  --root /path/to/project
prism swift   --root /path/to/project
```

## `prism-mcp`

```bash
prism-mcp .                 # current folder
prism-mcp game              # short name from cache (e.g. game-<hash>)
prism-mcp ~/path/to/project
prism-mcp which
```

`prism analyze` stamps every symbol onto that same tree: the node parent is the crate, Swift package, or Xcode target that owns the file, and a call stays inside that archipelago.

`prism ui --root <folder>` opens that graph: each top-level project is an island, links inside an island are blue, links that leave the island are orange.

`prism projects` prints a `nodes` graph. `parents` is the larger project that contains this one (a folder with several projects becomes a `group`). `calls` is a project invoking another: Cargo path / workspace dependency, local Swift package, a remote URL whose name matches a project in the same tree, or an FFI library name shared by Swift and Cargo.

`--lang` optional (omit = all languages for that project).

### MCP client config

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
| `CODE_PRISM_HOME` | Install root (default `~/Documents/Code`) |
| `CODE_PRISM_BIN` | Where to link CLIs (default `~/bin`) |
