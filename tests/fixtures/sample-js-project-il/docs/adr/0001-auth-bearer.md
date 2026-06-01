# ADR 0001 — Authentication scheme

Status: accepted

We will use Bearer JWTs for all `/api/*` endpoints.

<!-- PLANTED-AGREEMENT with PRDv2: same auth scheme. The merger should
     auto-merge this with PRDv2's auth claim and stitch provenance from
     both — module manifest's sourceDocs lists both files. -->

## Context

The session-cookie approach in V1 didn't work for the planned mobile
clients and didn't compose well with the admin-role gate.

## Decision

JWT issued by the auth service, validated on every `/api/*` request.
Role membership (`admin`) is encoded in the token payload and checked
per-route.
