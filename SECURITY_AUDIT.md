# PropertyOnTheGo — Security & Permission Audit

Date: 2026-09-16
Scope: full codebase (apps/api + apps/web), four parallel passes — authentication/session, authorization (RBAC+ABAC), input validation/injection/uploads, secrets/config/infra.

This file is local only, not published anywhere — it documents real (now-fixed) vulnerabilities and is not something to share as a link.

## Fixed this pass (see commit `f6c252f`)

### CRITICAL
**Privilege escalation to `platform_admin`/`platform_reviewer`**
`AddMemberDto.roleKey` had no allowlist. Any account holding `account:manage_members` (i.e. any ordinary property owner on their own account) could call `POST /accounts/:accountId/members` with `roleKey: "platform_admin"` and grant themselves platform-wide `account:read_all`/`account:suspend`. `PermissionsGuard`'s ABAC only checked the *account* was the caller's own — never which *role* was being granted there.
**Fix**: `AccountsService.addMember` now rejects `platform_admin`/`platform_reviewer` outright — both are seed/DB-only roles, never grantable via self-service membership.
**Verified live**: attempt correctly 403s; a legitimate role grant (`viewer`) still works.

### HIGH
**Cross-account document write via `POST /documents`**
This route isn't nested under `:propertyId`, so ABAC never ran. `DocumentsService.create` wrote whatever `propertyId`/`leaseId` was supplied straight onto a new `Document` row — and a timeline event onto that property — with no check it belonged to the uploading account.
**Fix**: verifies the resolved property's `accountId` matches the caller before creating anything.
**Verified live**: tested against a genuinely separate second account's real property — correctly rejected; own-property upload still works.

**`JWT_SECRET` weak-default fallback**
`auth.module.ts` fell back to the literal string `'dev-secret-change-me'` — also published in `.env.example` — whenever `JWT_SECRET` was unset. A deployment that forgot to set it would sign/verify every auth token with a secret anyone could read in this repo: a complete authentication bypass.
**Fix**: `main.ts` now refuses to start the app if `JWT_SECRET` is missing or still equals the placeholder; the insecure fallback is removed from `auth.module.ts`. A real, randomly generated `JWT_SECRET` was added to both local `.env` files (not committed).
**Verified live**: server boots cleanly with the real secret.

**SSRF via `visualizations.beforeImageUrl`**
The server `fetch()`'d any client-supplied URL with zero restriction — an authenticated account with `property:write` could point it at cloud metadata endpoints (`169.254.169.254`) or any internal host.
**Fix**: resolves the hostname and rejects private/loopback/link-local/reserved IP ranges before fetching.
**Verified live**: `169.254.169.254`, `localhost`, `127.0.0.1`, `10.x`, `192.168.x` all correctly rejected; a real public URL still passes the check (fails later only because it's not a real image, proving no over-blocking).

### MEDIUM
**Cross-project dispute references (griefing)**
`raiseDispute`/`raiseDisputeAsVendor` never verified an optional `milestoneId`/`paymentId`/`payoutId` belonged to the project the dispute was raised on. An attacker could raise a dispute on their own project referencing another project's milestone/payment id, permanently blocking that other project's `releaseMilestone`/`refundPayment` — with no way for the victim to ever resolve a dispute they weren't a real party to.
**Fix**: both methods now verify each optional target actually belongs to the given project.
**Verified live**: cross-project reference correctly rejected; same-project reference still works.

**No content-type allowlist on `/uploads`**
Only a 25MB size cap existed — no restriction on file type. An `evil.html`/`evil.svg` could be uploaded and served back from the storage domain with its content-type intact.
**Fix**: allowlisted to images (jpeg/png/webp/gif), PDF, and Word/Excel.
**Verified live**: HTML upload rejected (400); real PNG upload still succeeds (201).

**No rate limiting on AI/visualization endpoints**
`POST /ai/actions`, `/ai/chat`, and `POST /visualizations/property/:propertyId` route to real, billed OpenAI/Anthropic calls with only the blanket 100/min global limit.
**Fix**: added `@Throttle` (20/min on AI actions/chat, 10/min on visualization generation).

**No security headers**
No CSP, X-Frame-Options, X-Content-Type-Options, HSTS, etc. anywhere.
**Fix**: added `helmet()`.
**Verified live**: confirmed via raw `curl -I` that all standard headers are now present.

### LOW
**Weak password policy**: register/reset only required 8+ characters, no complexity, no max length (bcrypt truncates past 72 bytes). Now requires at least one letter + one digit, capped at 72 chars. Verified live (weak password rejected, valid one accepted).

**Materials orders**: `createOrder`/`requestBulkQuote` didn't verify a supplied `projectId` belonged to the ordering account (data-integrity nuisance — inflates another account's own project spend total, not a cross-account read/write). Now verified.

## Not fixed this pass — needs your action, not a code fix

**Rotate these credentials.** They're correctly gitignored and have never been committed, but they're real, live credentials that were read during this analysis: the Render Postgres password, the Upstash Redis password, the OpenAI API key, the Cloudflare R2 secret key, and the Resend API key (all in `.env` / `apps/api/.env`). Payment gateway keys (Paystack/Stripe/Flutterwave) are test-mode and Sumsub is sandboxed — lower concern.

## Fixed in the follow-up pass (see commits `c44e557`, `b7995a4`, `8800beb`, `bd5944a`)

