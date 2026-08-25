#!/usr/bin/env python3
"""
compare.py — diff an AUTHORING-LOOP web catalog against the hand-authored baseline.

This is the item-6 validation instrument: it reads two `interfaces.authored.json`
files and prints one deterministic report scored on the axes the authoring
doctrine itself states. It is a REPORT, not a gate — it never exits non-zero, and
it never decides that a difference is a regression. A human reads the numbers.

WHERE THE RUBRIC COMES FROM
---------------------------
There is no AUTHORING.md in `packages/interface-author/`; the doctrine lives in
the package's own code, and every axis below quotes it:

  * `packages/interface-author/src/session.ts` — the session SYSTEM_PROMPT:
    "One INTERFACE is ONE TASK a user can perform from one state … never a page
    inventory", the list of things that are NOT tasks (pagination, sorting,
    chrome), the `apiEffects` tri-state ("`[]` means the task reaches no server
    at all, which is a stronger claim than omitting"), and "reuse an id from the
    registry before you mint one".
  * `packages/interface-author/src/draft.ts` — the five rules `validateFragment`
    enforces: one id one thing, one fingerprint one task, `<role> "<name>"`
    locators over real ARIA roles, reachable-and-located, one state id one world.
  * `packages/shared/src/interfaces.ts` — `interfaceFingerprint` (reimplemented
    below, byte-for-byte) and the catalog schema.
  * `packages/shared/src/guard/web-steps.ts` — `GUARD_WEB_ROLES`, mirrored below.

THE SHAPE DRIFT IT NORMALIZES
-----------------------------
The two files are the same schema written by two hands, and they populate
different optional fields:

  hand baseline   `group` + `entry` + a stored `fingerprint`; no `at` / `to`
  loop output     `at` / `to` (the session is scoped to one place and briefed to
                  use them) and `group` as the session chose to name it

So neither "the candidate has `at` and the baseline does not" nor the reverse is
reported as a defect. Instead every entry is reduced to two normalized keys that
both shapes can answer:

  LOCATION  `at`, else the first `navigate` step's route, else `entry.path`
  IDENTITY  the recomputed fingerprint — `sha256:` over type + entry + steps,
            which is exactly what the catalog itself matches tasks by

Stored fingerprints are still read, and a stored value that disagrees with the
recomputed one is reported as drift rather than trusted.

USAGE
  python3 compare.py --baseline <hand.json> --candidate <loop.json>
  python3 compare.py            # both defaults below, run from the app's repo root

Python 3.8+, standard library only. No dependencies, no network, no writes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Defaults — the pilot layout on the local machine this benchmark runs on.
# Both are overridable; nothing here reaches outside the two paths given.
# ---------------------------------------------------------------------------

DEFAULT_BASELINE = "pr-benchmark/interfaces-pilot-2026-08-17/backup/cal.diy/interfaces.authored.json"
DEFAULT_CANDIDATE = ".truecourse/guard/interfaces.authored.json"

# The surface this catalog half is about. Everything else is reported and skipped.
WEB = "web"

# ---------------------------------------------------------------------------
# Mirrors of the TypeScript source. Kept as literals (not parsed out of the .ts)
# so this script runs with no toolchain at all; each names the file it mirrors so
# a drift between them is a one-line diff to find.
# ---------------------------------------------------------------------------

# packages/shared/src/guard/web-steps.ts — GUARD_WEB_ROLES
GUARD_WEB_ROLES = frozenset(
    """alert alertdialog application article banner blockquote button caption cell
    checkbox code columnheader combobox complementary contentinfo definition
    deletion dialog directory document emphasis feed figure form generic grid
    gridcell group heading img insertion link list listbox listitem log main
    marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter
    navigation none note option paragraph presentation progressbar radio
    radiogroup region row rowgroup rowheader scrollbar search searchbox separator
    slider spinbutton status strong subscript superscript switch tab table
    tablist tabpanel term textbox time timer toolbar tooltip tree treegrid
    treeitem""".split()
)

# packages/interface-author/src/draft.ts — TARGET_GRAMMAR
TARGET_GRAMMAR = re.compile(r'^([a-z]+) "([^"]+)"$')

# packages/interface-author/src/draft.ts — AUTHORED_ID
AUTHORED_ID = re.compile(r"^web/[a-z0-9]+(?:-[a-z0-9]+)*$")

# packages/shared/src/interfaces.ts — InterfaceStateIdSchema / InterfaceResourceIdSchema
KEBAB_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# The web members of the step union (draft.ts AuthoredWebStepSchema). `invoke`
# and `request` belong to other surfaces and are reported if they turn up here.
WEB_STEP_KINDS = ("navigate", "input", "activate")

# Fields the catalog schema defines on an interface. Anything else is drift.
KNOWN_INTERFACE_KEYS = frozenset(
    """id type title group entry steps startingState endState at to resource
    apiEffects fingerprint specOnly contract origin""".split()
)
KNOWN_FILE_KEYS = frozenset(
    "version generatedAt recipeFingerprint interfaces states resources source".split()
)

# session.ts SYSTEM_PROMPT, "What is NOT a task": controls that only re-render
# the same data. Matching one of these is a PROMPT for a human to look, never a
# verdict — "filter the violation list by category" is a legitimate task and
# would match `filter`, so the report shows the titles and lets a reader judge.
NON_TASK_HINTS = (
    "pagination",
    "next page",
    "previous page",
    "page size",
    "per page",
    "sort by",
    "sort the",
    "sort column",
    "change theme",
    "toggle theme",
    "dark mode",
    "light mode",
    "switch language",
    "copy to clipboard",
    "copy the link to the clipboard",
    "expand row",
    "collapse row",
    "show tooltip",
    "open help",
)

# A locator that names the implementation instead of the user's perception. The
# grammar check already refuses these; this classifies WHY for the report.
SELECTOR_SHAPES = ("data-testid", "data-test", "#", ".", "[", "//", "css=", "xpath=")

# How many examples any one list prints. Fixed, so the report is diffable.
MAX_EXAMPLES = 12


# ---------------------------------------------------------------------------
# The fingerprint — packages/shared/src/interfaces.ts, interfaceFingerprint()
# ---------------------------------------------------------------------------


def normalize_token(text: Any) -> str:
    """`normalizeToken` — whitespace-collapsed and trimmed."""
    return re.sub(r"\s+", " ", str(text)).strip()


def step_identity(step: Any) -> Optional[str]:
    """`stepIdentity` — kind + surface-visible payload, NUL-joined. None = unknown shape."""
    if not isinstance(step, dict):
        return None
    kind = step.get("kind")
    if kind == "invoke":
        command = step.get("command")
        flags = step.get("flags")
        if not isinstance(command, list) or not isinstance(flags, list):
            return None
        return "\x00".join(
            [
                "invoke",
                " ".join(normalize_token(c) for c in command),
                " ".join(sorted(normalize_token(f) for f in flags)),
            ]
        )
    if kind == "request":
        if "method" not in step or "path" not in step:
            return None
        return "\x00".join(
            ["request", normalize_token(step["method"]).upper(), normalize_token(step["path"])]
        )
    if kind == "navigate":
        if "route" not in step:
            return None
        return "\x00".join(["navigate", normalize_token(step["route"])])
    if kind in ("input", "activate"):
        if "target" not in step:
            return None
        return "\x00".join([str(kind), normalize_token(step["target"])])
    return None


def interface_fingerprint(iface: Dict[str, Any]) -> Optional[str]:
    """`sha256:<hex>` over type + entry identity + step identities. None = unfingerprintable."""
    itype = iface.get("type")
    entry = iface.get("entry")
    steps = iface.get("steps")
    if not isinstance(itype, str) or not isinstance(entry, dict) or not isinstance(steps, list):
        return None
    if "command" in entry:
        command = entry.get("command")
        if not isinstance(command, list):
            return None
        entry_identity = " ".join(normalize_token(c) for c in command)
    else:
        if "method" not in entry or "path" not in entry:
            return None
        entry_identity = " ".join(
            [normalize_token(entry["method"]).upper(), normalize_token(entry["path"])]
        )
    identities = [step_identity(step) for step in steps]
    if any(identity is None for identity in identities):
        return None
    body = "\n".join([itype, entry_identity] + [i for i in identities if i is not None])
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Loading — every failure is data for the report, never an exception
# ---------------------------------------------------------------------------


class Side:
    """One catalog file, normalized as far as its own shape allows."""

    def __init__(self, label: str, path: str) -> None:
        self.label = label
        self.path = path
        self.available = False
        self.load_error: Optional[str] = None
        self.raw: Dict[str, Any] = {}
        self.envelope: Dict[str, Any] = {}
        self.shape_notes: List[str] = []
        self.interfaces: List[Dict[str, Any]] = []  # web entries only
        self.other_surface: List[Dict[str, Any]] = []
        self.malformed_entries = 0
        self.states: List[Dict[str, Any]] = []
        self.resources: List[Dict[str, Any]] = []

    # -- loading ------------------------------------------------------------

    def load(self) -> None:
        p = Path(self.path)
        try:
            text = p.read_text(encoding="utf-8")
        except FileNotFoundError:
            self.load_error = "does not exist"
            return
        except IsADirectoryError:
            self.load_error = "is a directory, not a catalog file"
            return
        except PermissionError:
            self.load_error = "permission denied"
            return
        except OSError as exc:  # pragma: no cover - environment dependent
            self.load_error = "could not be read: {}".format(exc)
            return
        if not text.strip():
            self.load_error = "is empty"
            return
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            self.load_error = "is not valid JSON: {} (line {}, column {})".format(
                exc.msg, exc.lineno, exc.colno
            )
            return
        if not isinstance(data, dict):
            self.load_error = "is JSON {}, not a catalog object".format(type(data).__name__)
            return
        self.raw = data
        self.available = True
        self._normalize()

    def _normalize(self) -> None:
        data = self.raw
        self.envelope = {
            key: data.get(key) for key in ("version", "generatedAt", "recipeFingerprint")
        }
        if data.get("version") != 2:
            self.shape_notes.append(
                "envelope `version` is {!r}; this reader knows version 2".format(data.get("version"))
            )
        unknown_top = sorted(set(data) - KNOWN_FILE_KEYS)
        if unknown_top:
            self.shape_notes.append("unknown top-level keys: " + ", ".join(unknown_top))

        raw_interfaces = data.get("interfaces")
        if raw_interfaces is None:
            self.shape_notes.append("no `interfaces` key at all")
            raw_interfaces = []
        elif not isinstance(raw_interfaces, list):
            self.shape_notes.append(
                "`interfaces` is {}, not a list — read as empty".format(type(raw_interfaces).__name__)
            )
            raw_interfaces = []
        for entry in raw_interfaces:
            if not isinstance(entry, dict):
                self.malformed_entries += 1
                continue
            if entry.get("type") == WEB:
                self.interfaces.append(entry)
            else:
                self.other_surface.append(entry)
        if self.malformed_entries:
            self.shape_notes.append(
                "{} entr(y/ies) in `interfaces` are not objects — skipped".format(self.malformed_entries)
            )
        if self.other_surface:
            kinds = Counter(str(e.get("type")) for e in self.other_surface)
            self.shape_notes.append(
                "non-web entries present and excluded from every axis: "
                + ", ".join("{} x{}".format(k, n) for k, n in sorted(kinds.items()))
            )

        self.states = self._registry(data.get("states"), "states")
        self.resources = self._registry(data.get("resources"), "resources")

    def _registry(self, value: Any, name: str) -> List[Dict[str, Any]]:
        """`{area: [...]}` per the schema; a bare list is accepted with a note."""
        if value is None:
            return []
        if isinstance(value, dict):
            area = value.get(WEB)
            extra = sorted(k for k in value if k != WEB)
            if extra:
                self.shape_notes.append(
                    "`{}` carries non-web areas (ignored): {}".format(name, ", ".join(extra))
                )
            if area is None:
                return []
            if not isinstance(area, list):
                self.shape_notes.append(
                    "`{}.web` is {}, not a list — read as empty".format(name, type(area).__name__)
                )
                return []
            return [item for item in area if isinstance(item, dict)]
        if isinstance(value, list):
            self.shape_notes.append(
                "`{}` is a bare list, not the `{{area: [...]}}` registry — read as the web area".format(name)
            )
            return [item for item in value if isinstance(item, dict)]
        self.shape_notes.append(
            "`{}` is {}, not a registry — read as empty".format(name, type(value).__name__)
        )
        return []

    # -- derived views ------------------------------------------------------

    def entry_path(self, iface: Dict[str, Any]) -> Optional[str]:
        entry = iface.get("entry")
        if isinstance(entry, dict) and isinstance(entry.get("path"), str):
            return entry["path"]
        return None

    def first_navigate(self, iface: Dict[str, Any]) -> Optional[str]:
        steps = iface.get("steps")
        if isinstance(steps, list) and steps and isinstance(steps[0], dict):
            if steps[0].get("kind") == "navigate" and isinstance(steps[0].get("route"), str):
                return steps[0]["route"]
        return None

    def location(self, iface: Dict[str, Any]) -> str:
        """The shape-drift normalizer: `at`, else a first navigate, else the entry path."""
        at = iface.get("at")
        if isinstance(at, str) and at:
            return at
        route = self.first_navigate(iface)
        if route:
            return route
        path = self.entry_path(iface)
        return path if path else "(no location)"

    def group_of(self, iface: Dict[str, Any]) -> str:
        """`group` when the entry declares one; otherwise the normalized location."""
        group = iface.get("group")
        if isinstance(group, str) and group:
            return group
        return "(ungrouped: {})".format(self.location(iface))

    def fingerprints(self) -> Dict[str, List[Dict[str, Any]]]:
        by_fp: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for iface in self.interfaces:
            fp = interface_fingerprint(iface)
            by_fp[fp if fp else "(unfingerprintable)"].append(iface)
        return by_fp

    def ids(self) -> List[str]:
        return [str(i.get("id")) for i in self.interfaces]


# ---------------------------------------------------------------------------
# Report primitives — every line goes through these, so nothing is time- or
# order-dependent and two runs over the same inputs diff to nothing.
# ---------------------------------------------------------------------------


class Report:
    def __init__(self) -> None:
        self.lines: List[str] = []

    def head(self, title: str) -> None:
        self.lines.append("")
        self.lines.append("=" * 78)
        self.lines.append(title)
        self.lines.append("=" * 78)

    def sub(self, title: str) -> None:
        self.lines.append("")
        self.lines.append(title)
        self.lines.append("-" * len(title))

    def line(self, text: str = "") -> None:
        self.lines.append(text)

    def kv(self, key: str, *values: Any, width: int = 34) -> None:
        rendered = "  ".join("{:>16}".format(str(v)) for v in values)
        self.lines.append("  {}{}".format(key.ljust(width), rendered))

    def bullets(self, items: List[str], limit: int = MAX_EXAMPLES, indent: str = "    ") -> None:
        shown = items[:limit]
        for item in shown:
            self.lines.append("{}- {}".format(indent, item))
        if len(items) > len(shown):
            self.lines.append("{}… {} more".format(indent, len(items) - len(shown)))

    def render(self) -> str:
        return "\n".join(self.lines) + "\n"


def pct(n: int, total: int) -> str:
    return "  n/a" if total == 0 else "{:5.1f}%".format(100.0 * n / total)


def na(side: Side, value: Any) -> str:
    return "n/a" if not side.available else str(value)


def ratio(numerator: int, denominator: int) -> str:
    return "n/a" if denominator == 0 else "{:.2f}".format(numerator / denominator)


# ---------------------------------------------------------------------------
# Axis 0 — inputs and shape
# ---------------------------------------------------------------------------


def section_inputs(report: Report, baseline: Side, candidate: Side) -> None:
    report.head("INPUTS")
    for side in (baseline, candidate):
        report.line("  {:<10} {}".format(side.label, side.path))
        if not side.available:
            report.line("  {:<10} ERROR: the file {}".format("", side.load_error))
            continue
        env = side.envelope
        report.line(
            "  {:<10} version {} · generatedAt {} · recipeFingerprint {}".format(
                "",
                env.get("version"),
                env.get("generatedAt") or "(blank)",
                short(env.get("recipeFingerprint")),
            )
        )
    if not baseline.available or not candidate.available:
        report.line("")
        report.line("  One side is unavailable. Every axis below reports the side it has and")
        report.line("  prints `n/a` for the other — the report still runs, and still exits 0.")


def short(value: Any, keep: int = 16) -> str:
    text = str(value) if value else ""
    if not text:
        return "(blank)"
    return text if len(text) <= keep else text[:keep] + "…"


def section_shape(report: Report, baseline: Side, candidate: Side) -> None:
    report.head("AXIS 0 — SHAPE (what each file carries, before anything is compared)")
    report.line("")
    report.line("  The two halves populate different optional fields by design: the hand")
    report.line("  baseline carries `group` + `entry` + a stored `fingerprint` and no")
    report.line("  `at`/`to`; a loop entry is authored at a place and carries them. Field")
    report.line("  presence is therefore REPORTED, never scored.")
    report.line("")
    report.kv("", baseline.label, candidate.label)
    report.kv("web interfaces", na(baseline, len(baseline.interfaces)), na(candidate, len(candidate.interfaces)))
    report.kv("non-web entries (excluded)", na(baseline, len(baseline.other_surface)), na(candidate, len(candidate.other_surface)))
    report.kv("states.web[] entries", na(baseline, len(baseline.states)), na(candidate, len(candidate.states)))
    report.kv("resources.web[] entries", na(baseline, len(baseline.resources)), na(candidate, len(candidate.resources)))

    report.sub("field presence, per web entry")
    fields = (
        "title",
        "group",
        "entry",
        "steps",
        "at",
        "to",
        "startingState",
        "endState",
        "apiEffects",
        "fingerprint",
        "origin",
        "contract",
    )
    for field in fields:
        report.kv(
            "  " + field,
            present(baseline, field),
            present(candidate, field),
        )

    report.sub("unknown shapes (reported, not crashed on)")
    any_note = False
    for side in (baseline, candidate):
        if not side.available:
            continue
        notes = list(side.shape_notes)
        unknown_keys: Counter = Counter()
        for iface in side.interfaces:
            for key in set(iface) - KNOWN_INTERFACE_KEYS:
                unknown_keys[key] += 1
        if unknown_keys:
            notes.append(
                "unknown interface fields: "
                + ", ".join("`{}` x{}".format(k, n) for k, n in sorted(unknown_keys.items()))
            )
        bad_ids = sorted(i for i in side.ids() if not AUTHORED_ID.match(i))
        if bad_ids:
            notes.append("ids that are not `web/<kebab-slug>`: " + ", ".join(bad_ids[:MAX_EXAMPLES]))
        step_kinds = Counter()
        no_steps = 0
        for iface in side.interfaces:
            steps = iface.get("steps")
            if not isinstance(steps, list) or not steps:
                no_steps += 1
                continue
            for step in steps:
                step_kinds[str(step.get("kind")) if isinstance(step, dict) else "(not an object)"] += 1
        foreign = {k: v for k, v in step_kinds.items() if k not in WEB_STEP_KINDS}
        if foreign:
            notes.append(
                "step kinds outside the web union: "
                + ", ".join("`{}` x{}".format(k, n) for k, n in sorted(foreign.items()))
            )
        if no_steps:
            notes.append("{} entr(y/ies) carry no usable `steps`".format(no_steps))
        drift = fingerprint_drift(side)
        if drift:
            notes.append(
                "{} stored fingerprint(s) disagree with the recomputed value: {}".format(
                    len(drift), ", ".join(drift[:MAX_EXAMPLES])
                )
            )
        if notes:
            any_note = True
            report.line("  {}:".format(side.label))
            report.bullets(notes, limit=MAX_EXAMPLES * 2)
    if not any_note:
        report.line("  Both files parse as version-2 catalogs with no unrecognized shapes.")


def present(side: Side, field: str) -> str:
    if not side.available:
        return "n/a"
    n = sum(1 for i in side.interfaces if i.get(field) is not None)
    return "{:>3} / {:<3} {}".format(n, len(side.interfaces), pct(n, len(side.interfaces)))


def fingerprint_drift(side: Side) -> List[str]:
    out = []
    for iface in side.interfaces:
        stored = iface.get("fingerprint")
        if not isinstance(stored, str):
            continue
        recomputed = interface_fingerprint(iface)
        if recomputed and stored != recomputed:
            out.append(str(iface.get("id")))
    return sorted(out)


# ---------------------------------------------------------------------------
# Axis 1 — task coverage
# ---------------------------------------------------------------------------


def section_coverage(report: Report, baseline: Side, candidate: Side) -> None:
    report.head("AXIS 1 — TASK COVERAGE (one entry per invocable thing)")
    report.line("")
    report.line("  session.ts: \"One INTERFACE is ONE TASK a user can perform from one state")
    report.line("  … never a page inventory\". draft.ts rule 2: two entries with the same")
    report.line("  entry and the same steps are ONE task. Identity here is the recomputed")
    report.line("  fingerprint, so an id renamed between the two files still matches.")
    report.line("")
    report.kv("", baseline.label, candidate.label)
    report.kv("web tasks", na(baseline, len(baseline.interfaces)), na(candidate, len(candidate.interfaces)))

    b_fps = baseline.fingerprints() if baseline.available else {}
    c_fps = candidate.fingerprints() if candidate.available else {}
    b_keys = set(b_fps) - {"(unfingerprintable)"}
    c_keys = set(c_fps) - {"(unfingerprintable)"}
    report.kv("distinct task identities", na(baseline, len(b_keys)), na(candidate, len(c_keys)))
    report.kv(
        "unfingerprintable entries",
        na(baseline, len(b_fps.get("(unfingerprintable)", []))),
        na(candidate, len(c_fps.get("(unfingerprintable)", []))),
    )

    report.sub("duplicates within a file (rule 2 — one fingerprint, one task)")
    for side, fps in ((baseline, b_fps), (candidate, c_fps)):
        if not side.available:
            continue
        dupes = sorted(
            ("{} ← {}".format(fp[:14] + "…", ", ".join(sorted(str(i.get("id")) for i in group))))
            for fp, group in fps.items()
            if fp != "(unfingerprintable)" and len(group) > 1
        )
        dupe_ids = Counter(side.ids())
        repeated_ids = sorted(i for i, n in dupe_ids.items() if n > 1)
        report.line("  {}: {} duplicated identit(y/ies), {} repeated id(s)".format(side.label, len(dupes), len(repeated_ids)))
        report.bullets(dupes)
        if repeated_ids:
            report.bullets(["id `{}` appears {}x".format(i, dupe_ids[i]) for i in repeated_ids])

    if baseline.available and candidate.available:
        shared = b_keys & c_keys
        report.sub("overlap between the two files")
        report.kv("identical tasks (same fingerprint)", len(shared), width=44)
        report.kv("baseline-only tasks", len(b_keys - shared), width=44)
        report.kv("candidate-only tasks", len(c_keys - shared), width=44)
        report.kv(
            "recall of the baseline",
            "{} ({} of {})".format(pct(len(shared), len(b_keys)).strip(), len(shared), len(b_keys)),
            width=44,
        )
        same_id = set(baseline.ids()) & set(candidate.ids())
        report.kv("ids present on both sides", len(same_id), width=44)
        report.kv(
            "  … of which the task also matches",
            sum(
                1
                for i in sorted(same_id)
                if fp_of(baseline, i) is not None and fp_of(baseline, i) == fp_of(candidate, i)
            ),
            width=44,
        )
        renamed = sorted(
            "{} → {}".format(
                ", ".join(sorted(str(x.get("id")) for x in b_fps[fp])),
                ", ".join(sorted(str(x.get("id")) for x in c_fps[fp])),
            )
            for fp in shared
            if {str(x.get("id")) for x in b_fps[fp]} != {str(x.get("id")) for x in c_fps[fp]}
        )
        if renamed:
            report.line("")
            report.line("    same task, different id ({}):".format(len(renamed)))
            report.bullets(renamed)

        report.sub("baseline tasks with no candidate counterpart")
        report.bullets(
            sorted(
                "{}  [{}]  {}".format(
                    ", ".join(sorted(str(i.get("id")) for i in b_fps[fp])),
                    baseline.group_of(b_fps[fp][0]),
                    str(b_fps[fp][0].get("title", "")),
                )
                for fp in (b_keys - shared)
            ),
            limit=MAX_EXAMPLES * 3,
        )
        report.sub("candidate tasks with no baseline counterpart")
        report.bullets(
            sorted(
                "{}  [{}]  {}".format(
                    ", ".join(sorted(str(i.get("id")) for i in c_fps[fp])),
                    candidate.group_of(c_fps[fp][0]),
                    str(c_fps[fp][0].get("title", "")),
                )
                for fp in (c_keys - shared)
            ),
            limit=MAX_EXAMPLES * 3,
        )

    report.sub("per group")
    b_groups = Counter(baseline.group_of(i) for i in baseline.interfaces) if baseline.available else Counter()
    c_groups = Counter(candidate.group_of(i) for i in candidate.interfaces) if candidate.available else Counter()
    report.kv("", baseline.label, candidate.label, width=44)
    for group in sorted(set(b_groups) | set(c_groups)):
        report.kv(
            "  " + group,
            b_groups.get(group, 0) if baseline.available else "n/a",
            c_groups.get(group, 0) if candidate.available else "n/a",
            width=44,
        )

    report.sub("per normalized location (`at`, else first navigate, else entry.path)")
    b_loc = Counter(baseline.location(i) for i in baseline.interfaces) if baseline.available else Counter()
    c_loc = Counter(candidate.location(i) for i in candidate.interfaces) if candidate.available else Counter()
    report.kv("", baseline.label, candidate.label, width=44)
    for loc in sorted(set(b_loc) | set(c_loc)):
        report.kv(
            "  " + loc,
            b_loc.get(loc, 0) if baseline.available else "n/a",
            c_loc.get(loc, 0) if candidate.available else "n/a",
            width=44,
        )

    report.sub("entry addresses")
    b_paths = sorted({p for p in (baseline.entry_path(i) for i in baseline.interfaces) if p})
    c_paths = sorted({p for p in (candidate.entry_path(i) for i in candidate.interfaces) if p})
    report.kv("distinct entry.path values", na(baseline, len(b_paths)), na(candidate, len(c_paths)))
    if baseline.available and candidate.available:
        only_b = [p for p in b_paths if p not in set(c_paths)]
        only_c = [p for p in c_paths if p not in set(b_paths)]
        if only_b:
            report.line("    addresses only the baseline covers:")
            report.bullets(only_b)
        if only_c:
            report.line("    addresses only the candidate covers:")
            report.bullets(only_c)
        if not only_b and not only_c:
            report.line("    both files cover the same address set.")

    report.sub("page-inventory smell (session.ts: \"What is NOT a task\")")
    report.line("  A hit is a PROMPT to read the entry, never a verdict — a filter is a real")
    report.line("  task and matches too. Pagination, sorting and chrome are the refusals.")
    for side in (baseline, candidate):
        if not side.available:
            continue
        hits = sorted(
            "{}  {}".format(str(i.get("id")), str(i.get("title", "")))
            for i in side.interfaces
            if smells_like_chrome(i)
        )
        report.line("  {}: {} entr(y/ies) to eyeball".format(side.label, len(hits)))
        report.bullets(hits)

    report.sub("steps per task")
    for side in (baseline, candidate):
        if not side.available:
            continue
        counts = sorted(
            len(i["steps"]) for i in side.interfaces if isinstance(i.get("steps"), list)
        )
        if not counts:
            report.line("  {}: no entries with steps".format(side.label))
            continue
        report.line(
            "  {}: min {} · median {} · mean {:.1f} · max {} · single-step {}".format(
                side.label,
                counts[0],
                counts[len(counts) // 2],
                sum(counts) / len(counts),
                counts[-1],
                sum(1 for c in counts if c == 1),
            )
        )


def fp_of(side: Side, iface_id: str) -> Optional[str]:
    for iface in side.interfaces:
        if str(iface.get("id")) == iface_id:
            return interface_fingerprint(iface)
    return None


def smells_like_chrome(iface: Dict[str, Any]) -> bool:
    haystack = "{} {}".format(iface.get("id", ""), iface.get("title", "")).lower().replace("-", " ")
    return any(hint in haystack for hint in NON_TASK_HINTS)


# ---------------------------------------------------------------------------
# Axis 2 — locator grammar and role validity
# ---------------------------------------------------------------------------


def section_locators(report: Report, baseline: Side, candidate: Side) -> None:
    report.head("AXIS 2 — LOCATOR GRAMMAR AND ROLE VALIDITY")
    report.line("")
    report.line("  draft.ts rule 3: every `activate`/`input` target is `<role> \"<accessible")
    report.line("  name>\"` over a role `GUARD_WEB_ROLES` knows. A selector is refused by the")
    report.line("  write path, so a violation here means the file predates the rule or was")
    report.line("  hand-edited past it.")
    report.line("")

    stats = {}
    for side in (baseline, candidate):
        if not side.available:
            continue
        stats[side.label] = locator_stats(side)

    report.kv("", baseline.label, candidate.label)
    report.kv("targeted steps (activate + input)", stat(stats, baseline, "targets"), stat(stats, candidate, "targets"))
    report.kv("  conforming to the grammar", stat(stats, baseline, "conforming"), stat(stats, candidate, "conforming"))
    report.kv("  malformed (not `role \"name\"`)", stat(stats, baseline, "malformed"), stat(stats, candidate, "malformed"))
    report.kv("  selector-shaped", stat(stats, baseline, "selectorish"), stat(stats, candidate, "selectorish"))
    report.kv("  unknown ARIA role", stat(stats, baseline, "unknown_role"), stat(stats, candidate, "unknown_role"))
    report.kv("navigate steps", stat(stats, baseline, "navigates"), stat(stats, candidate, "navigates"))
    report.kv("  route ≠ entry.path on step 1", stat(stats, baseline, "route_mismatch"), stat(stats, candidate, "route_mismatch"))
    report.kv("distinct roles used", stat(stats, baseline, "distinct_roles"), stat(stats, candidate, "distinct_roles"))
    report.kv("distinct accessible names", stat(stats, baseline, "distinct_names"), stat(stats, candidate, "distinct_names"))

    report.sub("role histogram")
    b_roles = stats.get(baseline.label, {}).get("roles", Counter())
    c_roles = stats.get(candidate.label, {}).get("roles", Counter())
    report.kv("", baseline.label, candidate.label)
    for role in sorted(set(b_roles) | set(c_roles)):
        report.kv(
            "  " + role,
            b_roles.get(role, 0) if baseline.available else "n/a",
            c_roles.get(role, 0) if candidate.available else "n/a",
        )

    for side in (baseline, candidate):
        if not side.available:
            continue
        problems = stats[side.label]["problems"]
        report.sub("{}: grammar problems ({})".format(side.label, len(problems)))
        if problems:
            report.bullets(sorted(problems), limit=MAX_EXAMPLES * 2)
        else:
            report.line("    none — every target is `<role> \"<name>\"` over a known role.")


def stat(stats: Dict[str, Dict[str, Any]], side: Side, key: str) -> Any:
    if not side.available:
        return "n/a"
    return stats.get(side.label, {}).get(key, 0)


def locator_stats(side: Side) -> Dict[str, Any]:
    roles: Counter = Counter()
    names: set = set()
    out = {
        "targets": 0,
        "conforming": 0,
        "malformed": 0,
        "selectorish": 0,
        "unknown_role": 0,
        "navigates": 0,
        "route_mismatch": 0,
        "problems": [],
    }
    for iface in side.interfaces:
        steps = iface.get("steps")
        if not isinstance(steps, list):
            continue
        entry_path = side.entry_path(iface)
        for index, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            kind = step.get("kind")
            if kind == "navigate":
                out["navigates"] += 1
                route = step.get("route")
                if index == 0 and isinstance(route, str) and entry_path and route != entry_path:
                    out["route_mismatch"] += 1
                    out["problems"].append(
                        "{} step 1 navigates to `{}` but entry.path is `{}` (draft.ts rule 4)".format(
                            iface.get("id"), route, entry_path
                        )
                    )
                continue
            if kind not in ("activate", "input"):
                continue
            target = step.get("target")
            out["targets"] += 1
            if not isinstance(target, str):
                out["malformed"] += 1
                out["problems"].append(
                    "{} step {}: target is {}, not a string".format(
                        iface.get("id"), index + 1, type(target).__name__
                    )
                )
                continue
            match = TARGET_GRAMMAR.match(target)
            if not match:
                out["malformed"] += 1
                if any(shape in target for shape in SELECTOR_SHAPES):
                    out["selectorish"] += 1
                out["problems"].append(
                    "{} step {}: `{}` is not `<role> \"<accessible name>\"`".format(
                        iface.get("id"), index + 1, target
                    )
                )
                continue
            role, name = match.group(1), match.group(2)
            roles[role] += 1
            names.add(name)
            if role not in GUARD_WEB_ROLES:
                out["unknown_role"] += 1
                out["problems"].append(
                    "{} step {}: `{}` is not an ARIA role GUARD_WEB_ROLES knows".format(
                        iface.get("id"), index + 1, role
                    )
                )
            else:
                out["conforming"] += 1
    out["roles"] = roles
    out["distinct_roles"] = len(roles)
    out["distinct_names"] = len(names)
    return out


# ---------------------------------------------------------------------------
# Axis 3 — the state registry: count, reuse, and whether it is a vocabulary
# ---------------------------------------------------------------------------


def section_states(report: Report, baseline: Side, candidate: Side) -> None:
    report.head("AXIS 3 — STATE REGISTRY (count and reuse)")
    report.line("")
    report.line("  session.ts: \"Reuse an id above whenever it names the world your task")
    report.line("  assumes or leaves.\" reconcile.ts exists because sessions that cannot see")
    report.line("  each other mint synonyms — so the number that matters is not the registry")
    report.line("  size but how many tasks each id serves. A registry the size of the task")
    report.line("  list is a per-task sentence, not a vocabulary.")
    report.line("")

    b = state_stats(baseline) if baseline.available else {}
    c = state_stats(candidate) if candidate.available else {}
    report.kv("", baseline.label, candidate.label)
    report.kv("states defined (states.web[])", b.get("defined", "n/a"), c.get("defined", "n/a"))
    report.kv("distinct ids referenced", b.get("referenced", "n/a"), c.get("referenced", "n/a"))
    report.kv("total references (start + end)", b.get("refs", "n/a"), c.get("refs", "n/a"))
    report.kv("REUSE RATIO (refs / distinct id)", b.get("reuse", "n/a"), c.get("reuse", "n/a"))
    report.kv("states per task (defined / tasks)", b.get("per_task", "n/a"), c.get("per_task", "n/a"))
    report.kv("tasks with startingState", b.get("with_start", "n/a"), c.get("with_start", "n/a"))
    report.kv("tasks with endState", b.get("with_end", "n/a"), c.get("with_end", "n/a"))
    report.kv("tasks with both", b.get("with_both", "n/a"), c.get("with_both", "n/a"))
    report.kv("tasks with neither", b.get("with_neither", "n/a"), c.get("with_neither", "n/a"))
    report.kv("ids used exactly once", b.get("singletons", "n/a"), c.get("singletons", "n/a"))
    report.kv("defined but never referenced", b.get("orphans_n", "n/a"), c.get("orphans_n", "n/a"))
    report.kv("referenced but never defined", b.get("dangling_n", "n/a"), c.get("dangling_n", "n/a"))
    report.kv("chaining pairs (end → start)", b.get("chains", "n/a"), c.get("chains", "n/a"))
    report.kv("ids that are not kebab-case", b.get("bad_ids_n", "n/a"), c.get("bad_ids_n", "n/a"))

    for side, stats in ((baseline, b), (candidate, c)):
        if not side.available:
            continue
        report.sub("{}: registry health".format(side.label))
        if stats["dangling"]:
            report.line("    referenced but never defined (the merged catalog would refuse these):")
            report.bullets(stats["dangling"])
        if stats["orphans"]:
            report.line("    defined but never referenced:")
            report.bullets(stats["orphans"])
        if stats["bad_ids"]:
            report.line("    not kebab-case:")
            report.bullets(stats["bad_ids"])
        families = stats["families"]
        if families:
            report.line("    synonym families — same stem, different suffix (what `interfaces")
            report.line("    reconcile` collapses; a large count here means run it):")
            report.bullets(families, limit=MAX_EXAMPLES * 2)
        if not (stats["dangling"] or stats["orphans"] or stats["bad_ids"] or families):
            report.line("    every id is defined once, referenced, kebab-case, and unfamilied.")

    if baseline.available and candidate.available:
        b_ids = {str(s.get("id")) for s in baseline.states}
        c_ids = {str(s.get("id")) for s in candidate.states}
        report.sub("registry overlap")
        report.kv("ids in both registries", len(b_ids & c_ids), width=44)
        report.kv("baseline-only ids", len(b_ids - c_ids), width=44)
        report.kv("candidate-only ids", len(c_ids - b_ids), width=44)
        redefined = sorted(
            "{}\n        baseline : {}\n        candidate: {}".format(
                sid, describe(baseline.states, sid), describe(candidate.states, sid)
            )
            for sid in sorted(b_ids & c_ids)
            if describe(baseline.states, sid) != describe(candidate.states, sid)
        )
        if redefined:
            report.line("")
            report.line("    same id, different description ({}):".format(len(redefined)))
            report.bullets(redefined)


def describe(states: List[Dict[str, Any]], state_id: str) -> str:
    for state in states:
        if str(state.get("id")) == state_id:
            return str(state.get("description", ""))
    return "(undefined)"


def state_stats(side: Side) -> Dict[str, Any]:
    defined = [str(s.get("id")) for s in side.states]
    uses: Counter = Counter()
    with_start = with_end = with_both = with_neither = 0
    ends: Counter = Counter()
    starts: Counter = Counter()
    for iface in side.interfaces:
        start = iface.get("startingState")
        end = iface.get("endState")
        if isinstance(start, str) and start:
            uses[start] += 1
            starts[start] += 1
        if isinstance(end, str) and end:
            uses[end] += 1
            ends[end] += 1
        has_start = isinstance(start, str) and bool(start)
        has_end = isinstance(end, str) and bool(end)
        with_start += 1 if has_start else 0
        with_end += 1 if has_end else 0
        with_both += 1 if has_start and has_end else 0
        with_neither += 1 if not has_start and not has_end else 0

    referenced = set(uses)
    defined_set = set(defined)
    total_refs = sum(uses.values())
    return {
        "defined": len(defined),
        "referenced": len(referenced),
        "refs": total_refs,
        "reuse": ratio(total_refs, len(referenced)),
        "per_task": ratio(len(defined), len(side.interfaces)),
        "with_start": "{} {}".format(with_start, pct(with_start, len(side.interfaces))),
        "with_end": "{} {}".format(with_end, pct(with_end, len(side.interfaces))),
        "with_both": with_both,
        "with_neither": with_neither,
        "singletons": sum(1 for _, n in uses.items() if n == 1),
        "orphans": sorted(defined_set - referenced),
        "orphans_n": len(defined_set - referenced),
        "dangling": sorted(referenced - defined_set),
        "dangling_n": len(referenced - defined_set),
        "chains": sum(min(ends[sid], starts[sid]) for sid in set(ends) & set(starts)),
        # Defined AND referenced: a task may point at an id no registry defines,
        # and a sentence that slipped into `startingState` is exactly the failure
        # `InterfaceStateIdSchema` exists to catch.
        "bad_ids": sorted(i for i in (defined_set | referenced) if not KEBAB_ID.match(i)),
        "bad_ids_n": sum(1 for i in (defined_set | referenced) if not KEBAB_ID.match(i)),
        "families": synonym_families(sorted(defined_set | referenced)),
    }


# Suffixes reconcile.ts names as the observed synonym families on a whole-app run
# ("41 `-updated`, 20 `-created` and 17 `-exists` families").
FAMILY_SUFFIXES = (
    "created",
    "updated",
    "exists",
    "saved",
    "deleted",
    "removed",
    "added",
    "open",
    "opened",
    "closed",
    "visible",
    "shown",
    "set",
    "enabled",
    "disabled",
    "selected",
    "loaded",
    "present",
    "listed",
)


def synonym_families(ids: List[str]) -> List[str]:
    """Ids sharing a stem but differing only in a terminal state-verb — the shape
    `interfaces reconcile` collapses. Heuristic and advisory: it never rewrites."""
    stems: Dict[str, List[str]] = defaultdict(list)
    for state_id in ids:
        parts = state_id.split("-")
        if len(parts) >= 2 and parts[-1] in FAMILY_SUFFIXES:
            stems["-".join(parts[:-1])].append(state_id)
    return [
        "{}-*  →  {}".format(stem, ", ".join(sorted(members)))
        for stem, members in sorted(stems.items())
        if len(members) > 1
    ]


# ---------------------------------------------------------------------------
# Axis 4 — apiEffects, as a tri-state
# ---------------------------------------------------------------------------


def section_api_effects(report: Report, baseline: Side, candidate: Side) -> None:
    report.head("AXIS 4 — apiEffects TRI-STATE")
    report.line("")
    report.line("  session.ts: \"`[]` means the task reaches no server at all, which is a")
    report.line("  stronger claim than omitting.\" interfaces.ts: OMITTED = the extraction")
    report.line("  established nothing; `[]` = it established NONE. The three states are")
    report.line("  therefore counted apart — a loop that never writes `[]` is not making the")
    report.line("  stronger claim, and one that never omits is guessing.")
    report.line("")
    b = effect_stats(baseline) if baseline.available else {}
    c = effect_stats(candidate) if candidate.available else {}
    report.kv("", baseline.label, candidate.label)
    report.kv("OMITTED (established nothing)", b.get("omitted", "n/a"), c.get("omitted", "n/a"))
    report.kv("EMPTY `[]` (reaches no server)", b.get("empty", "n/a"), c.get("empty", "n/a"))
    report.kv("NON-EMPTY (named api ids)", b.get("filled", "n/a"), c.get("filled", "n/a"))
    report.kv("malformed (not a list of strings)", b.get("malformed", "n/a"), c.get("malformed", "n/a"))
    report.kv("distinct api ids referenced", b.get("distinct", "n/a"), c.get("distinct", "n/a"))
    report.kv("total id references", b.get("total", "n/a"), c.get("total", "n/a"))
    report.kv("effects per filled task", b.get("per_task", "n/a"), c.get("per_task", "n/a"))
    report.kv("ids not shaped `<surface>/<slug>`", b.get("odd_shape", "n/a"), c.get("odd_shape", "n/a"))

    if baseline.available and candidate.available:
        b_ids = set(b["ids"])
        c_ids = set(c["ids"])
        report.sub("api id overlap")
        report.kv("ids in both", len(b_ids & c_ids), width=44)
        report.kv("baseline-only ids", len(b_ids - c_ids), width=44)
        report.kv("candidate-only ids", len(c_ids - b_ids), width=44)
        if b_ids - c_ids:
            report.line("    baseline-only:")
            report.bullets(sorted(b_ids - c_ids))
        if c_ids - b_ids:
            report.line("    candidate-only (each one should be an id the api catalog defines):")
            report.bullets(sorted(c_ids - b_ids))

    for side, stats in ((baseline, b), (candidate, c)):
        if not side.available:
            continue
        if stats["odd_ids"]:
            report.sub("{}: api ids of an unexpected shape".format(side.label))
            report.bullets(sorted(stats["odd_ids"]))


API_ID_SHAPE = re.compile(r"^[a-z]+/[^\s]+$")


def effect_stats(side: Side) -> Dict[str, Any]:
    omitted = empty = filled = malformed = 0
    ids: Counter = Counter()
    odd: set = set()
    for iface in side.interfaces:
        if "apiEffects" not in iface or iface.get("apiEffects") is None:
            omitted += 1
            continue
        value = iface["apiEffects"]
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
            malformed += 1
            continue
        if not value:
            empty += 1
            continue
        filled += 1
        for effect in value:
            ids[effect] += 1
            if not API_ID_SHAPE.match(effect):
                odd.add(effect)
    total_tasks = len(side.interfaces)
    return {
        "omitted": "{} {}".format(omitted, pct(omitted, total_tasks)),
        "empty": "{} {}".format(empty, pct(empty, total_tasks)),
        "filled": "{} {}".format(filled, pct(filled, total_tasks)),
        "malformed": malformed,
        "distinct": len(ids),
        "total": sum(ids.values()),
        "per_task": ratio(sum(ids.values()), filled),
        "ids": sorted(ids),
        "odd_ids": odd,
        "odd_shape": len(odd),
    }


# ---------------------------------------------------------------------------
# The headline table
# ---------------------------------------------------------------------------


def section_summary(report: Report, baseline: Side, candidate: Side) -> None:
    report.head("SUMMARY")
    report.line("")
    b_stats = state_stats(baseline) if baseline.available else {}
    c_stats = state_stats(candidate) if candidate.available else {}
    b_loc = locator_stats(baseline) if baseline.available else {}
    c_loc = locator_stats(candidate) if candidate.available else {}
    b_api = effect_stats(baseline) if baseline.available else {}
    c_api = effect_stats(candidate) if candidate.available else {}

    report.kv("", baseline.label, candidate.label)
    report.kv("web tasks", na(baseline, len(baseline.interfaces)), na(candidate, len(candidate.interfaces)))
    report.kv("groups", na(baseline, len({baseline.group_of(i) for i in baseline.interfaces})),
              na(candidate, len({candidate.group_of(i) for i in candidate.interfaces})))
    report.kv("states defined", b_stats.get("defined", "n/a"), c_stats.get("defined", "n/a"))
    report.kv("state reuse ratio", b_stats.get("reuse", "n/a"), c_stats.get("reuse", "n/a"))
    report.kv("locator violations", locator_violations(b_loc), locator_violations(c_loc))
    report.kv("apiEffects omitted / [] / filled",
              tri(b_api), tri(c_api))
    if baseline.available and candidate.available:
        b_keys = set(baseline.fingerprints()) - {"(unfingerprintable)"}
        c_keys = set(candidate.fingerprints()) - {"(unfingerprintable)"}
        shared = b_keys & c_keys
        report.line("")
        report.kv("baseline tasks matched", "{} of {}  {}".format(len(shared), len(b_keys), pct(len(shared), len(b_keys))), width=44)
        report.kv("candidate tasks not in baseline", len(c_keys - shared), width=44)
    report.line("")
    report.line("  This report ranks nothing and gates nothing. Read the axis sections for")
    report.line("  what moved, and the doctrine in `packages/interface-author/src/` for what")
    report.line("  each number is supposed to mean.")


def locator_violations(stats: Dict[str, Any]) -> Any:
    if not stats:
        return "n/a"
    return stats.get("malformed", 0) + stats.get("unknown_role", 0) + stats.get("route_mismatch", 0)


def tri(stats: Dict[str, Any]) -> str:
    if not stats:
        return "n/a"
    return "{} / {} / {}".format(
        stats["omitted"].split()[0], stats["empty"].split()[0], stats["filled"].split()[0]
    )


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def build_report(baseline: Side, candidate: Side) -> str:
    report = Report()
    report.line("TrueCourse — authored web-interface catalog comparison")
    report.line("Rubric: packages/interface-author/src/{session,draft}.ts + packages/shared/src/interfaces.ts")
    section_inputs(report, baseline, candidate)
    section_shape(report, baseline, candidate)
    section_coverage(report, baseline, candidate)
    section_locators(report, baseline, candidate)
    section_states(report, baseline, candidate)
    section_api_effects(report, baseline, candidate)
    section_summary(report, baseline, candidate)
    return report.render()


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="compare.py",
        description=(
            "Diff an authoring-loop web-interface catalog against the hand-authored "
            "baseline, on the axes the authoring doctrine states. Prints a report; "
            "always exits 0."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Both arguments are `interfaces.authored.json` files. The defaults are the\n"
            "pilot layout: the baseline under the pilot backup, the candidate at the\n"
            "app repo's own `.truecourse/guard/interfaces.authored.json`."
        ),
    )
    parser.add_argument(
        "--baseline",
        default=DEFAULT_BASELINE,
        help="hand-authored catalog (default: %(default)s)",
    )
    parser.add_argument(
        "--candidate",
        default=DEFAULT_CANDIDATE,
        help="catalog the authoring loop wrote (default: %(default)s)",
    )
    args = parser.parse_args(argv)

    baseline = Side("baseline", args.baseline)
    candidate = Side("candidate", args.candidate)
    baseline.load()
    candidate.load()

    sys.stdout.write(build_report(baseline, candidate))

    # Errors also go to stderr, because the exit code deliberately never carries
    # them: this is a report, not a gate, and a CI-shaped reader needs SOMEWHERE
    # to see that a side never loaded.
    for side in (baseline, candidate):
        if not side.available:
            sys.stderr.write(
                "compare.py: {} `{}` {} — that side is reported as n/a\n".format(
                    side.label, side.path, side.load_error
                )
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
