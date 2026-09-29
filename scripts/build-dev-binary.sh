#!/usr/bin/env bash
set -e

echo "=========================================="
echo "  TriliumDEV Binary Builder"
echo "=========================================="

echo "[1/4] Installing dependencies..."
pnpm install

echo "[2/4] Running typecheck and plugin unit tests..."
pnpm typecheck
pnpm --filter client test plugins

echo "[3/4] Building client & desktop application..."
pnpm --filter desktop build

# With only the Command Line Tools installed (or Xcode's license not accepted) `actool` fails and
# the packager's postPackage hook crashes compiling icon.icon. Hide the .icon bundles for the run so
# it falls back to icon.icns, then always put them back.
ICON_DIR="apps/desktop/electron-forge/app-icon"
if ! actool --version >/dev/null 2>&1; then
    echo "    actool unavailable; packaging with icon.icns instead of icon.icon"
    for icon in icon icon-dev; do
        [ -d "$ICON_DIR/$icon.icon" ] && mv "$ICON_DIR/$icon.icon" "$ICON_DIR/$icon.icon.tmp"
    done
    trap 'for icon in icon icon-dev; do [ -d "$ICON_DIR/$icon.icon.tmp" ] && mv "$ICON_DIR/$icon.icon.tmp" "$ICON_DIR/$icon.icon"; done' EXIT
fi

echo "[4/4] Packaging desktop binary executable..."
pnpm --filter desktop electron-forge:package

echo ""
echo "=========================================="
echo "  SUCCESS: Dev binary built successfully!"
echo "  Location: apps/desktop/dist/out/"
echo "=========================================="
