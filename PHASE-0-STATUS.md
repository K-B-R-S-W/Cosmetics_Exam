# Phase 0 status

**Status:** locally complete, deployment-deferred

This record covers implementation-plan tasks 0.1 through 0.11.

| Task | Local status | Note |
|---|---|---|
| 0.1 Initialize Next.js + TypeScript | Complete | Next.js App Router, TypeScript, ESLint, Tailwind v4, npm, no `src/` directory |
| 0.2 Install core dependencies | Complete | Approved runtime packages installed; Vitest added for the mocked health-route test |
| 0.3 Supabase project setup | Manual/external step not performed | No Supabase project, dashboard or SQL was touched |
| 0.4 Environment config | Complete locally | Safe templates are committed; real values remain in ignored local environment files and the user's password manager |
| 0.5 Supabase client helpers | Complete | Service-role client is server-only; browser client uses only the public URL and anon key |
| 0.6 iron-session config | Complete | Cookie lifetime is exam duration plus two hours; the temporary local verification route was deleted after checks passed |
| 0.7 Vercel project | Deferred | No Vercel project, environment or deployment was touched |
| 0.8 Git repo + structure | Complete locally | Approved `infra/livekit`, `infra/ec2` and `infra/env` files are present; none was executed |
| 0.9 Logger config | Complete | Structured logger serializes only allowlisted metadata and never request bodies |
| 0.10 Public health endpoint | Complete locally | Success and failure shapes are covered by mocked tests; a real Supabase query waits for the schema and user-run setup |
| 0.11 Design foundation | Complete | Tailwind v4 CSS tokens, global/tablet rules, approved PNG logos, logo favicon, font loading and raw-colour lint are in place |

## Original done-when

> Deployed app reads a row from Supabase and iron-session creates a test cookie on localhost.

**Not met.** Deployment is explicitly deferred. The localhost `exam_session` cookie check passed, but no real Supabase row was read because the project and Phase 1A schema were intentionally not touched.

## Deferred work

- Task 0.7: Vercel project and deployed verification.
- Pre-Phase-1A specification corrections: explicit Data API grants and the locked-decision mismatches. No SQL or specification file has been edited for these yet.
