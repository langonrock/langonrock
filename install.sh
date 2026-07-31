#!/bin/sh
# Installs the langonrock binary for the current platform.
#
#   curl -fsSL https://raw.githubusercontent.com/langonrock/langonrock/main/install.sh | sh
#
# Environment:
#   LANGONROCK_VERSION  tag to install (default: the latest release)
#   LANGONROCK_BIN      install directory (default: ~/.local/bin)
set -eu

REPO="langonrock/langonrock"
BIN_DIR="${LANGONROCK_BIN:-$HOME/.local/bin}"

fail() {
  echo "install: $1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed"
}

need curl

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported OS $(uname -s). On Windows download the .exe from the releases page." ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac

asset="langonrock-${os}-${arch}"

if [ -n "${LANGONROCK_VERSION:-}" ]; then
  tag="$LANGONROCK_VERSION"
else
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null |
    sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  [ -n "$tag" ] || fail "could not resolve the latest release. If ${REPO} is private, set LANGONROCK_VERSION and make sure gh is authenticated, or download from the releases page."
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A private repository cannot be fetched anonymously, so prefer an authenticated
# gh when one is available and fall back to the plain download URL otherwise.
fetch() {
  name="$1"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh release download "$tag" --repo "$REPO" --pattern "$name" \
      --output "$tmp/$name" --clobber
  else
    curl -fsSL -o "$tmp/$name" \
      "https://github.com/${REPO}/releases/download/${tag}/${name}"
  fi
}

fetch "$asset" || fail "could not download ${asset} for ${tag}. If ${REPO} is private, install gh and run 'gh auth login' first."
fetch SHA256SUMS || fail "could not download SHA256SUMS for ${tag}"

if command -v sha256sum >/dev/null 2>&1; then
  sum="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
else
  need shasum
  sum="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
fi

expected="$(grep " ${asset}\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
[ -n "$expected" ] || fail "SHA256SUMS has no entry for ${asset}"
[ "$sum" = "$expected" ] || fail "checksum mismatch for ${asset}: got ${sum}, expected ${expected}"

mkdir -p "$BIN_DIR"
install -m 755 "$tmp/$asset" "$BIN_DIR/langonrock"

echo "installed langonrock ${tag} to ${BIN_DIR}/langonrock"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: ${BIN_DIR} is not on your PATH" >&2 ;;
esac
