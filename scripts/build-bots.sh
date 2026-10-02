#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FORKS_DIR="${PROJECT_DIR}/forks"
EMSDK_DIR="${PROJECT_DIR}/emsdk"
BOTS_OUTPUT_DIR="${PROJECT_DIR}/public/bots"
MANIFEST_FILE="${BOTS_OUTPUT_DIR}/manifest.json"
USERS_FILE="${PROJECT_DIR}/users.json"
WASM_DIR="${PROJECT_DIR}/wasm"

# ---------- Colors ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}>>>${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}>>> WARNING:${NC} $*" >&2; }
err()   { echo -e "${RED}>>> ERROR:${NC} $*" >&2; }

# ---------- 1. Ensure Emscripten is available ----------
ensure_emscripten() {
    if command -v emcc &>/dev/null; then
        log "Emscripten already available: $(emcc --version | head -1)"
        return
    fi

    log "Emscripten not found, bootstrapping emsdk..."
    if [ ! -d "$EMSDK_DIR" ]; then
        git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
    fi

    "$EMSDK_DIR/emsdk" install latest
    "$EMSDK_DIR/emsdk" activate latest
    source "$EMSDK_DIR/emsdk_env.sh"

    log "Emscripten ready: $(emcc --version | head -1)"
}

# ---------- 2. Bridge legacy forks (examples/catchthecat + core/ layout) ----------
# Old forks predate apps/ + core/sources/. Detect and adapt inside the fork copy:
#   examples/catchthecat/* -> apps/catchthecat/* (patched: engine/imgui/SDL stripped)
#   core/sources -> symlink to core/  (resolves Random.h, math/Point2D.h etc.)
#   Point2D.cpp appended to build (defines Point2D statics/operators)
bridge_legacy_fork() {
    local fork_dir="$1"

    mkdir -p "${fork_dir}/apps"
    cp -R "${fork_dir}/examples/catchthecat" "${fork_dir}/apps/catchthecat"
    ln -sfn . "${fork_dir}/core/sources"

    local wh="${fork_dir}/apps/catchthecat/World.h"
    local wc="${fork_dir}/apps/catchthecat/World.cpp"

    # World.h: drop GameObject base + engine/SDL includes + GUI overrides; alias CatWorld
    sed -i '' \
        -e '/#include "scene\/GameObject.h"/d' \
        -e '/^#include "SDL[^"]*\.h"/d' \
        -e 's/^class World : GameObject {/class World {/' \
        -e '/void OnDraw(SDL_Renderer\* renderer) override;/d' \
        -e '/void OnGui(ImGuiContext\* context) override;/d' \
        -e '/void Update(float deltaTime) override;/d' \
        -e 's/World(Engine\* pEngine, int size = 11)/World(int size = 11)/' \
        -e 's/World(Engine\* pEngine, int mapSideSize/World(int mapSideSize/' \
        "$wh"
    printf '\n// wasm-arena bridge alias (upstream renamed World -> CatWorld)\nusing CatWorld = World;\n' >> "$wh"

    # Old forks whose step() predates the public lastMove/moveDuration contract:
    # expose both publicly and record the move in step() (mirrors upstream forks).
    if ! grep -q "lastMove" "$wh"; then
        perl -0777 -pi -e 's/^  int64_t moveDuration = 0;\n//m; s/^public:\n/public:\n  Point2D lastMove = Point2D(0, 0);\n  int64_t moveDuration = 0;\n/m' "$wh"
        perl -pi -e 's/^(\s*auto move = (?:cat|catcher)->Move\(this\);)$/$1\n    lastMove = move;/' "$wc"
    fi

    # World.cpp: drop engine/SDL includes, Engine ctor params, GUI function bodies
    sed -i '' \
        -e '/#include "Polygon.h"/d' \
        -e '/#include "scene\/Transform.h"/d' \
        -e '/#include "engine\/Engine.h"/d' \
        -e '/^#include "SDL[^"]*\.h"/d' \
        -e 's/World::World(Engine\* pEngine, int size) : GameObject(pEngine), /World::World(int size) : /' \
        -e 's/World::World(Engine\* pEngine, int mapSideSize, bool isCatTurn, Point2D catPos, std::vector<bool> map)/World::World(int mapSideSize, bool isCatTurn, Point2D catPos, std::vector<bool> map)/' \
        -e 's/    : GameObject(pEngine), sideSize(mapSideSize)/    : sideSize(mapSideSize)/' \
        "$wc"
    # Strip member GUI bodies (OnDraw/OnGui/Update) and any free helper fn whose
    # signature mentions SDL_* (e.g. FillHexagon) — bodies end at first column-0 }
    perl -0777 -pi -e '
        s/void World::OnDraw\(SDL_Renderer\* renderer\) \{.*?\n\}\n//s;
        s/void World::OnGui\(ImGuiContext\* context\) \{.*?\n\}\n//s;
        s/void World::Update\(float deltaTime\) \{.*?\n\}\n//s;
        s/^(?:static\s+)?\w[^;\n{}]*\([^;\n{}]*SDL_[^;\n{}]*\)\s*\n\{.*?\n\}\n//gms;
    ' "$wc"

    # Some forks use std::unordered_set without including it (leaked via engine
    # headers on desktop); add the missing include next to the first one.
    for f in "$wh" "$wc"; do
        if grep -q "std::unordered_set" "$f" && ! grep -q "#include <unordered_set>" "$f"; then
            perl -pi -e 'if (!$done && /^#include/) { print "#include <unordered_set>\n"; $done = 1 }' "$f"
        fi
    done

    # CMake: append legacy core sources (Point2D statics/operators, Random if present)
    {
        echo ""
        echo "# legacy-fork bridge sources (appended by build-bots.sh)"
        echo "file(GLOB CAT_LEGACY_SRC"
        echo "    \${CMAKE_CURRENT_SOURCE_DIR}/core/math/Point2D.cpp"
        echo "    \${CMAKE_CURRENT_SOURCE_DIR}/core/Random.cpp)"
        echo "list(FILTER CAT_LEGACY_SRC EXCLUDE REGEX \"NOTHING\")"
        echo "target_sources(\${CAT_BOT_NAME} PRIVATE \${CAT_LEGACY_SRC})"
    } >> "${fork_dir}/CMakeLists.txt"

    log "  Bridged legacy layout (examples/ -> apps/, core/sources symlink, headless World patch)"
}

