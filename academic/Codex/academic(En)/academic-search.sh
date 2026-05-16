#!/bin/bash
#==============================================================================
# academic-search.sh — v4.1
#
# Usage:
#   bash script.sh "research topic"                 # 快速扫描（arXiv + GitHub + HF）
#   bash script.sh "topic" --full                   # 全量扫描（8 源）
#   bash script.sh "topic" --keywords "alt keyword" # 备选关键词重试
#
# v4.1 hotfixes:
#   - Suppress snapshot YAML from stdout (was 188KB of noise)
#   - Replace grep -P with grep -E + sed (locale-safe on Windows)
#   - Add wait-loop with timeout for snapshot file (removed sleep 2)
#   - Check playwright-cli availability before starting
#==============================================================================

set -uo pipefail

# --- Pre-flight: check playwright-cli ---
PLAYWRIGHT_CMD=""
for cmd in playwright-cli; do
    if command -v "$cmd" &>/dev/null; then
        PLAYWRIGHT_CMD="$cmd"
        break
    fi
done
if [ -z "$PLAYWRIGHT_CMD" ] && command -v npx &>/dev/null; then
    if npx --no-install playwright-cli --version &>/dev/null 2>&1; then
        PLAYWRIGHT_CMD="npx --no-install playwright-cli"
    fi
fi

if [ -z "$PLAYWRIGHT_CMD" ]; then
    echo "ERROR: playwright-cli not found."
    echo "  Install: npm install -g @playwright/cli@latest"
    echo "  Or try:  npx playwright-cli"
    exit 1
fi

TOPIC="${1:?Usage: $0 <topic> [--full] [--keywords \"k1 k2\"]}"

# Parse arguments
MODE="quick"
EXTRA_KEYWORDS=""
POSITIONAL=()
while [ $# -gt 0 ]; do
    case $1 in
        --full) MODE="full"; shift ;;
        --keywords) EXTRA_KEYWORDS="$2"; shift 2 ;;
        *) POSITIONAL+=("$1"); shift ;;
    esac
done
TOPIC="${POSITIONAL[0]:-$TOPIC}"

SESSION_DIR=".playwright-cli"
SUMMARY_FILE=".academic-summary-$$.txt"

# Clean old sessions (keep old snapshots)
"$PLAYWRIGHT_CMD" close-all 2>/dev/null || true

TOPIC_PLUS="${TOPIC// /+}"
TOPIC_20="${TOPIC// /%20}"

echo "========================================================================"
echo "  Academic Search v4.1  |  Topic: ${TOPIC}  |  Mode: ${MODE}"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================================================"

# Init summary file
cat > "$SUMMARY_FILE" <<- 'EOFSUM'
# Academic Search Summary
# source | count | snapshot | top_entries
EOFSUM

# --- Helper: wait for snapshot file (max ~5s) ---
wait_snapshot() {
    local max_wait=10 waited=0
    while [ "$waited" -lt "$max_wait" ]; do
        local latest
        latest=$(ls -t "${SESSION_DIR}" 2>/dev/null | grep -E "^page-.*\.yml$" | head -1)
        if [ -n "$latest" ] && [ -s "${SESSION_DIR}/${latest}" ]; then
            echo "$latest"
            return 0
        fi
        sleep 0.5
        waited=$((waited + 1))
    done
    echo ""
    return 1
}

# --- Helper: extract count from a line like "Showing 1-50 of 3,731 results" ---
extract_count() {
    local t="$1"
    # "of 3,731 results" or "of 3731 results"
    local c
    c=$(echo "$t" | sed -n 's/.*[Oo]f[[:space:]]\([0-9,][0-9,]*\)[[:space:]]results*.*/\1/p' | head -1 | tr -d ',')
    [ -n "$c" ] && echo "$c" || echo "?"
}

