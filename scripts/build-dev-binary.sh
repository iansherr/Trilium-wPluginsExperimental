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

echo "[4/4] Packaging desktop binary executable..."
pnpm --filter desktop electron-forge:package

echo ""
echo "=========================================="
echo "  SUCCESS: Dev binary built successfully!"
echo "  Location: apps/desktop/out/"
echo "=========================================="
