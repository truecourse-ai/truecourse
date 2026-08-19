---
finding: C12
target: calcom/cal.diy
route: skip: fixed (main only, no tag)
title: Note only, not an issue. The attendeePhoneNumber prefill is fixed on main by PR #29740 and is in no release.
labels: none
status: draft
reverified: pending live re-run (source re-checked 2026-08-19: fix present on main at 176037d0af as 5e3fe3cbe6; `git tag --contains 5e3fe3cbe6` is empty and the newest tag, v6.2.0, predates it by five months)
---

# C12: no issue filed

Not filed. The defect (the documented `attendeePhoneNumber=` prefill never reaching the Phone number question) is fixed on `main` by PR #29740, merged 2026-08-05 as `5e3fe3cbe60e529b7f0d9d18065fd094c4d2152a`, five days after the commit we tested. The one-line change replaces `country={value ? undefined : defaultCountry}` with `country={defaultCountry}` at `apps/web/components/phone-input/PhoneInput.tsx:123`, which is exactly the prop flip our root cause identified.

Fixed does not mean shipped: `git tag --contains 5e3fe3cbe6` is empty and the newest cal.diy tag is `v6.2.0` from 2026-03-01, so every tagged release still carries the bug and self-hosters on a tag are unaffected by the fix. Nothing about the hosted Cal.com product is verifiable from source.

## Comment to drop if the maintainers are engaged

Use only if a filer is already in conversation with the maintainers on the sibling issue C11 (the phone control's missing accessible name). Paste as a comment, not as a new issue:

> While testing the documented `attendeePhoneNumber=` prefill on a build from source at `038381aeca`, we reproduced the bug reported in #29739: the prefilled number is dropped and the field falls back to `+1`. PR #29740 fixes it on `main` (the stable `country` fallback at `PhoneInput.tsx:123`), and we confirmed the fixed prop shape makes the full `+919999999999` land, so nothing more is needed there. Worth flagging that the fix is on `main` only: `git tag --contains 5e3fe3cbe6` is empty and the newest tag, `v6.2.0` (2026-03-01), predates it, so anyone self-hosting a release still hits it. Two related notes. First, our evidence widens #29739 slightly: the drop is not limited to bare calling codes like `%2B371`, a full international number is discarded on the same update path, because the country branch of `componentDidUpdate` runs instead of the value branch regardless of the value's length. Second, and separately, the same booking form step is still red on `main` for an unrelated reason: the phone control has no accessible name, which #29740 did not touch. That half is filed separately, so a re-run that comes back red should not be read as "#29740 did not work". The clean way to check the prefill half in isolation is to read the value of `input[name="attendeePhoneNumber"]` rather than to locate the field by role and name.
