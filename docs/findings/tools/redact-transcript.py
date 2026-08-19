#!/usr/bin/env python3
"""Redact credentials from a guard evidence transcript so it can be published.

Usage:
  python3 tools/redact-transcript.py <transcript.txt> [more.txt ...] -o <outdir>
  python3 tools/redact-transcript.py <transcript.txt> --check   # report only, write nothing

Redacts, in place of the secret value, a stable placeholder that keeps the shape
readable (<REDACTED:admin-jwt>, <REDACTED:access-key>, ...). The same secret always
maps to the same placeholder within a run, so a reader can still follow which token
was used where.

ALWAYS run with --check first and read the residual-scan output. This script is a
blunt instrument; it cannot know a secret it has no pattern for. Never publish a
transcript whose residual scan is non-empty without looking at each hit.
"""

import argparse
import os
import re
import sys

# Transcripts embed response bodies as ESCAPED json strings, so every key/value
# appears both as "accessKey":"..." and as \"accessKey\":\"...". Q matches either
# quote form; missing this leaked a real key on the first run of this script.
Q = r'(?:"|\\")'


def _kv(keys, value_chars=r'[^"\\]'):
    """key/value pattern tolerant of escaped quotes, value is group 2."""
    return re.compile(rf'({Q}(?:{keys}){Q}\s*:\s*{Q})({value_chars}{{8,}})({Q})')


# (name, regex with the secret value as the SECOND capturing group)
PATTERNS = [
    ("access-key", _kv(r'accessKey|access_key')),
    ("authorization", _kv(r'[Aa]uthorization')),
    ("jwt", _kv(r'jwt|token|accessToken|refreshToken')),
    ("password", _kv(r'password')),
    ("api-key", _kv(r'apiKey|api_key|secret|clientSecret')),
    ("bearer", re.compile(r'(Bearer\s+)([A-Za-z0-9._\-]{16,})()')),
    ("bare-jwt", re.compile(r'\b(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.)([A-Za-z0-9_\-]{10,})()')),
]

# Things that look secret-ish and must be eyeballed if they survive redaction.
# Deliberately noisy: a false positive costs a glance, a false negative leaks a key.
RESIDUAL = re.compile(
    r'(accessKey|Bearer\s+\S|authorization\\?"\s*:|password\\?"|secret\\?"|apiKey'
    r'|eyJ[A-Za-z0-9_\-]{10,}|\b[a-f0-9]{40,}\b)',
    re.IGNORECASE,
)

# Placeholders a human already wrote into a hand-authored repro; not secrets.
ALREADY_MASKED = re.compile(r'<[^>]*(redact|masked|token|jwt|key)[^>]*>|\.\.\.', re.IGNORECASE)


def redact(text):
    counts = {}
    seen = {}

    def make_sub(name, value_group_index):
        def _sub(m):
            groups = list(m.groups())
            value = groups[value_group_index]
            key = (name, value)
            if key not in seen:
                seen[key] = f"<REDACTED:{name}{'' if name not in counts else counts[name]}>"
                counts[name] = counts.get(name, 0) + 1
            placeholder = seen[key]
            groups[value_group_index] = placeholder
            return "".join(g for g in groups if g is not None)

        return _sub

    for name, rx in PATTERNS:
        # the secret is always the 2nd group in these patterns
        text = rx.sub(make_sub(name, 1), text)

    return text, seen


def residual_hits(text):
    hits = []
    for i, line in enumerate(text.split("\n"), 1):
        if not RESIDUAL.search(line):
            continue
        if "<REDACTED:" in line or ALREADY_MASKED.search(line):
            continue
        hits.append((i, line.strip()[:160]))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("-o", "--outdir")
    ap.add_argument("--check", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    exit_code = 0
    for path in args.files:
        raw = open(path, encoding="utf-8", errors="replace").read()
        red, seen = redact(raw)
        hits = residual_hits(red)

        print(f"=== {path}")
        print(f"    size {len(raw)} -> {len(red)} bytes")
        print(f"    redacted {len(seen)} distinct secret(s): "
              + (", ".join(sorted({v for v in seen.values()})) or "none"))
        if hits:
            exit_code = 1
            print(f"    !! {len(hits)} residual line(s) to review by hand:")
            for ln, txt in hits[:20]:
                print(f"       L{ln}: {txt}")
        else:
            print("    residual scan: clean")

        if not args.check:
            if not args.outdir:
                sys.exit("refusing to write without -o/--outdir")
            os.makedirs(args.outdir, exist_ok=True)
            out = os.path.join(args.outdir, os.path.basename(path))
            with open(out, "w", encoding="utf-8") as fh:
                fh.write(red)
            print(f"    wrote {out}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
