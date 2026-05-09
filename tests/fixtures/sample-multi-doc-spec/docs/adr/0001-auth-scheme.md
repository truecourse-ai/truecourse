# ADR 0001 — Authentication scheme

Status: accepted

We will use Bearer JWTs for all `/api/*` endpoints.

<!-- PLANTED-AGREEMENT with PRDv2: same auth scheme. The merger should
     auto-merge this with PRDv2's auth claim (identical content) and
     stitch provenance from both — module manifest's sourceDocs lists
     both files. -->

## Context

The session-cookie approach in the original prototype didn't work for
the planned mobile clients.

## Decision

JWT issued by the auth service, validated on every `/api/*` request.
