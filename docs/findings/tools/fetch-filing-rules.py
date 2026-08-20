#!/usr/bin/env python3
"""Regenerate a target's FILING.md from the live GitHub repo.

Issue templates, enforcement workflows and label vocabularies drift. Rather than
trusting a copy written weeks ago, re-run this before each filing batch and read the
diff.

Usage:
  python3 tools/fetch-filing-rules.py <target-dir> <owner/repo> [<owner/repo> ...]

  python3 tools/fetch-filing-rules.py targets/documenso documenso/documenso
  python3 tools/fetch-filing-rules.py targets/strapi strapi/strapi strapi/documentation

Writes <target-dir>/FILING.md. Requires gh, authenticated.
"""

import json
import subprocess
import sys
import os
import re
import base64
import collections
from datetime import date


def gh(args, default=None):
    try:
        out = subprocess.run(["gh"] + args, capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            return default
        return out.stdout
    except Exception:
        return default


def contents(repo, path):
    raw = gh(["api", f"repos/{repo}/contents/{path}", "--jq", ".content"])
    if not raw or raw.strip().startswith("{"):
        return None
    try:
        return base64.b64decode(raw.strip()).decode("utf-8", "replace")
    except Exception:
        return None


def listdir(repo, path):
    raw = gh(["api", f"repos/{repo}/contents/{path}", "--jq", ".[].name"])
    return [l for l in (raw or "").splitlines() if l.strip()]


def yaml_labels(text):
    """Pull the `label:` values of a form's required fields, in order."""
    fields = []
    cur_label, required = None, False
    for line in text.split("\n"):
        m = re.match(r"\s*label:\s*(.+?)\s*$", line)
        if m:
            if cur_label:
                fields.append((cur_label, required))
            cur_label = m.group(1).strip("'\"")
            required = False
        if re.match(r"\s*required:\s*true", line):
            required = True
    if cur_label:
        fields.append((cur_label, required))
    return fields


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    target_dir, repos = sys.argv[1], sys.argv[2:]
    out = [f"# Filing rules for {' and '.join(repos)}",
           "",
           f"**Regenerated {date.today().isoformat()}** by `tools/fetch-filing-rules.py`. "
           "Templates and label vocabularies drift, so re-run this before each batch and read the diff. "
           "The rules that apply to every target live in `../../FILING-GUIDE.md`.",
           ""]

    for repo in repos:
        out.append(f"## {repo}")
        out.append("")

        pvr = gh(["api", f"repos/{repo}/private-vulnerability-reporting", "--jq", ".enabled"])
        sec = contents(repo, "SECURITY.md") or contents(repo, ".github/SECURITY.md")
        out.append(f"- Private vulnerability reporting: **{(pvr or 'unknown').strip()}**"
                   + ("  (so `gh api -X POST repos/%s/security-advisories/reports` works)" % repo
                      if (pvr or "").strip() == "true" else ""))
        out.append(f"- SECURITY.md present: **{'yes' if sec else 'no'}**")

        names = listdir(repo, ".github/ISSUE_TEMPLATE")
        cfg = contents(repo, ".github/ISSUE_TEMPLATE/config.yml") or ""
        blank = "false" if "blank_issues_enabled: false" in cfg else (
            "true" if "blank_issues_enabled" in cfg else "unknown")
        out.append(f"- `blank_issues_enabled`: **{blank}**"
                   + ("  (every issue MUST go through a template)" if blank == "false" else ""))
        out.append(f"- Templates: {', '.join('`%s`' % n for n in names) if names else 'none found'}")
        out.append("")

        for n in names:
            if n == "config.yml":
                continue
            body = contents(repo, f".github/ISSUE_TEMPLATE/{n}") or ""
            auto_labels = re.search(r"^labels:\s*(.+)$", body, re.M)
            auto_title = re.search(r"^title:\s*(.+)$", body, re.M)
            out.append(f"### `{n}`")
            out.append("")
            if auto_title:
                out.append(f"- auto-title: `{auto_title.group(1).strip()}`")
            if auto_labels:
                out.append(f"- auto-labels: `{auto_labels.group(1).strip()}`")
            if n.endswith((".yml", ".yaml")):
                fields = yaml_labels(body)
                if fields:
                    out.append("- Body must contain these as `### ` headers, spelled exactly:")
                    out.append("")
                    out.append("```")
                    for label, req in fields:
                        out.append(f"### {label}" + ("" if req else "        (optional)"))
                    out.append("```")
            else:
                heads = re.findall(r"^#{1,4}\s*(.+)$", body, re.M)
                if heads:
                    out.append("- Markdown template, sections: " + ", ".join(f"`{h}`" for h in heads))
            out.append("")

        # enforcement workflows
        wf = listdir(repo, ".github/workflows")
        enforcing = []
        for f in wf:
            if not re.search(r"issue|template|triage|label|stale", f, re.I):
                continue
            b = contents(repo, f".github/workflows/{f}") or ""
            if re.search(r"issue.?template|invalid template|required.*(section|checkbox)", b, re.I):
                trig = "opened+edited" if re.search(r"types:\s*\[.*edited", b) else "opened"
                enforcing.append(f"`{f}` (on {trig})")
        out.append(f"- Template-enforcing workflows: "
                   + (", ".join(enforcing) if enforcing else "none detected"))
        out.append("")

        # label vocabulary in use
        raw = gh(["issue", "list", "--repo", repo, "--state", "all", "--limit", "30",
                  "--json", "labels"])
        if raw:
            try:
                c = collections.Counter(l["name"] for i in json.loads(raw) for l in i["labels"])
                if c:
                    out.append("- Labels actually used on the 30 most recent issues "
                               "(we cannot self-apply; put a `Suggested labels` line in the body):")
                    out.append("")
                    out.append("| label | seen |")
                    out.append("|---|--:|")
                    for name, n in c.most_common(18):
                        out.append(f"| `{name}` | {n} |")
                    out.append("")
            except Exception:
                pass
        out.append("")

    os.makedirs(target_dir, exist_ok=True)
    p = os.path.join(target_dir, "FILING.md")
    open(p, "w").write("\n".join(out).rstrip() + "\n")
    print(f"wrote {p}")


if __name__ == "__main__":
    main()
