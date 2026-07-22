# yamllint — not analyzable (documentation format unsupported)

**Target:** [adrienverge/yamllint](https://github.com/adrienverge/yamllint), cloned 2026-07-17
**Method:** TrueCourse guard (v0.7.3-next.8) — spec scan → scenario generation → run.

## Result

No findings — and no claim of a clean bill of health. yamllint's documentation
(`docs/*.rst`, `README.rst`) is entirely reStructuredText, and the current spec
scanner reads markdown only, so the documentation corpus came back empty and no
test scenarios could be generated. The rule specifications in `docs/rules.rst`
were never analyzed.

This is a limitation of the analysis tool, not a statement about yamllint's
documentation accuracy. Tracked upstream in the tool as truecourse-ai/truecourse
issues #806 (rst support) and #807 (empty-corpus reporting).
