"""
Coding interview module — LeetCode problem fetching + AI coding assistant.
Uses LeetCode's public GraphQL API (no auth for public problems).
"""
import os
import json
import random
import requests
import anthropic
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

LEETCODE_GRAPHQL = "https://leetcode.com/graphql"

HEADERS = {
    "Content-Type": "application/json",
    "Referer": "https://leetcode.com",
    "User-Agent": "Mozilla/5.0",
}

# Curated pool of common interview problems by difficulty
PROBLEM_POOL = {
    "easy": [
        "two-sum",
        "reverse-linked-list",
        "valid-parentheses",
        "merge-two-sorted-lists",
        "best-time-to-buy-and-sell-stock",
        "valid-anagram",
        "binary-search",
        "contains-duplicate",
        "palindrome-number",
        "maximum-depth-of-binary-tree",
        "remove-duplicates-from-sorted-array",
        "climbing-stairs",
        "symmetric-tree",
        "min-stack",
        "single-number",
        "intersection-of-two-linked-lists",
        "majority-element",
        "linked-list-cycle",
        "pascals-triangle",
        "reverse-integer",
    ],
    "medium": [
        "longest-substring-without-repeating-characters",
        "three-sum",
        "container-with-most-water",
        "product-of-array-except-self",
        "maximum-subarray",
        "jump-game",
        "merge-intervals",
        "unique-paths",
        "coin-change",
        "word-search",
        "number-of-islands",
        "rotting-oranges",
        "course-schedule",
        "lowest-common-ancestor-of-a-binary-search-tree",
        "find-first-and-last-position-of-element-in-sorted-array",
        "search-in-rotated-sorted-array",
        "subsets",
        "combination-sum",
        "binary-tree-level-order-traversal",
        "kth-smallest-element-in-a-bst",
        "validate-binary-search-tree",
        "minimum-path-sum",
    ],
    "hard": [
        "median-of-two-sorted-arrays",
        "trapping-rain-water",
        "word-ladder",
        "merge-k-sorted-lists",
        "longest-valid-parentheses",
        "minimum-window-substring",
        "serialize-and-deserialize-binary-tree",
        "regular-expression-matching",
        "substring-with-concatenation-of-all-words",
        "first-missing-positive",
        "lfu-cache",
        "n-queens",
        "palindrome-partitioning-ii",
        "sliding-window-maximum",
        "find-median-from-data-stream",
        "alien-dictionary",
        "deserialize-serialize-bst",
    ],
}


def fetch_problem(difficulty: str = "medium", slug: str | None = None) -> dict:
    """Fetch a LeetCode problem. Returns normalized problem dict."""
    if not slug:
        pool = PROBLEM_POOL.get(difficulty.lower(), PROBLEM_POOL["medium"])
        slug = random.choice(pool)

    query = """
    query questionDetail($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        titleSlug
        difficulty
        content
        hints
        exampleTestcases
        codeSnippets { lang langSlug code }
        topicTags { name }
      }
    }
    """

    resp = requests.post(
        LEETCODE_GRAPHQL,
        headers=HEADERS,
        json={"query": query, "variables": {"titleSlug": slug}},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json().get("data", {}).get("question")
    if not data:
        raise ValueError(f"Problem '{slug}' not found or LeetCode API unavailable")

    # Extract TypeScript starter code
    ts_snippet = next(
        (s["code"] for s in (data.get("codeSnippets") or []) if s["langSlug"] == "typescript"),
        "// TypeScript starter code not available\nfunction solution(): void {\n\n}",
    )

    # Strip HTML from content
    import re
    content_html = data.get("content") or ""
    content_text = re.sub(r"<[^>]+>", "", content_html)
    content_text = content_text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"').strip()

    return {
        "title": data["title"],
        "slug": data["titleSlug"],
        "difficulty": data["difficulty"],
        "description": content_text,
        "hints": data.get("hints") or [],
        "examples": data.get("exampleTestcases") or "",
        "starter_code": ts_snippet,
        "topics": [t["name"] for t in (data.get("topicTags") or [])],
    }


def _get_client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return anthropic.Anthropic(api_key=api_key)


def get_hint(problem: dict, current_code: str, hint_level: int = 1) -> str:
    """
    Return a hint for the current problem.
    hint_level 1 = nudge in right direction
    hint_level 2 = bigger hint with approach
    hint_level 3 = near-solution walkthrough
    """
    client = _get_client()

    hint_instruction = {
        1: "Give a small nudge — point them toward the right approach without revealing it. 2-3 sentences.",
        2: "Describe the algorithm approach clearly. Don't write code. 3-5 sentences.",
        3: "Walk through the solution step by step with pseudocode. Be detailed.",
    }.get(hint_level, "Give a helpful hint.")

    prompt = f"""You are a coding interview assistant helping with a LeetCode problem.

Problem: {problem['title']} ({problem['difficulty']})
{problem['description'][:1500]}

Candidate's current code:
```typescript
{current_code or "(empty — hasn't started yet)"}
```

{hint_instruction}
Keep it concise and spoken-friendly (this will be read aloud or displayed inline).
"""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip()


def analyze_code(problem: dict, current_code: str, is_periodic: bool = True) -> dict:
    """
    Analyze the candidate's current code and return structured feedback.
    Used for both periodic snapshots and on-demand analysis.
    """
    client = _get_client()

    context = "This is a periodic check-in (every few minutes)." if is_periodic else "The candidate requested explicit help."

    prompt = f"""You are a coding interview AI assistant reviewing a candidate's work in progress.

Problem: {problem['title']} ({problem['difficulty']})
{problem['description'][:1500]}

Current code:
```typescript
{current_code or "(empty — hasn't started yet)"}
```

{context}

Return ONLY valid JSON:
{{
  "status": "not_started|in_progress|on_track|needs_help|complete",
  "summary": "1-2 sentence summary of where they are",
  "observations": ["specific observation about their code", "..."],
  "next_step": "1 sentence on what to focus on next",
  "bugs": ["specific bug if any", "..."],
  "score": 0-10
}}

Be direct and specific. Reference actual lines/logic in their code."""

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    # Parse JSON
    import re
    clean = re.sub(r"```(?:json)?\s*", "", raw).strip().strip("`")
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", clean, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                pass
    return {
        "status": "in_progress",
        "summary": raw[:200],
        "observations": [],
        "next_step": "",
        "bugs": [],
        "score": 5,
    }