# --- Helper: search + snapshot + extract summary ---
search_source() {
    local session="$1" label="$2" url="$3"

    echo "[$label] Searching..."
    # open already takes a snapshot; explicit snapshot is redundant
    # (it dumps full YAML tree to stdout and is slow on large result pages)
    "$PLAYWRIGHT_CMD" -s="$session" open "$url" 2>/dev/null || true

    local latest
    latest=$(wait_snapshot "$session" "$label")

    if [ -z "$latest" ]; then
        echo "[FAIL] $label | count=0 | snapshot=(none)" >> "$SUMMARY_FILE"
        echo "  -> No snapshot captured"
        return
    fi

    # Extract page text for counting
    local text
    text=$("$PLAYWRIGHT_CMD" -s="$session" --raw eval "el => el.textContent.substring(0,6000)" "main" 2>/dev/null || echo "")

    local count="?" top3="?"
    case "$label" in
        "arXiv"|"arXiv-alt")
            count=$(extract_count "$text")
            # Extract paper titles via CSS selector .title.is-5.mathjax
            top3=$("$PLAYWRIGHT_CMD" -s="$session" --raw eval "el => [...el.querySelectorAll('p.title.is-5.mathjax')].slice(0,3).map(t => t.textContent.replace(/\\s+/g,' ').trim()).join(' | ')" "main" 2>/dev/null || echo "?")
            ;;
        "GitHub"|"GitHub-alt")
            # Count: number of hl_name entries in JSON payload ~ results on page
            count=$(echo "$text" | grep -c 'hl_name' || true)
            [ "$count" = "0" ] && count="?"
            # Extract repo names from hl_name\":\"owner/repo\" JSON fragments
            top3=$(echo "$text" | grep -o 'hl_name\\":\\"[^\\"]*' | sed 's/hl_name\\":\\"//' | head -3 | tr '\n' ' | ')
            [ -z "$top3" ] && top3="?" ;;
        "HuggingFace")
            count=$(extract_count "$text")
            top3=$(echo "$text" | grep -oE '[a-zA-Z0-9_-]+/[a-zA-Z0-9._-]+' | grep -v '^hf/' | head -3 | tr '\n' ' | ')
            [ -z "$top3" ] && top3="?"
            ;;
        "ACLAnthology")
            count=$(extract_count "$text")
            top3=$(echo "$text" | grep -oE '^[[:space:]]*[A-Z][A-Za-z0-9 \t\(\),:;/-]{20,200}' | sed 's/^[[:space:]]*//' | head -3 | tr '\n' ' | ')
            [ -z "$top3" ] && top3="?"
            ;;
        *)
            count=$(echo "$text" | wc -w)
            top3="${text:0:200}"
            ;;
    esac

    {
        echo "$label | OK | count=$count | snapshot=$latest"
        echo "  top: ${top3}"
    } >> "$SUMMARY_FILE"

    echo "  -> $latest (${count} results)"
}

# ============================================================
# STABLE SOURCES
# ============================================================
search_source arxiv "arXiv" "https://arxiv.org/search/?query=${TOPIC_PLUS}&searchtype=all&start=0"
search_source github "GitHub" "https://github.com/search?q=${TOPIC_20}&type=repositories&s=stars&o=desc"
search_source hf "HuggingFace" "https://huggingface.co/models?search=${TOPIC_20}&sort=downloads"

# ============================================================
# EXTRA KEYWORDS
# ============================================================
if [ -n "${EXTRA_KEYWORDS}" ]; then
    EK_PLUS="${EXTRA_KEYWORDS// /+}"
    EK_20="${EXTRA_KEYWORDS// /%20}"
    echo ""
    echo "--- Extra keywords: ${EXTRA_KEYWORDS} ---"
    search_source arxiv2 "arXiv-alt" "https://arxiv.org/search/?query=${EK_PLUS}&searchtype=all&start=0"
    search_source gh2 "GitHub-alt" "https://github.com/search?q=${EK_20}&type=repositories&s=stars&o=desc"
fi

# ============================================================
# OPTIONAL SOURCES (--full mode only)
# ============================================================
if [ "$MODE" = "full" ]; then
    echo ""
    echo "--- Full mode ---"
    search_source openreview "OpenReview" "https://openreview.net/search?term=${TOPIC_PLUS}&contentFilters=all&groupBy=paper"
    search_source pwc "PapersWithCode" "https://paperswithcode.com/search?q=${TOPIC_20}"
    search_source acl "ACLAnthology" "https://aclanthology.org/search/?q=${TOPIC_PLUS}"
fi

echo ""
echo "========================================================================"
echo "  Complete  |  $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================================================"
echo ""
echo ">>> NEXT STEPS <<<"
echo "1. cat $SUMMARY_FILE"
echo "2. playwright-cli -s=arxiv --raw eval '...querySelectorAll(...)' main"
echo "3. playwright-cli -s=github --raw eval '...' main"
echo "4. playwright-cli -s=hf --raw eval '...' main"
echo "5. playwright-cli close-all"
echo ""
echo "Use: cat $SUMMARY_FILE"
echo "Then: playwright-cli -s=arxiv --raw eval \"el => [...el.querySelectorAll('.list-title')].map(t=>t.textContent.trim()).slice(0,20).join('\n'))\" \"main\""
echo "Sessions OPEN. Close: playwright-cli close-all"
