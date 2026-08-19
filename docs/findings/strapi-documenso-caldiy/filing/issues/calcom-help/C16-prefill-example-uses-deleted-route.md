---
finding: C16
target: calcom/help
route: docs repo issue
title: "bookings/prefill-fields: the worked example URL uses the /{user}/book route, which was removed in 2023"
labels: none (calcom/help has no issue templates and no labels in use)
status: draft
reverified: yes, doc side. Re-checked 2026-08-19: calcom/help main ba04d67b4121ef41fab83a865f6c430ac6792b34 still has the URL at bookings/prefill-fields.mdx line 20, and an unauthenticated GET of https://cal.com/help/bookings/prefill-fields returned HTTP 200 with the same URL in the body.
---

# bookings/prefill-fields: the worked example URL uses the /{user}/book route, which was removed in 2023

Note before the report: calcom/help has no issue template, no CONTRIBUTING and no PR template, so this is a plain issue. Given that the repository's recent history is almost entirely PRs from Mintlify's bot and from Cal.com staff, a one-line PR against `bookings/prefill-fields.mdx` is probably the faster path than this issue, and either is fine by us.

Also worth stating plainly: this page documents the commercial Cal.com product, which we cannot test. Our reproduction is on Cal.diy built from source from the public repository. What makes the report solid anyway is that the route removal happened in the shared codebase in 2023, three years before the repository was renamed, so the page is describing a shape that no build of either product has served since then. A fix that is right only for Cal.diy would not automatically be right for this page, so please confirm the replacement URL against the hosted product before merging.

## What is wrong

https://cal.com/help/bookings/prefill-fields , in the opening section, prints:

> An example URL with a few prefill fields is given below:
> `https://cal.com/johndoe/book?type=12345&duration=30&email=johndoe%40example.com&notes=Test+Notes`
> You can integrate the prefill-fields with your booking page URL in a similar way.

Source: `bookings/prefill-fields.mdx`, line 20 on `main` (`ba04d67b4121ef41fab83a865f6c430ac6792b34`, blob `806eddaef7`, 130 lines).

The `/{user}/book` route no longer exists. Following that address gives a 404 page, not a prefilled booking form. The mechanism the article teaches is fine; only its address is dead.

## What the product does

`/{user}/book` is resolved by the `[user]/[type]` route with `type = "book"`, matches no event type, and returns `notFound`. In `apps/web/server/lib/[user]/[type]/getServerSideProps.ts`, `getUserPageProps` parses the params at line 214, finds the user at line 233, calls `getPublicEvent` with `eventSlug: "book"` at lines 245-253, and returns `{ notFound: true }` at lines 255-259. There is no `[user]/book` page and no rewrite or redirect for one (the `?!book` comments left in `apps/web/pagesAndRewritePaths.ts:62-64` are dead leftovers of the old booker).

Permalink at the commit we tested: https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/web/server/lib/%5Buser%5D/%5Btype%5D/getServerSideProps.ts#L212-L259
Same lines on `main` today: https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/web/server/lib/%5Buser%5D/%5Btype%5D/getServerSideProps.ts#L212-L259

The 404 is deliberate. The route was retired on purpose by PR calcom/cal.diy#10053 (merged 2023-07-11), which deleted `apps/web/pages/[user]/book.tsx`, `apps/web/pages/team/[slug]/book.tsx` and `apps/web/pages/d/[link]/book.tsx`. Its tracking issue, calcom/cal.diy#6612 (closed completed 2023-05-17), states the intent and the replacement shape verbatim:

> right now events fail if you call your event-type: "book" because https://cal.com/peer/book?type=50756&... is being used. we should not use a new route and instead just use parameters: before: https://cal.com/peer/book?type=50756&... after: https://cal.com/peer/30min?type=50756&...

That deleting commit is an ancestor of both the tested tree and today's public `main`, so this is not a fork difference.

## Suggested replacement

Swapping `book` for a slug is not enough. `type=12345` and `duration=30` were the **old** booker's event-type id and duration parameters; they do nothing on the current booker. The example should read:

```
https://cal.com/johndoe/30min?email=johndoe%40example.com&notes=Test+Notes
```

The sibling page `legacy/pages/developer/pre-fill.mdx` in calcom/docs already uses this modern shape (`cal.com/rick/quick-chat/?email=attendee@example.com&name=John`), so the two pages currently disagree with each other.

The identical stale URL is also in the calcom/docs mirror, `pages/core-features/bookings/prefill-fields.mdoc` line 19 (single commit `e25efd96a1`, 2024-02-15). That repository's README declares itself obsolete, so it may not be worth editing, but both copies carry the error.

Worth flagging one hazard that issue #6612 itself raised: because `book` is now an ordinary event-type slug, a host who happens to own an event type slugged `book` turns the stale URL into a plausible **wrong page** with the prefill applied, rather than an honest 404.

## Evidence

Reproduced on Cal.diy built from source at commit `038381aeca6261635357957d66b8ba85cdb29737`, `@calcom/web` 6.2.0, served with `yarn workspace @calcom/web start`, in headless Chromium. We opened the article's own URL shape, changing only the username to the seeded host:

```
/reference-host/book?type=12345&duration=30&email=johndoe%40example.com&notes=Test+Notes
```

Result: HTTP 404. Browser console: `Failed to load resource: the server responded with a status of 404 (Not Found)`. Page text captured from the rendered page:

```
ERROR 404

This page does not exist.
Check for spelling mistakes or go back to the previous page.
POPULAR PAGES
Documentation
Learn how to integrate our tools with your app
Blog
Read our latest news and articles
Or go back home
```

The screenshot shows that 404 page fully painted (headline, Documentation and Blog cards, "Or go back home"), so this is not a rendering race. In the same run, the same prefill parameters **do** work on the `/{user}/{type}` shape: `/reference-host/prefill-all-fields?...&email=johndoe%40example.com` rendered the booking form with the Email address field holding `johndoe@example.com`. So the article's mechanism is correct and only its address is stale.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check. for the product-side 404 on a freshly built instance; the routing code that produces it is byte-identical to the tested tree at today's `main`, and `git ls-tree -r` at `main` finds no `[user]/book` path.

Doc side re-checked on 2026-08-19: `bookings/prefill-fields.mdx` line 20 on `main` still carries the URL, `gh api repos/calcom/help/commits?path=bookings/prefill-fields.mdx` shows the path untouched since 2025-11-17, and an unauthenticated GET of the published page returned HTTP 200 with the same URL in the body. Screenshots and the full transcript are available on request.

## Related

- calcom/cal.diy#6612 (closed 2023-05-17): the decision to remove the route, with the replacement shape.
- calcom/cal.diy#10053 (merged 2023-07-11): the change that removed it. It touched no documentation.
- calcom/cal.diy#6529 and #2010: contemporary reports about the same route, from when it still existed.
- calcom/help#48 (merged 2025-11-17): the most recent edit to this article. It appended a new location section and left this example untouched, so the page was reviewed twenty months after the route was gone and the error survived.
- Searches across calcom for "prefill" and "prefill-fields" turned up no proposal to correct this.

Found by TrueCourse running the help centre's own documented URLs against a live instance; the full transcript (page text, console, screenshots) is available on request.
