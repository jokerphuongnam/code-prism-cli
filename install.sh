#!/usr/bin/env bash
# Code Prism — one-line setup
#   curl -fsSL https://raw.githubusercontent.com/jokerphuongnam/code-prism-cli/main/install.sh | bash
set -euo pipefail

PREFIX="${CODE_PRISM_HOME:-$HOME/Documents/Code}"
BIN_DIR="${CODE_PRISM_BIN:-$HOME/bin}"
GH="${CODE_PRISM_GITHUB:-https://github.com/jokerphuongnam}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: need '$1' on PATH" >&2
    exit 1
  }
}

need git
need node
need npm

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "error: Node.js >= 20 required (found $(node -v))" >&2
  exit 1
fi

clone_or_pull() {
  local url="$1" dest="$2"
  if [[ -d "$dest/.git" ]]; then
    echo "↻  $(basename "$dest")"
    git -C "$dest" pull --ff-only --quiet || git -C "$dest" fetch --quiet || true
    return 0
  fi
  echo "↓  $(basename "$dest")"
  mkdir -p "$(dirname "$dest")"
  if ! git clone --depth 1 "$url" "$dest"; then
    rm -rf "$dest"
    return 1
  fi
  return 0
}

echo "==> Code Prism install"
echo "    home: $PREFIX"
echo "    bin:  $BIN_DIR"
echo

# CLI
clone_or_pull "$GH/code-prism-cli.git" "$PREFIX/code-prism-cli"
chmod +x "$PREFIX/code-prism-cli/bin/prism" "$PREFIX/code-prism-cli/bin/prism-mcp"
mkdir -p "$BIN_DIR"
ln -sfn "$PREFIX/code-prism-cli/bin/prism" "$BIN_DIR/prism"
ln -sfn "$PREFIX/code-prism-cli/bin/prism-mcp" "$BIN_DIR/prism-mcp"

# MCP server (prism-mcp launches this)
clone_or_pull "$GH/mcp-prism.git" "$PREFIX/mcp-prism"
echo "⚙  mcp-prism (npm install + build)"
(
  cd "$PREFIX/mcp-prism"
  npm install --silent
  npm run build --silent
)

# Language backends + core — single monorepo (no more per-lang remotes)
clone_or_pull "$GH/code-prism.git" "$PREFIX/code-prism"
if [[ -d "$PREFIX/code-prism/backends" ]]; then
  find "$PREFIX/code-prism/backends" -type f -path '*/bin/*' -exec chmod +x {} \; 2>/dev/null || true
fi
# Optional: keep a private swift analyzer build if the user already has one
if [[ -x "$HOME/Library/Application Support/CodePrism/backends/swift/swift-prism-analyzer" ]]; then
  echo "✓  swift analyzer (App Support)"
elif [[ -x "$PREFIX/code-prism/backends/swift/bin/swift-prism-analyzer" ]]; then
  echo "✓  swift shim (monorepo)"
else
  echo "⚠  swift analyzer binary not built yet — see code-prism/backends/swift/README.md"
fi

# Ensure ~/bin is on PATH for this shell and common rc files
path_line='export PATH="$HOME/bin:$PATH"'
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) export PATH="$BIN_DIR:$PATH" ;;
esac

add_path_once() {
  local rc="$1"
  [[ -f "$rc" ]] || return 0
  if grep -qF 'HOME/bin:$PATH' "$rc" 2>/dev/null || grep -qF "$BIN_DIR" "$rc" 2>/dev/null; then
    return 0
  fi
  printf '\n# code-prism\n%s\n' "$path_line" >>"$rc"
  echo "✎  appended PATH to $rc"
}

add_path_once "$HOME/.zshrc"
add_path_once "$HOME/.bashrc"

echo
echo "==> OK"
echo "    prism      → $(command -v prism)"
echo "    prism-mcp  → $(command -v prism-mcp)"
echo
echo "Next:"
echo "  prism plugins"
echo "  prism analyze --root /path/to/project"
echo "  prism-mcp .                 # MCP for current folder"
echo
echo "MCP client snippet:"
cat <<'JSON'
  { "mcpServers": { "code-prism": { "command": "prism-mcp", "args": ["."] } } }
JSON
echo
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Open a new terminal (or: export PATH=\"$BIN_DIR:\$PATH\") so prism is on PATH."
fi
