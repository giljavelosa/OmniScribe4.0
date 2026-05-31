# Ingestion Router V2 Baseline

Date: 2026-05-29

## Repository State

Baseline was taken before clinical file ingestion router V2 implementation changes. The working tree already contained Unit 52 document-ingestion changes and documentation updates from prior work.

Mandatory fixture source supplied by user:

- `/Users/gil/Downloads/OmniScribe_John_Alvarez_COMPREHENSIVE_SYNTHETIC_Medical_Record_Packet.pdf`

Mandatory fixture copied to:

- `tests/fixtures/ingestion/OmniScribe_John_Alvarez_COMPREHENSIVE_SYNTHETIC_Medical_Record_Packet.pdf`

## Commands

| Command | Result | Notes |
|---|---:|---|
| `git status --short` | pass | Working tree was already dirty with Unit 52 changes; no router V2 implementation changes had been made yet. |
| `npx prisma validate` | pass | Prisma schema valid. Prisma emitted the existing `package.json#prisma` deprecation warning. |
| `npm run typecheck` | pass | `tsc --noEmit` completed successfully. |
| `npm run lint` | pass | Exited 0 with 11 existing warnings. |
| `npm test` | pass | Initial sandboxed run could not reach local Docker Postgres/Redis. Rerun with local Docker access passed 125 files / 1136 tests. |
| `npm run build` | pass | Initial run hit generated `.next/node_modules/.DS_Store`; removed that generated file only. Sandboxed rerun could not fetch Google Fonts. Rerun with network access passed. |

## Baseline Commands Identified

- Unit/integration tests: `npm test`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Existing E2E command: `npm run e2e`

## Baseline Risk Notes

- Local default Prisma migration history is already documented as divergent in `context/progress-tracker.md`; this baseline did not perform destructive migration repair.
- Build requires network access for `next/font` Google font fetches.
- DB/Redis-backed tests require access to local Docker services on Postgres `localhost:5434` and Redis `localhost:6381`.
