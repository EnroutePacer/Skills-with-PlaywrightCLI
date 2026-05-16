---
name: academic
description: Use when user asks for a fixed academic-research scan workflow: collect existing studies first, then analyze research gaps and recommend directions for a given topic.
allowed-tools: WebSearch Bash(playwright-cli:*) Bash(npx:*)
---

# Academic Research Scan — v3

## CRITICAL — Read These Rules First

**DON'T** (these waste tokens every time):
- ❌ Read full YAML snapshot files — they're >30K tokens, 90% UI noise
- ❌ Fix sources known to be blocked (Google Scholar, OpenReview JS-loading)
- ❌ Retry the same keyword that returned 0 results — use `--keywords` with a shorter alternative
- ❌ Screenshot pages (unless visual layout is requested)
- ❌ Close playwright sessions after script finishes — eval-extract on demand
- ❌ Use more than 2 keyword groups — marginal gain drops sharply

**DO**:
- ✅ Start with `bash .codex/skills/academic/academic-search.sh "topic"` (default = 3 sources)
- ✅ Read `.academic-summary-*.txt` first to decide which sources have data
- ✅ Use `playwright-cli -s=NAME --raw eval "..." "main"` to extract text (skips YAML)
- ✅ Keep sessions open after script — re-eval if summary shows interesting results
- ✅ Fall back to `--keywords "shorter phrase"` if primary keyword returns 0

## Decision Tree (What To Do, In Order)

```
User enters topic
  └→ Step 1: Extract keywords (broad + precise two groups)
       └→ Step 2: bash academic-search.sh "keyword1"
            ├→ Summary shows data → eval extract details → Step 3: filter ≤10 entries
            └→ Summary shows 0 or no relevant → bash ... --keywords "keyword2"
                 └→ More data? → eval extract → filter
                     └→ Still no data? → WebSearch supplement
                            └→ Step 3: Output report
```

## The Flow (5 Steps)

### 0. Wait for user topic
Reply: `Please tell me your academic topic (you can include research object, scenario, time range).`