# ---------- 3. Compile a single fork ----------
compile_fork() {
    local username="$1"
    local clone_url="$2"
    local fork_dir="${FORKS_DIR}/${username}"
    local build_dir="${fork_dir}/build-wasm"

    log "Compiling bot for '${username}'..."

    # Clone or update
    if [ -d "${fork_dir}/.git" ]; then
        log "  Updating existing clone..."
        git -C "$fork_dir" fetch --depth=1 origin 2>/dev/null || true
        git -C "$fork_dir" reset --hard origin/HEAD 2>/dev/null || \
            git -C "$fork_dir" reset --hard origin/master 2>/dev/null || \
            git -C "$fork_dir" reset --hard origin/main 2>/dev/null || true
    else
        log "  Cloning ${clone_url}..."
        git clone --depth=1 "$clone_url" "$fork_dir" 2>/dev/null || {
            err "  Failed to clone ${clone_url}"
            return 1
        }
    fi

    # Validate: examples/catchthecat (legacy) or apps/catchthecat (current); legacy wins if both
    local is_legacy=0
    if [ -f "${fork_dir}/examples/catchthecat/World.h" ]; then
        is_legacy=1
    elif [ -f "${fork_dir}/apps/catchthecat/World.h" ]; then
        is_legacy=0
    else
        warn "  No apps/catchthecat/World.h or examples/catchthecat/World.h found, skipping"
        return 1
    fi

    # Overlay wasm entry point, CMakeLists, and CPM bootstrap
    cp "${WASM_DIR}/wasm_main.cpp" "${fork_dir}/wasm_main.cpp"
    cp "${WASM_DIR}/CMakeLists.overlay.txt" "${fork_dir}/CMakeLists.txt"
    mkdir -p "${fork_dir}/cmake"
    if grep -q "CPM_HASH_SUM_PLACEHOLDER" "${WASM_DIR}/get_cpm.cmake"; then
        warn "  wasm/get_cpm.cmake is a placeholder, fetching CPM.cmake directly"
        curl -fsSL "https://github.com/cpm-cmake/CPM.cmake/releases/download/v0.40.2/CPM.cmake" -o "${fork_dir}/cmake/get_cpm.cmake"
    else
        cp "${WASM_DIR}/get_cpm.cmake" "${fork_dir}/cmake/get_cpm.cmake"
    fi

    if [ "$is_legacy" -eq 1 ]; then
        rm -rf "${fork_dir}/apps/catchthecat"
        bridge_legacy_fork "$fork_dir"
    fi

    # share CPM downloads with the native report build
    export CPM_SOURCE_CACHE="${PROJECT_DIR}/deps"
    mkdir -p "$CPM_SOURCE_CACHE"

    # Configure
    rm -rf "$build_dir"
    log "  Configuring CMake..."
    if ! emcmake cmake \
        -S "$fork_dir" \
        -B "$build_dir" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCAT_BOT_NAME="${username}" \
        2>&1 | tail -5; then
        err "  CMake configure failed for '${username}'"
        return 1
    fi

    # Build
    log "  Building..."
    if ! cmake --build "$build_dir" --target "${username}" --parallel 2 2>&1 | tail -5; then
        err "  Build failed for '${username}'"
        return 1
    fi

    # Copy outputs
    if [ -f "${build_dir}/${username}.js" ] && [ -f "${build_dir}/${username}.wasm" ]; then
        cp "${build_dir}/${username}.js" "${BOTS_OUTPUT_DIR}/"
        cp "${build_dir}/${username}.wasm" "${BOTS_OUTPUT_DIR}/"
        log "  Success: ${username}.js + ${username}.wasm"
        return 0
    else
        err "  Output files not found for '${username}'"
        return 1
    fi
}

