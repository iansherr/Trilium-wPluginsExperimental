#!/usr/bin/env bash
set -e

MODE="${1:-menu}"

function show_menu() {
    echo "=================================================="
    echo "  TriliumDEV Ecosystem Management Tool"
    echo "=================================================="
    echo "  1) dev      - Launch Hot-Reload Watch Mode (Vite HMR)"
    echo "  2) prod     - Run Local Production Build"
    echo "  3) build    - Package Standalone Desktop Executable Binary"
    echo "  4) release  - Create & Push -dev.X Release Tag to GitHub"
    echo "  5) test     - Run Typecheck and Plugin Vitest Suites"
    echo "  6) exit     - Quit"
    echo "=================================================="
    read -p "Select an option [1-6]: " choice
    case "$choice" in
        1) MODE="dev" ;;
        2) MODE="prod" ;;
        3) MODE="build" ;;
        4) MODE="release" ;;
        5) MODE="test" ;;
        6) exit 0 ;;
        *) echo "Invalid choice"; exit 1 ;;
    esac
}

if [ "$MODE" = "menu" ]; then
    show_menu
fi

case "$MODE" in
    dev|1)
        echo "--> Launching TriliumDEV in Hot-Reload Watch Mode (Vite HMR)..."
        pnpm desktop:start
        ;;
    prod|2)
        echo "--> Running TriliumDEV Local Production Build..."
        pnpm desktop:start-prod
        ;;
    build|3)
        echo "--> Packaging TriliumDEV Standalone Desktop Binary Executable..."
        echo "[1/4] Installing dependencies..."
        pnpm install
        echo "[2/4] Running typecheck and plugin unit tests..."
        pnpm typecheck
        pnpm --filter client exec vitest run plugins
        echo "[3/4] Building client & desktop application..."
        pnpm --filter desktop build
        echo "[4/4] Packaging desktop binary executable..."
        pnpm --filter desktop electron-forge:package
        echo ""
        echo "=================================================="
        echo "  SUCCESS: Dev binary packaged in apps/desktop/out/"
        echo "=================================================="
        ;;
    release|4)
        TAG_NAME="$2"
        if [ -z "$TAG_NAME" ]; then
            read -p "Enter dev release tag name (e.g. v0.104.1-dev.1): " TAG_NAME
        fi
        if [ -z "$TAG_NAME" ]; then
            echo "Error: Tag name cannot be empty."
            exit 1
        fi
        echo "--> Creating and pushing release tag: $TAG_NAME"
        git tag "$TAG_NAME"
        git push origin "$TAG_NAME"
        echo "=================================================="
        echo "  SUCCESS: Pushed $TAG_NAME to GitHub!"
        echo "  GitHub Actions will build & attach desktop binaries."
        echo "=================================================="
        ;;
    test|5)
        echo "--> Running TriliumDEV Verification Suites..."
        pnpm typecheck
        pnpm --filter client exec vitest run plugins
        node --test tests/packages/package-manifest.test.mjs tests/packages/community-packages-contract.test.mjs tests/packages/package-update-e2e.test.mjs
        ;;
    *)
        echo "Usage: ./scripts/trilium-dev.sh [dev|prod|build|release|test]"
        exit 1
        ;;
esac
