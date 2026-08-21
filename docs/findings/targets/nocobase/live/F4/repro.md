# F4 — `union.md`'s "Mixed Rows and Columns" example prints two rows per role under filters that admit three

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100, PostgreSQL 16 (project `tc-nocobase`, 127.0.0.1:15432) |
| scenario | `role-union-merges-rows-and-columns-separately.api.1`, failing step 4 |
| **verdict** | **still reproduces**, in both directions |

## Doc, re-read at this SHA

`docs/docs/en/users-permissions/acl/union.md`, `#### Mixed Rows and Columns`:

> Role A filter: Age < 30, columns Name, Age
>
> | UserID | Name | Age |
> | ------ | ---- | --- |
> | 1      | Jack | 23  |
> | 2      | Lily | 29  |
>
> Role B filter: Name contains "Ja", columns Name, Sex
>
> | UserID | Name  | Sex   |
> | ------ | ----- | ----- |
> | 3      | Jade  | Woman |
> | 4      | James | Man   |

and its merged table lists all four rows (`Jack 23 Man`, `Lily 29 Woman`, `Jade 27 Woman`,
`James 31 Man`), which is the fixture the example's own data implies.

## Fixture, built to the manual exactly (the corpus seed's `union-fixture`)

```
tcunionmixed (raw postgres):  1|Jack|23|Man   2|Lily|29|Woman   3|Jade|27|Woman   4|James|31|Man
scope A: {"$and":[{"age":{"$lt":30}}]}           role tcuniona, fields ["name","age"]
scope B: {"$and":[{"name":{"$includes":"Ja"}}]}  role tcunionb, fields ["name","sex"]
user   : tcunion, roles [tcuniona, tcunionb]
```

(The two scope rows are quoted verbatim in `raw/scopes.txt`.)

## Probe — Role A alone

```
GET /api/tcunionmixed:list?sort=id   X-Role: tcuniona
→ 200 {"data":[{"age":23,"name":"Jack","id":1},
               {"age":29,"name":"Lily","id":2},
               {"age":27,"name":"Jade","id":3}],"meta":{"count":3,...}}
```

Three rows where the manual prints two. **Jade is 27, and 27 < 30.**

## Probe — Role B alone

```
GET /api/tcunionmixed:list?sort=id   X-Role: tcunionb
→ 200 {"data":[{"name":"Jack","sex":"Man","id":1},
               {"name":"Jade","sex":"Woman","id":3},
               {"name":"James","sex":"Man","id":4}],"meta":{"count":3,...}}
```

Three rows where the manual prints two. **`Jack` contains `Ja`.**

## Control — the merge itself is correct

Under `allow-use-union`, the merged read returns exactly the manual's merged table:

```
GET /api/tcunionmixed:list?sort=id   X-Role: __union__
→ 200 {"data":[{"name":"Jack","sex":"Man","id":1,"age":23},
               {"name":"Lily","sex":"Woman","id":2,"age":29},
               {"name":"Jade","sex":"Woman","id":3,"age":27},
               {"name":"James","sex":"Man","id":4,"age":31}],"meta":{"count":4,...}}
```

Four rows with both `age` and `sex`, so the three rules in `#### Summary` hold. The defect
is confined to the two per-role tables: they contradict the filters printed immediately
above them.

## Raw captures

- `raw/F4.json` — full transcript with the per-role counts and name lists
- `raw/scopes.txt` — the data-scope rows the two roles reference
- `raw/probe.stdout.txt`
