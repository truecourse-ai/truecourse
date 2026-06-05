"""Architecture FP-guard: description-only contract.

The contract `arch.fp-guard.description-only` contains only a `decision "..."`
prose field — no `category` or `chosen` keywords. The lifter defaults both to
`'data-store'` and `''` respectively. The comparator must NOT fire any drift for
a contract that makes no structured choice.

# FP-GUARD: architecture-decision/data-store-unmet-choice — must NOT drift
"""