### 1. Prepare keywords
- 1 wide group (2-4 words, high recall)
- 1 precise group (3-5 words, high precision)
- Keep short — arXiv returns 0 for long queries
- See [Keyword Guide](#keyword-guide) below

### 2. Run search (always start with --full)
```bash
# Phase A — Quick scan (arXiv + GitHub + HuggingFace)
bash .codex/skills/academic/academic-search.sh "your topic"

# Read summary to check results
cat .academic-summary-*.txt

# If summary is truncated (long conversation), file still exists:
# cat .academic-summary-*.txt  (globbing works)
```

**If results are weak**, retry with alternative keywords:
```bash
bash .codex/skills/academic/academic-search.sh "main topic" --keywords "alternative keywords"
```

**Only if both fail and topic genuinely needs coverage:**
```bash
# Full mode — adds OpenReview, PapersWithCode, ACL Anthology
bash .codex/skills/academic/academic-search.sh "topic" --full
# Then: WebSearch as last resort
```

### 3. Extract results (NEVER read raw YAML)

After script run, sessions are still open. Use these to extract just the text:

**arXiv — titles + IDs + categories (combined):**
```bash
playwright-cli -s=arxiv --raw eval "el => { const ids = [...el.querySelectorAll('.list-title')].map(t=>t.textContent.trim().match(/arXiv:(\d+\.\d+)/)?.[1]); const titles = [...el.querySelectorAll('p.title.is-5.mathjax')].map(t=>t.textContent.replace(/\s+/g,' ').trim()); const cats = [...el.querySelectorAll('.list-title + .tags .tag, .list-title ~ .tags .tag')].map(c=>c.textContent.trim()); return ids.map((id,i) => (id||'')+'|'+(titles[i]||'')+'|'+(cats[i]||'')).slice(0,20).join('\n'); }" "main"
```

**GitHub — repo names + stars:**
```bash
playwright-cli -s=github --raw eval "el => { const m = el.textContent.match(/hl_name\\u0022:\\u0022([^\\u0022]+)\\u0022/g); return m ? m.slice(0,15).map(x => 'https://github.com/' + x.replace(/hl_name\\u0022:\\u0022/,'').replace(/\\u0022/g,'')).join('\\n') : 'no matches'; }" "main"
```

**HuggingFace — model names + links:**
```bash
playwright-cli -s=hf --raw eval "el => [...el.querySelectorAll('article h4, .model-card h4')].map(h => 'https://huggingface.co/' + h.textContent.trim()).slice(0,15).join('\\n')" "main"
```

**Generic fallback (any source):**
```bash
playwright-cli -s=SESSION_NAME --raw eval "el => el.textContent.substring(0,5000)" "main"
```

### 4. Filter & rank (max 10 entries)
Evaluate each candidate by:

| Dimension | What to check |
|-----------|---------------|
| **Relevance** | Relevance to user's topic + sub-questions |
| **Completeness** | Has problem definition, method, experiments, conclusions |
| **Credibility** | Venue (conference/journal), citation count, community activity |
| **Timeliness** | Recent advances covered? Foundational work included? |

### 5. Output report
See [Output Format](#output-format) below — must include A + B + C.

## Output Format

### A. Findings List (≤10 entries)

Each entry should be output in key-value pair format, separated by `───`:

```
Number: N
Title: {paper title / repo name / model name}
Source: {arXiv:XXXX.XXXXX (category) / GitHub: owner/repo (N★) / HuggingFace: model-name}
Relevance: {High/Medium/Low}
Completeness: {High/Medium/Low}
Link: {arXiv (https://arxiv.org/abs/XXXX.XXXXX) / GitHub (https://github.com/owner/repo) / HF (https://huggingface.co/model)}
Value explanation: {1-2 sentences explaining the relevance of this work to the topic and its core findings}
────────────────────────────────────────
```

**Source field rules:**
- arXiv: `arXiv:XXXX.XXXXX (category)` — e.g. `arXiv:2605.14503 (cs.SE)`
- GitHub: `GitHub: owner/repo (N★)` — e.g. `GitHub: Marker-Inc-Korea/AutoRAG (4.7k★)`, extract star count from (`"followers":N` field)
- HuggingFace: `HuggingFace: model-name` — e.g. `HuggingFace: roberta-base-ai-text-detection-v1`

**Link field rules:**
- arXiv: `arXiv (https://arxiv.org/abs/XXXX.XXXXX)`
- GitHub: `GitHub (https://github.com/owner/repo)`
- HuggingFace: `HF (https://huggingface.co/model-name)`

**Value explanation rules:**
- Must include the core methods/findings of this work
- Must explain the direct relevance to user's topic
- If there are quantitative results (accuracy, benchmark, star count, etc.), they should be included

### B. Gap Analysis

Expand by number, each gap should have at least 3-5 sentences of analysis, citing specific findings/papers as evidence:

1. **Problem Definition Gap** — Which core problems have not been systematically solved
   - What is the specific manifestation (cite evidence from search results)
   - Why existing work does not cover it (methodological limitations, domain bias, etc.)
   - What impact would filling this gap have

2. **Method Gap** — Which methodological approaches are insufficient or have bottlenecks
   - List at least 2-3 specific method gaps
   - For each gap, cite the most relevant work in the search results and explain its limitations

3. **Data/Benchmark Gap** — Dataset, evaluation protocol, reproducibility gaps
   - Which languages/domains/modalities are not covered
   - Limitations of existing benchmarks (scale, diversity, task design)

4. **Application Deployment Gap** — Real-world scenarios, cost, robustness, safety/ethics, etc.
   - Engineering deployment barriers (latency, cost, transferability)
   - Safety/ethics issues that have not been considered

### C. Recommendations (3-5 directions)

Each entry format:

```
Recommendation N: {Direction title}

- **Why is it a gap**: {Corresponding to specific gaps in B, cite evidence}
- **Feasible entry points**: {Specific experiments that can be done, prototypes, dataset construction}
- **Expected contribution**: {Expected output types: new methods/benchmarks/frameworks/empirical findings}
```

## Troubleshooting

### Script failures

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `playwright-cli: command not found` | Not installed or not in PATH | Try `npx playwright-cli` or `npm install -g @playwright/cli@latest` |
| arXiv shows 0 results | Keyword too long/specific | Use shorter keywords (3-4 words max), retry with `--keywords` |
| GitHub shows 0 results | Query too narrow or network | Retry with broader terms; GitHub search is lenient |
| HuggingFace empty | Topic non-AI/ML | Skip HF for non-ML topics, save the session |
| Summary file empty / not created | Script may have been interrupted | Check if playwright sessions were created: `playwright-cli list` |
| All sources return `count=?` | grep pattern didn't match page structure | Fall back to generic eval template, read 5000 chars of text |

### Session recovery
If the script output was truncated (long conversation), recover sessions:
```bash
playwright-cli list  # shows open sessions
# Then eval-extract from specific sessions:
playwright-cli -s=arxiv --raw eval "el => el.textContent.substring(0,5000)" "main"
```

## Source Reference

| Source | Reliability | Token Eff. | When to use | Extraction method |
|--------|------------|------------|-------------|-------------------|
| arXiv | Stable | High | Always | eval with .list-title |
| GitHub | Stable | Medium | Always | eval with a[href] filter |
| HuggingFace | Stable | Medium | AI/ML topics | eval with h4/article |
| ACL Anthology | Stable | High | NLP only | Not in default script |
| Papers With Code | May redirect | Low | Try if others weak | Manual eval |
| OpenReview | Unstable | Low | --full only | Likely empty |
| Semantic Scholar | Rate-limited | Low | --full only | API key needed |
| Google Scholar | Blocked | Zero | Never | Use WebSearch instead |

## Keyword Guide

**Golden rule:** 2 groups max. First wide, second precise. If first works, skip second.

**arXiv keyword sensitivity:** 5+ word phrases often return 0. Keep keywords under 5 words.

| Topic | Group 1 (wide) | Group 2 (precise) |
|-------|---------------|-------------------|
| AI text humanization | `humanize AI text` | `adversarial paraphrasing evade AI detection` |
| Knowledge distillation | `knowledge distillation` | `logit distillation transformer pruning` |
| Few-shot learning | `few-shot learning LLM` | `in-context learning prompt examples` |
| RAG optimization | `RAG optimization` | `retrieval augmented generation efficient` |

**Wrong:** `AIGC detection bypass text humanization natural language processing` → 0 on arXiv
**Right:** `humanize AI text` → results on arXiv

## Evolution History

This workflow evolved through 3 real runs. Each fix addressed an actual failure:

| # | Problem | Fix |
|---|---------|-----|
| v1 | 8 sources searched, most blocked/empty | v2: default to 3 stable sources, `--full` flag |
| v1 | No source-to-snapshot mapping, all files read blindly | v2: metadata output file mapping sessions to files |
| v1 | No keyword fallback = wasted run on 0 results | v2: `--keywords` flag for alternative query |
| v1 | Full YAML read = 30K+ tokens of UI noise | v2: recommend eval extraction, skip YAML |
| v2 | `python3` Windows Store stub exits 49 → empty metadata | v3: pure bash text summary, zero python dependency |
| v2 | `close-all` at end kills sessions → can't re-extract | v3: keep sessions open, only cleanup on next run |
| v2 | `rm old snapshots` → loses previous search data | v3: never delete old snapshots |
| v2 | Metadata only had status, not content | v3: summary auto-extracts top-3 titles per source |
| v2 | AI had to recall eval syntax after script ends | v3: script prints exact eval command templates |
| v3 | `sleep 2` wastes time waiting for snapshot file | v4: loop until snapshot appears, no fixed sleep |
| v4 | Playwright-cli not found = cryptic error | v4.1: pre-flight availability check |
| v4 | `grep -P` fails on Windows (locale) → all counts `?` | v4.1: replace with `grep -E` + `sed`, locale-safe |
| v4 | Explicit snapshot command dumps 188KB YAML to stdout | v4.1: remove redundant snapshot (open already takes one) |
| v4 | `set -e` kills script on recoverable errors (eval fails, snapshot slow) | v4.1: remove `set -e`, rely on `|| true` fallbacks |
| v4 | arXiv `.list-title` selector gets arXiv ID, not paper title | v4.1: use `p.title.is-5.mathjax` for actual titles |
| v4 | GitHub JSON payload has escaped `\\\"` in textContent | v4.1: match literal `hl_name\\\":\\\"` pattern |