**Applied safe `npm audit` fixes** — non-`--force` semver-compatible bumps only (`file-type`, `qs`, and a later `@nestjs/common` 10.4.15→10.4.22 patch bump, all within already-declared version ranges — no `package.json` changes). Verified with `tsc --noEmit` in both apps and a clean API boot after each bump.

**NestJS 10 → 11, Express 4 → 5** (commit `b09b967`) — closes the remaining backend findings (`@nestjs/core` request-smuggling CVE, `@nestjs/config`'s bundled lodash CVE, `body-parser`/`multer` CVEs via the Express 5 bump). Stayed on the well-established 11.x line rather than the newly-released 12.x — `@nestjs/throttler` (used for login/AI/visualization rate limiting) doesn't support 12 yet, and 11.2.5 already fixes every reported CVE. `multer` needed a manual override to 2.4.0 since `@nestjs/platform-express@11.2.5` still bundles a vulnerable 2.2.0 internally. Also fixed a real npm-workspace hoisting bug this surfaced: a plain `npm install` left `@nestjs/schedule`/`@nestjs/throttler` resolving their own `@nestjs/common`/`@nestjs/core` to a stale nested v10 copy instead of the app's v11 — a split-DI-container bug that fails silently until something depends on identity across the two copies. Fixed via scoped root `overrides` plus a full clean reinstall.
**Verified live**: clean `tsc --noEmit`, clean Nest boot, and a full regression pass (login/lockout, create+update on properties/leases/projects/milestones/BOQ items/documents, a dispute, and a real multipart file upload through the `/uploads` content-type allowlist) — no behavior change.

**Next.js 14 → 16, React 18 → 19** (commit `d48eef6`) — closes the last two findings (Next.js's own critical CVE, and postcss's high-severity CVE, which was just Next's own bundled dependency). This app is pure Pages Router with no `middleware.ts`, no `next/image` usage, no custom `webpack` config, no `getServerSideProps`/`getStaticProps` (fully client-rendered), and no legacy React patterns — which ruled out nearly every breaking change in both the v15 and v16 upgrade guides. The only real changes were the React 19 bump itself and Turbopack becoming the default bundler (nothing to migrate, since there's no custom webpack config to begin with). Hit the same hoisting bug as the NestJS bump (stale `react@18`/`next@14` left at the workspace root); fixed the same way, with a full clean reinstall.
**Verified live**: clean `tsc --noEmit`, a clean `next build` with all 47 routes prerendering, and a live browser smoke test against real API data — login, the portfolio dashboard, and a dynamic property detail route all rendered correctly with zero console or server errors on a fresh tab.

**`npm audit` now reports 0 vulnerabilities**, across the full dependency tree including devDependencies.

**Real per-account login lockout** — added `User.failedLoginAttempts`/`lockedUntil` (migration `20260923000000_add_user_login_lockout`). After 5 failed attempts, the account locks for 15 minutes; checked live on read (no cron/unlock job needed), matching this codebase's existing "compute on read" convention (`PropertyDevelopmentAgreement.expiresAt`, `Project.quotesDeadline`). Complements, doesn't replace, the existing per-IP throttle on `/auth/login`.
**Verified live**: 5 wrong passwords lock the account; a 6th attempt with the *correct* password is still rejected with the lockout message (tested past the per-IP throttle window to isolate the two mechanisms); a fresh account can still log in normally.

**bcrypt cost factor 10 → 12** — OWASP's current minimum recommendation. Applied to both registration and password-reset hashing. Password DTOs also gained `@MaxLength(72)` since bcrypt silently truncates beyond that.

**`DATABASE_URL` pinned to `?sslmode=require`** — in both `.env` files, explicit rather than relying on Render's default behavior.

**`forbidNonWhitelisted` on the global ValidationPipe** — turns "silently strip any field not declared on the DTO" into a real 400 naming the offending field. Not a closed exploit (`whitelist` alone already made stray fields harmless server-side) — this is about surfacing a real client/DTO mismatch instead of hiding it. Regression-tested live (authenticated `fetch` calls using `apps/web/lib/api.ts`'s exact payload shapes) against create/update on properties, leases, projects, milestones, BOQ items, and documents, plus raising a dispute — all succeeded, no unexpected-field rejections. Vendor-quote, maintenance-quote, and vendor-dispute DTOs were checked statically against their frontend call sites instead of live (this test account has no `vendor:write` role) and match field-for-field.

## Deliberately not fixed — recommended follow-ups, not done now

- Password-reset/invite token dev-fallback logging, no payment webhook receivers, documents in a public-but-unguessable-URL bucket — all already self-documented, deliberate scaffold tradeoffs, not oversights.
- Regression testing across this audit's several passes created some real test records in the dev DB (a test property, lease, project, milestone, BOQ item, document, and dispute) — there's no delete endpoint for any of them (consistent with the app's no-hard-delete pattern elsewhere), so they were left in place rather than force-removed. Harmless, but worth knowing if you're auditing DB row counts.

## Areas checked and found solid (no findings)
CSRF (real double-submit cookie pattern), refresh-token rotation + server-side revocation, cookie httpOnly split, account-switching ABAC (`AccountContextGuard`/`PermissionsGuard`), user-enumeration-safe password reset, Google OAuth ID-token verification, SQL/Prisma injection (all raw queries properly parameterized), XSS (no `dangerouslySetInnerHTML` anywhere), CORS (specific origin, not wildcard), the AI layer's own permission re-checks, and RBAC/ABAC across ~20 controllers (properties, projects, payments, vendors, materials, listings, communities, branches, platform-admin) — all independently re-verify resource ownership at the service layer, consistent with the one exception (documents) fixed above.