# ---------- Main ----------
main() {
    ensure_emscripten

    mkdir -p "$FORKS_DIR"
    mkdir -p "$BOTS_OUTPUT_DIR"

    # Corpus: username|repo lines from users.json (preserves order)
    local corpus
    corpus="$(node -e "const u=require('${USERS_FILE}'); for(const e of u) console.log(e.username+'|'+e.repo)")"
    local total
    total="$(echo "$corpus" | wc -l | tr -d ' ')"
    log "Loaded ${total} users from users.json"

    # ONLY filter (comma-separated usernames)
    local -a usernames=()
    local -a repos=()
    local matched_only_entries="${ONLY:-}"

    while IFS='|' read -r uname curl; do
        [ -z "$uname" ] && continue
        if [ -n "${ONLY:-}" ]; then
            if ! echo ",${ONLY}," | grep -q ",${uname},"; then
                continue
            fi
            matched_only_entries="$(echo "$matched_only_entries" | tr ',' '\n' | grep -v "^${uname}$" | paste -sd, - || true)"
        fi
        usernames+=("$uname")
        repos+=("$curl")
    done <<< "$corpus"

    # ONLY entries that matched no corpus user count as failures
    local fail_count=0
    local failed_list=""
    if [ -n "${ONLY:-}" ] && [ -n "$matched_only_entries" ]; then
        for missing in $(echo "$matched_only_entries" | tr ',' ' '); do
            warn "User '${missing}' (from ONLY) not found in users.json"
            failed_list="${failed_list}${missing}(not-in-users.json) "
            fail_count=$((fail_count + 1))
        done
    fi

    local -a successes=()
    local success_count=0

    log "Processing ${#usernames[@]} users..."

    for i in $(seq 0 $((${#usernames[@]} - 1))); do
        local username="${usernames[$i]}"
        local clone_url="${repos[$i]}"
        echo "" >&2
        log "=== [$(( i + 1 ))/${#usernames[@]}] ${username} ==="

        if compile_fork "$username" "$clone_url"; then
            successes+=("$username")
            success_count=$((success_count + 1))
        else
            warn "Skipping '${username}' due to errors"
            failed_list="${failed_list}${username} "
            fail_count=$((fail_count + 1))
        fi
    done

    # Manifest: users.json order filtered to successes (always written when >=1 user processed)
    local processed=$((success_count + fail_count))
    if [ "$processed" -gt 0 ] || [ -n "${ONLY:-}" ]; then
        local successes_file
        successes_file=$(mktemp)
        printf '%s\n' ${successes[@]+"${successes[@]}"} > "$successes_file"
        (cd "$PROJECT_DIR" && node -e '
            const users = require("./users.json");
            const fs = require("fs");
            const ok = new Set(fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean));
            const bots = users.filter(u => ok.has(u.username)).map(u => ({username: u.username}));
            fs.writeFileSync(process.argv[2], JSON.stringify({bots}, null, 2) + "\n");
        ' "$successes_file" "$MANIFEST_FILE")
        rm -f "$successes_file"
    else
        log "No users processed, leaving manifest untouched"
    fi

    echo "" >&2
    log "========================================="
    log "Bot build complete!"
    log "  Successful: ${success_count}"
    log "  Failed:     ${fail_count}"
    if [ "${fail_count}" -gt 0 ]; then
        log "  Failures:   ${failed_list:-none}"
    fi
    log "  Manifest:   ${MANIFEST_FILE}"
    log "  Bots dir:   ${BOTS_OUTPUT_DIR}"
    log "========================================="

    if [ "$fail_count" -gt 0 ] || [ "$success_count" -eq 0 ]; then
        exit 1
    fi
}

main "$@"
