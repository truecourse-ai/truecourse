# R8 — the exclusion doc lists five kinds; the code evaluates seven, and the undocumented ones silently block

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:39 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`, backend `127.0.0.1:14701` |
| raw | `r8.log`, `r8.json`, `r8.stdout` |

## VERDICT: **still reproduces** — both halves, and the doc still omits TWO kinds, not one.

---

## The doc

`docs/content/docs/(docs)/filter-traffic.mdx:120-130`:

> ## How Filters Are Evaluated
>
> Rybbit checks exclusions in this order:
>
> 1. IP address
> 2. Country
> 3. Path
> 4. Hostname
> 5. User agent
>
> If any filter matches, the event is accepted with a `200` response but is not tracked.

`grep -i "query param"` and `grep -i "\bASN\b"` over both `filter-traffic.mdx` and
`site-settings.mdx` return **nothing** at this SHA.

## The code, re-read at `64f8c4fb`

`server/src/services/sites/siteExclusionDecision.ts` names seven kinds in one type and
evaluates all seven:

```ts
export type SiteExclusionReason = "ip" | "asn" | "country" | "path" | "query_param" | "hostname" | "user_agent";
```

```
168:    return excluded("ip", "IP", matchedIp);
180:        return excluded("asn", "ASN", `AS${asnInfo.asn}`);
193:      return excluded("country", "country", countryIso);
200:    return excluded("path", "path", pathname);
206:      return excluded("query_param", "query param", matchedParam);
211:    return excluded("hostname", "hostname", hostname);
222:      return excluded("user_agent", "user agent", userAgent);
```

The correct seven-item list already exists in-repo, one line of the same file.

---

## PROBE — an undocumented kind (query param) silently blocks

```
site 36
declare a QUERY PARAM exclusion
    PUT /api/sites/36/config    -> 200 {"success":true,"message":"Site configuration updated successfully",…}
read it back
    GET /api/sites/36/excluded-query-params -> 200 {"success":true,"excludedQueryParams":["preview"]}

PROBE   POST /api/track  (querystring "?preview=1")
    -> 200 {"success":true,"message":"Event not tracked - query param excluded"}
```

## CONTROL — a query string that does not match is tracked

```
CONTROL POST /api/track  (querystring "?utm_source=x")
    -> 200 {"success":true}
```

Same site, same path `/offer`, same second, one query string apart. The exclusion behaves
exactly as the doc's *closing sentence* promises (200, untracked) for a kind the doc's own
numbered list does not name.

## Change from the hand-verification

None.
