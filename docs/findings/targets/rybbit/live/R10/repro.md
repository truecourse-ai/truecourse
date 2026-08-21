# R10 — a lowercase country code is refused with a 400 rather than normalised

| | |
|---|---|
| date | 2026-08-20 (probe wall clock 2026-08-21 02:39 UTC) |
| build | master `64f8c4fb7f394bdfe9379717de8e6c21758b1ac2` |
| stack | compose project `tc-rybbit`, backend `127.0.0.1:14701` |
| raw | `r10.log`, `r10.json`, `r10.stdout` |

## VERDICT: **still reproduces** — both halves.

---

## The doc

`docs/content/docs/(docs)/filter-traffic.mdx:48`, closing the § Country Exclusions section:

> Country codes are stored as uppercase values in the dashboard and API.

"stored as uppercase" reads as a normalisation promise: it says what happens to what you
enter, not what you must enter. (`site-settings.mdx:89-91` is silent on normalisation, so
`filter-traffic.mdx` is the doc that makes the promise.)

## The code, re-read at `64f8c4fb`

`server/src/api/sites/updateSiteConfig.ts:14-24`:

```ts
  excludedCountries: z
    .array(
      z
        .string()
        .trim()
        .length(2)
        .regex(/^[A-Z]{2}$/, "Country code must be a 2-letter ISO code (e.g., US, GB, CN)")
    )
    .max(250)
    .optional(),
```

The write path validates uppercase and never uppercases. The *read* path does compare
case-insensitively (`siteExclusionDecision.ts`,
`country.toUpperCase() === countryIso.toUpperCase()`), so the strictness is purely at the
boundary.

---

## CONTROL — uppercase

```
site 38
CONTROL uppercase US
    PUT /api/sites/38/config              -> 200 {"success":true,…}
CONTROL read back
    GET /api/sites/38/excluded-countries  -> 200 {"success":true,"excludedCountries":["US"]}
```

## PROBE — lowercase, then mixed case

```
PROBE lowercase us
    PUT /api/sites/38/config
      -> 400 {"success":false,"error":"Invalid request data","details":{"formErrors":[],
              "fieldErrors":{"excludedCountries":["Country code must be a 2-letter ISO code (e.g., US, GB, CN)"]}}}

PROBE mixed-case Us
    PUT /api/sites/38/config
      -> 400 {"success":false,…same message…}

read back after the refusals
    GET /api/sites/38/excluded-countries  -> 200 {"success":true,"excludedCountries":["US"]}
```

Same site, same field, same request in every other respect; only the case of the two
letters differs. The refusals left the stored list untouched.

## Incidental R1 sighting

The CONTROL read-back had to wait **10427 ms** for the `sitesAccessCache` window before
`GET /api/sites/38/excluded-countries` stopped answering 403 on a site the same caller
had just created. That is an independent, unplanned reproduction of R1.

## Change from the hand-verification

None.
