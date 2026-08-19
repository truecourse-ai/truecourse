# GitHub Support request (ready to send)

Send from the account that owns `truecourse-ai/truecourse`, at https://support.github.com/contact
Category: Account or repository, then "something else". Paste the body below.

Two asks in one ticket: purge unreachable commit objects, and remove two cross-reference events they created on a third-party issue.

---

**Subject:** Purge unreachable commits after force-push, and remove two cross-reference events they created

Hello,

Two related requests, both caused by commits that were force-pushed away but remain accessible.

**1. Please garbage-collect unreachable objects in `truecourse-ai/truecourse`.**

The following commits are not reachable from any branch or tag (they were removed by force-push), but they are still served by SHA, for example https://github.com/truecourse-ai/truecourse/commit/2ff540c80fc93a60322982dd4c1842758adc55c1 :

```
fa971126509ec1b515b4cd39c0211dc26d9c1140
dacaa34a42cccc7d64ee02baa6638aa4b13814e2
2ff540c80fc93a60322982dd4c1842758adc55c1
792d64484a11f2ff8d99b6a4111d49acf783563d
51d59c6d51eb36461c5849a1a0261e6c2592c9ca
697ee448120a9412131c42624aa5aa3d9bd43c5f
```

They were committed under the wrong author identity and carry incorrect metadata in their messages. The corrected history is on the branch `sm/findings-filing-package`, and the repository has no forks. Please remove the unreachable objects so those URLs stop resolving.

**2. Please remove two cross-reference events on `strapi/strapi` issue 27418.**

Two of the commits above referenced that issue in their commit messages, so pushing them created `referenced` timeline events on it, attributed to the pushing account rather than to the commit author:

- 2026-08-19T20:22:30Z, commit `2ff540c80fc93a60322982dd4c1842758adc55c1`
- 2026-08-19T20:25:58Z, commit `697ee448120a9412131c42624aa5aa3d9bd43c5f`

The issue belongs to another organisation, and the events point at commits that no longer exist in our history, so they are noise on someone else's tracker. Please remove both timeline entries. I cannot do this myself: timeline events of this type have no delete endpoint, and force-pushing does not retract them.

Thank you.

---

## Context for whoever sends this

- Cause: commit messages contained `strapi/strapi#27418`. GitHub turns that into a `referenced` event on push and credits the pusher, not the author. Rewriting authorship afterwards does not affect it.
- Why nothing local fixes it: a commit SHA is the hash of its content, so editing a message produces a new commit and leaves the old object intact. Every rewrite in this episode created a new SHA while the originals stayed reachable by URL.
- Interim option if you want the URLs dark immediately: making the repository private causes them to 404 for anyone without access, and it is reversible.
- Nothing sensitive is exposed. The content is documentation; what is wrong is the author line and a tool-attribution trailer.
- Prevention is in `FILING-GUIDE.md`: never put issue-linking syntax in a commit message, and pass the filing identity per commit.
