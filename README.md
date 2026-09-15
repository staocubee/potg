# PropertyOnTheGo — technical scaffold

All six of the blueprint's [Engineering Implementation
Priorities](#) are scaffolded here: the multi-account foundation, the
property portfolio and document vault, the AI Copilot Layer, the vendor
marketplace and project tracking, payments and escrow, the property and
materials marketplaces, and real multi-turn AI chat with tool-calling — as
a working NestJS + Prisma API, plus a Next.js web app whose foundation
(auth, account switching, nav) and one reusable component — the Ask AI
panel — are now real screens wired to that API, not a mock: portfolio,
projects + vendor marketplace, payments + escrow, the property + materials
marketplaces, and the document vault all have working UI. The AI Copilot
Layer's design
point still holds: every module adds a **skill** to one existing
`AiService` instead of building AI support from scratch, and every one of
those skills is reachable from a web screen via `AskAiPanel` without that
screen knowing anything about AI plumbing itself.

## What's here

```
apps/api/            NestJS backend
  prisma/schema.prisma   Data model — Modules 1-4, 7 & 9, + the AI request/output/approval log
  prisma/seed.ts         Seeds permissions, roles, a demo owner + property + project, and a demo vendor
  src/auth/              Register, login, list-my-accounts
  src/accounts/          Create an account, add a member (Module 1)
  src/properties/        Property portfolio CRUD (Module 2) + inspections (Module 8) + leases (Module 13) + maintenance requests (Module 12)
  src/documents/         Document vault CRUD (Module 4)
  src/vendors/            Vendor marketplace profiles & quoting (Module 7)
  src/projects/           Project tracking — stages, milestones, updates, quotes (Module 9)
  src/payments/           Escrow, deposits, milestone release, payouts, receipts, disputes (Module 11)
  src/listings/           Property marketplace — listings, inquiries, offers, favorites (Module 5)
  src/materials/          Materials marketplace — suppliers, product catalog, orders, delivery (Module 10)
  src/ai/                The AI Copilot Layer (Section 5), now including real chat — see below
  src/common/            JWT auth guard, account-context guard, RBAC/ABAC permissions guard
apps/web/             Next.js web app — see "Web app" below
  lib/api.ts              Typed client for every endpoint above (one file, one contract)
  lib/auth.tsx             AuthProvider — token + account-switching, localStorage-backed
  components/AppShell.tsx  Sidebar nav, top bar, account switcher, Ask AI drawer
  components/AskAiPanel.tsx  THE reusable Ask AI panel — quick actions + chat, one per moduleContext
  components/AiDraftCard.tsx Accept/Edit/Discard for one AiOutput
  pages/properties/        Portfolio list + property detail
  pages/projects/          Project list/detail — stages, milestones, quotes, and now payments/escrow
  pages/vendors/           Vendor marketplace browse/detail/"me" dashboard
  pages/marketplace/       Property listings + (nested) materials marketplace — see "Web app" below
  pages/documents/         Account-wide document vault list + upload form
packages/shared/      Empty — shared types go here as the web app grows
docker-compose.yml    Local Postgres + Redis
```

## Running it locally

```bash
npm install
cp apps/api/.env.example apps/api/.env   # edit DATABASE_URL if needed
npm run db:up                            # starts Postgres + Redis via Docker
npm run prisma:migrate --workspace=apps/api -- --name init
npm run seed
npm run dev:api                          # http://localhost:3001
```

The seed script prints a demo login (email/password) plus the demo owner
account, property, and project IDs, and a second demo *vendor* account ID —
the same login belongs to both, so you can switch `X-Account-Id` between
them to try both sides of Module 7/9's marketplace flow without a second
signup.

To also run the web app:

```bash
cp apps/web/.env.local.example apps/web/.env.local   # only needed if the API isn't on :3001
npm run dev:web                          # http://localhost:3000
```

Sign in with the seeded demo login (or register a fresh one — a brand-new
user is routed straight to account creation, since every API call needs an
`X-Account-Id`).

## Web app (`apps/web`) — Foundation + Ask AI panel

This pass builds the web app's foundation and the one component every
future screen will reuse, matching the published Ask AI panel wireframe's
`Main.dc.html` artboard: the app shell (auth, account switcher, sidebar
nav), the property portfolio screens, and a real `AskAiPanel` wired to the
live API — not a mock.

- **`lib/auth.tsx`** — `AuthProvider` holds the JWT and the currently
  selected account (both in `localStorage`, read back on load so a refresh
  doesn't bounce a signed-in user to `/login`), and hands every screen one
  `ApiClient` instance (`lib/api.ts`) already carrying the right
  `Authorization` and `X-Account-Id` headers — the same account-switching
  model `AccountContextGuard` enforces server-side.
- **`components/AppShell.tsx`** — sidebar (Portfolio, Projects, Vendors,
  Marketplace, and Documents are all live; only Payments is shown but
  marked "soon" rather than hidden, so the shell doesn't misrepresent how
  much of the platform this pass covers — see the Payments & escrow
  section for why), top bar with the account switcher, and the Ask AI
  drawer toggle every screen that passes an `aiPanel` prop gets for free.
- **`components/AskAiPanel.tsx`** — the reusable piece. Takes one prop,
  `moduleContext` (e.g. `"property:<id>"`, `"account:<accountId>"`), and:
  1. Fetches `GET /ai/skills` and renders a quick-action button for every
     skill whose `moduleContextPrefix` matches — clicking one calls
     `POST /ai/actions` exactly like the wireframe's quick-action buttons.
  2. Renders a chat thread wired to `POST /ai/chat`, resuming the most
     recent conversation already scoped to this `moduleContext` if one
     exists (`GET /ai/conversations`).
  3. Renders every resulting `AiOutput` — from a quick action or from a
     chat tool call — as the same `AiDraftCard`, with Accept/Edit/Discard
     calling `POST /ai/outputs/:id/decision`. Nothing the AI produces here
     looks like it already happened; the visual language (indigo accent,
     "draft" framing, the disclaimer line) is deliberately consistent and
     used nowhere else in the UI.
  The dashboard (`pages/properties/index.tsx`) embeds it scoped to
  `"account:<id>"` — putting the Priority 6 `generate_portfolio_report`
  skill one click away — and the property detail screen embeds it scoped
  to `"property:<id>"`.
- **`pages/properties/`** — the portfolio list (cards + an inline "add
  property" form) and the property detail screen (info, timeline,
  documents, valuation history + an "add valuation" form hitting the
  Priority 6 `PropertyValuation` endpoints, and — added in the Projects
  pass below — a Projects section for that property).

### Projects & vendor marketplace screens (this pass)

Built from the same foundation, covering Priority 3 (Modules 7 & 9):

- **`pages/projects/`** — the projects list (cards with a `ProjectStageBar`
  mini-progress bar + an inline "new project" form scoped to one of the
  account's properties) and the project detail screen: the full 5-stage
  stepper (`Scope → Quote → Materials → Work → Handover`, matching
  `ProjectsService.DEFAULT_STAGES`), milestones (list + add form),
  updates (list + post form), vendor quotes (list, Accept on a `submitted`
  quote, and a "Request quote" widget that lists marketplace vendors and
  calls `POST /projects/:id/quotes/request`), and assigned vendor badges.
  Embeds `AskAiPanel` scoped to `"project:<id>"` — six of the twelve AI
  skills are `project`-prefixed (`estimate_project_budget`,
  `draft_project_status_update`, `compare_vendor_quotes`, `explain_fees`,
  `flag_payment_anomaly`, `boq_to_order`), so this is the panel's densest
  quick-action screen.
- **`pages/vendors/`** — `index.tsx` is the public marketplace browse
  (category filter, cards linking to a profile); `[id].tsx` is a vendor's
  profile + reviews, plus (for a non-vendor account) a "request a quote for
  one of your projects" widget — the same `POST /projects/:id/quotes/request`
  call, entered from the vendor's side instead of the project's;
  `me.tsx` is the vendor side of the marketplace — create your `Vendor`
  profile (`POST /vendors`), see quote requests owners sent you and submit
  a real amount against them (`POST /vendors/me/quotes`, upserts by
  project+vendor), and a read-only payout history (`GET /vendors/me/payouts`).
- No AI skill is `vendor`-prefixed today, so vendor screens don't embed
  `AskAiPanel` — only project- and property/account-scoped screens do.

### Payments & escrow screens (this pass)

Every payments/escrow route in `src/payments` is nested under one project
(`/projects/:projectId/...` — there's no account-wide payments aggregate
endpoint), so this pass builds the money side directly into the project
detail screen (`pages/projects/[id].tsx`) rather than as a separate page:

- **Escrow card** — current balance/currency/status, a "+ Deposit" form
  (`POST /projects/:id/payments`, simulated per the `Payment` schema
  comment — no real gateway call), and the escrow ledger (`EscrowLedgerEntry`
  rows) showing every deposit and release with the running balance after
  each, so the money trail is auditable without cross-referencing anything
  else.
- **Milestones** gained Approve/Release actions: "Approve" calls
  `POST .../milestones/:id/approve` (available whenever `approvalStatus`
  isn't already `"approved"`); once approved, "Release funds" calls
  `POST .../milestones/:id/release`, which pays the assigned vendor out of
  escrow — shown only for milestones with a `paymentAmount` set and not yet
  released (`status !== "completed"`, which `releaseMilestone` sets).
- **Payouts & Receipts cards** — read-only history from
  `GET /projects/:id/payouts` and `/receipts` (a receipt is issued for
  every deposit and every release automatically by the API; nothing in the
  UI creates one directly).
- **Disputes card** — list + a "Raise dispute" form (optionally tied to a
  milestone), and a "Resolve" action on any `open`/`under_review` dispute
  (mark `resolved` or `rejected`, with notes) via
  `POST .../disputes/:id/resolve`.
- At the time of this pass, the sidebar's "Payments" nav item still said
  "soon" — there was no `GET /payments` across all of an account's projects
  to back a standalone screen, only the complete money lifecycle for one
  project on that project's own page. A later pass ("Real end-to-end
  smoke test" section below, then the payments-rollup pass after it) added
  `GET /payments/overview` and a standalone `pages/payments/index.tsx` — see
  that pass's own README section for the rollup screen itself.

### Property & materials marketplace screens (this pass)

Priority 5's two marketplaces (`src/listings`, `src/materials`) each get
their own screens under `pages/marketplace`, kept as separate sub-trees
since they share nothing structurally beyond the nav item:

- **Property listings** (`/marketplace`) — browse active listings with
  type/city filters; `/marketplace/new` lists a property from the account's
  own portfolio as a `draft`; `/marketplace/[id]` is the listing detail —
  its Ask AI panel (`moduleContext: "listing:<id>"`) reaches the
  `generate_listing_description` and `assess_listing_risk` skills. Owners
  see Publish, plus Offers (Accept/Reject) and Inquiries; everyone else
  sees Make an offer / Ask a question, and a Favorite toggle. `/marketplace/me`
  rolls up an account's own listings (with Publish) and the offers it has
  made elsewhere.
- **Materials & tools** (`/marketplace/materials`) — browse the product
  catalog by category; `/marketplace/materials/[id]` is a supplier's
  storefront (product list + quantity picker → `POST /orders`, which
  decrements stock and computes the order total server-side).
  `/marketplace/materials/me` is the supplier dashboard: create a
  `SUPPLIER`-account profile if none exists yet, add/edit products
  (price, stock, status), and see incoming orders. `/marketplace/materials/orders`
  and `/orders/[id]` cover the buyer side — order detail shows line items
  and delivery status; on the supplier's own orders, the same detail page
  gains status transitions and a delivery-tracking form
  (`PATCH /orders/:id/status` and `/delivery`).
- The sidebar's Marketplace item is now fully enabled. Payments stays
  "soon" for the reason above; Documents got its screen in the next pass
  below.

### Documents screen (this pass)

`src/documents` (Module 4) had a working API since early in this scaffold
but only a read-only summary embedded in the property detail page.
`pages/documents/index.tsx` is now a real screen:

- **`GET /documents`** (account-wide) backs the main list — every document
  across every property, plus any not tied to a property at all
  (`propertyId` is optional on `Document`). A `?propertyId=` query param
  filters it to one property; the property detail page's Documents card
  now links here with that filter set ("Manage documents") instead of only
  showing its own read-only summary.
- **Upload form** — `POST /documents`: document type (a dropdown of the
  same checklist `verify_property_documents` checks against, plus a
  freeform "Other" since `Document.documentType` is just a string),
  a file URL, an optional property, and an optional expiry date. There's
  no file storage wired up yet, so this is a link to wherever the document
  already lives rather than a real upload — the form says so.
- The list flags anything expiring within 30 days and shows each
  document's `verificationStatus` badge, but there's still no way to
  *change* that status from the UI or the API — verification stays a
  human/admin workflow that Module 6 hasn't been built yet (the
  `verify_property_documents` AI skill only drafts a checklist gap report,
  it never sets the field itself; see that skill's own comment).
- The sidebar's Documents item is now fully enabled — Payments is the only
  item left disabled, and deliberately so (see above).

### Vendor & supplier reviews (this pass)

`VendorReview` had a schema and a spot on the vendor profile page since an
early pass, but no endpoint — "needs a 'mark project complete' step first"
per that pass's own note. This pass adds that step, the review endpoints
for both marketplaces, and a new `SupplierReview` model that didn't exist
before (suppliers/products had no review model at all):

- **`POST /projects/:projectId/complete`** (`project:write`) — the missing
  step: flips a project to `status: "completed"` (refuses if it's already
  `completed` or `cancelled`). The project detail page now shows a "Mark
  complete" button whenever a project is still open.
- **`POST /projects/:projectId/reviews`** (`review:write`, new permission)
  — leaves a `VendorReview` on one of the project's assigned vendors.
  Lives on `ProjectsController` rather than `VendorsController` so it
  inherits `PermissionsGuard`'s `:projectId` ABAC check for free; from
  there `VendorsService.createReview` enforces the two review-specific
  gates — the project must be `completed`, and the vendor must actually
  have a `ProjectVendorAssignment` on it — then recomputes
  `Vendor.ratingAverage` from all of that vendor's reviews.
  `VendorReview` also gained a `@@unique([projectId, vendorId])`
  constraint: one review per vendor per project. The project detail page
  shows a review form for each assigned vendor once the project is
  completed, one per vendor, hidden once submitted.
- **`POST /orders/:orderId/reviews`** (`review:write`) — the materials
  marketplace counterpart, gated on the *order* being `delivered` instead
  of a project being completed (an order doesn't always belong to a
  project — `Order.projectId` is optional). `SupplierReview.orderId` is
  `@unique`, so it's one review per order; `MaterialsService` recomputes
  `Supplier.ratingAverage` the same way. The order detail page shows the
  form once an order is delivered, and the submitted review afterward; the
  supplier's storefront page (`/marketplace/materials/[id]`) now has a
  Reviews section alongside the product catalog, matching the vendor
  profile page's layout.
- Reading a review needs no permission of its own — it rides along with
  `vendor:read`/`supplier:read` since the existing `findOne`/`findSupplier`
  queries just got `reviews` added to their `include`.
- Seed data got one of each review (a 5-star vendor review on the
  demolition milestone project, a 4-star supplier review on the tile
  order) so both profile pages have something real to show on first
  login — added by writing straight to Prisma, since the demo project is
  deliberately left `in_progress` and the demo order `in_transit` so
  there's live money/delivery activity to demo elsewhere; the review
  *gates* themselves are only exercised for real once a user completes
  their own project or order through the UI.

### Web app auth hardening (this pass)

The gap flagged since the Foundation pass — a single 7-day JWT in
`localStorage`, no refresh, no password reset — gets addressed, with one
piece explicitly left as a documented tradeoff rather than built:

- **Access + refresh tokens.** `POST /auth/register` and `/login` now
  return `{ accessToken, refreshToken }` instead of one long-lived token —
  a 1-hour access token (`type: 'access'` in its payload) and a 30-day
  refresh token (`type: 'refresh'`). `JwtAuthGuard` now checks that `type`
  claim, so a refresh token can never be used directly against a protected
  route, only against the new `POST /auth/refresh`. This is **stateless**
  on purpose — no persisted session/refresh-token table — which means a
  refresh token can't be revoked early (on logout, or a password change);
  it's simply valid until it expires. A real production auth system would
  want that revocation; this scaffold calls out the gap instead of
  building a session store for it.
- **Transparent refresh on the client.** `apps/web/lib/api.ts`'s `request()`
  now catches a 401 from an authenticated call, swaps the refresh token
  for a new pair via `POST /auth/refresh`, and retries the original call
  once — invisibly to whichever screen made it. Concurrent requests that
  401 around the same time share a single in-flight refresh instead of
  each racing their own. `lib/auth.tsx`'s `AuthProvider` wires this up via
  `configureAuthSession()` (persisting the new pair, or forcing a real
  logout if the refresh token is no good either) and, on hydrate, decodes
  the refresh token's `exp` client-side to tell "just need a silent
  refresh" apart from "genuinely logged out" without an extra round trip.
- **Password reset.** `POST /auth/forgot-password` / `/reset-password`,
  backed by a new `PasswordResetToken` model (hashed token, 1-hour expiry,
  one-time use — the `passwordHash` treatment applied to a reset token
  instead of a chosen password) and two new pages,
  `pages/forgot-password.tsx` and `pages/reset-password.tsx`. No email
  provider is wired up anywhere in this scaffold (payments are simulated
  the same way — see `src/payments`), so the reset link is logged
  server-side (where a real implementation would hand it to an email
  service instead) **and** returned directly in the API response so a
  demo/dev user has any way to receive it at all — `AuthService
  .forgotPassword`'s own comment flags that the `resetToken` field must be
  deleted before this ships for real, since returning it defeats the
  point of the flow.
- **What was still open as of this pass**: the JWT (now the short-lived
  access token) still lived in `localStorage`, not an httpOnly cookie —
  moving to cookies would mean the API setting them itself (CORS +
  `credentials: 'include'` + CSRF protection, none of which existed yet)
  and losing the clean bearer-header story for non-browser callers (curl,
  the eventual mobile app). That tradeoff was deliberate for this pass,
  not an oversight — see "Moving auth off localStorage: httpOnly cookies
  + CSRF" further down for where a later pass this session actually did
  it, CSRF protection and all, and what the bearer-header loss above
  turned into a real, explicitly accepted tradeoff rather than a deferred
  one.

### Per-skill AI input schemas (this pass)

Closes a gap the Chat & deeper AI pass had already flagged in its own code
comment (`AnthropicLlmProvider.chat`, before this pass): every tool handed
to the model got the same permissive `{ type: 'object', properties: {},
additionalProperties: true }` schema regardless of what the skill actually
read, so a real model had no way to know, say, that `model_roi_scenario`
takes a `scenario` field — and nothing validated `input` server-side either.

- **`AiSkillInputSchema`** (`src/ai/skills/ai-skill-input-schema.ts`) is a
  small, hand-rolled JSON-Schema-shaped type — `string`/`number`/`boolean`
  fields, with `enum` (string), `minimum`/`maximum` (number), and `default`
  — deliberately not a dependency on `zod`/`ajv`, since three primitive
  types cover every skill in this registry. `AiSkill.inputSchema` is now a
  **required** field, so every skill states its shape explicitly — 11 of
  the 12 use the shared `NO_INPUT_SCHEMA` constant (they don't read `input`
  at all); `model_roi_scenario` — the one skill that already read `input` —
  gets a real schema (`scenario` enum plus the four scenario-specific
  numbers), with defaults matching what the skill already fell back to, so
  a bare `{}` still behaves exactly as it did before this pass.
- **`AiService.coerceInput`** runs before every skill call (both
  `POST /ai/actions` and chat's tool-calling path funnel through the same
  `runAction`): declared fields are coerced to their declared type and
  checked against `enum`/`minimum`/`maximum` (a bad value throws a 400
  instead of silently becoming `NaN` deep inside a skill), missing fields
  get their schema `default`, and **undeclared keys are dropped** rather
  than passed through — a skill only ever sees a shape that matches its own
  schema. The coerced input (not the raw request body) is what gets
  persisted on `AiRequest.input`, too.
- **`AnthropicLlmProvider.chat()`** now sends each tool's real
  `inputSchema` as Anthropic's `input_schema` instead of the placeholder
  open object — a real model can now see `model_roi_scenario` wants a
  `scenario` string and act on it. `StubLlmProvider` is unchanged in
  behavior (it's a keyword router over tool *names*, not an argument
  extractor) but its code comment now says so explicitly, since it's the
  one place a schema exists but isn't used yet.
- **`AskAiPanel`** (`apps/web`) — a quick-action button for a skill with an
  empty schema still runs immediately on click, same as every pass before
  this one. A skill with declared fields (today, just "Model an ROI or rent
  scenario") opens a small inline form instead — a `<select>` for an enum
  field, a bounded number input for a number field — so the ROI scenario
  skill can actually be run with a chosen scenario and numbers from the UI,
  not always with `{}` defaulting to `"current"`.

## How multi-account auth works

A user can belong to several accounts at once (personal, family, company,
vendor — Module 1's whole point). So a request needs two things:

1. `Authorization: Bearer <accessToken>` from `POST /auth/login` — who you
   are. `/login` and `/register` actually return an `{ accessToken,
   refreshToken }` pair (1h / 30d) — see "Web app auth hardening" above
   for the refresh flow; this section only covers the access token, which
   is what every other route actually checks.
2. `X-Account-Id: <accountId>` — which account you're acting as right now.
   `GET /auth/accounts` lists the accounts a token can act as.

`AccountContextGuard` resolves the membership (role + permissions) for that
pair once per request; `PermissionsGuard` then checks the route's
`@RequirePermissions(...)` against that role, and — if the route has a
`:propertyId` param — checks the property actually belongs to that account
(the ABAC half of Section 8: "RBAC as the baseline, ABAC for
property/project/transaction-level restrictions").

## Vendor marketplace & project tracking (`src/vendors`, `src/projects`)

Priority 3 of the Engineering Implementation Priorities — Modules 7 and 9.

- **`src/vendors`** — a `Vendor` is a 1:1 marketplace profile on top of a
  `VENDOR`-type account (`POST /vendors` to create it, `GET /vendors` to
  browse/filter the marketplace by `serviceCategory`). A vendor submits or
  revises a quote via `POST /vendors/me/quotes` — deliberately keyed off the
  vendor's own account rather than `/projects/:projectId/...`, since the
  project being quoted on isn't the vendor's own tenant and shouldn't have
  to pass the property-owner ABAC check in `PermissionsGuard`.
- **`src/projects`** — `POST /projects` creates a project under one of the
  account's own properties and seeds its five stages (`Scope → Quote →
  Materials → Work → Handover`, matching the Ask AI panel wireframe
  exactly). From there: `POST /projects/:projectId/milestones` and
  `.../updates` for progress tracking, `.../quotes/request` for the owner
  to invite a specific vendor to quote, and `.../quotes/:quoteId/accept` to
  hire one — which assigns the vendor, declines the project's other live
  quotes, and moves the project out of `planning`.
- **Three new AI skills** plug into the same registry as Modules 2/4's:
  `estimate_project_budget` (a deterministic keyword match against the
  scope description and a placeholder cost table — `src/ai/skills/cost-
  estimates.ts` — not a real pricing catalog yet), `draft_project_status_
  update` (facts from stage/update state, LLM only phrases the paragraph),
  and `compare_vendor_quotes` (sorts submitted quotes, flags a >50% price
  spread as `warn`).
- **Reviews** (`POST /projects/:projectId/complete`, `.../reviews`) were
  added in a later pass — see "Vendor & supplier reviews" under "Web app"
  above for the full gating logic.

## Payments & escrow (`src/payments`)

Priority 4 — Module 11. At the time this was written, no real payment
gateway was wired up (Section 16 lists Paystack/Flutterwave/Stripe/PayPal
as day-one integrations); every deposit and payout was simulated and
completed instantly, the same way `StubLlmProvider` simulates a model. A
much later pass this same session made deposits real via Paystack — see
"A real payment gateway — Paystack" further down; payouts are still
exactly what this paragraph describes. What's real from the start is the
ledger — every balance change is an `EscrowLedgerEntry`, so a project's
escrow balance is always derivable from its history rather than just a
number someone could edit directly.

- `POST /projects/:projectId/payments` — deposit funds into the project's
  escrow account (creates it on first deposit).
- `GET /projects/:projectId/escrow` — current balance plus the full ledger.
- `POST /projects/:projectId/milestones/:milestoneId/approve` — owner signs
  off on a milestone's submitted evidence (Section 22's "review evidence,
  approve" step) — a prerequisite for releasing its funds, not the release
  itself.
- `POST /projects/:projectId/milestones/:milestoneId/release` — pays the
  project's assigned vendor from escrow. Gated by its own `payment:approve`
  permission rather than `project:write`, since moving money deserves a
  narrower grant than editing a project — see `prisma/seed.ts`'s role list
  for why the `vendor` role never has it. Creates a `Payout` and a
  `Receipt`, and marks the milestone `completed`.
- `GET /vendors/me/payouts` — a vendor checking what it's actually been
  paid, on `VendorsController` alongside `me/quotes`.
- `POST /projects/:projectId/disputes` and `.../disputes/:disputeId/resolve`
  — deliberately simple: any account member with `dispute:write` can both
  raise and resolve one in this scaffold. A real dispute-resolution
  workflow (a neutral reviewer, evidence requests, holds) is out of scope
  here.
- **Two new AI skills**: `explain_fees` (deposited/released/balance from
  the real ledger, plus an *illustrative* platform fee — nothing is
  actually deducted anywhere yet, the skill says so rather than implying
  otherwise) and `flag_payment_anomaly` (invariant checks: a payout that
  doesn't match its milestone's amount, more than one live payout on the
  same milestone, a single payout that dwarfs the project's budget, a
  negative escrow balance).
- **`GET /payments/overview`** (this pass) — the account-wide rollup that
  finally backs a standalone Payments screen. Every route above is
  deliberately nested under one project so `PermissionsGuard`'s `:projectId`
  ABAC check applies for free; this one isn't project-scoped at all, so
  `PaymentsService.getAccountOverview` filters by the caller's `accountId`
  directly instead. Returns escrow balance / total deposited / total
  released **grouped by currency** rather than summed across currencies
  (the same caution `generate_portfolio_report`'s own comment already
  takes for cross-property pricing), an open-dispute count, and a
  per-project breakdown. `apps/web`'s `pages/payments/index.tsx` — stat
  tiles for the four rollup numbers, then one card per project linking into
  its existing full payments/escrow view on `pages/projects/[id].tsx` (that
  page is still where deposits, approvals, and releases actually happen —
  this screen is a read-only portfolio-wide summary, not a second place to
  take those actions). The sidebar's "Payments" item is enabled now that it
  has somewhere to point.

## Two marketplaces (`src/listings`, `src/materials`)

Priority 5 — Modules 5 and 10. Same shared pattern both times: a seller-side
profile, a public browse/search surface with **no** tenant isolation
(`PermissionsGuard`'s ABAC check never triggers here — neither controller
has a `:propertyId`/`:projectId` route param, so ownership of a specific
listing/product/order is checked in the service layer instead, the same
way `VendorsController`'s `me` routes work), and a buyer-side action kept
as its own deliberate step.

- **`src/listings`** — `POST /listings` creates a listing from one of the
  account's own properties (still `draft`); `POST /listings/:id/publish`
  makes it `active` and visible to `GET /listings` (`?listingType`,
  `?city`, `?propertyType`, `?minPrice`, `?maxPrice` — Priority 5's
  "search" requirement). Any account can inquire or submit an offer;
  `.../offers/:offerId/respond` is the owner accepting, rejecting, or
  countering. `GET /listings/me/offers` and `.../me/favorites` mirror
  `VendorsController`'s `me` routes for the buyer side.
  `PropertyListing.verificationStatus` started as a plain field with no
  dedicated review endpoint — the same simplification
  `Vendor.verificationStatus` took in Priority 3 — but a later pass
  closed that gap: see "A real listing:verify action for the neutral
  platform reviewer" below. Module 6's full verification workflow
  (risk flags, trust scores) still isn't built for listings specifically
  the way it is for vendors/suppliers.
- **`src/materials`** — `POST /suppliers` creates a 1:1 marketplace profile
  on a `SUPPLIER`-type account (same shape as `Vendor`); `POST /suppliers/
  me/products` and `PATCH .../products/:id` manage its own catalog;
  `GET /products` is the public cross-supplier catalog browse/search.
  `POST /orders` computes the total from real product prices and
  decrements stock; `PATCH /orders/:id/status` and `.../delivery` are the
  supplier's own fulfillment actions, checked against `req.accountId`
  owning the supplier record rather than the order. No cart model — an
  order is created directly from a line-item list; a real cart is
  session/UI state, not really a backend entity worth modeling here.
- **Two new AI skills**: `generate_listing_description` (the first skill
  with a `moduleContextPrefix` other than `property`/`project` —
  `moduleContext` is `"listing:<uuid>"`; deterministic facts, LLM writes
  the marketing paragraph) and `boq_to_order` (reuses
  `estimate_project_budget`'s keyword matcher against the project's scope
  description, but looks each match up against the *real* product catalog
  instead of the placeholder cost table — drafts a suggestion, never
  places the order itself).
- **`SupplierReview`** (`POST /orders/:orderId/reviews`) — added in a later
  pass alongside `VendorReview`'s own endpoint; see "Vendor & supplier
  reviews" under "Web app" above.

## Chat & deeper AI (Priority 6)

Every AI entry point before this pass was a quick-action button: one skill,
one call, one draft. Section 5.1's actual requirement was "every feature
should let the user **chat**", which needed a different shape — a real
back-and-forth where the model decides whether to call a tool, using
Section 16's "LLM provider with tool-calling/function-calling support."
That's `ChatService` (`src/ai/chat.service.ts`):

- `POST /ai/chat` — `{ conversationId?, moduleContext?, message }`. Starts a
  new `AiConversation` if `conversationId` is omitted. `moduleContext` is
  set once, on the first message ("property:<id>", "listing:<id>",
  "account:<id>" for a portfolio-wide skill) and carried by the
  conversation from then on.
- `GET /ai/conversations` and `GET /ai/conversations/:id` — conversation
  history, scoped to the caller's account.
- `LlmProvider` gained a `chat()` method alongside `complete()` —
  `StubLlmProvider` routes on keywords in the last user message (no API key
  needed, same philosophy as its templated `complete()` replies);
  `AnthropicLlmProvider` calls Claude's real Messages API `tools` parameter
  and reads back a `tool_use` block when the model calls one.
- **Every tool call still goes through `AiService.runAction`** — the exact
  same permission check, `AiRequest`/`AiOutput` persistence, and
  Accept/Edit/Discard requirement as a quick-action button. Chat is a
  second way to reach the same audited, human-in-the-loop skills, not a
  bypass around them. A chat turn can now chain more than one tool call
  before replying — see "Multi-turn tool use in chat" below for how and
  why that was originally scoped out, then added.

Three new skills round out the blueprint's Priority 6 list:

- **`model_roi_scenario`** (property) — the "do financials" skill (Module
  15): current value (from the latest `PropertyValuation`, or
  `Property.estimatedValue`) against what's actually been invested
  (acquisition value + everything released from escrow on the property's
  projects), plus `rent_increase` and `sell_now_vs_hold` scenarios. Every
  output ends with a disclaimer line — Section 5.4's guardrail that
  AI-generated valuations are "assistive estimates, not professional
  advice" is enforced in the skill itself, not left to a UI label.
- **`assess_listing_risk`** (listing) — the one listing skill that's
  deliberately *not* ownership-gated, the same way `GET /listings/:id`
  isn't: any account with `listing:read` can ask why a listing looks risky.
  Reuses `DEFAULT_DOCUMENT_CHECKLIST` against the underlying property's
  documents, plus price-deviation and listing-status checks.
- **`generate_portfolio_report`** (account) — the first skill scoped to a
  whole account rather than one record (`moduleContext` is
  `"account:<id>"`); aggregates properties, projects, listings, and open
  disputes into one plain-language report — an early stand-in for what
  turned out to be Module 24's own "natural-language report generation
  on top of every report type" (Module 24: Reports and Analytics wasn't
  named yet when this was built; the numbering below has since been
  corrected).

`PropertyValuation` (`POST`/`GET /properties/:propertyId/valuations`, on
the existing `PropertiesController` — no new permission keys, gated by the
same `property:read`/`property:write` pair as the property itself) is a
thin slice of Module 15: an appreciation history a human (or an
`ai_estimate`-sourced entry) can append to. `Property.estimatedValue`
itself is never recomputed from it.

## The AI Copilot Layer (`src/ai`)

This is the part worth reading closely, since it's what the rest of the
blueprint's 24 modules will plug into:

- **`skills/ai-skill.interface.ts`** defines an `AiSkill` — the "skill/tool
  registry" from Section 5.4. Twelve are wired up: `verify_property_documents`
  and `summarize_property` (Module 2); `estimate_project_budget`,
  `draft_project_status_update`, and `compare_vendor_quotes` (Modules 7/9);
  `explain_fees` and `flag_payment_anomaly` (Module 11);
  `generate_listing_description` and `boq_to_order` (Modules 5/10);
  `model_roi_scenario`, `assess_listing_risk`, and
  `generate_portfolio_report` (Priority 6 — see above). Every one of them
  is now reachable two ways: a direct `POST /ai/actions` quick-action call,
  or the model choosing to call it mid-chat via `POST /ai/chat`. Every skill
  also declares an `inputSchema` (`ai-skill-input-schema.ts` — see "Per-skill
  AI input schemas" above) describing the shape of the `input` object its
  `run()` expects; 11 of the 12 don't read `input` at all and use the shared
  `NO_INPUT_SCHEMA`.
- **`ai.service.ts`** is the one entry point every module's Ask AI panel
  calls into. It resolves the skill, checks the caller's account membership
  actually holds that skill's required permission (the AI layer never sees
  more than the human already could — Section 8), validates/coerces `input`
  against the skill's `inputSchema`, and persists an `AiRequest` → `AiOutput`
  pair so every draft is auditable.
- **`POST /ai/outputs/:outputId/decision`** is the server side of the Ask AI
  panel's Accept / Edit / Discard buttons. An `AiOutput` is a draft until
  exactly one `AiActionApproval` exists for it — nothing should ever treat
  an `AiOutput` as final by itself. (For an action that also moves money or
  publishes something, Accept here should additionally call that module's
  own approval endpoint once it exists — this endpoint records the
  decision, it doesn't yet chain into e.g. a milestone release.)
- **`llm/`** is a provider-agnostic interface. `StubLlmProvider` is the
  default (no API key needed — the whole permission/persistence pipeline is
  testable without one); set `ANTHROPIC_API_KEY` to switch to
  `AnthropicLlmProvider` automatically. Skills that only need structured
  facts (`verify_property_documents`) don't call the LLM provider at all;
  `summarize_property` shows the pattern for the ones that do — deterministic
  facts assembled from the database, LLM used only to phrase the intro line.

Try it once seeded:

```bash
# Ask AI to verify documents on the demo property
curl -X POST localhost:3001/ai/actions \
  -H "Authorization: Bearer <token from /auth/login>" \
  -H "X-Account-Id: <demo account id>" \
  -H "Content-Type: application/json" \
  -d '{"moduleContext":"property:<demo property id>","actionType":"verify_property_documents"}'

# Accept the draft it returns
curl -X POST localhost:3001/ai/outputs/<outputId>/decision \
  -H "Authorization: Bearer <token>" -H "X-Account-Id: <demo account id>" \
  -H "Content-Type: application/json" -d '{"decision":"accepted"}'
```

## Real end-to-end smoke test (this pass)

Every pass so far has repeated the same caveat: no cloud-sandbox session
building this scaffold has network access to `binaries.prisma.sh`
(confirmed once for `prisma generate`; this pass confirmed it again,
separately, for `prisma format` and `prisma validate` — **all three fail
identically**, since even `format` needs the query-engine binary in Prisma
5.19 and `validate` needs the schema-engine binary). One more thing this
pass confirmed that earlier passes hadn't stated this precisely: the
`@prisma/client` package installed here is the *un-generated* stub
(`export declare const PrismaClient: any`, and its runtime constructor
literally throws `"@prisma/client did not initialize yet. Please run
'prisma generate'..."`) — so `PrismaService extends PrismaClient` cannot
even be instantiated, meaning **no cloud-sandbox session has ever been able
to boot this app at all**, independent of whether a real Postgres was
reachable. The user's own machine (with real network access) is the only
place any of this has ever been confirmed to actually work.

Since neither "spin up Postgres" nor "run `prisma generate`" alone gets
past that, this pass did the part that's actually possible here and was
explicit about the part that isn't:

- **A real PostgreSQL 16 server, actually running in this sandbox**
  (`apt-get install postgresql` — genuinely reachable, unlike
  `binaries.prisma.sh`).
- **`prisma/tools/prisma_to_sql.py`** — a small, purpose-built (not
  general-purpose) translator from `schema.prisma` straight to PostgreSQL
  DDL: parses all 43 models, both enums, and every `@relation` into real
  `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE ... ADD CONSTRAINT FOREIGN
  KEY` statements, using the schema's own `@@map`/`@db.Decimal`/`@default`/
  `onDelete` annotations. This is **not** a Prisma-equivalence claim — it's
  a direct reading of one specific, consistently-formatted schema file, and
  its own header comment says so.
- Ran the generated DDL against the real Postgres server: **all 43 tables
  and 64 foreign keys created with zero errors.**
- **`prisma/tools/smoke-test.sql`** — one representative row inserted into
  every one of the 43 tables, in FK dependency order, mirroring the actual
  relationship chain the app writes (account → user → role/permission →
  member → property → document → project → escrow → payments →
  disputes → listings → suppliers → orders → reviews → AI conversation),
  plus explicit assertions that: `account_members`'s
  `[accountId, userId]` unique constraint rejects a duplicate,
  `vendor_reviews`'s `[projectId, vendorId]` unique constraint rejects a
  duplicate, `documents.propertyId`'s foreign key rejects a bad reference,
  and — the most useful check, since it exercises real cascade behavior,
  not just a syntax check — **deleting a `Property` really does `SET NULL`
  on `documents.propertyId` instead of deleting the document**, confirmed
  by an actual `DELETE` against the running database, not just read back
  from the schema text. All of it passed; the script ends with a literal
  `SMOKE TEST PASSED` row.
- **What this does and doesn't prove**: it's real, independent evidence
  that the schema's 43 models are internally consistent — every relation
  resolves to a real table and column, no duplicate constraint names, no
  reserved-word collisions — and that the *design* of the FK/unique/cascade
  rules (not just their Prisma DSL syntax) behaves as intended under an
  actual PostgreSQL engine. It is **not** the same as `prisma migrate dev`
  or `prisma generate` succeeding — a hand-rolled translator can diverge
  from Prisma's own DDL output in ways this pass wouldn't catch (exact
  index strategy, `@updatedAt` trigger semantics, edge-case type mapping),
  and it says nothing about whether the *application code* (NestJS
  services, the AI skills, the web app) actually works against a real
  database, since the app still can't boot here at all. Re-run it any time
  with the two commands in `prisma/tools/smoke-test.sql`'s own header
  comment.

## Payments rollup (this pass)

Closes the gap the "Payments & escrow screens" pass flagged explicitly:
every payments/escrow route lived under one project, so the sidebar's
"Payments" item had nowhere of its own to point.

- **`GET /payments/overview`** (`AccountPaymentsController`, a second
  controller in `src/payments/payments.controller.ts` alongside the
  existing project-scoped one) — not nested under `:projectId`, so it can't
  lean on `PermissionsGuard`'s ABAC convention the way every other route in
  this module does; `PaymentsService.getAccountOverview` filters by the
  caller's `accountId` directly instead. Still gated by the same
  `payment:read` permission as everything else here — no new permission
  key needed.
- Returns escrow balance, total deposited, and total released **grouped by
  currency** (`{ currency, balance|total }[]`, not one summed number) —
  the same caution `generate_portfolio_report`'s own comment already takes
  for cross-property pricing, since nothing here guarantees every project
  shares a currency — plus an open-dispute count across the account's
  projects and a per-project breakdown (title, property name, status,
  escrow balance/status, open dispute count).
- **`pages/payments/index.tsx`** — four stat tiles for the rollup numbers
  (the open-disputes tile picks up the warning color tokens when the count
  is above zero), then one card per project linking into that project's
  existing full payments/escrow view on `pages/projects/[id].tsx`. This
  screen is deliberately read-only: deposits, milestone approvals, and
  releases still only happen from inside a project, same as before — this
  is a portfolio-wide summary layered on top, not a second place to take
  those actions.
- The sidebar's "Payments" nav item is enabled now that it has a real
  screen to point to.

## AI skills read reviews (this pass)

The original plan for this pass, as offered to the user, was "wire vendor/
supplier reviews into `compare_vendor_quotes` and `assess_listing_risk`."
Once `assess-listing-risk.skill.ts` was actually re-read, that second half
turned out not to fit: `assess_listing_risk` looks at a property *listing*
(verification status, price deviation from comparable listings, missing
documents) and listings have no relationship to a `Vendor` or `Supplier` in
the schema at all — there's nothing for it to read. `boq_to_order` was
substituted instead: it's the materials-marketplace skill that already
looks up products by supplier, and reviews live on suppliers, so it's the
real counterpart to what `compare_vendor_quotes` does for vendors.

- **`compare_vendor_quotes`** (`src/ai/skills/compare-vendor-quotes.skill.ts`)
  used to show a vendor's pre-computed `ratingAverage` with no sense of how
  many reviews it rests on. It now `include`s `Vendor.reviews` (most recent,
  for its comment) and `_count.reviews` alongside the quote query, so every
  line reads e.g. "rated 4.6 across 3 reviews" instead of a bare number — a
  5.0 from one review and a 4.6 from twenty are not the same claim. The
  lowest-priced quote (the one this skill has always sorted to the top) now
  gets an explicit caution when its vendor has zero reviews or a rating
  under 3, since "cheapest" and "needs a second look" can both be true of
  the same quote; otherwise, if that vendor's most recent review has a
  comment, the skill surfaces it directly.
- **`boq_to_order`** (`src/ai/skills/boq-to-order.skill.ts`) similarly
  `include`s `Product.supplier`'s `ratingAverage` and `_count.reviews`, and
  appends the supplier's reputation to each matched scope item's "cheapest
  product" line. If any cheapest pick comes from a supplier with zero
  reviews, the skill adds a caution that price alone isn't enough signal to
  order on.
- Both skills use Prisma's `_count: { select: { reviews: true } }`
  relation-count feature rather than a second query, so the added read is
  one `include`, not an extra round trip.
- Demo data lines up with this: the seed vendor (`Lekki Renovations Co.`,
  `ratingAverage: 4.6`) has a real 5-star review with a comment on the demo
  project, and the seed supplier (`Lagos BuildMart`, `ratingAverage: 4.4`)
  has a real 4-star review — so running these skills against the demo
  project exercises the new reputation text and comment-surfacing with real
  rows, not just the empty-state branches.

## Auth hardening: rate limiting, refresh-token revocation, refunds (this pass)

Three of the gaps the "Auth hardening that's still open" and "Refunds"
bullets below used to flag — picked as the highest-value, lowest-risk slice
of the backlog to close first, ahead of any new module.

- **Rate limiting.** `@nestjs/throttler` is wired up globally in
  `AppModule` (100 req/min/IP baseline for every route) with a much
  tighter `@Throttle({ default: { limit: 5, ttl: 60_000 } })` on
  `POST /auth/login`, `/auth/forgot-password`, and `/auth/reset-password`
  specifically — the three endpoints the "not built yet" list called out
  by name as unlimited-attempt. `/auth/register` and `/auth/refresh` still
  only get the module-wide default, which is already a real change from
  "no limit anywhere."
- **Refresh-token revocation.** Refresh tokens were stateless — valid
  until their own 30-day expiry no matter what, per the comment that used
  to sit at the top of `auth.service.ts`. They're now tracked one row per
  token in a new `RefreshToken` model (`userId`, `jti`, `expiresAt`,
  `revokedAt`), keyed by a `jti` claim embedded in the JWT itself; the JWT
  signature still proves possession, the row is only what makes early
  revocation possible.
  - `POST /auth/refresh` now **rotates**: it revokes the row for the token
    just redeemed before issuing a new pair, so replaying an
    already-refreshed token is rejected even though it hasn't expired.
  - **`POST /auth/logout`** (new) revokes one refresh token on demand —
    unauthenticated, same reasoning as `/refresh`: the refresh token itself
    is the credential being acted on. Same "don't confirm anything to the
    caller" shape as `forgotPassword` — an already-invalid or unrecognized
    token still returns a plain success.
  - `resetPassword` now revokes every outstanding refresh token for that
    user in the same transaction as the password change, so a session
    started before whatever prompted the reset doesn't just keep working
    for up to 30 more days.
  - Still open: this closes early revocation, not the `localStorage`
    access-token-storage tradeoff — see "Web app auth hardening" above and
    the remaining bullet below.
- **Refunds.** `EscrowLedgerEntry.entryType` and `Payment.status` already
  had a `"refund"` state in the schema; there was just no endpoint. New:
  **`POST /projects/:projectId/payments/:paymentId/refund`**
  (`PaymentsService.refundPayment`), gated by `payment:approve` — the same
  permission `releaseMilestone` uses, for the same reason: moving money
  out of escrow deserves more than the plain `payment:write` a deposit
  needs. Only refundable while that deposit's own amount is still sitting
  in the escrow balance; if enough of it has already gone out via a
  milestone release, it fails with the same "insufficient balance" shape
  `releaseMilestone` already uses rather than taking the balance negative.
  Optional `reason` in the request body becomes the ledger entry's note.
  No receipt is issued for a refund (`Receipt` only models paying in or
  paying out, not giving back) — the updated `Payment.status` and the new
  `EscrowLedgerEntry` row are the record of it.

## Document verification (this pass)

Closes the specific gap the "Not built yet" list used to name: "no way for
the web app (or the API) to change a document's `verificationStatus`."
`verify_property_documents` (`src/ai/skills`) already checked a property's
documents against a checklist, but its own comment was explicit that it
never sets `verificationStatus` itself — that was always meant to be a
separate human/admin action, which simply didn't exist yet.

- **New permission `document:verify`**, distinct from `document:write` —
  uploading your own document and approving someone's document are
  different actions, same reasoning `payment:approve` is split from
  `payment:write`. Granted to the `property_owner`, `family_admin`, and
  `company_admin` roles; withheld from `vendor`, `supplier`, and `viewer`
  the same as the rest of the account-admin permission set.
- **`PATCH /documents/:documentId/verify`** (`DocumentsService.verify`) —
  body is `{ status: "verified" | "rejected", notes?: string }`. Not
  nested under `:propertyId`, so it can't lean on `PermissionsGuard`'s
  ABAC convention; filters by the caller's `accountId` directly instead,
  same shape as `PaymentsService.getAccountOverview`. Writes a
  `document_verified`/`document_rejected` `PropertyTimelineEvent` when the
  document is tied to a property, mirroring the existing
  `document_uploaded` event.
- **New `Document.verificationNotes`** column — a reviewer's reason for a
  rejection (or any caveat on a verification), shown back on the document
  row.
- **`pages/documents/index.tsx`** — a document still sitting at
  `not_verified` (or, if something ever sets it, `submitted`) gets
  inline Verify/Reject buttons; Reject expands a small optional-reason
  field first. Once a document is `verified` or `rejected` the controls
  disappear — this endpoint decides once, it doesn't support re-review.
  No client-side permission check: a member without `document:verify`
  sees the buttons and gets the API's 403, same pattern the project
  page's approve/release buttons already use.
- **Still not a neutral reviewer, at the time this was written.** This
  scaffold's RBAC had no reviewer identity outside the account itself —
  an account's own owner/admin could verify a document its own member
  uploaded, which isn't what Module 6's "neutral reviewer" ultimately
  calls for. A much later pass this same session added exactly that
  identity and gave it this exact action — see "Extending the neutral
  reviewer to document verification" further down.

## Two-party dispute resolution (this pass)

Closes the specific gap the "Not built yet" list used to name: "any
account member with `dispute:write` can both raise and resolve a
dispute — no neutral reviewer... or payment hold tied to an open
dispute." Still no independent third-party reviewer (same limitation as
document verification), but the two real, checkable pieces of that gap
are closed.

- **Can't resolve your own dispute.** `PaymentsService` now has a private
  `applyDisputeResolution` that both the owner-side and vendor-side
  resolve routes share: if `dispute.raisedByAccountId` matches the
  account trying to resolve it, that's a 403, not a resolution. On a
  project there are exactly two parties — the owning account and its
  assigned vendor's account — so this is a real check, not a
  self-certification with extra steps. Resolving an already-resolved or
  -rejected dispute is now a 409, not a silent overwrite.
- **Payment hold.** `releaseMilestone` and the new `refundPayment` (see
  "Auth hardening" above) both now check for an `open`/`under_review`
  dispute tied to that milestone/payment before moving money, and refuse
  with a 400 if one exists. Resolving the dispute clears the hold.
- **The vendor side of this didn't actually exist before.** The `vendor`
  role has always had `dispute:read`/`dispute:write`, but every dispute
  route lived under `/projects/:projectId/...`, and `PermissionsGuard`'s
  ABAC check 404s that whole path for any account that isn't the
  project's *owner* — a vendor could never reach it. New
  **`GET/POST /vendors/me/disputes`** and
  **`POST /vendors/me/disputes/:disputeId/resolve`** (`VendorsController`,
  delegating into `PaymentsService` — `VendorsModule` now imports
  `PaymentsModule`) give the vendor side the same access the owner side
  already had, keyed off `ProjectVendorAssignment` instead of the
  `:projectId` ABAC convention, same shape as `submitQuote`/`myQuotes`.
  Without this, the "can't resolve your own dispute" rule above would
  have made every dispute the owner raises permanently unresolvable —
  there'd be no other party who could ever reach the route.
- **`pages/projects/[id].tsx`** — the Resolve button disappears (replaced
  with "You raised this dispute — the other party needs to resolve it")
  when the signed-in account is the one that raised it.
  **`pages/vendors/me.tsx`** gets a new Disputes card: list, raise (with a
  project picker built from the vendor's own quotes/payouts), and resolve,
  all wired to the new vendor-side routes.

## Cart persistence & favorite accuracy (this pass)

Two small, unrelated fixes bundled together since both were the same
"Not built yet" bullet:

- **`GET /listings/:listingId` now reports `isFavorited`.** Before this,
  the listing detail page's Favorite button was optimistic-only — it
  fired the favorite/unfavorite call and toggled local state, but a
  reload always came back to an unfavorited-looking button regardless of
  the real `ListingFavorite` row, because `findOne` had no `accountId` to
  check one against. It does now (`ListingsController.findOne` passes
  `member.accountId` through), and `pages/marketplace/[id].tsx`
  initializes its `favorited` state from the response instead of always
  starting `false`. This was a real correctness bug, not just a missing
  feature — fixed outright, not flagged as a tradeoff.
- **The materials cart survives a refresh, at the time this was written.**
  `pages/marketplace/materials/[id].tsx`'s cart (`productId -> quantity`)
  round-tripped through `localStorage`, keyed per supplier
  (`potg:materials-cart:<supplierId>`), deliberately *not* a server-side
  `Cart` model — a real synced-across-devices cart was judged a
  materially bigger feature than "stop losing it on refresh" at the time.
  A later pass this same session built that bigger feature anyway and
  replaced this `localStorage` version outright, since a real account-
  scoped cart strictly subsumes what `localStorage` did — see "A real
  server-side cart" further down.

## Review editing, replies, and the "me" dashboards (this pass)

Closes two of the three "Reviews are one-shot and unmoderated" gaps —
editing/deleting a review and a reply from the reviewed party. The third
(a real admin/moderator) stays open, same "no neutral third party in this
scaffold's RBAC" limitation as document verification and dispute
resolution.

- **The reviewer can edit or delete their own review.**
  `PATCH`/`DELETE /projects/:projectId/reviews/:reviewId` (vendor
  reviews) and `PATCH`/`DELETE /orders/:orderId/reviews/:reviewId`
  (supplier reviews), gated by the existing `review:write` permission and
  an explicit check that `review.accountId` matches the caller — not just
  "this account owns the project/order," since those aren't quite the
  same claim. Editing the rating recomputes the vendor's/supplier's
  `ratingAverage`; deleting does too.
- **The reviewed vendor/supplier can reply.** New permission
  `review:respond` (separate from `review:write` — replying is the other
  party to the review, not a variant of leaving one), granted to the
  `vendor` and `supplier` roles only. New
  **`POST /vendors/me/reviews/:reviewId/reply`** and
  **`POST /suppliers/me/reviews/:reviewId/reply`** — vendor/supplier-
  initiated, so (same reasoning as `submitQuote`/`raiseDisputeAsVendor`)
  they check `Vendor.accountId`/`Supplier.accountId` themselves rather
  than leaning on `PermissionsGuard`'s ABAC. One reply per review —
  replying again overwrites the last one rather than threading. New
  `VendorReview.response`/`respondedAt` and
  `SupplierReview.response`/`respondedAt` columns; the reply shows
  wherever the review already did (the project page, the order page, and
  both public profile pages).
- **The "me" dashboards now show received reviews.** `GET /vendors/me`
  and `GET /suppliers/me` already `include`d `reviews` — the gap was
  purely that `pages/vendors/me.tsx` and
  `pages/marketplace/materials/me.tsx` never rendered them. Both now have
  a Reviews section with the reply control described above.
- **Unrelated fix found along the way:** `AppShell`/`AuthLayout` built
  `<title>` as `<title>{title} · PropertyOnTheGo</title>` — two JSX
  children (`{title}` and the literal `" · PropertyOnTheGo"`), which
  React warns is invalid (`<title>` can only take a single text node) and
  falls back to client-only rendering to recover. Every page hit this.
  Fixed to a single interpolated string.

## Accepting a status-update draft now posts it (this pass)

Closes the gap the "Not built yet" list called "chaining an AI Accept
into the action it drafted for" — for one skill. The original example
given (a payment-anomaly flag's Accept placing a payment hold) turned out
not to fit once re-examined: `flag_payment_anomaly` reports anomalies
already present in the ledger (a mismatched payout, a duplicate release)
— there's no pending action for an Accept to trigger, nothing to "hold."
`draft_project_status_update` was substituted: its draft is exactly one
paragraph of text with one obvious destination
(`POST /projects/:projectId/updates`), which is exactly the shape "Accept
should perform the real action" needs to mean something.

- **`AiService.decide`** now runs a new private `applyChainedAction`
  before recording the `AiActionApproval` — not after, so if the chained
  action fails, nothing gets marked "decided" and the caller can retry,
  rather than being stuck with a recorded Accept that never took effect.
  Only `decision === "accepted"` chains; `"edited"` deliberately never
  does, since an edit's `notes` describe what the human changed, not the
  corrected text itself — there's nothing safe to write automatically.
- **`draft_project_status_update`'s Accept** calls
  `ProjectsService.addUpdate` with the draft's own text. Its own
  `run()` only ever needed `project:read`, but posting a real update
  needs `project:write` — so accepting the draft checks `project:write`
  again rather than assuming the permission that let someone *see* the
  draft is enough to let them *post* it.
- **Fixed a real gap found while wiring this up:** `AiService.decide` had
  no tenant-isolation check at all — any account with `ai:act` could
  decide on any `AiOutput` by id, regardless of which account's
  `AiRequest` it belonged to. Now 404s (not 403) for a draft that isn't
  the caller's account's own, same "don't confirm it exists" shape as
  every other cross-tenant check in this codebase.
- Every other skill's Accept is unchanged — still records the decision
  only. See "Not built yet" below for which ones and why.

## Real invite/accept flow (this pass)

Closes the gap `AddMemberDto`'s own comment used to flag: `POST
/accounts/:accountId/members` only ever worked for an email that already
had a User on the platform. Building this surfaced a critical,
independently-fixed IDOR in the same endpoint — see below.

- **`AccountInvite`** — same `tokenHash` pattern as `PasswordResetToken`
  (only the hash is stored; the raw token is a one-time bearer
  credential). `AccountsService.addMember` now branches on whether
  `email` already has a `User`: existing → added immediately, exactly as
  before; new → creates (or, on a re-invite, refreshes) a pending invite
  instead of failing. `WEB_APP_URL` isn't set in this scaffold, so the
  link is only ever logged server-side and returned raw in the
  response — same no-real-email-provider tradeoff as
  `forgotPassword`'s `resetToken`.
- **Two ways to accept**, because the recipient might already be
  registered or might not be:
  - **`GET /invites/:token`** (public — no guard at all, since the
    recipient may not be signed in yet) previews what the invite leads
    to, including whether the email already has a `User`, so the client
    knows whether to route to login or register.
  - **`POST /invites/:token/accept`** (`JwtAuthGuard` only, no account
    context — accepting is how you *get* account context for that
    account) — for someone already signed in. Rejects an invite/user
    email mismatch with 403, and an already-accepted/expired one with
    400.
  - **`RegisterDto.inviteToken`** — for someone brand new. Validated
    *before* the `User` is created (a bad token fails registration
    cleanly rather than leaving a signed-up user whose invite silently
    didn't take), then the membership is created in the same call.
    Deliberately not implemented by calling `AccountsService.acceptInvite`
    — that path already has a signed-in user; this one is still creating
    one, so it keeps its own copy of the same validate-then-consume
    logic rather than manufacturing a cross-module dependency for it.
- **New `GET /accounts/:accountId/members`** and **`pages/accounts/
  members.tsx`** — there was no way to even see who was already in an
  account before this pass, let alone invite someone; the page lists
  current members, pending invites, and the invite form (which surfaces
  the raw link for the "no email provider" reason above).
  **`pages/accept-invite.tsx`** is the recipient's landing page; `/login`
  gained a `redirect` query param (validated to an in-app path only) so
  it can send an already-registered recipient there after signing in.
- **Found and fixed separately: a critical IDOR in this same endpoint.**
  `PermissionsGuard` checked that the caller had `account:manage_members`
  *somewhere*, never that it applied to the `:accountId` in the URL —
  since `addMember` used that URL param directly, any account owner
  could add themselves (or anyone, with any role) to *any other account
  on the platform* by putting a different id in the URL. Confirmed
  exploitable against live seed data, then fixed by extending
  `PermissionsGuard`'s existing `:propertyId`/`:projectId` ABAC pattern
  to `:accountId` — see that guard's own comment. Shipped as its own
  commit, independent of the invite work that surfaced it.
- **Revoking or resending a pending invite is no longer missing** — see
  "Revoking and resending pending invites" below. Still not built: any
  invite listing beyond one account's own Members page.

## Revoking and resending pending invites (this pass)

Closes the gap the invite/accept pass above left open: re-inviting the
same email worked as an implicit revoke + resend, but there was no way to
kill a pending invite without replacing it, or resend one without
re-entering its role.

- **`AccountsService.revokeInvite`** sets `AccountInvite.status` to
  `"revoked"` — a value the schema's own `status` comment already
  anticipated (`pending | accepted | revoked`) but nothing wrote until
  now. A revoked invite's token stops resolving immediately: `GET
  /invites/:token` (the same lookup `acceptInvite` and registration use)
  only ever treats `status === "pending"` as live, so a revoked token
  behaves exactly like an expired one — confirmed live, not assumed.
- **`AccountsService.resendInvite`** reuses `addMember`'s token-rotation
  (new raw token, new hash, refreshed 7-day expiry) but keyed off the
  invite's own id instead of its email, so the caller doesn't have to
  remember or re-pick a role. Same "no email provider" tradeoff as every
  other invite/reset flow here — the new raw token is logged server-side
  and returned in the response for the web UI to show directly.
- Both share a new `requirePendingInvite` guard: 404 if the invite id
  doesn't belong to `:accountId` (same cross-tenant shape as everywhere
  else), 400 if it's already accepted or revoked — so a stale double-click
  fails cleanly instead of silently reviving a dead invite.
- **`POST /accounts/:accountId/invites/:inviteId/revoke`** and **`POST
  /accounts/:accountId/invites/:inviteId/resend`**, both gated on
  `account:manage_members` exactly like adding a member — revoking or
  resending someone else's pending invite needs the same permission as
  sending it in the first place, not a new one.
- **`pages/accounts/members.tsx`** gets Resend/Revoke buttons on each
  pending-invite row; Resend shows the fresh link the same way the invite
  form does on first send.
- **Verified live:** invited a fresh email, resend rotated the token (the
  old link started 404ing, the new one resolved via `GET
  /invites/:token`), then revoke removed it from the pending list and its
  latest token also started 404ing — all confirmed by calling the API
  directly, not just reading the UI state.

## Property inspections — Module 8 (this pass)

The first genuinely new module added since the original scaffold, rather
than a gap closed in one already built — chosen because it's fully
self-contained (no external credentials or infrastructure, unlike a real
payment gateway or a search/vector layer) and fits the existing data
model directly: a property already has documents, valuations, and a
timeline; this adds the physical-condition-check most of Module 8's
blueprint description is actually about. Distinct from Module 4's
document verification (this pass's earlier work) — that checks paperwork,
this checks the property itself.

- **`PropertyInspection`** (scheduled → completed or cancelled) and
  **`InspectionFinding`** — same `accountId`-free, `:propertyId`-ABAC
  shape as `PropertyValuation`: nothing here duplicates an ownership
  check, since any route nested under `/properties/:propertyId/...`
  already gets one from `PermissionsGuard`. An inspection can optionally
  reference a `Project` (e.g. a post-renovation inspection) — validated
  to actually belong to the same property, the same cross-reference
  sanity check `VendorsService.createReview` and
  `PaymentsService.raiseDispute` already make for their own optional
  links.
- **`POST /properties/:propertyId/inspections`** schedules one;
  **`.../inspections/:inspectionId/complete`** sets the result, an
  optional summary, and any findings (area/description/severity) in one
  call — findings are never added one at a time, so an inspection's
  findings can't drift out of sync with whether it's still "scheduled".
  **`.../cancel`** is the other terminal state. New `inspection:read`/
  `inspection:write` permission pair, granted like `property:read`/
  `property:write` to the three account-admin roles (`inspection:read`
  only for `viewer`) — kept separate from the property permissions
  themselves since "who can see a property" and "who can schedule an
  inspection on it" are reasonable to grant independently.
- **No separate Inspector identity — but the inspector can now be a
  platform vendor.** `inspectorVendorId` optionally links to `Vendor`
  (see "Linking inspectors and maintenance assignees to real vendor
  accounts" below); `inspectorName` stays freeform text for a
  non-platform inspector or a licensed-inspector role this scaffold
  still doesn't have (Modules 1-24 stop at what's actually implemented
  here; see the "Not built yet" list below).
- **`summarize_inspection_history`** (new AI skill, `property` context)
  — reads a property's full inspection history and drafts what it
  actually says about the property's condition (how many came back
  needs-attention/fail, common major-finding areas), not just a list of
  past visits. Zero extra wiring needed for `AskAiPanel` to pick it up —
  confirmed live: the skill appeared in the panel and ran correctly the
  moment it was registered in `AiModule`, exactly the "write one AiSkill,
  list it once" design Section 5.4 calls for.
- **`pages/properties/[id].tsx`** gets a new Inspections card — schedule
  form, list with status badges, and an inline Complete form (result +
  summary + add findings one at a time before submitting). The existing
  `TIMELINE_ICON` map already had `inspection_completed: "🔍"` defined
  from the original scaffold with nothing that ever produced that event
  — first real confirmation this module was anticipated, not bolted on.
- Verified against the live dev API (schedule, cross-property project
  rejected, list, complete with findings, double-complete rejected,
  cancel, permission-403 for a role without `inspection:write`) and in
  the browser (schedule → complete → timeline event, all through the
  actual form UI) — see "Not built yet" for the two gaps left in it.

## Leases — Module 13 (this pass)

The second genuinely new module added this session. Module 5's property
marketplace (`PropertyListing` with `listingType: "rent"`/`"short_let"`,
plus `ListingInquiry`/`ListingOffer`) gets a property rented out; nothing
tracked what happens *after* that — the ongoing tenancy, its rent
schedule, or payments against it. Deliberately not wired to
Listing/Offer at all: a lease can just as well start from an owner
recording a tenancy that predates this software, same "record what's
true, don't force a specific prior workflow" reasoning
`PropertyValuation.source: "manual"` already uses.

- **`Lease`** (active → ended or terminated) and **`LeaseRentPayment`**
  — same `accountId`-free, `:propertyId`-ABAC shape as `PropertyValuation`
  and `PropertyInspection`. A rent payment here is a plain record that
  rent was paid, same "simulated, not a real payment rail" depth Module
  11's own `Payment` model already has — it doesn't move money or touch
  escrow. A real deployment collecting rent through the platform would
  tie this to `Payment`/`EscrowAccount` instead of standing alone.
- **`POST /properties/:propertyId/leases`** creates one; **`.../leases/
  :leaseId/rent-payments`** records a payment (blocked once the lease
  isn't `"active"` — no rent to record against an ended one);
  **`.../end`** is the other terminal state (`"ended"` or
  `"terminated"`). New `lease:read`/`lease:write` permission pair,
  granted like `inspection:read`/`write` — its own pair rather than
  folded into `property:read`/`write`, same reasoning Module 8 gives.
- **No separate Tenant identity.** `tenantName`/`tenantEmail`/
  `tenantPhone` are freeform fields, not a relation — same scaffold-depth
  tradeoff `PropertyInspection.inspectorName` already documents, for the
  same reason (no licensed-tenant/renter account type exists here).
- **`summarize_lease_status`** (new AI skill, `property` context) —
  reads a property's full lease history and drafts what it actually
  says: active vs. ended leases, total rent collected, and a call-out
  when a lease is ending within 60 days (worth a renewal conversation),
  not just a list of tenancies. Zero extra wiring for `AskAiPanel` to
  pick it up, same as `summarize_inspection_history` before it.
- **`pages/properties/[id].tsx`** gets a new Leases card: create-lease
  form, per-lease status, an inline "record rent payment" form, and an
  "end lease" action. New `lease_started`/`lease_ended` timeline events
  (🔑/📤) — unlike `inspection_completed`, the original `TIMELINE_ICON`
  map had no entry waiting for these, so this module genuinely wasn't
  anticipated the way inspections turned out to be.
- Verified against the live dev API (create, list, record two rent
  payments, run the AI skill, end the lease, rent-after-ended rejected,
  timeline events) and in the browser (create → record payment → end,
  all through the actual form UI, plus the AI skill running from the
  panel).

## Maintenance requests — Module 12 (this pass)

The third genuinely new module added this session, same self-contained
pattern as Property inspections and Leases: no external credentials or
infrastructure, fits directly alongside the property's existing timeline
and (optionally) an active lease. A maintenance request is what a tenant
or owner reports going wrong with a property, tracked from report through
resolution — distinct from Module 8's inspections (a scheduled, proactive
condition check) and from Module 13's leases (the tenancy a request can
optionally be reported against).

- **`MaintenanceRequest`** (open → in_progress → resolved, or cancelled
  from either open state) — same `accountId`-free, `:propertyId`-ABAC
  shape as `PropertyInspection` and `Lease`. Optionally references a
  `Lease`, validated to actually belong to the same property, the same
  cross-reference check `PropertyInspection.projectId` already makes for
  its own optional link.
- **`POST /properties/:propertyId/maintenance-requests`** reports one
  (title, description, `priority`: low/normal/high/urgent, defaulting to
  normal); **`.../start`** moves it to `in_progress` and can set
  `assignedTo`; **`.../resolve`** is a terminal state with optional
  resolution notes and logs a `maintenance_resolved` timeline event
  (🧰); **`.../cancel`** is the other terminal state, allowed from either
  `open` or `in_progress`. New `maintenance:read`/`maintenance:write`
  permission pair, granted like `inspection:read`/`write` and
  `lease:read`/`write` — its own pair, same reasoning Module 8 and Module
  13 both give.
- **No separate Contractor identity — but the assignee can now be a
  platform vendor.** `assignedVendorId` optionally links to `Vendor`,
  reusing Module 9's marketplace directory (see "Linking inspectors and
  maintenance assignees to real vendor accounts" below); `assignedTo`
  stays freeform text for the owner doing it themselves or a contractor
  off-platform, the same "record what's true, no forced workflow"
  tradeoff `Lease.tenantName` still documents.
- **`summarize_maintenance_backlog`** (new AI skill, `property` context)
  — reads a property's full maintenance history and drafts what it
  actually says: how many requests are open/in-progress out of the
  total, how many are urgent, and a call-out for anything open 7+ days
  (worth following up), not just a list of tickets. Zero extra wiring
  for `AskAiPanel` to pick it up, same as `summarize_inspection_history`
  and `summarize_lease_status` before it.
- **`pages/properties/[id].tsx`** gets a new Maintenance card: report
  form (with an optional lease dropdown), per-request status, and
  inline Start/Resolve/Cancel actions. New `maintenance_resolved`
  timeline icon (🧰) — like Leases and unlike Inspections, the original
  `TIMELINE_ICON` map had no entry waiting for this one.
- Verified against the live dev API (report, cross-property lease
  rejected, list, get one, start, double-start rejected, resolve,
  cancel-after-resolve rejected, cancel from open, tenant isolation via
  a nonexistent property returning 404, the AI skill) and in the browser
  (report → start → resolve, all through the actual form UI). Browser
  testing caught a real bug in the first pass: `onStart`/`onCancel` only
  reset their `busy` flag in the `catch` branch, so after successfully
  starting a request the Resolve/Cancel buttons stayed silently disabled
  forever (the API call had already succeeded — only the UI was stuck).
  Fixed by resetting `busy` in a `finally` block, matching the pattern
  `onResolve` already used correctly.

## Vendor trust score — Module 6 slice (this pass)

Not a new module data-wise — reuses `Vendor.verificationStatus`,
`Vendor.ratingAverage`/`VendorReview`, `ProjectVendorAssignment`, and
`Dispute`, all of which already existed — but the first thing in this
scaffold that actually computes and surfaces a *trust score*, the piece
of Module 6 ("a neutral reviewer, risk flags, trust scores") that was
still completely missing. `assess_listing_risk` already covered risk
flags for listings; this is its counterpart for the vendor marketplace.

- **`apps/api/src/vendors/trust-score.ts`** — a new shared module (not a
  new model or migration) exporting the deterministic formula: start at
  50, `+20` verified / `+5` pending, `+(ratingAverage - 3) * 10`, `+3` per
  completed project (capped at `+15`), `-8` per dispute on a project this
  vendor was assigned to (capped at `-30`), clamped to `[0, 100]`. Banded
  into excellent/good/fair/caution for display. Computed on read, not
  stored — too many separate flows touch its inputs (review CRUD,
  verification status, project completion, dispute resolution) to keep a
  denormalized column in sync the way `Vendor.ratingAverage`'s narrower
  recompute hook can.
- **`GET /vendors/:vendorId` and `GET /vendors/me`** now attach a
  `trustScore` object (`{ score, band, factors }`) to the response — not
  `GET /vendors` (the marketplace browse list), where computing it for
  every row would mean per-vendor extra queries on a list that's already
  sorted by `ratingAverage` for exactly this purpose.
- **`explain_vendor_trust_score`** (new AI skill, `vendor` context,
  public/buyer-facing like `assess_listing_risk` — not filtered by
  `ctx.accountId`) — imports the same `trust-score.ts` formula so it
  never drifts from what the REST endpoint returns, and has the LLM
  phrase one neutral paragraph over the real factor breakdown. Needed
  its own `AskAiPanel` wiring on the vendor detail page — unlike Modules
  8/12/13's property-context skills, no `AskAiPanel` existed there yet at
  all.
- **`pages/vendors/[id].tsx`** gets a trust score badge (score/100, band,
  and the factor summary) on the vendor header card, plus the new AI
  panel. Verified against the live dev API (`GET /vendors/:id` and
  `/vendors/me` both return the same score, the AI skill draft matches
  the REST numbers exactly) and in the browser (badge renders, "Explain
  vendor trust score" appears in the panel with zero extra wiring and
  its draft matches the page).
- **Still not what Module 6's "neutral reviewer" calls for at the time
  this was written.** This is the platform's own arithmetic over data
  the vendor's own marketplace activity already produced — reviews come
  from the accounts that hired it, not an independent auditor — and at
  this point in the session `verificationStatus` still had no endpoint
  at all. A later pass this same session added one, gated to a real
  separate role — see "A real neutral reviewer for vendor/supplier
  verification" further down.

## Supplier trust score (this pass)

The materials-marketplace counterpart to the vendor trust score above,
added right after it in the same pass once the vendor version proved out
— same formula shape, same "computed on read, shared with an AI skill"
structure, just swapped for the signals a `Supplier` actually has.

- **`apps/api/src/materials/trust-score.ts`** — same shared-module
  pattern as `vendors/trust-score.ts`: start at 50, `+20` verified / `+5`
  pending, `+(ratingAverage - 3) * 10`, then the two signals that differ
  from the vendor version — suppliers have no `Dispute` model, so
  delivered orders (`+2` each, capped at `+15`) stand in for completed
  projects as the positive track-record signal, and cancelled orders
  (`-8` each, capped at `-30`) stand in for disputes as the negative one
  (the closest supplier-side analogue to "something went wrong with this
  transaction"). Same `[0, 100]` clamp and excellent/good/fair/caution
  bands.
- **`GET /suppliers/:supplierId` and `GET /suppliers/me`** now attach the
  same `trustScore` shape the vendor endpoints do.
- **`explain_supplier_trust_score`** (new AI skill, `supplier` context) —
  same public/buyer-facing shape as `explain_vendor_trust_score`, reusing
  `materials/trust-score.ts` so it can't drift from the REST response.
- **`pages/marketplace/materials/[id].tsx`** (the supplier detail page —
  despite the URL, this is a `Supplier` profile, the materials-market
  counterpart to `pages/vendors/[id].tsx`) gets the same trust score
  badge and its first `AskAiPanel`.
- Verified the same way as the vendor version: live API (`GET /suppliers/
  :id` and the AI skill return matching numbers — 90/100 "excellent" for
  the seeded supplier, hand-checked against the formula) and in the
  browser (badge renders, "Explain supplier trust score" appears with
  zero extra wiring, draft matches the page).
- **Same limitations as the vendor score at the time this was written**
  — the score itself still isn't an independent audit, and at this point
  `Supplier.verificationStatus` still had no endpoint either. See "A real
  neutral reviewer for vendor/supplier verification" further down for
  what a later pass this session added.

## Edit endpoints for Inspections, Leases, and Maintenance requests (this pass)

After the two marketplace trust scores, back to closing self-flagged
gaps: each of this session's three property-nested modules could be
created and moved through its own lifecycle, but never edited — a typo
in an inspection's inspector name, a lease's rent changing mid-tenancy,
or a maintenance request's priority needing to go up, all meant deleting
the record and starting over (which none of these modules even support —
there's no delete endpoint either). One `PATCH` route per module, each
gated to the same lifecycle stage its own create/action endpoints
already assume:

- **`PATCH /properties/:propertyId/inspections/:inspectionId`**
  (`inspection:write`) — only while still `"scheduled"`, the same gate
  `completeInspection`/`cancelInspection` already use. Can change type,
  date, inspector name, or the linked project (re-validated to belong to
  the same property, same check `scheduleInspection` makes); an empty
  `projectId` clears an existing link.
- **`PATCH /properties/:propertyId/leases/:leaseId`** (`lease:write`) —
  only while still `"active"`. Can change tenant contact fields, rent
  amount/frequency, deposit, start date, or end date; an empty `endDate`
  clears one. Notably does *not* touch existing `LeaseRentPayment`
  records if the currency or amount changes — those stay historical.
- **`PATCH /properties/:propertyId/maintenance-requests/:requestId`**
  (`maintenance:write`) — only while `"open"` or `"in_progress"`, the
  same `isOpen` gate `resolveMaintenanceRequest`/`cancelMaintenanceRequest`
  share. Title, description, and priority only — not `leaseId` or
  `assignedTo`, since re-pointing which lease a report is against after
  the fact felt like a different action than fixing a typo, not an edit.
- **Web UI**: each of the three list rows (`InspectionRow`, `LeaseRow`,
  `MaintenanceRequestRow` in `pages/properties/[id].tsx`) gets an inline
  "Edit" button next to its existing actions, opening a form pre-filled
  from the current record — same inline-toggle pattern the existing
  Complete/Resolve/Record-payment forms already use.
- Verified against the live dev API (edit while eligible, rejected with
  a clear message once the record leaves that stage — cancelled
  inspection, ended lease, resolved maintenance request all correctly
  refused) and in the browser for all three (pre-filled edit form saves
  and the row reflects the new values immediately).

## Overdue-rent detection for Leases (this pass)

The last piece of the Leases gap this session had already named:
`summarize_lease_status` could say a lease was ending soon, but never
whether rent itself had gone unpaid — there's no real payment/reminder
system behind `LeaseRentPayment` (it's a manual record, same as it was
when the module was first built), so this is a deterministic read of
what's already on file, not a payment tracker.

- **Definition**: a lease "looks overdue" when more than one rent period
  (7/30/365 days for weekly/monthly/annually — `monthly` is a 30-day
  approximation, same order-of-magnitude simplification `Document`'s
  30-day "expiring soon" window already uses) has passed since the
  latest recorded payment's `periodEnd`, or since the lease's own
  `startDate` if no payment has ever been recorded.
- **`summarize_lease_status`** now computes this per active lease,
  mentions the count in its opening line, tags each overdue lease inline
  (`— rent looks ~N day(s) overdue`), and sets `warn: true` whenever any
  lease is overdue or ending soon (previously only the latter).
- **`pages/properties/[id].tsx`**: `isRentOverdue()` runs the identical
  check client-side so a "Rent Overdue" badge shows on the lease row
  directly, without opening the AI panel — the same pairing `isExpiring()`
  gives Documents' "expiring soon" badge. Two independent
  implementations of the same simple formula, not a shared import, since
  one runs in the AI skill's Prisma context and the other in the browser
  against already-fetched JSON.
- Verified against the live dev API (a lease with old `startDate` and no
  payments correctly flagged with the right day count and `warn: true`;
  a lease that started today correctly not flagged) and in the browser
  (the overdue lease shows the red badge, the current one doesn't).

## A real neutral reviewer for vendor/supplier verification (Module 6)

Every earlier mention of Module 6 in this README carried the same
caveat: verification and trust scores are the platform's own arithmetic,
or an account's own admin verifying its own content — never an
independent party. This pass closes that gap for exactly two fields,
`Vendor.verificationStatus` and `Supplier.verificationStatus`, which
until now had no endpoint at all (not even a self-serve one). The design
question was whether a "reviewer" role granted to the vendor/supplier's
own account would even count as neutral — it wouldn't, a business
verifying itself defeats the point — so this had to be a genuinely
separate account with a role no vendor or supplier account ever holds.

- **New `vendor:verify`/`supplier:verify` permissions** and a new
  **`platform_reviewer` role** (`seed.ts`) — deliberately minimal
  (`vendor:read`, `vendor:verify`, `supplier:read`, `supplier:verify`
  only, not even `ai:act`), and deliberately *never* added to the
  `vendor`/`supplier`/owner roles above it, the same way `RolePermission`
  already keeps `payment:approve` off the `vendor` role so a vendor can't
  release its own escrow. That omission — not an account-type flag — is
  what actually makes this neutral.
- **`PATCH /vendors/:vendorId/verification`** and **`PATCH /suppliers/
  :supplierId/verification`** — no `:accountId`/`:propertyId` param for
  `PermissionsGuard`'s ABAC to key on, so (like the existing `GET .../:id`
  routes) these reach any vendor/supplier on the platform once the
  caller's role has the permission; there's nothing to reach if it
  doesn't. Status is one of `not_verified`/`pending`/`verified`, same set
  the field's own default comment already listed.
- **Demo data**: `seed.ts` gives the same demo owner a *third* account
  membership — `PropertyOnTheGo Trust & Safety` (`COMPANY` accountType,
  chosen only to avoid an `AccountType` enum migration for what's really
  a role distinction; the account has no properties, projects, or
  anything else) — with the `platform_reviewer` role. Same "one user,
  several accounts" pattern the demo vendor/supplier accounts already
  established.
- **Web UI**: a `PlatformReviewPanel` on both `pages/vendors/[id].tsx` and
  `pages/marketplace/materials/[id].tsx`, rendered only when
  `auth.currentAccount?.role === "platform_reviewer"` — unlike the
  Documents page's Verify/Reject controls (which skip the client-side
  check on purpose, see "Document verification" above), here the panel's
  *visibility* doing the gating is deliberate: showing self-verification
  controls to every vendor/supplier visiting their own page would be
  actively misleading about what the feature is for, not just redundant.
- Verified against the live dev API: the platform account can move a
  vendor/supplier through all three statuses; the vendor's own account
  gets 403 `Missing permission(s): vendor:verify` attempting the same
  call on itself; an unrelated property-owner account gets the identical
  403; an invalid status value gets a 400. In the browser: switching to
  the seeded platform account surfaces the panel and live-updates the
  trust score underneath it as status changes (verified → pending
  visibly dropped the same vendor's score from 53 to 38, "Fair" to
  "Caution"), and switching back to the demo owner's own account hides
  the panel entirely — the "Request a quote" panel takes its place.
- **Still not the full Module 6 neutral-reviewer workflow.** This closes
  it for exactly the two fields that had no verification path at all.
  Document verification (any account's own admin) and dispute resolution
  (the project's owner or its assigned vendor) remain what they were —
  seeded data, not moved onto the new role, since a document/dispute
  reviewer would need to review specific content, not just flip a status,
  which is a larger workflow than this pass's scope.

## Tool/equipment rental booking (Module 10)

Closes the other named gap in Module 10's "Not built yet" bullet: `src/
materials` went straight from browsing to a line-item `Order`, with no
rental calendar for tools/equipment at all. A rental is a different
lifecycle from a purchase — requested → confirmed → returned, over a
date range, against shared stock — not another `OrderItem`.

- **`Product.isRentable`/`rentalPricePerDay`** (new columns) — a product
  is either sold, rentable, or both; the flag and its price only mean
  something together, same "flag plus a field that's only meaningful
  when the flag is set" shape `EscrowAccount`/`Payment` pairs already
  use elsewhere. `CreateProductDto`/`UpdateProductDto` both take them.
- **`RentalBooking`** (new model: `requested → confirmed → returned`, or
  `cancelled` from either open state) — shares a product's regular
  `stockQuantity`, there's no separate rental-only count. Availability is
  a standard interval-overlap check: the sum of `quantity` on
  `requested`/`confirmed` bookings whose date range overlaps the new
  request must leave enough stock for it.
- **`POST /products/:productId/rental-bookings`** (`rental:write`) — 400s
  if the product isn't rentable, if `endDate` isn't after `startDate`, or
  if the overlap check leaves too little stock (the error names exactly
  how many units *are* available for those dates). `totalPrice` is
  computed server-side (`rentalPricePerDay × days × quantity`), never
  trusted from the client. **`GET /rental-bookings/me`** (renter) and
  **`GET /suppliers/me/rental-bookings`** (supplier) are the only list
  routes — deliberately no `GET /products/:id/rental-bookings`, which
  would leak other renters' booking details to anyone browsing the
  catalog. **`.../confirm`**, **`.../return`**, **`.../cancel`**
  (`rental:write`) — confirm/return are supplier-only (via the same
  `requireOwnSupplier` check `createProduct` uses); cancel accepts either
  the renter or the supplier, the same "either party" shape
  `RentalBooking.status` needed since a supplier might need to back out
  of a request too.
- **New `rental:read`/`rental:write` permission pair** — its own pair,
  same reasoning `inspection:read`/`write` and `lease:read`/`write` both
  give (a distinct action, not folded into `order:*`). Granted to the
  three owner-side roles and `vendor` (the renter side — a contractor
  renting equipment for a job) and `supplier` (the fulfillment side);
  `viewer` gets `rental:read` only.
- **`summarize_rental_bookings`** (new AI skill, `supplier` context) —
  counts awaiting confirmation and overdue-for-return (confirmed, past
  `endDate`, never marked returned) bookings, same deterministic-compute-
  plus-LLM-phrasing split every other skill this session uses.
- **Web UI**: a "Rent this" toggle next to any rentable product's cart
  quantity field (`pages/marketplace/materials/[id].tsx`) opens an inline
  date-range request form; a new `pages/marketplace/materials/rentals.tsx`
  ("My rentals", linked from the marketplace header) lists a renter's own
  bookings with a cancel action; the supplier dashboard
  (`pages/marketplace/materials/me.tsx`) gets a rental toggle on
  create/edit product forms and a new "Rental bookings" card with
  confirm/return/cancel actions.
- Verified against the live dev API: a rentable product's booking
  succeeds with the right computed price; a second overlapping booking
  that would exceed stock is rejected naming the real remaining count; a
  non-overlapping booking on the same product succeeds; booking a
  non-rentable product and an inverted date range both 400; the renter
  attempting to confirm their own booking fails (no supplier profile);
  double-confirm, return-before-confirm, and double-cancel are all
  rejected; the AI skill's overdue count matches a booking confirmed with
  a past `endDate`. In the browser: requesting a rental from the catalog,
  cancelling it from "My rentals", and confirming/marking-returned from
  the supplier dashboard all worked end to end, with badges and card
  contents matching the API state at every step.

## A real server-side cart (this pass)

The last named half of the materials-marketplace gap this session
inherited: "there's still no `Cart`/`CartItem` model, so it doesn't
follow the account across devices or reconcile against a product's
price/stock changing while it sits in the cart." Rental booking closed
the other half. This replaces the supplier detail page's `localStorage`
cart outright — a real account-scoped cart strictly subsumes what
`localStorage` did (survive a refresh) plus what it never could (follow
the account across devices), so there was no reason to keep both.

- **`CartItem`** (new model) — one row per `(accountId, productId)`,
  `@@unique` enforced so `upsertCartItem` is a straight upsert, not a
  find-then-branch. Quantity `0` deletes the row rather than storing a
  meaningless zero line.
- **`GET /cart`** (`order:read`) lists every item across every supplier
  for the caller's account. **`POST /cart/items`** and **`DELETE /cart/
  items/:productId`** (`order:write`) upsert or remove one line.
  **`POST /cart/checkout`** (`order:write`, body `{ supplierId,
  projectId?, deliveryAddress? }`) reads the account's cart items for
  *that* supplier, builds the same `{ productId, quantity }[]` shape
  `CreateOrderDto` already takes, and calls `createOrder` directly —
  price computation, stock decrement, and the "does every product belong
  to this supplier" check all stay in the one place that already had
  them, never duplicated. Only the checked-out supplier's items are
  cleared from the cart afterward; items from other suppliers are
  untouched, matching how an `Order` has always been per-supplier.
  Deliberately reuses the existing `order:read`/`order:write`
  permissions rather than adding a `cart:*` pair — a cart is a staging
  area for an order, not a distinct action worth its own permission the
  way inspections/leases/maintenance/rentals each got.
- **`pages/marketplace/materials/[id].tsx`**: the `localStorage`
  read/write `useEffect` pair is gone. The quantity inputs now call
  `GET /cart` on load (filtered client-side to this supplier's items —
  the account's cart can span suppliers, this page only shows one) and
  `POST /cart/items` on every change; `OrderWidget`'s submit calls
  `POST /cart/checkout` instead of building an `items` array from local
  state and posting straight to `/orders`.
- Verified against the live dev API (add/update/zero-clears a line,
  checkout with no matching items 400s, checkout computes the right
  total and decrements stock, the cart is empty afterward) and in the
  browser: added a quantity, reloaded the page — the "4" survived the
  reload from the server, not `localStorage` — then placed the order and
  landed on its detail page showing the correct line and total.

## Extending the neutral reviewer to dispute arbitration (Module 6)

The last of this session's Module 6 passes: "dispute resolution is still
not a neutral-reviewer workflow" was the other gap the vendor/supplier
verification work had left open. Same shape as that pass — a new
permission granted only to `platform_reviewer`, never to a role that can
raise a dispute in the first place, so the reviewer is neutral by
construction, not by an extra runtime check.

- **New `dispute:arbitrate` permission**, granted only to
  `platform_reviewer`. Because that role never gets `dispute:write` (see
  `seed.ts`), it structurally can never be the account that raised the
  dispute it's arbitrating — `arbitrateDispute` skips
  `applyDisputeResolution`'s `raisedByAccountId` check entirely rather
  than reusing it, since that check exists to stop the *other* party
  (owner or vendor) from self-resolving, a different risk than the one
  here.
- **`GET /payments/disputes/open`** lists every `open`/`under_review`
  dispute platform-wide with its project's title, regardless of which
  account raised it or owns the project — no `:projectId` param for
  `PermissionsGuard`'s ABAC to key on, same reasoning the vendor/supplier
  verification routes already use. **`PATCH /payments/disputes/
  :disputeId/arbitrate`** records the decision (`resolved`/`rejected`,
  optional notes), 409s if the dispute is already resolved.
  Both live on `AccountPaymentsController` (the already-unscoped
  `/payments` controller the account-wide overview uses), not the
  `:projectId`-nested one.
- **Web UI**: `pages/payments/index.tsx` branches on
  `auth.currentAccount?.role === "platform_reviewer"` — that account has
  no `payment:read` and owns no projects, so the normal overview would
  just 403 or show "no projects yet". Instead it renders a
  `DisputeArbitrationQueue`: every open dispute with a resolve/reject
  action and an optional notes field.
- Verified against the live dev API (a fresh dispute appears in the
  open queue with its project's title; the raising account still gets
  403 attempting the normal resolve route; the reviewer's arbitration
  succeeds; arbitrating twice 409s; the queue is empty again after) and
  in the browser: switching to the seeded platform account turns
  `/payments` into the arbitration queue, resolving a dispute there
  empties the queue, and switching back to the demo owner's own account
  shows `Open disputes: 0` on the normal overview — the decision
  propagated to the exact page a real dispute lives on.

## An evidence-request step for dispute arbitration (Module 6)

Closes the gap every Module 6 pass above kept flagging as still open:
"the reviewer can't request more evidence before deciding." `Dispute.
status`'s own comment already anticipated `under_review` (`open |
under_review | resolved | rejected`) and every query that treats a
dispute as still-holding-its-milestone already filtered `{ in: ['open',
'under_review'] }` — nothing ever actually *wrote* that value. It turned
out to be one status this scaffold had already built the read side of
and never finished the write side.

- **New `ArbitrateDisputeDto`**, a superset of `ResolveDisputeDto`
  (`resolved | rejected`) adding `under_review` — deliberately its own
  class rather than widening `ResolveDisputeDto` itself, so the two-party
  `resolveDispute`/`resolveDisputeAsVendor` paths still can't set it; only
  `arbitrateDispute` (`dispute:arbitrate`, `platform_reviewer` only) can.
  Requesting evidence isn't a decision either party should be able to
  hand itself.
- **`PaymentsService.arbitrateDispute`** only sets `resolvedAt` for the
  two terminal statuses — `under_review` leaves it `null`, so the dispute
  stays out of "resolved" anywhere that matters and the same method can
  be called again later to make the actual call, no separate "resume"
  endpoint needed. The existing status guard (`already resolved/rejected
  → 409`) already let `under_review` pass through unchanged, since it was
  never resolved/rejected to begin with — the whole write path needed no
  other change once the value could actually reach it.
- **`resolutionNotes` doubles as the evidence request's own text** — no
  new field. What the arbitrator writes when setting `under_review`
  ("what's needed") is stored the same place, and shown the same way, as
  what they'd write when finally resolving it.
- **Web UI**: `ArbitrationRow` (`pages/payments/index.tsx`) gets a third
  button, "Request more evidence", next to Resolve/Reject — and, found by
  actually clicking through this live: `onDecide` never reset `busy` to
  `null` on success, which was invisible before (a resolved/rejected
  dispute drops out of the reloaded queue, so the button unmounts with
  it) but left a dispute set `under_review` — which deliberately stays in
  the queue — stuck showing "…" forever. Fixed by resetting `busy` in a
  `finally` block.
- **Verified live end-to-end**: raised a fresh dispute, set it
  `under_review` with a note as the platform reviewer, confirmed the note
  rendered back as "What's needed: …" and the status badge read "under
  review", reloaded the page and confirmed the row wasn't stuck busy
  (the fix above), then resolved it from that same `under_review` state
  and watched it drop out of the queue.
- **Scoped to disputes only, for now.** Vendor/supplier verification and
  document verification still only ever decide immediately, same
  one-shot shape as before — extending this same `under_review`-style
  step to `Vendor`/`Supplier.verificationStatus` and `Document.
  verificationStatus` (both already have a spare state in their own
  status comments: `pending` and `submitted` respectively, never
  currently set by any reviewer action either) is the natural next slice
  if this gets picked up again, not something this pass touched.

## Extending the neutral reviewer to document verification (Module 6)

The last of the three gaps "A real neutral reviewer for vendor/supplier
verification" originally left open: document verification was still an
account's own admin, the same "not actually neutral" limitation
vendor/supplier verification and dispute resolution both used to carry.
Same shape as those two passes, applied to `Document`.

- **New `document:arbitrate` permission**, granted only to
  `platform_reviewer` — that role never gets `document:write` (see
  `seed.ts`), so it never uploads, let alone owns, a document it might
  later verify. Structural neutrality again, not a runtime check.
- **`DocumentsService.verify`** (the existing account-scoped path) and
  the new **`arbitrateVerify`** now share one private `applyVerification`
  helper for the actual status update and timeline-event write —
  `verify` still filters `{ id, accountId }` before calling it,
  `arbitrateVerify` looks the document up by `id` alone. Same
  extract-the-shared-part-not-the-check shape
  `PaymentsService.applyDisputeResolution` already established.
- **`GET /documents/pending`** lists every document platform-wide whose
  `verificationStatus` isn't `verified`/`rejected` yet (so `not_verified`
  and the never-actually-used `submitted` value both surface), with the
  uploading account's name and the property's name for context — a
  reviewer arbitrating blind wouldn't be reviewing anything. **`PATCH
  /documents/:documentId/arbitrate`** records the decision. No
  `:propertyId`/`:accountId` param for `PermissionsGuard`'s ABAC to key
  on, same reasoning every other neutral-reviewer route this session
  added already uses.
- **Web UI**: `pages/documents/index.tsx` branches on
  `auth.currentAccount?.role === "platform_reviewer"` — that account has
  no `document:read`, so the normal per-account list would just 403.
  Instead it renders a `DocumentArbitrationQueue`, structurally the same
  Verify/Reject-with-optional-notes shape the existing
  `VerifyDocumentControls` already used, just reading from and posting to
  the arbitration routes instead.
- Verified against the live dev API (a freshly uploaded document appears
  in the pending queue with the uploading account's and property's
  names; an unrelated account still gets 403 on the normal `/verify`
  route; the reviewer's arbitration succeeds and writes the same
  `document_verified` timeline event `verify` itself would have; the
  decision is visible on the uploading account's own document list
  immediately after) and in the browser: switching to the platform
  account turns `/documents` into the arbitration queue, verifying the
  pending document there empties the queue.
- **Closed Module 6's neutral-reviewer scope as it stood at the time** —
  see "Review moderation — flagging and the neutral reviewer (Module 6)"
  further down for a fourth field (review `moderationStatus`) this same
  role picked up later in this session, and "An evidence-request step for
  document verification" just below for the evidence-request gap this
  bullet used to describe as fully open. All four fields that had either
  no verification path (`Vendor`/`Supplier.verificationStatus`) or only a
  self-service one (`Document.verificationStatus`, `Dispute.status`,
  review `moderationStatus`) now have a genuinely separate reviewer path;
  the score/self-serve paths still exist alongside the neutral ones
  rather than being replaced by them — see the "Not built yet" bullets
  below for exactly what that leaves on the table.

## An evidence-request step for document verification (Module 6)

The other half of the evidence-request gap "An evidence-request step for
dispute arbitration" above closed for disputes — same reasoning applies
here almost verbatim: `Document.verificationStatus`'s own comment already
anticipated `submitted` (`not_verified | submitted | verified |
rejected`), and `findPendingForArbitration` already filtered `notIn:
['verified', 'rejected']`, so `submitted` was already going to show up in
the queue the moment anything ever wrote it. Nothing did, until now.

- **New `ArbitrateDocumentVerificationDto`**, a superset of
  `UpdateDocumentVerificationDto` (`verified | rejected`) adding
  `submitted` — its own class, not a widened one, for the same reason
  `ArbitrateDisputeDto` is separate from `ResolveDisputeDto`: only
  `arbitrateVerify` (`document:arbitrate`, `platform_reviewer` only)
  accepts it, so neither the uploading account nor its own admin's
  self-service `verify` can send a document back to itself.
  `applyVerification` (shared by both paths) picks the right
  `PropertyTimelineEvent` type for all three outcomes now instead of a
  `verified`-or-`rejected` ternary that would have mislabeled a
  `submitted` update as a rejection.
- **`verificationNotes` doubles as the evidence request's own text**, the
  same reuse `resolutionNotes` got for disputes — what the reviewer
  writes when sending a document back is stored and shown the same place
  as the eventual verified/rejected reason.
- **No document-revision model exists**, so "more evidence" today means
  whatever the account does outside this specific flow (re-upload as a
  new `Document`, update the file at the same `fileUrl`) — there's no
  structured way to attach a resubmission to the original request, unlike
  the dispute version of this same gap — see "Submitting evidence on a
  dispute" further down for the `DisputeEvidence` channel that closed it
  there; nothing analogous exists for documents yet.
- **Web UI**: `DocumentArbitrationRow` (`pages/documents/index.tsx`)
  replaces its old `rejecting: boolean` with a `pendingAction: "reject" |
  "evidence" | null`, so "Reject" and the new "Request more evidence"
  button share one notes-input-then-confirm flow ("Verify" stays the
  one-click action it always was) — plus the same `finally`-block busy-
  reset fix the dispute row needed, applied here pre-emptively since the
  identical bug (never resetting `busy` on success, invisible for a
  terminal decision that drops its own row, not invisible for one that
  deliberately stays) would have hit this row too the first time anyone
  used the new button.
- **Verified live end-to-end**: uploaded a fresh document, switched to
  the platform reviewer, sent it back with a note ("Please upload a
  clearer scan…"), confirmed the status read `submitted` and the note
  rendered as "What's needed: …" both in the reviewer's queue and — via
  the account's own `GET /documents` — on the uploading account's own
  view, reloaded to confirm the row wasn't stuck busy, then verified it
  from that `submitted` state and watched it clear the queue.

## Giving vendor/supplier "pending" verification actual meaning (Module 6)

The narrower gap "The neutral reviewer's decisions are one-shot" kept
flagging: `Vendor`/`Supplier.verificationStatus`'s `pending` was already
freely settable by `platform_reviewer` (unlike `Dispute.under_review` and
`Document.submitted`, which had no write path at all before the two
passes above) — but nothing gave it "awaiting evidence" semantics or a
paper trail, so setting it was indistinguishable from any other one-shot
decision. Unlike disputes and documents, `Vendor`/`Supplier` had no spare
notes field to reuse.

- **New `verificationNotes String?` on both `Vendor` and `Supplier`**
  (migration `20260903000000_add_verification_notes`) — the one piece
  this pass actually needed a schema change for, since (unlike
  `Dispute.resolutionNotes` and `Document.verificationNotes`) there was
  nothing to repurpose.
- **`SetVendorVerificationDto`/`SetSupplierVerificationDto`** gain an
  optional `notes` field alongside `status` — deliberately not a
  separate arbitrator-only DTO like `ArbitrateDisputeDto`/
  `ArbitrateDocumentVerificationDto`, because `pending` was already
  reachable by the same one action every other status is; there was no
  narrower write-path gap to close here, only a missing field.
  `VendorsService.setVerificationStatus`/`MaterialsService.
  setSupplierVerificationStatus` write it alongside `verificationStatus`
  on every call (`null` when omitted, clearing a stale note once a final
  decision is made).
- **Web UI**: `PlatformReviewPanel` (on both the vendor and supplier
  detail pages) gains a notes textarea seeded from the profile's current
  note, and its status buttons are no longer disabled for the
  already-active status — clicking "pending" again now works, which
  matters once notes carry meaning: a reviewer can update what's needed
  without changing the status at all. The vendor/supplier's own `/me`
  dashboard shows the note under the status badge ("Platform reviewer's
  note: …") the same way `vendors/me.tsx` already shows a review's
  moderator note.
- **Verified live**: set a vendor to `pending` with a note as the
  platform reviewer, confirmed both the status and note via a direct API
  call, confirmed the vendor's own `/vendors/me` view (a different
  account) showed the identical note, then repeated the same check for a
  supplier before restoring both back to `verified` with the note
  cleared.
- **Closes Module 6's evidence-request gap as far as this scaffold's
  schema allows.** Three of four `platform_reviewer` actions (dispute
  arbitration, document verification, vendor/supplier verification) now
  carry real reviewer context instead of a bare status flip; only review
  `moderationStatus` doesn't fit the same pattern — "flagged" already
  plays a similar role there, raised by the reviewed party rather than
  the reviewer, so there's no analogous gap to close.

## Review moderation — flagging and the neutral reviewer (Module 6)

Closes the "no report/flag mechanism" half of the "Reviews still have no
moderation" gap, and extends `platform_reviewer` to a fourth field —
same structural-neutrality shape as vendor/supplier verification, dispute
arbitration, and document verification above, applied to `VendorReview`/
`SupplierReview`.

- **`VendorReview`/`SupplierReview` both gain `moderationStatus`**
  (`published | flagged | hidden`, mirroring `Document.
  verificationStatus`'s shape) plus `flagReason`/`flaggedAt` (set by the
  reviewed party) and `moderationNotes`/`moderatedAt` (set by the
  moderator). Migration `20260902100000_add_review_moderation`.
- **New `review:flag` permission**, granted to the `vendor`/`supplier`
  roles alongside their existing `review:respond` — flagging is still
  just the other party to the review acting on their own profile, the
  same ownership check `replyToReview` already used.
  **`POST /vendors/me/reviews/:reviewId/flag`** and **`POST /suppliers/
  me/reviews/:reviewId/flag`** (`VendorsService.flagReview`,
  `MaterialsService.flagOrderReview`) mark a review `"flagged"` with a
  reason — flagging doesn't hide anything by itself, it only surfaces the
  review to the moderation queue.
- **New `review:moderate` permission, granted only to
  `platform_reviewer`** — that role never gets `review:write`/`respond`/
  `flag` (see `seed.ts`), so it can never be the reviewer, the reviewed
  party, or whoever flagged a review it goes on to moderate. **`GET
  /vendors/reviews/flagged`** and **`GET /suppliers/reviews/flagged`**
  (`findFlaggedReviews`/`findFlaggedOrderReviews`) list every flagged
  review platform-wide, no `:vendorId`/`:supplierId`/`:accountId` param
  for `PermissionsGuard`'s ABAC to key on — same shape every other
  neutral-reviewer route already uses. **`PATCH /vendors/reviews/
  :reviewId/moderate`** / **`.../suppliers/reviews/:reviewId/moderate`**
  record the decision: `"hidden"` (excluded from the public profile and
  no longer counted in `ratingAverage`) or `"published"` (dismiss the
  flag, or — found and fixed during live testing below — restore an
  earlier `"hidden"` decision; only a review that's never been flagged at
  all is rejected as "nothing to moderate").
- **A hidden review stays visible to the account it's about.** The
  public `findOne`/`findSupplier` filter `moderationStatus: { not:
  "hidden" }`; the owner's own `findForAccount`/`findMySupplier` don't, so
  a vendor/supplier can see why a review disappeared (and the moderator's
  own note) rather than it just vanishing unexplained.
  `recomputeRating` — and, since they read reviews directly rather than
  the pre-computed `ratingAverage`, `compare_vendor_quotes` and
  `boq_to_order`'s own review reads — all apply the same exclusion, so a
  hidden review stops counting anywhere its rating would otherwise show
  up, immediately and consistently.
- **Web UI**: `pages/vendors/me.tsx` and `pages/marketplace/materials/
  me.tsx` get a "Flag" button next to "Reply" on each own-profile review
  (hidden once a review is already flagged or hidden), plus a moderation-
  notes readout when hidden. `pages/vendors/index.tsx` — the one page
  `platform_reviewer` can actually reach, since `product:read` (not
  `vendor:read`) gates the materials marketplace and this role has
  neither a supplier list page nor that permission — gains a combined
  "Flagged reviews" queue for both marketplaces shown *alongside* (not
  replacing) the vendor grid this role already browses to verify vendors,
  each row offering "Hide review" / "Dismiss flag".
- **Verified live end-to-end**, including a real gap the first pass
  missed: flagged the seeded vendor review as the vendor account,
  confirmed it appeared in the platform reviewer's queue with its reason,
  dismissed it (queue emptied, rating unchanged), re-flagged it, hid it
  (queue emptied again; confirmed via direct API calls that `ratingAverage`
  recomputed to `null`, the public `GET /vendors/:id` response dropped the
  review entirely, and the vendor's own `GET /vendors/me` still showed it
  marked `"hidden"` with the moderator's note) — then discovered
  `moderateReview` had no way to reverse a `"hidden"` decision at all (it
  only accepted a review currently `"flagged"`), fixed it to accept
  either `"flagged"` or `"hidden"` as a starting point, and confirmed live
  that restoring the hidden review brought the `4.0` rating back.
- **Known gap, honestly left open**: restoring a hidden review works via
  the API (confirmed above) but has no UI — there's no "previously
  moderated" list to find one from, only the still-flagged queue. A real
  deployment doing enough of this to need it would want that list; this
  scaffold's slice doesn't build it.

## A real payment gateway — Paystack (Section 16)

Closes the specific gap this README named for a whole session: "`src/
payments` simulates every deposit and payout instantly." Deposits into
escrow now go through Paystack's real Checkout — an actual hosted
payment page, a real transaction reference, and a server-side
verification call before a naira ever counts as "in escrow." Payouts
(releasing a milestone to a vendor) are still simulated — see the gap
below for why that's a materially bigger integration than deposits
turned out to be.

- **`PaystackService`** (`src/payments/paystack.service.ts`) — the same
  "plain `fetch`, no SDK" shape `AnthropicLlmProvider` already
  established, wrapping exactly two Paystack endpoints:
  `/transaction/initialize` and `/transaction/verify/:reference`.
  That's Section 16's actual minimum ("process real transactions"), not
  the full Paystack API surface — no webhook receiver, since this
  scaffold runs on localhost with no public URL for Paystack to call
  back to. Verification is caller-initiated instead: the buyer clicks
  "I've paid — verify" and the backend asks Paystack directly, the same
  pull-based pattern a production deployment would keep as the fallback
  for a buyer who closes the tab before a webhook could fire.
- **`PaymentsService.deposit`** now branches on `provider`. `"manual"`
  (the default, and everything demo/seed data uses) is the original
  instant simulation, unchanged. `"paystack"` creates a **`pending`**
  `Payment` — no escrow credit yet — calls Paystack's initialize
  endpoint, and returns an `authorizationUrl` instead of a receipt.
  Escrow is only credited once **`verifyDeposit`** (new: `POST /
  projects/:projectId/payments/:paymentId/verify`) confirms the charge
  actually succeeded, so a buyer abandoning checkout never phantom-funds
  the project. Both paths share one `creditEscrowForDeposit` helper for
  the actual balance/ledger/receipt write, so there's only one place
  that can credit escrow at all. Amount *and* currency are checked
  against what Paystack itself confirms before crediting anything — a
  reference alone isn't trusted.
- **Paystack's own transaction statuses aren't binary.** A first version
  of this treated any non-`"success"` verify result as a terminal
  `"failed"` — caught live when verifying a truly untouched checkout
  session returned Paystack's own `"abandoned"` status and permanently
  failed a payment that hadn't even been attempted yet. Fixed: only
  Paystack's own `"failed"` (an actually declined/errored charge) marks
  the local `Payment` `"failed"`; anything else (`"abandoned"`, still
  pending) leaves it `"pending"` so the same checkout session can still
  be completed and re-verified later.
- **Paystack rejects RFC 2606 reserved-TLD emails outright** — confirmed
  directly against their API: `demo-owner@propertyonthego.test` (this
  scaffold's own seeded login, deliberately fake so it's never mistaken
  for a real mailbox) gets `"email" must be a valid email` back from
  `/transaction/initialize`. A `payableEmail()` helper swaps a reserved
  test TLD (`.test`/`.example`/`.invalid`/`.localhost`) for `.com` only
  in what's sent to Paystack — Paystack never actually emails this
  address in test mode, it's only a label on the transaction, so this
  changes nothing about the account's real login email anywhere else.
- **Web UI**: `DepositForm` (`pages/projects/[id].tsx`) labels the
  provider dropdown honestly now — "Paystack (real test payment)" next
  to "Manual/Flutterwave/Stripe/PayPal (simulated)", since only Paystack
  does anything real. Choosing it opens Paystack's checkout in a new tab
  and swaps the form for an "I've paid — verify" button.
- **New env vars** (`apps/api/.env.example`): `PAYSTACK_SECRET_KEY`
  (omit to keep every deposit on the manual simulated path — nothing
  breaks without it) and `WEB_APP_URL` (where Paystack redirects the
  browser after checkout).
- **Verified for real, not mocked** — this pass actually ran against
  Paystack's live test API using a real test secret key: initializing a
  transaction, completing checkout on Paystack's real hosted page with
  their public test cards (`Success` → escrow credited exactly once,
  confirmed via the ledger and a direct balance check; `Declined` →
  `Payment` marked `"failed"`, escrow untouched, re-verifying a failed
  payment correctly refused), and — separately — verifying an
  **un-touched** checkout session to catch the `"abandoned"` bug above.
  Every step was also driven through the actual browser: the deposit
  form, Paystack's real checkout UI, the callback redirect back to the
  project page (carrying Paystack's `reference` as a query param — see
  "The redirect back from checkout now verifies itself" below for what
  reading it now does), and the escrow card updating live after "I've
  paid — verify". There's still no webhook receiver, by design (see
  above) — every verification is caller-initiated, the redirect included.
  Payouts were still fully simulated at the time this was written — see
  "A real payout gateway — Paystack Transfers" further down for what a
  later pass this same session built.

## The redirect back from checkout now verifies itself (this pass)

Closes the gap the Paystack deposit pass above flagged: Paystack's
checkout redirects the buyer back to `/projects/:id?paystackReference=
<reference>` (see `PaymentsService.deposit`'s `callbackUrl`), but nothing
ever read that query param — verification only ever happened through the
"I've paid — verify" button in the *original* tab, so a buyer who closed
that tab and only ever landed on the redirect had no UI path back to
verifying at all.

- **`ProjectDetailPage`** gets a new effect keyed on
  `router.query.paystackReference`: it calls the now-exposed
  `AuthApiClient.findPayments`, finds the `pending` `Payment` whose
  `providerReference` matches, and verifies it the exact same way the
  "I've paid — verify" button already does (`verifyDeposit`) — no new
  backend logic, just a second caller of the endpoint that pass already
  built. The query param is stripped via `router.replace` afterward
  (shallow, no reload) so refreshing the page doesn't re-trigger it.
- **Still no webhook** — this is still a caller-initiated confirmation,
  same as the button. What changed is *which* caller: the redirect itself
  now does it automatically instead of requiring the buyer to have kept
  the original tab open.
- **Verified live**, working around the current test key's activation
  state (see "A real payout gateway" below — this session's Paystack
  account is still activating, so a real end-to-end checkout couldn't be
  driven right now): inserted a `pending` `Payment` row directly, then
  loaded `/projects/:id?paystackReference=<its reference>` the same way
  Paystack's redirect would. Confirmed the page called `verifyDeposit`
  (visible in the network log), surfaced Paystack's real response as a
  banner (`"Transaction reference not found"` — correct, since the test
  reference was never a real Paystack transaction), and stripped the
  query param from the URL afterward. The test row was deleted once
  confirmed; nothing about this needed a code change to `PaymentsService`
  or `PaystackService`, only a second consumer on the web side.

## A real payout gateway — Paystack Transfers (Section 16)

The other half of Section 16, closing the "payouts are still fully
simulated" gap the deposit pass above left open. Releasing a milestone
to a vendor now goes through Paystack's real Transfer API when the
vendor has bank details on file — the same "verify first, never trust
the client" discipline as the deposit side, adapted for a flow that also
has to survive a real bank's own OTP confirmation step.

- **`Vendor.bankAccountNumber`/`bankCode`/`bankAccountName`/
  `paystackRecipientCode`** (new columns) — all four or none, same
  "record what's true" shape other optional-together fields already use
  in this schema. `bankAccountName` is never client-supplied: **`PATCH
  /vendors/me/bank-details`** (`VendorsService.setBankDetails`) resolves
  the account number against Paystack's own `/bank/resolve` first and
  stores whatever name Paystack itself returns — a vendor can't put a
  fake name on their own payout account. **`GET /vendors/banks`** backs
  the web form's bank picker with Paystack's real bank list (not a
  hardcoded one this scaffold would have to keep in sync).
- **`PaymentsService.releaseMilestone`** now branches the same way
  `deposit` does: no bank details, or no Paystack key configured, falls
  through to the original instant simulation unchanged. With both, it
  creates (or reuses a cached) Transfer Recipient, calls Paystack's
  `/transfer` endpoint, and creates the `Payout` as `"processing"` —
  escrow is **not** debited and the milestone does **not** flip to
  `"completed"` yet, mirroring the deposit side's "pessimistic until
  confirmed" shape exactly. **`POST /projects/:projectId/payouts/
  :payoutId/verify`** asks Paystack directly whether the transfer
  actually succeeded before any of that happens, via a shared
  `finalizePayout` helper (`PaymentsService`) that's now the one place
  that can debit escrow for a payout, used by both the instant-manual
  path and the confirmed-real one.
- **A newly created Paystack integration has transfer OTP on by
  default** — confirmed live, not assumed: `initiateTransfer` against
  this scaffold's own test key came back `"otp"`, not `"success"`.
  Paystack sends that code to whoever owns the *Paystack account*
  itself, not to this app or the vendor being paid — there's no way for
  this integration to intercept or redirect it. **`POST /projects/
  :projectId/payouts/:payoutId/finalize`** (`PaymentsService.
  finalizePayoutOtp`, `PaystackService.finalizeTransferOtp`) relays
  whatever code a human types in; the web UI's `PayoutRow` gets both a
  "Check status" button (polls `/verify`, for OTP-less integrations or
  once OTP is already handled) and an "Enter OTP" form next to any
  `"processing"` payout.
- **Verified as far as an external account allows, and documented
  exactly where that stops.** Live against Paystack's real API: bank
  list, account-number resolution (Paystack's own documented test
  account resolved to a real name), Transfer Recipient creation, and
  Transfer initiation all succeeded and were confirmed by querying
  Paystack directly — a real `TRF_…` transfer code exists, correctly
  sitting in Paystack's own `"otp"` state, with escrow correctly left
  untouched and the milestone correctly left incomplete pending that
  confirmation. What's *not* verified end-to-end: actually receiving and
  submitting the OTP, and the "success" branch of `finalizePayout` for a
  real (not manual) payout — both blocked by external account state, not
  by this integration's own code:
  1. The OTP itself wasn't confirmed delivered — Paystack's own
     `resend_otp` returned `"OTP has been resent"` on request, twice,
     which places the delivery gap outside this scaffold's control
     (registered contact info on the Paystack account).
  2. A second test key created specifically to try disabling OTP turned
     out to belong to a Paystack business Paystack itself has disabled
     (`"code":"disabled_merchant"`, confirmed by calling Paystack
     directly, independent of this codebase) — an account-activation
     step only Paystack support can resolve, not something to route
     around in code.
  The integration code itself — recipient creation, transfer
  initiation, the pessimistic-until-confirmed escrow/milestone gating,
  the OTP relay endpoint — is written, typechecked, and has run
  successfully against Paystack's live test API up to the exact point an
  external human confirmation step takes over. Picking this back up once
  an activated key is available needs no further code changes, only a
  live OTP (or a dashboard "disable OTP for transfers" toggle) to watch
  the `"success"` branch actually fire.
- **Rechecked later the same session: the `disabled_merchant` block is
  gone, replaced by a narrower one.** Calling Paystack directly again
  with the project-specific key — `/transaction/initialize`, `/balance`,
  `/bank/resolve`, `/transferrecipient` — all now succeed where
  `/transaction/initialize` previously came back `"Integration has been
  deactivated"`, so the account-activation step the user was waiting on
  has completed. Initiating a fresh transfer now gets past that and fails
  one step later instead: Paystack's own `/balance` reports `₦0`, and
  `/transfer` refuses with `"code":"insufficient_balance"` — a test-mode
  transfer normally doesn't require real funds, but this particular test
  account currently does, which is Paystack's own account-level setting,
  not this integration's. The stale `TRF_…` reference from the earlier
  (differently-keyed) attempt is also gone —
  `GET /transfer/:code` now 400s `"Transfer ID/code specified is
  invalid"` for it, confirming it belonged to the account under the old
  key, not this one. Next step is funding this Paystack account's test
  balance (Paystack dashboard, test mode) — once that's done, a fresh
  `POST /projects/:projectId/milestones/:milestoneId/release` should
  reach the `"otp"` state this section already handles, with nothing
  left to change in this codebase.

## Flutterwave and PayPal: a second and third real gateway (this pass)

Section 16 named four gateways ("Paystack, Flutterwave, Stripe, PayPal");
every deposit and payout route stayed hardcoded to Paystack's own
`PaystackService` — a concrete class, not an interface, injected directly
into `PaymentsService`/`VendorsService` — until now. This closes that:
Flutterwave and PayPal both process real deposits and real payouts,
Stripe gets a correctly-shaped deposit gateway that's deliberately left
inactive (see its own section below), and `Payout` gained the `provider`
column `Payment` already had, fixing a real bug the redesign surfaced —
see "The bug this surfaced" below.

- **`FlutterwaveService`** (`src/payments/flutterwave.service.ts`) — same
  "plain fetch, no SDK, `isConfigured` gate" shape `PaystackService`
  already established. One real structural difference: Flutterwave's
  Transfer API takes the destination bank account directly on every
  transfer call, no separate "create a recipient, cache its id" step the
  way Paystack's does — so there's no Flutterwave equivalent of
  `Vendor.paystackRecipientCode`. Another: Flutterwave amounts are
  already in the currency's major unit (5000 means 5000 NGN), not kobo
  like Paystack's — every method here reflects that directly.
- **`PaypalService`** (`src/payments/paypal.service.ts`) — structurally
  the most different of the three: OAuth2 client-credentials (cached,
  refreshed near expiry) instead of a static bearer key; deposits go
  through the Orders API, where `verifyTransaction` doesn't just *read*
  a status, it *captures* the order — a capture only succeeds once the
  buyer has approved it via the returned link, so an unapproved order
  correctly reports "pending" rather than erroring, and an
  already-captured order is looked up read-only on a second call instead
  of erroring on it; payouts go through the Payouts API, targeting an
  email address directly — there's no bank code/account number involved
  at all, hence `Vendor.paypalPayoutEmail` existing as its own field.
- **`Vendor` gained `payoutProvider`** (`"paystack" | "flutterwave" |
  "paypal" | null`) **and `paypalPayoutEmail`** — `bankAccountNumber`/
  `bankCode`/`bankAccountName` are now shared between Paystack and
  Flutterwave rather than Paystack-only, disambiguated by
  `payoutProvider`, since **Paystack's and Flutterwave's bank code lists
  are not interchangeable for the same physical bank** — confirmed live:
  Flutterwave's own bank list (`GET /vendors/banks?provider=flutterwave`)
  came back a materially different, differently-coded list than
  Paystack's. `VendorsService.setBankDetails` now takes an optional
  `provider` (defaults to `"paystack"` for existing callers) and resolves
  against whichever gateway that names; `setPaypalPayoutEmail` is the
  email-based counterpart with no resolve step to make first — PayPal
  itself validates the receiver when a payout is actually sent.
- **The bug this surfaced**: `Payout` had no equivalent of
  `Payment.provider` at all — only `payoutMethod` (`manual |
  bank_transfer | mobile_money`), which `PaymentsService.verifyPayout`/
  `finalizePayoutOtp` used to mean "call Paystack," unconditionally,
  because Paystack was the only gateway that could ever produce a
  `"bank_transfer"` payout. The moment a second one could, that
  assumption would have made every Flutterwave/PayPal payout's "check
  status" silently call Paystack's API against a reference Paystack never
  issued. Fixed by adding `Payout.provider` (mirroring `Payment.provider`,
  backfilled `"paystack"` for every existing `bank_transfer` row in the
  migration) and switching the verification gate from `payoutMethod ===
  'bank_transfer'` to `provider !== 'manual'`, with a small
  `getPayoutGateway(provider)` lookup replacing the old unconditional
  `this.paystack.*` calls. `finalizePayoutOtp` now explicitly refuses any
  payout that isn't Paystack's rather than silently doing nothing useful
  with an OTP no other gateway asked for.
- **Web UI**: `DepositForm`'s provider dropdown
  (`pages/projects/[id].tsx`) now offers Flutterwave and PayPal as real
  options alongside Paystack, with Stripe labeled "real once configured";
  the Paystack-specific `?paystackReference=` checkout-return query param
  is now the gateway-agnostic `?depositReference=`, read the same way for
  all four. `PayoutRow` only shows "Enter OTP" when the payout's own
  `provider` is `"paystack"` — Flutterwave/PayPal payouts in this
  integration only ever need "Check status" to move past "processing".
  `BankDetailsForm` (`pages/vendors/me.tsx`) gained a Paystack/
  Flutterwave/PayPal toggle that swaps between the bank-account form
  (re-fetching that gateway's own bank list) and a plain email field for
  PayPal.
- **Verified live end-to-end against both gateways' real sandbox APIs** —
  not simulated, not mocked:
  - **Flutterwave**: a real deposit returned a genuine
    `checkout-v2.dev-flutterwave.com` hosted-payment URL; verifying it
    before completing checkout correctly stayed "pending"; resolving
    Flutterwave's own sandbox "Test bank" account number against its real
    `/accounts/resolve` endpoint correctly returned a real account name
    ("Forrest Green"); releasing a milestone to that account correctly
    dispatched to Flutterwave (not Paystack) and returned a real transfer
    reference in `"processing"`; checking its status called Flutterwave's
    real `/transfers` endpoint and correctly marked the payout `"failed"`
    once Flutterwave's own settlement rejected the test destination — and
    confirmed escrow's balance was untouched by the failed payout, same
    "nothing moves until success is confirmed" guarantee the Paystack
    path already had.
  - **PayPal**: a real deposit against this demo project's own NGN
    project currency failed with PayPal's own real validation error
    (NGN isn't a currency PayPal supports) — switching to USD via a
    direct API call (bypassing the UI, which always uses the project's
    own currency) confirmed the integration itself is correct: PayPal
    returned a real Order id and a genuine `sandbox.paypal.com`
    checkout-now URL, and verifying it before approval correctly stayed
    "pending". A real payout attempt hit the identical NGN constraint on
    the Payouts API side (`items[0].amount.currency`, confirmed via a
    detailed PayPal error response), the same real external limitation
    as the deposit side, not a bug — this scaffold's demo data just
    happens to be NGN-denominated and PayPal's supported-currency list
    doesn't include it, the same category of constraint the Paystack
    section above already documents for reserved test-TLD emails.

## Stripe: the fourth gateway, now live too (this pass)

The fourth gateway Section 16 named. Written first as a correctly-shaped
but deliberately inactive deposit gateway (no credentials were ready for
it yet), then activated and verified live in the same pass once they
were: `StripeService` (`src/payments/stripe.service.ts`) is gated by the
exact `isConfigured` pattern `PaystackService` already established, so it
needed zero code changes between "inactive" and "live" — only
`STRIPE_SECRET_KEY` going from unset to set.

- **Deposit-only, on purpose.** Paystack/Flutterwave/PayPal all pay a
  vendor directly from this platform's own gateway balance (a bank
  account or an email address); Stripe's equivalent is Stripe Connect, a
  materially different product requiring each vendor to onboard their own
  connected account through a separate flow before this platform could
  ever pay one through it. That's not something one service class can
  "complete in advance" the way a checkout integration can — building a
  payout path against the wrong API shape would be worse than not
  building one at all, so this scaffold doesn't pretend to. If Stripe
  payouts are ever wanted, that's Connect onboarding as its own real
  workstream, not a gap in this file.
- **One real API-shape difference from the other three**: Stripe's REST
  API takes `application/x-www-form-urlencoded` bodies with
  bracket-notation keys for nested objects/arrays (e.g.
  `line_items[0][price_data][unit_amount]`), not JSON. `toFormBody`
  exists only to build that encoding correctly for the one request shape
  this file actually sends (a Checkout Session).
- **Verified live, further than any of the other three gateways this
  pass**: this is the only one of the four where completing the actual
  buyer-side checkout was possible without an external sandbox account —
  Stripe's own well-known test card (`4242 4242 4242 4242`) needs
  nothing else. First confirmed the real minimum-charge constraint
  Stripe enforces (a session has to convert to at least ~$0.50 — a ₦10
  deposit correctly 400'd on that, not a bug), then ran the whole flow
  for real at ₦50,000: a genuine `checkout.stripe.com` session showing
  the right product name, the right amount, and `payableEmail`'s
  reserved-test-TLD rewrite already applied to the prefilled email (the
  same helper `deposit()` uses for every gateway); paid with the test
  card through Stripe's actual hosted checkout; landed back on
  `?depositReference=<id>` exactly like the other three gateways now do;
  and confirmed server-side that `verifyDeposit` correctly captured it,
  credited escrow by exactly ₦50,000, and issued a real receipt — the
  full path, not just session creation.

## Accepting a listing-description draft now saves it (this pass)

Closes the "Not built yet" list's own pointer — "`generate_listing_description`
is the next-clearest candidate... if this gets picked up again" — the same
way "Accepting a status-update draft now posts it" closed it for projects.

- **`AiService.applyChainedAction`** gets a second arm: accepting a
  `generate_listing_description` draft now calls the new
  `ListingsService.updateDescription`, which re-checks the listing still
  belongs to the caller's account (same `requireOwnListing` guard every
  other listing-owner action uses) before writing `Listing.description`.
- **No permission re-check needed here**, unlike `draft_project_status_
  update`'s — that skill only ever needed `project:read` to *run*, so
  accepting it had to check `project:write` separately before it could
  *post*. `generate_listing_description` already requires `listing:write`
  just to run, so the permission that let someone request the draft
  already matches the one now needed to save it.
- **`AiModule` now imports `ListingsModule`** so `AiService` can inject
  `ListingsService` alongside the `ProjectsService` it already had — the
  same shape as the first chained action, extended to a second module.
- Same caveat as the status-update case: the listing detail page
  (`apps/web/pages/marketplace/[id].tsx`) doesn't live-refresh after
  Accept — the new description is saved immediately, but the page shows
  it after a reload, not optimistically. Not fixed here, for the same
  reason it wasn't fixed there: `AskAiPanel` is one component shared by
  every module's screen with no per-page refresh callback, and adding one
  is a bigger change than this slice.

## A real email provider — Resend (password reset + invites)

Closes the last "logged + returned raw" scaffold-depth tradeoff this
codebase carried: password-reset and invite links now get actually
emailed, via [Resend](https://resend.com)'s API — same "plain fetch, no
SDK" shape `AnthropicLlmProvider`/`PaystackService` already use, and the
same "falls back cleanly with no key configured" shape `PaystackService`
uses too.

- **New `EmailService`** (`src/notifications`) — one `send()` method,
  `isConfigured` gated on `RESEND_API_KEY`. Returns whether the send was
  actually accepted rather than throwing: an email provider being down is
  never a reason to fail the request that triggered the email.
- **`AuthService.forgotPassword`** and **`AccountsService.addMember`/
  `resendInvite`** now call it. The raw token/link is only ever included
  in the response when `send()` comes back `false` — that's the one case
  still needing a manual fallback (no key configured, or a send that
  failed for some other reason), and it's what closes the actual security
  gap those three endpoints' comments used to flag: returning a
  password-reset or invite token in an API response is fine for a
  scaffold with no email provider and genuinely wrong once one exists,
  since anyone who could call the endpoint could then also read the token
  meant to prove receipt of the email.
- **Web UI**: `pages/forgot-password.tsx`, `pages/accounts/members.tsx`'s
  `InviteForm`, and its `PendingInviteRow`'s resend action all branch on
  whether a token came back — "emailed to X" when one didn't, the old
  copy-this-link box when one did. No page needed new API calls, only to
  stop assuming the token field is always present.
- **Verified live end-to-end, including the exact limitation this
  approach carries**: with `RESEND_API_KEY` set, a real
  `forgotPassword('staocube@gmail.com')` call correctly omitted
  `resetToken` from the response, the server log read `(emailed)`, and
  the user confirmed the email actually arrived and the reset link
  worked. Inviting a fresh, non-account email
  (`new-invitee-realtest@example.com`) hit Resend's own sandbox
  restriction instead — `422 Invalid \`to\` field... Please use our
  testing email address` — confirming live what the code comments already
  said: without a verified sending domain, Resend's sandbox sender
  (`onboarding@resend.dev`, the default `EMAIL_FROM`) only actually
  delivers to the email address the API key's own Resend account is
  registered with, nobody else. The endpoint correctly treated that as a
  failed send and fell back to returning the raw `inviteToken` — caught
  and fixed a real bug while confirming this: the fallback log line
  originally said "no provider configured" even when a key *was*
  configured and the send failed for an unrelated reason (this exact
  sandbox case); `AccountsService.describeSendStatus`/the equivalent
  inline check in `AuthService` now distinguish "not configured" from "a
  configured send failed" instead of blaming the wrong cause.
- **What a real deployment needs beyond this**: a verified sending domain
  on Resend (lifts the sandbox recipient restriction — see
  `RESEND_API_KEY`'s comment in `.env.example`), and probably a proper
  HTML email template rather than the inline strings this pass uses.

## Finding out you've been invited (this pass)

Closes "no invite listing beyond the account's own Members page" — until
now the *only* place any invite was visible at all was the inviting
account's own Members page. A recipient with no access to that page, or
who lost the email, had no way to discover an invite existed.

- **`AccountsService.findMyInvites(email)`** lists every still-pending,
  unexpired `AccountInvite` sent to the signed-in user's own email,
  across every account — not just one. **`acceptMyInvite`** accepts one,
  deliberately keyed by the invite's own id rather than its bearer token:
  a signed-in session already proves the caller's email, so there's
  nothing a token adds that the query's own email filter doesn't already
  guarantee. 404s (not 403) on an email mismatch, this scaffold's usual
  "don't confirm a cross-tenant resource exists" shape. Both share the
  actual membership-grant transaction with the token-based `acceptInvite`
  via a new private `applyAcceptInvite` helper — same extract-the-shared-
  part pattern every other neutral-decision pass this session used.
- **`GET /invites/mine` and `POST /invites/mine/:inviteId/accept`** —
  registered before the existing `GET /invites/:token` catch-all on the
  same controller, so `"mine"` isn't swallowed as a literal token value.
- **Web UI, in the two places that actually matter**: `AccountSwitcher`
  (rendered in `AppShell`'s header on every page once a user has at least
  one account) gets a red count badge and an "Accept" row per invite in
  its dropdown. But the *more* important case turned out to be the one a
  first pass would have missed: a brand-new user who registers
  independently of any invite link — the realistic way someone with a
  waiting invite actually discovers this scaffold — lands on
  `/accounts/new` with **zero** accounts, and `AccountSwitcher` can't
  render at all without one. `pages/accounts/new.tsx` now fetches
  `findMyInvites` itself and shows an "You've been invited" card above
  the "create your own account" form, so that dead end doesn't happen.
- **Verified live end-to-end**, including finding that second gap by
  actually walking through the flow rather than assuming the first fix
  was enough: invited a brand-new email, registered a User for that same
  email independently (not via the invite link — the scenario that
  matters), confirmed `GET /invites/mine` returned the pending invite,
  confirmed a mismatched-email accept attempt correctly 404'd, then
  drove it through the real browser — a fresh registration landing on
  `/accounts/new` showed the invite card, clicking Accept joined the
  account, switched into it, and redirected straight to the portfolio
  showing that account's own property.

## Real client-side validation: catching a mistyped password (this pass)

Closes the one concrete, checkable gap "no client-side validation beyond
native `required`/`minLength`/`type=\"email\"`" actually named: a
mistyped password on Register or Reset Password went completely
uncaught client-side before this — the account (or the new password)
would silently be set to whatever was typed, and the *first* sign a
typo happened at all was the next sign-in failing with no way to tell
"wrong password" from "the account never got the password I meant to
set."

- **`pages/register.tsx` and `pages/reset-password.tsx`** both gain a
  "Confirm password" field. A live, styled inline message ("Passwords
  don't match.") appears the moment the two differ — but only once the
  confirm field actually has something in it, so it doesn't flash red
  before the user has finished typing — and the submit button is
  disabled for the same condition, on top of the check `onSubmit` itself
  still does as a defense against a disabled button being bypassed
  somehow. A live "At least 8 characters" hint sits under the password
  field itself, replacing reliance on the browser's own (inconsistently
  styled, easy to miss) `minLength` validation popup.
- **Deliberately narrow**: email-format and required-field checks
  already have real enforcement via native `type="email"`/`required`
  *and* the backend's own `class-validator` decorators
  (`@IsEmail()`/`@MinLength(8)` — see the DTOs in `src/auth/dto`) — this
  pass didn't reimplement those client-side, since a mismatched
  client/server regex would be a worse bug than no client-side copy at
  all. The one thing native HTML genuinely can't check at all —
  "did these two fields actually match" — is what needed real code.
- **Verified live in the browser**: typed two different passwords into
  Register, confirmed the inline message appeared and the submit button
  was disabled; corrected the second field and confirmed both cleared
  immediately.

## Moving auth off localStorage: httpOnly cookies + CSRF (this pass)

Closes the tradeoff "Web app auth hardening" above flagged as deliberate
but open: the access token moves out of `localStorage` (XSS-exposed —
any script that runs on the page, including one smuggled in through a
dependency or a stored-XSS bug, could read it and exfiltrate the whole
session) into an httpOnly cookie neither this app's own JS nor an
attacker's ever gets to read. Doing that without also adding CSRF
protection would trade one vulnerability for another — a cookie the
browser attaches automatically is exactly what a forged cross-site
request rides on — so this pass is the two together, not just the first
half.

- **`src/auth/cookie.util.ts`** — one place both halves of the session
  get set (`access_token`, `refresh_token`, both httpOnly) and cleared,
  plus a third, deliberately non-httpOnly `csrf_token` cookie for the
  double-submit pattern below. `sameSite: "lax"` with no `secure` flag in
  dev works for this scaffold's own topology — the web app and API run on
  `localhost` at different *ports*, which `SameSite` treats as the same
  *site* (site is scoped by registrable domain, not port, unlike the
  CORS/fetch *origin* check that still needs `credentials: true` to send
  the cookie cross-port at all) — a genuinely cross-*site* production
  deployment (different registrable domains) would need `sameSite: "none"`
  + `secure: true` instead, which only works over HTTPS.
- **`CsrfGuard`** (`src/common/guards/csrf.guard.ts`), wired in globally
  via `APP_GUARD` in `AppModule` rather than added to every controller's
  own `@UseGuards(...)` list — the risk it closes applies uniformly to
  every mutating endpoint, so one central guard is far less likely to
  miss a spot than repeating it across 15+ controllers. Double-submit
  cookie pattern: `cookie.util.ts` sets a random `csrf_token` cookie
  alongside the auth ones; every mutating request (anything but
  GET/HEAD/OPTIONS) must echo that exact value back as an `X-CSRF-Token`
  header. A cross-site attacker's page can trigger the cookie-carrying
  request but can't *read* this origin's cookies to know what to put in
  the header, so the two only ever match for a request this app's own JS
  actually made. Skips four unauthenticated routes
  (`/auth/login`/`register`/`forgot-password`/`reset-password`) that act
  on an explicit credential already in the request body, not a cookie's
  ambient authority — there's nothing CSRF-shaped to exploit there.
  `/auth/refresh` and `/auth/logout` *are* checked, even though both are
  otherwise unauthenticated too, since both act on the `refresh_token`
  cookie's ambient authority the same way any other mutating route acts
  on `access_token`'s.
- **`JwtAuthGuard`** now reads `req.cookies.access_token` instead of an
  `Authorization` header — the whole point of httpOnly is that this app's
  own JS never sees the token to attach it manually, the browser does
  that on its own.
- **`AuthController`** sets/clears cookies via `@Res({ passthrough: true
  })` on register/login/refresh/logout, and none of the four hand back a
  token string in the response body anymore — putting it there would
  undo the XSS protection just as completely as `localStorage` did, since
  any script that can read a fetch response can read a JSON body as
  easily as `localStorage`. Login/register/refresh responses are
  correspondingly thin; a new **`GET /auth/me`** (`{ id, email }`) is how
  the client now finds out who's actually signed in, since it can no
  longer decode its own JWT.
- **`lib/auth.tsx`/`lib/api.ts`** lost every line that touched a real
  token value — no more `decodeExpiryMs`/`decodeEmail` JWT-decoding, no
  more `getRefreshToken`/`onRefreshed` in `configureAuthSession` (nothing
  left to persist, cookies just update themselves via `Set-Cookie`).
  `AuthContextValue.token` stays in the interface — every existing
  `if (!auth.token)` truthiness check across the app (`AppShell`,
  `AccountSwitcher`, `accept-invite.tsx`, `accounts/new.tsx`,
  `index.tsx`) keeps working completely unchanged — but it's now a
  non-secret "is a session active" marker (the signed-in user's own id)
  rather than the token itself, set from `GET /auth/me`'s response
  instead of decoded from a stored string. `request()`'s existing
  401-triggers-a-silent-refresh-then-retry logic (built in the
  `localStorage` pass) needed almost no change — it never actually cared
  what the token *was*, only whether the call was meant to be
  authenticated — plus one small addition: it now skips even attempting
  a refresh when the readable `csrf_token` cookie is absent, a reliable
  "there was never a session to refresh" signal that avoids a doomed
  round trip (and a misleading CSRF-guard 403 in the console) on every
  page load for a visitor who was never signed in.
- **What this costs, honestly**: the bearer-header story for non-browser
  callers is gone. A `curl` request or a future mobile app can no longer
  authenticate by attaching an `Authorization: Bearer <token>` header —
  everything now goes through a browser holding the httpOnly cookies.
  That's the real half of the "Web app auth hardening" tradeoff this pass
  didn't undo, just relocated: a production system serving both a web app
  and non-browser clients would need a second auth mechanism (API keys,
  most likely) alongside this one, not a replacement for it.
- **Verified live end-to-end** against the real dev servers, not just
  typechecked: logged in and confirmed `document.cookie` only ever
  exposed `csrf_token` (never the two httpOnly ones) and `localStorage`
  held nothing but the non-secret account selection; created a document
  through the real UI and confirmed the request carried a matching
  `X-CSRF-Token`; sent the identical mutating request manually with
  cookies but *no* CSRF header and confirmed a real `403`, then again
  with the correct header read straight from `document.cookie` and
  confirmed it succeeded — proving the guard actually blocks a forged
  request rather than being a no-op; called `POST /auth/refresh` directly
  and confirmed it rotated the cookies (a fresh `csrf_token` value) and
  the new `access_token` worked on the very next call; signed out through
  the real UI and confirmed the cookies were cleared server-side (`GET
  /auth/me` correctly 401'd immediately after, not just "the client
  forgot its copy"); confirmed a protected page redirects to `/login`
  when genuinely logged out; and ran a full fresh registration →
  create-account → portfolio flow through the browser to confirm the
  ordinary path still works end to end, not just the security-specific
  edge cases.

## Submitting evidence on a dispute (this pass)

Closes a gap flagged twice — in "An evidence-request step for dispute
arbitration" and again under "Not built yet" — once the arbitrator could
say `under_review`, there was still no dedicated way for either party to
*submit* more evidence in response, only whatever general tool they
happened to reach for (a project update, a reply somewhere else entirely)
that had nothing to do with the dispute itself and wasn't visible to the
arbitrator in one place.

- **New `DisputeEvidence` model** (migration
  `20260903100000_add_dispute_evidence`) — `note` plus an optional
  `fileUrl` (same "URL you provide yourself" shape as `Document.fileUrl`,
  no object storage in this scaffold), who submitted it and when.
- **`PaymentsService.requireDisputeParty`** — new shared check: either
  the account owns the dispute's project, or it's a vendor assigned to
  it. Deliberately *not* `applyDisputeResolution`'s
  `raisedByAccountId`-excludes-itself check — submitting evidence isn't a
  decision either side could tilt in its own favor the way resolving one
  could, so the account that raised a dispute can still add to its own
  record, unlike resolving it.
- **`POST`/`GET .../disputes/:disputeId/evidence`** on both
  `PaymentsController` (nested under `/projects/:projectId`, matching
  every other owner-side dispute route) and `VendorsController`
  (`/vendors/me/disputes/:disputeId/evidence`, matching its vendor-side
  counterpart) — both funnel into the same service methods.
  `submitDisputeEvidence` 400s once a dispute is `resolved`/`rejected`,
  same "nothing more to decide" shape `arbitrateDispute` already uses.
- **The neutral reviewer never has to ask for it separately** —
  `findOpenDisputesForArbitration` now `include`s the evidence thread
  directly, the same "arbitrating blind wouldn't be arbitrating
  anything" reasoning `DocumentsService.findPendingForArbitration`
  already uses for uploader/property context.
- **Web UI**: `DisputeRow` (`pages/projects/[id].tsx`) and
  `VendorDisputeRow` (`pages/vendors/me.tsx`) both get a lazily-loaded
  "View/add evidence" toggle — not fetched for every dispute on page
  load, only once expanded — with a submit form shown while the dispute
  is still open. `ArbitrationRow` (`pages/payments/index.tsx`) renders
  the thread read-only, straight from the queue response it already had.
- **Verified live end-to-end**: raised a fresh dispute as the project
  owner, submitted evidence with a note and a supporting link, confirmed
  it rendered correctly (clickable link, timestamp) and the form reset
  for a second submission; switched to the platform reviewer and
  confirmed the exact same evidence appeared in the arbitration queue
  with no extra fetch, resolved the dispute from there; confirmed via a
  direct API call that submitting evidence to that now-resolved dispute
  correctly 400s instead of silently succeeding.

## Linking inspectors and maintenance assignees to real vendor accounts (this pass)

Closes half of a gap flagged three times when Modules 8, 12, and 13 were
first built: "no separate Inspector, Contractor, or Tenant identity."
Tenant stays out of scope — there's no Tenant account type or
tenant-facing login anywhere in this scaffold, so `Lease.tenantName`
would need a genuinely new role to become a relation, not just a field
bolted onto an account type that already exists. Inspector and
Contractor are different: `Vendor` already *is* a real, marketplace-wide
professional-identity account type (Module 9), so an inspection's
inspector or a maintenance request's assignee can now optionally *be*
one, the same way a project's vendor assignment already works.

- **`PropertyInspection.inspectorVendorId`** and
  **`MaintenanceRequest.assignedVendorId`** (migration
  `20260903120000_add_inspector_and_assignee_vendor_links`) — both
  optional, both `onDelete: SetNull`, both reachable from the full
  marketplace directory (`GET /vendors`, same reach picking a vendor for
  a project quote already has — not scoped to vendors this property has
  worked with before). Set instead of `inspectorName`/`assignedTo`,
  never alongside it — `PropertiesService` clears whichever of the pair
  isn't given, so a row is never left with both a vendor and stale
  freeform text disagreeing about who's responsible.
- **`PropertiesService.requireVendor`** — the referential-integrity
  check every route accepting `inspectorVendorId`/`assignedVendorId`
  runs first (400s if the id doesn't resolve to a real `Vendor`), same
  spirit as the existing `projectId`/`leaseId` cross-reference checks
  just against the marketplace-wide `Vendor` table instead of a
  property-scoped one.
- **`scheduleInspection`/`updateInspection`/`reportMaintenanceRequest`/
  `startMaintenanceRequest`** all accept the new field alongside the old
  one; every inspection/maintenance-request read (`find*`, and now the
  `create` responses themselves) `include`s the linked vendor's
  `id`/`businessName`/`serviceCategory`/`verificationStatus` so the web
  UI never has to make a second round-trip to show who's assigned.
- **Web UI**: a shared `VendorOrNameField` (vendor `<select>` sourced
  from `GET /vendors`, with a freeform-text fallback that disables
  itself once a vendor is picked) appears on the inspection schedule/edit
  forms and the maintenance report/start forms in
  `pages/properties/[id].tsx`. A vendor-assigned row now reads "vendor"
  next to the business name so it's visually distinct from a freeform
  name.
- **Verified live end-to-end**: scheduled an inspection and reported a
  maintenance request each with a real seeded vendor picked from the
  dropdown, confirmed both showed the vendor's name immediately on
  creation (not just after a reload — this caught a real bug, below);
  opened the maintenance "Start" form on an already vendor-assigned
  request and confirmed it pre-filled the existing vendor rather than
  showing it unassigned; confirmed the freeform-text path (an existing
  seeded "Plumber Joe" assignment) still renders correctly alongside the
  new vendor-linked rows.
- **Bug caught and fixed during testing**: `scheduleInspection` and
  `reportMaintenanceRequest`'s `prisma.create()` calls didn't `include`
  the new vendor relation, so a freshly created row's own API response
  came back with `inspectorVendorId`/`assignedVendorId` set but no
  joined `inspectorVendor`/`assignedVendor` object — the UI's "Assigned
  to: ..." line silently didn't render until the next full list reload.
  Fixed by adding the same `include` the `find*` methods already used
  (factored into one shared `vendorSummarySelect` field so the two can't
  drift apart again) to both `create()` calls.

## Multi-turn tool use in chat (this pass)

Closes the gap the "Chat & deeper AI" pass drew on purpose and then named
under "Not built yet": `ChatService` ran at most one tool per message and
reported the result straight to the user, even if the request genuinely
needed two ("verify the documents and summarize this property" could only
ever get one of the two done). Since `AiService.runAction` never mutates
real state by itself — it only ever creates an `AiRequest`/`AiOutput`
draft; a real action only happens later, if a human separately calls
`POST /ai/outputs/:id/decision` with `accepted` (see `AiService.decide`
and `applyChainedAction`) — chaining several tool calls automatically
inside one chat turn costs nothing safety-wise beyond the calls
themselves: it just means more drafts get created before the human sees
any of them, each one still requiring its own separate Accept.

- **`ChatService.sendMessage` is now a bounded loop**, not a single call:
  after a tool runs, its result is fed back to the model as a
  `tool_result` (Anthropic's own tool-use protocol — the assistant turn
  that made the call is replayed alongside it, not just the result on its
  own) so the model can decide whether another tool call would round out
  the answer, or reply in text. Capped at `MAX_CHAINED_TOOL_CALLS = 4` — a
  cost/latency guard against a model that keeps finding "one more thing to
  check," not a safety boundary (see above for why chaining is safe to
  begin with). A tool already called this turn is dropped from what's
  offered on the next loop turn, so nothing can be run twice in one turn.
- **`LlmProvider.chat()`'s types grew a `ChatContentBlock`** (`text` /
  `tool_use` / `tool_result`) so a `ChatMessage`'s content can carry that
  exchange — but only in the in-memory scratch history `ChatService`
  builds up mid-loop. Nothing about what's persisted to `AiMessage`
  changed: each loop step still writes one plain-string `content` row
  (the same human-readable draft summary as before), so a resumed
  conversation's history reconstruction needed no changes at all.
- **`POST /ai/chat` now returns `messages: AiMessage[]`**, not a single
  `message` — one entry per chained tool call plus the final reply, oldest
  first. `AskAiPanel` (`components/AskAiPanel.tsx`) appends all of them;
  since each one is its own `AiMessage` with its own `aiOutputId`, the
  existing per-message `MiniDecision` control already rendered one
  Accept/Discard per step with no changes needed there.
- **`StubLlmProvider` needed two real fixes to chain correctly**, both
  caught live rather than by inspection: its `chat()` crashed on the new
  block-array content form until content was read through a `textOf()`
  helper; and its "last user message" lookup, unchanged, would find the
  `tool_result` block ChatService had just appended (role `user`, no
  matchable text) instead of the human's actual sentence, so a second
  keyword in the same sentence could never be found on the next loop turn
  — every chat turn silently capped at one tool call regardless of intent.
  Fixed by skipping user-role entries with no extractable text when
  looking for "the" last user message, letting the keyword search re-scan
  the original sentence on every turn, the same sentence a real model
  reasons over the whole time.
- **Verified live end-to-end** in the browser (stub provider, no
  `ANTHROPIC_API_KEY` set): asked "verify the documents, give me a summary
  of this property, and also its ROI" in a property-scoped chat and got
  three separate draft cards back in one turn — `verify_property_documents`,
  then `summarize_property`, then `model_roi_scenario` — each with its own
  `AiOutput` id and independent Accept/Discard, followed by a final text
  reply once nothing else matched. Reloaded the page and confirmed all
  three drafts and their decision controls survived the round trip through
  `GET /ai/conversations/:id`. Accepted one of the drafts from the
  reloaded thread and confirmed the decision recorded correctly, same as
  before this pass.

## An ROI & valuation dashboard (this pass)

Closes the "valuation/ROI dashboards" half of the "Deeper AI" gap under
"Not built yet" — `model_roi_scenario`'s "current" scenario already
computed a property's simple ROI, but only ever as AI-narrated text
buried in a chat reply or a quick-action draft, one snapshot at a time
with no history alongside it. This is that same computation surfaced as
an actual dashboard: real numbers in stat tiles, plus a chart of the
property's valuation history, both live on the property page rather than
something you have to ask the AI for.

- **`PropertiesService.getRoiSummary`** (`GET
  /properties/:propertyId/roi-summary`, gated by the same `property:read`
  the valuations it's built from already use) — deliberately mirrors
  `model_roi_scenario`'s "current" scenario's current-value/invested
  computation exactly (latest `PropertyValuation`, or
  `Property.estimatedValue` as a fallback; `Property.estimatedValue`
  doubles as an acquisition-cost stand-in the same way that skill treats
  it), so the dashboard and the AI skill can never quietly disagree about
  what a property's ROI is. Adds one figure the skill doesn't compute at
  all: gross rental yield, summed across every currently active lease
  (annualized by `rentFrequency`) against the current value — "no active
  lease" rather than a misleading 0% when there's nothing to divide.
- **`ValuationTrendChart`** (`pages/properties/[id].tsx`) — a hand-rolled
  inline SVG line chart, not a new dependency: this app has no charting
  library (see `apps/web/package.json`), the same lean-footprint choice
  `AnthropicLlmProvider` makes calling the Messages API with `fetch`
  instead of pulling in the Anthropic SDK. Only renders once there are
  two or more valuations to draw a trend between; with zero or one, the
  card says so instead of drawing a flat or empty chart.
- **Self-fetching, like `AskAiPanel`** — this is the one card on the
  property page whose data no other card already has loaded, so it fetches
  its own `roi-summary` independently rather than folding a fourth
  `Promise.all` entry into `PropertyDetailPage.load()`. Takes a
  `refreshToken` prop (the parent's `valuations.length`) so adding a
  valuation elsewhere on the page invalidates its fetch — caught live
  during testing: without it, a freshly added valuation left the card
  showing the old current value and the stale "add another valuation to
  see a chart" message until a full page reload, since nothing told this
  independently-fetching card that the data it depends on had changed.
- **Verified live end-to-end**: loaded the dashboard against the demo
  property's existing single valuation and confirmed the stat tiles
  matched `model_roi_scenario`'s own numbers exactly (current value,
  invested, simple ROI all identical) and gross yield matched a manual
  calculation from its two active leases; added a second valuation
  through the existing "+ Add valuation" form and confirmed the card
  updated without a reload — current value, ROI, and a genuine
  two-point trend line all changed correctly, labeled with both
  valuation dates.

## A project summary skill, and a real Reports dashboard (this pass)

Two small, genuinely different gaps closed together — one AI-side, one
deterministic — both under the "Deeper AI"/"the full fixed-dashboard
side of reports" bullets that were still open.

- **`summarize_project`** (new AI skill, `project` context) — every other
  module already had a real "give me the whole picture" summary skill
  (`summarize_property`, `summarize_inspection_history`,
  `summarize_lease_status`, `summarize_maintenance_backlog`); Module 9
  never did. Deliberately not a duplicate of `draft_project_status_update`
  (which already covers stage progress and recent narrative updates) —
  this one covers what that skill doesn't: vendor assignment, a
  milestone/approval breakdown including overdue ones, budget vs. what's
  actually been released so far, and any open disputes, with `warn: true`
  set whenever either of the last two is non-zero.
- **Fixed a real ambiguity this surfaced in `ChatService`**: the
  keyword-matching stub LLM provider has no way to tell
  `summarize_property` and `summarize_project` apart when both are
  offered and the message just says "summarize" — a real model reasons
  about which one fits the conversation, the stub can't. `ChatService`
  now filters the tools it offers down to the current conversation's own
  `moduleContext` prefix once one is set (an unscoped conversation still
  sees everything, so the existing "this conversation isn't scoped to
  anything yet" guidance still fires the same way it always did) — a
  skill whose `moduleContextPrefix` doesn't match couldn't have run in
  this conversation anyway, so this is also just less dead weight for a
  real model to consider, not only a stub workaround.
- **`GET /reports/portfolio-overview`** (`ReportsService`, new module) —
  the deterministic counterpart to `generate_portfolio_report` (the
  AI-narrated account-wide skill): real counts and totals across every
  property an account owns — properties/projects by status, open vs.
  resolved maintenance, inspection pass/fail/needs-attention breakdown,
  and top vendors by amount paid. Vendor spend is grouped by (vendor,
  currency), never summed across currencies — same caution
  `PaymentsService.getAccountOverview` already applies to deposits/
  releases, since one account can run projects in more than one currency
  even though `Property.estimatedValue` itself is implicitly the
  account's own single currency (no currency field of its own). Gated on
  `property:read`, the same permission every owner-side role already
  carries and vendor/supplier accounts don't — an owner-side report, not
  a marketplace one, same reasoning `AccountPaymentsController.
  getOverview` already uses for `payment:read`.
- **Web**: a new `/reports` page and sidebar nav item — stat tiles, a
  plain labeled-bar status breakdown (not another SVG chart: a handful of
  counts against a total doesn't need an axis or points the way the ROI
  dashboard's real time series did), and a top-vendors list.
  Self-fetching, same pattern the ROI dashboard and `AskAiPanel` already
  use.
- **Verified live end-to-end**: ran `summarize_project` against the demo
  Kitchen Renovation project and confirmed every figure (vendor name,
  2/4 milestones completed, budget 2,500,000 NGN with 901,000 released —
  36%) against the underlying data by hand; loaded `/reports` and
  confirmed its numbers independently — including landing on the exact
  same 901,000 NGN top-vendor total the AI skill had just computed
  separately, a real cross-check that the two features can't quietly
  disagree about the same underlying payouts.

## Real identity (KYC) verification — Sumsub (Module 6, originally Dojah/NIN, swapped this pass)

Module 6's actual remaining gap: `Vendor`/`Supplier.verificationStatus`
verify a *business*, `Document.verificationStatus` verifies *paperwork*
— nothing in this scaffold ever verified the *person* behind an account
at all. This was originally built against Dojah (Nigeria's National
Identification Number, a single lookup call) but swapped for Sumsub
once real Dojah credentials turned out to be placeholder text
(`"your_app_id"`/`"your_secret_key"`, not real values) while a genuine
Sumsub account was available instead. The swap changed more than the
provider name: Sumsub is document+selfie review, not a single-field
lookup, so the shape of the whole flow is different, not just which
service a `Bearer` header points at.

- **`User` gained `sumsubApplicantId`, replacing `ninLast4`** —
  `identityVerificationStatus`/`identityVerificationNotes`/
  `identityVerifiedAt` stayed (provider-agnostic), but there's no NIN
  digits to keep a trailing trace of anymore. `sumsubApplicantId` is
  what a later status check polls against, since Sumsub's review happens
  asynchronously on their own side — genuinely different from Dojah's
  NIN lookup, which returned a definitive match/no-match in the same
  request that made it. Still deliberately *not* modeled on `Vendor`/
  `Supplier.verificationStatus`'s human-`platform_reviewer` pattern —
  Sumsub's own reviewers are the human step, just not one of this
  platform's own roles, so `IdentityService` sets the status directly
  from Sumsub's result, no `platform_reviewer` queue involved.
- **`SumsubService`** (`src/identity/sumsub.service.ts`, replacing
  `dojah.service.ts`) — same "plain fetch, no SDK, `isConfigured` gate"
  shape every gateway service in this scaffold already uses. The one
  real auth difference from every other integration here: Sumsub signs
  *every* request with an HMAC-SHA256 over `timestamp + method + path +
  body` (`X-App-Token`/`X-App-Access-Sig`/`X-App-Access-Ts` headers), not
  a static bearer token or header pair — `sign()` does that once, shared
  by all three calls (`createApplicant`, `getAccessToken`,
  `getApplicantStatus`). No sandbox-vs-production host split the way
  Dojah had — sandbox vs. live is just which app-token/secret pair you
  use, both against the same `api.sumsub.com`. Deliberately pull-based,
  same reasoning `PaystackService`'s and the old `DojahService`'s own
  comments already gave for avoiding webhook receivers: Sumsub's normal
  integration expects a webhook URL for review-complete callbacks, but
  there's no stable public URL for local dev to receive one, so
  `IdentityService.refreshStatus` polls `GET /resources/applicants/:id/
  status` on demand instead.
- **Two actions, not one** — `POST /identity/start` creates (or reuses)
  a Sumsub applicant and mints a fresh short-lived WebSDK access token;
  `POST /identity/refresh` re-reads Sumsub's current review answer and
  updates `identityVerificationStatus` accordingly (`GREEN` → `verified`,
  `RED` → `failed` with `rejectLabels` as the note, anything else stays
  `pending`). Splitting these out (rather than Dojah's single call) is
  the direct consequence of review being asynchronous: nothing here can
  return a final answer synchronously the way a NIN lookup could.
- **No ID document or selfie image ever touches this backend.** Sumsub's
  own WebSDK (loaded from their CDN in the browser) talks to Sumsub
  directly using the short-lived access token `POST /identity/start`
  returns — this server only ever sees Sumsub's own applicant id and
  final review answer, never the underlying photos.
- **`IdentityController`** (`GET /identity/me`, `POST /identity/start`,
  `POST /identity/refresh`) — still deliberately user-scoped, not
  account-scoped: no `AccountContextGuard`/`PermissionsGuard` the way
  every other controller in this codebase has, since identity
  verification is about the person signed in, independent of which
  account they currently have selected. Same reasoning `AuthController`'s
  own `GET /auth/me` needs nothing more than `JwtAuthGuard` for.
- **Web**: the "Identity verification" card on the Members page
  (`pages/accounts/members.tsx`) — there's no dedicated profile screen
  yet, and this is the closest thing to account-level settings that
  exists — now loads Sumsub's WebSDK script on demand and launches it
  into a container div once `POST /identity/start` returns a token,
  plus a "Check status" button for the pull-based re-check `POST
  /identity/refresh` needs (nothing pushes a result to the browser the
  way a webhook would).
- **Verified live, fully — real credentials arrived shortly after this
  was first written.** First confirmed the "unconfigured" path behaves
  correctly (clicking "Start verification" through the real web form
  surfaced the exact clear error, `"...set SUMSUB_APP_TOKEN/
  SUMSUB_SECRET_KEY/SUMSUB_LEVEL_NAME to enable it"`), same bar Dojah
  was held to before it. Once real sandbox credentials and a configured
  `SUMSUB_LEVEL_NAME` arrived, ran the actual flow end to end through
  the real app: `POST /identity/start` created a genuine Sumsub
  applicant (confirmed via a direct signed API call first — a status
  lookup on a fake applicant id came back `404 "not found"` rather than
  a `401` auth error, proving the HMAC signing and credentials were both
  correct before ever touching this app's own code) and returned a real
  WebSDK access token; the web card loaded Sumsub's actual CDN script
  and launched their real onboarding widget (consent screen, real
  Privacy Notice/data-processing links) in the browser — not a mock.
  Stopped short of submitting an actual ID document (nothing legitimate
  to test with, and not necessary to confirm the integration), but
  confirmed the rest of the chain: `GET /identity/me` showed the new
  `sumsubApplicantId` correctly persisted, and `POST /identity/refresh`
  correctly read back `pending` (Sumsub's own review hadn't completed,
  since no document was ever submitted) and cleared the old Dojah-era
  failure note — reflected correctly in the web UI ("Pending" badge,
  "Continue verification"/"Check status" buttons) after a reload.
- **What changed from the Dojah pass that's now stale**: the exact-token
  name-matching caveat (`namesMatch`, Dojah-specific code that no longer
  exists) no longer applies — Sumsub does its own identity matching as
  part of its document review, opaque to this codebase, so there's
  nothing analogous to audit here. Whether Sumsub's own matching is
  fuzzy or exact isn't something this integration controls or needs to.

## A seller-facing listing summary skill (this pass)

Closes the other half of "Deeper AI — listing/risk summaries beyond
`assess_listing_risk`". `assess_listing_risk` is deliberately
buyer-facing and public (no `accountId` filter, same reach `GET
/listings/:id` itself has — its own comment explains why). This is the
opposite on purpose: `summarize_listing` filters by `ctx.accountId` the
same way `summarize_property`/`summarize_project` do, because market
performance (inquiry/offer counts, a competing offer's amount) is
exactly the kind of thing a seller wouldn't want a random buyer's chatbot
session surfacing.

- **`summarize_listing`** (new AI skill, `listing` context,
  `listing:read`) — views, saves, days on market, inquiry count (and how
  many are still unanswered), offer count (with the highest amount and
  how many are awaiting a response), and whether an offer's already been
  accepted. `warn: true` when there's an open, unanswered offer — the
  one state that actually calls for the seller to act.
- **Verified live**: ran it against the demo account's real "14 Ocean
  Drive" listing and confirmed every figure against the underlying data
  — 9 views (incremented by loading the listing page itself, a real
  side effect, not a stub artifact), 4 days on market (matches its
  `createdAt`), zero inquiries/offers (matches the seed data). Confirmed
  the owner-only scoping is actually enforced, not just intended: a
  different account without `listing:read` at all got a 403 attempting
  the same action — the `accountId` filter itself reuses the exact
  pattern already proven correct by every other `summarize_*` skill this
  pass, so a same-permission-different-owner cross-tenant check wasn't
  repeated here.

## Vendor and supplier trust audits — an independent judgment call (Module 6, this pass)

Every earlier trust-score pass in this README carried the same caveat:
the score is the platform's own arithmetic over data the vendor's/
supplier's own marketplace activity produced — never a real judgment
call from an independent party. "A real neutral reviewer for vendor/
supplier verification" (above) closed that for `verificationStatus`, a
binary/tri-state gate with no history — each call overwrites the last,
and it was never meant to carry reasoning. This pass adds something
different: a real audit record, with mandatory reasoning, that's kept
forever rather than overwritten, blended into the trust score alongside
the identity verification (see "Real identity (KYC) verification —
Sumsub" above) already built for the account operator.

- **`VendorTrustAudit`/`SupplierTrustAudit`** (new models, one migration,
  parallel to every other Vendor/Supplier pair in this schema rather
  than a shared polymorphic table) — `rating` (`clean` /
  `minor_concerns` / `major_concerns`), a **required, non-empty** `notes`
  field (an audit with no recorded reasoning isn't an audit — the
  existing `verificationNotes` field on `Vendor`/`Supplier` stayed
  optional on purpose; this one didn't), `reviewedByUserId`, and
  `createdAt`. Every audit is kept — filing a new one never deletes or
  overwrites an old one — only the most recent feeds the live score, the
  same way only the current `verificationStatus` value does, but the
  full history stays visible.
- **`vendors/trust-score.ts` and `materials/trust-score.ts`** — extended,
  not replaced. Two new factors: `latestAudit` (`clean: +15`,
  `minor_concerns: -10`, `major_concerns: -35` — deliberately the
  widest swing of any factor in the formula, since a reviewer's own
  judgment call is meant to be the most authoritative signal it has) and
  `identityVerifiedOperator` (`+10` when any member of the vendor's/
  supplier's account has `User.identityVerificationStatus === "verified"`
  — checked with a `count`/`some` over `AccountMember`, not "the first
  member," since an account can in principle have more than one). Same
  `[0, 100]` clamp as before, so no rebalancing of the existing factors
  was needed.
- **`POST`/`GET /vendors/:vendorId/trust-audits`** and the same pair
  under `/suppliers/:supplierId/trust-audits` — reuse the exact
  `vendor:verify`/`supplier:verify` (file an audit) and `vendor:read`/
  `supplier:read` (read the history) permissions `setVerificationStatus`
  already used. No new permission keys, no `seed.ts` changes — the same
  `platform_reviewer` role that can flip verification status is the one
  that can file an audit, deliberately: this is one more action for the
  same neutral party, not a second reviewer role.
- **`explain_vendor_trust_score`/`explain_supplier_trust_score`** — the
  factor list and system prompt both updated to say plainly that part of
  the score now comes from a reviewer's own audit and identity
  verification, not only recomputed activity, while still cautioning
  it's one input a buyer should weigh themselves, not proof either way.
- **Web UI**: `PlatformReviewPanel` on both `pages/vendors/[id].tsx` and
  `pages/marketplace/materials/[id].tsx` gained a "File a trust audit"
  sub-form (rating buttons + a required notes textarea) beneath the
  existing verification-status controls, visible only to the same
  `platform_reviewer`-only panel. A new self-fetching audit-history card
  (`TrustAuditHistory` / `SupplierTrustAuditHistory`, same
  `refreshToken`-prop pattern `RoiSummaryCard` established) shows every
  audit ever filed — visible to anyone who can see the vendor/supplier at
  all, the same transparency reviews already get, not just the reviewer
  who filed them.
- **Verified against the live dev API and in the browser**, switched
  into the seeded `PropertyOnTheGo Trust & Safety` platform-reviewer
  account: filed a `minor_concerns` audit on the seeded vendor (score
  dropped 53 → 43, the exact −10) and a `major_concerns` audit on the
  seeded supplier (score dropped 90 → 55, the exact −35); both audits
  appeared immediately in their history card with no page reload, and
  the "Latest platform audit" line on the trust-score factors updated to
  match. Switching back to the demo owner's own account hid the "File a
  trust audit" form (and the rest of `PlatformReviewPanel`) while the
  audit-history card stayed visible, confirming the write path is gated
  and the read path isn't. `explain_supplier_trust_score` via Ask AI
  picked up both new factors correctly in its stub-mode draft ("Most
  recent platform audit: major concerns", "This supplier's own identity
  has not been verified").
- **What this still isn't.** A reviewer's audit only covers what that
  reviewer actually checked — there's no mandated checklist, no site
  visit requirement, no external records lookup (business registration,
  insurance, licensing) built into the flow itself; `notes` being
  required means an audit records *that* reasoning was given, not that
  the reasoning meets any particular bar. Filing an audit is also still
  entirely manual — nothing prompts a reviewer to re-audit a vendor/
  supplier on any cadence, so a score can carry a stale audit indefinitely
  once one exists (and no audit at all, same as before this pass, if one
  never gets filed). The design intent is that these gaps stay judgment
  calls made *by a human reviewer*, not something to automate away — but
  it does mean the platform still can't promise every trust score reflects
  a recent, thorough look at the business behind it.

## A self-reported professional license for vendors — licensed-Inspector/Contractor (this pass)

Closes half of the gap "Property inspections" and "Maintenance requests"
both flagged: "no separate licensed-Inspector/licensed-Contractor
account type." Building a full licensing *credential* system (a
reviewer-issued license record, backed by an external registry lookup)
would be a much larger undertaking than this pass's scope — what's
built instead is the same tier this scaffold already gives
`Lease.tenantName` or `MaintenanceRequest.assignedTo`: record what the
vendor itself claims, don't pretend the platform verified it. Tenant
identity (the other half of that same flagged gap, on `Lease`) stays
fully out of scope — see "What this doesn't do" below for why it's a
different order of work.

- **`Vendor.licenseNumber`/`licenseIssuingBody`/`licenseExpiresAt`**
  (new columns, one migration) — all three set together or not at all,
  same shape the bank-detail fields already use. Not gated to any
  particular `serviceCategory`: nothing in this scaffold's category list
  (`electrical`, `security_installation`, `general_contracting`, …)
  distinguishes which ones are really licensed trades in a given
  jurisdiction, so — same "record what's true, no forced workflow"
  reasoning `Lease.tenantName` already documents — any vendor can add
  one if it applies to them.
- **`PATCH /vendors/me/license`** — `vendor:write`, the vendor's own
  account only, same gate `create()`/`setBankDetails()` already use. No
  external registry lookup backs this (none is wired up in this
  scaffold) — unlike `setBankDetails`, which resolves the account number
  against a real payment gateway before saving, this just records
  whatever the vendor typed in, the same trust level `PropertyInspection.
  inspectorName`/`MaintenanceRequest.assignedTo` already had.
- **`computeVendorTrustScore` gains a `licenseExpired` factor — and a
  deliberate asymmetry.** A license on file and *not* expired adds
  nothing to the score; one that's expired costs `-10`, the same weight
  class as a dispute. The reasoning is in the schema comment on
  `Vendor.licenseNumber`: since this field is self-reported and nothing
  here verifies it, letting it add points would let a vendor raise its
  own trust score just by typing a license number in — the same integrity
  problem `identityVerifiedOperator`/`latestAudit` (a real KYC check, a
  human reviewer's judgment) don't have, because neither one is
  something the vendor's own account can set for itself.
- **`explain_vendor_trust_score`** — the factor list now calls out an
  expired license explicitly ("This vendor lists a professional license
  that has expired") when one applies.
- **Web UI**: a `LicenseForm` on `pages/vendors/me.tsx` (same
  edit-in-place shape `BankDetailsForm` already established — view, "+
  Add"/"Update", a form, save/cancel), and the public vendor profile
  (`pages/vendors/[id].tsx`) shows the license inline under the business
  name, styled red once expired, plus a "listed license has expired" note
  alongside the other trust-score factors.
- **Verified against the live dev API and in the browser**: added a
  license with a past expiry date to the seeded vendor account, confirmed
  `PATCH /vendors/me/license` saved it and the public `GET /vendors/:id`
  response carried `licenseExpired: true` with the expected `-10` (trust
  score dropped from 43 to 33, band moved from "fair" to "caution");
  edited the expiry to a future date and confirmed the same request
  carried `licenseExpired: false` with the score back at 43 — the *lack*
  of a positive swing confirming the "only ever costs, never earns"
  design actually held. In the browser: the license form saved and
  re-rendered correctly without a page reload, the public profile page
  showed the red "expired" styling, and `explain_vendor_trust_score`'s
  Ask AI draft picked up the new factor correctly.
- **What this doesn't do.** No external license-registry lookup exists
  anywhere in this scaffold, so "licensed" here means "claims to be
  licensed," not "the platform confirmed it" — closing that gap for real
  would mean integrating a real state/national licensing-board API the
  way `SumsubService` integrates identity verification, which no such
  API was available to wire up here. A `platform_reviewer`'s trust audit (see
  "Vendor and supplier trust audits" above) is the closest thing to an
  actual check today: nothing stops a reviewer from calling the issuing
  body and recording what they found in an audit's own `notes`, but
  nothing prompts them to, either. **Tenant identity is not part of this
  pass and is a meaningfully bigger lift than the vendor-license piece
  above**, for a reason specific to it: Inspector/Contractor could
  attach to `Vendor` because `Vendor` already *is* a real, marketplace-
  wide account type with its own login (Module 9) — this pass only had
  to add fields to something that already existed. Tenant has no
  equivalent anywhere in this scaffold: no account type, no role, no
  registration/login flow a renter could use, so `Lease.tenantName`
  staying freeform text isn't a smaller version of the same gap, it's a
  different, larger one — a real Tenant identity needs a new account
  type and a tenant-facing signup path built from nothing, not three new
  columns on a model that already had somewhere to attach them.

## A real Tenant identity (Module 13, this pass)

Closes the gap the pass above deliberately left open: a genuinely new
`AccountType.TENANT`, its own `tenant` role, and a tenant-facing view
onto its own lease — the "bigger lift" flagged in every earlier mention
of this gap. The key realization that kept this from being as large as
it sounds: `pages/accounts/new.tsx` already *is* a self-serve
account-type-picker-plus-login for every account type this scaffold
has (INDIVIDUAL/FAMILY/COMPANY/VENDOR/SUPPLIER all reach it the same
way) — adding TENANT to that list is most of "a tenant-facing signup
path," not a new screen built from nothing.

- **`AccountType.TENANT`** (new enum value) and a **`tenant` role**
  (`seed.ts`) — deliberately minimal, same "only what its own screen
  needs" reasoning `platform_reviewer` already documents: `lease:read`,
  `maintenance:read`, `maintenance:write`. No new permission keys — this
  reuses the exact same keys the landlord-facing lease/maintenance
  routes already check, since a tenant's own routes never take a
  `:propertyId`/`:projectId` param for `PermissionsGuard`'s ABAC to key
  on, so plain RBAC is the entire access check (same reasoning the
  vendor/supplier trust-audit routes gave for reusing `vendor:verify`/
  `supplier:verify` instead of inventing new permissions).
- **`Lease.tenantAccountId`** (new column) — optional, `onDelete:
  SetNull`, same "landlord picks a real account, nothing auto-links"
  shape `inspectorVendorId`/`assignedVendorId` already established for
  Inspector/Contractor. The one real difference: there's no marketplace
  directory to pick a tenant from the way `GET /vendors` lets a landlord
  browse vendors (a browsable directory of every tenant on the platform
  would be a real privacy problem `Vendor`'s public directory never had
  to consider) — so linking resolves by the lease's own `tenantEmail`
  instead of a client-supplied id.
- **`POST /properties/:propertyId/leases/:leaseId/link-tenant`**
  (`PropertiesService.linkTenantAccount`, `lease:write`, same ABAC as
  every other lease mutation) — looks up the `User` registered under
  `lease.tenantEmail`, then that user's own `AccountType.TENANT`
  membership, and links it. Clear 400s at each step it can fail: no
  `tenantEmail` on file, no registered user with that email yet, or a
  registered user who hasn't set up a Tenant account yet — this never
  creates an account on the tenant's behalf, only links one that
  already exists.
- **A new `TenantModule`** (`apps/api/src/tenant`) — its own
  controller/service rather than more routes on `PropertiesController`,
  because every route here is scoped to "whichever lease this account
  is linked to," which is fundamentally incompatible with
  `PermissionsGuard`'s `:propertyId` ABAC (a tenant doesn't own the
  property, so that check would 404 it out of every landlord-facing
  route — the same reason vendor's own actions live under `/vendors/
  me/...` rather than `/projects/:projectId/...`). `GET /tenant/lease`
  (the linked lease, its property, and rent history — 404 until a
  landlord links one), `GET /tenant/maintenance-requests`, and `POST
  /tenant/maintenance-requests` (fills in `propertyId`/`leaseId`/
  `reportedBy` from the caller's own linked lease — a tenant never
  supplies or sees another lease's id).
- **Web UI**: `pages/tenant/index.tsx` — read-only lease/property/rent-
  history display (rent/dates/deposit stay landlord-controlled, same as
  the landlord's own lease card), plus a maintenance-report form mirrored
  from `pages/properties/[id].tsx`'s own. `AppShell`'s nav shows a "My
  Lease" item only for a TENANT-type account — the one account type
  with no existing nav item that leads anywhere useful (unlike
  `platform_reviewer`, which reaches its own screens through the
  Vendors/Marketplace items that already exist for other reasons). The
  landlord's own Leases card (`pages/properties/[id].tsx`) gained a
  "Link tenant account" action (shown once `tenantEmail` is set and
  no account is linked yet) and a "Tenant account linked (...)" /
  "No tenant account linked yet" line.
- **Demo data**: a fifth membership on the same demo login (`Demo
  Tenant`, `AccountType.TENANT`) plus a seeded lease on the demo
  property whose `tenantEmail` matches that same login — left
  deliberately *unlinked* in seed data so `link-tenant` is something to
  actually call and verify, not a fact baked in ahead of time.
- **Verified live end-to-end**: as the owner account, linked the seeded
  lease to the seeded tenant account (confirmed via the API response
  that `tenantAccountId` was set, and via a page reload that the
  landlord's own Leases card now reads "Tenant account linked (Demo
  Tenant)"); switched to the tenant account and confirmed `GET /tenant/
  lease` returned the real property/rent/deposit details; reported a
  maintenance issue as the tenant and confirmed it appeared immediately
  in the tenant's own list *and* on the landlord's own property page
  with `reportedBy: "Demo Tenant"`. Confirmed isolation two ways: the
  owner account's own `GET /tenant/lease` returns `null` (empty 200, the
  same shape `GET /vendors/me` already returns for "no profile yet" —
  `lease:read` is shared with the landlord roles, so the isolation comes
  from filtering by the *caller's own* `accountId`, not from a
  permission boundary), and the vendor account's own `GET /tenant/lease`
  correctly 403s (`vendor` role doesn't carry `lease:read` at all).
- **What this doesn't do.** A tenant still can't edit their own lease —
  by design, rent/dates/deposit stay landlord-controlled. See "Closing
  the three Tenant identity gaps" below for the auto-link notification,
  lease-scoped documents, and `summarize_my_tenancy` this pass added
  right after this one — all three were still open when this section was
  first written.

## Closing the three Tenant identity gaps: auto-link, lease-scoped documents, a tenant AI skill (this pass)

The Tenant identity pass above shipped with three named gaps. This pass
closes all three in one sitting, since none of them touch each other's
code and all three are natural, bounded follow-ons rather than new
design questions.

**1. A tenant signing up no longer needs the landlord to click anything.**
`AccountsService.create` — the same method every account type's own
self-serve signup already runs through (`pages/accounts/new.tsx`, see
"A real Tenant identity" above) — now auto-links a brand-new
`AccountType.TENANT` account to every still-unlinked `Lease` whose
`tenantEmail` matches the new user, then emails every member of each
lease's landlord account via the same `EmailService` the invite flow
already uses. `PropertiesService.linkTenantAccount` (the manual "Link
tenant account" button) stays — it's what still handles a lease created
*after* the tenant already has an account, or a manual correction — but
the common case (tenant signs up after the lease exists) no longer
needs it. **Real gap found while verifying this**: `pages/properties/
[id].tsx`'s lease form had no `tenantEmail` input at all — the field
existed on `CreateLeaseDto` server-side (and was reachable via `PATCH`)
but nothing in the UI could ever set it, which meant "Link tenant
account" could only ever work on the one lease the seed script wrote by
hand. Fixed by adding the field to both the create and edit lease
forms.

- Verified live end-to-end: created a lease with a fresh `tenantEmail`
  as the landlord, registered a genuinely new user under that same
  email, created a `TENANT` account for them — no "Link tenant account"
  click anywhere — and confirmed both sides: the new tenant's own `GET
  /tenant/lease` immediately returned the real lease, and the landlord's
  own Leases card read "Tenant account linked (New Auto Tenant)" on
  reload. Confirmed the notification actually fires (server log:
  `Auto-linked tenant account ... — notified demo-owner@propertyonthego.test
  (email send failed — see the EmailService error above)`) — "failed"
  here is Resend's own sandbox-key restriction (delivers only to the
  key's own registered address, see `EmailService`'s comment), not a bug
  in this pass; the attempt and its outcome are both logged correctly
  either way.

**2. Documents can now be tagged to a specific tenancy.** `Document.
leaseId` (new column, optional, `onDelete: SetNull`) — same "optional
cross-reference must actually belong to this property" cross-check
`ReportMaintenanceRequestDto.leaseId` already gets
(`DocumentsService.create` derives/validates `propertyId` from the
lease when only `leaseId` is given). The landlord's upload form
(`pages/documents/index.tsx`) grows a "Tenancy (optional)" picker once
a property with active leases is selected; `GET /tenant/documents`
(new route, `document:read` — now granted to the `tenant` role) shows a
tenant only documents tagged to their own lease, never the landlord's
full vault. **Bug caught and fixed during testing** — the same class of
bug this session already found once before on `PropertyInspection`/
`MaintenanceRequest`'s own vendor links: `DocumentsService.create()`
didn't `include` the `lease` relation on its own return value, so the
web UI's optimistic update (which renders the `POST` response directly,
not a re-fetch) showed no tenancy tag until the next full reload. Fixed
by adding the same `include` `findForProperty`/`findForAccount` already
use.
- Verified live: uploaded a document as the landlord with "Demo Tenant"
  picked from the new tenancy dropdown, confirmed it read "Demo Tenant's
  tenancy (visible to them)" immediately (no reload needed, post-fix),
  and confirmed it appeared in that tenant's own `/tenant` page under
  Documents.

**3. `summarize_my_tenancy`** (new AI skill, `tenant` context,
`lease:read`) — the tenant-facing counterpart to `summarize_lease_status`:
rent status, whether it looks overdue (same `FREQUENCY_DAYS`
approximation), whether the lease is ending within 60 days, and how
many maintenance requests are still open, all computed from the one
lease `Lease.tenantAccountId` links to the caller's own account — no id
in `moduleContext` needed, unlike every other skill in this registry,
since a tenant's own account already names the only lease it could ever
ask about. `ai:act` is now granted to the `tenant` role for exactly
this. Verified live: ran it from the `/tenant` page's Ask AI panel and
confirmed the draft matched the page (open maintenance count included).

## CSV export and scheduled email digests for Reports (this pass)

Closes "the rest of the Reports module" the blueprint review named
separately from Module 14's own dashboard: `GET /reports/
portfolio-overview` (see "A project summary skill, and a real Reports
dashboard" above) gave a landlord real numbers on screen, but nothing
to take away from it and nothing that reached them without opening the
app. Two genuinely different things closed together because both are
small, don't touch each other's code, and are natural follow-ons to the
same dashboard.

- **`GET /reports/portfolio-overview/export`** (`property:read`, same
  gate as the dashboard itself) — a real CSV file (`Content-Type: text/
  csv`, RFC 4180 escaping — a property name or address with a comma in
  it doesn't silently corrupt the columns after it), not the same JSON
  restated with commas. Two tables in one file since plain CSV has no
  concept of sheets: the actual property list first (the atomic data
  worth opening in a spreadsheet and filtering yourself), the dashboard's
  own summary totals beneath it, so the file stands alone without the
  dashboard open alongside it. The web `Reports` page's new "Export CSV"
  button fetches it and hands the browser a `Blob` to download — a plain
  `<a href>` can't carry the httpOnly auth cookie or `X-Account-Id`
  header this route needs, so the file has to be fetched in JS first.
- **Real scheduled email digests** — `Account.reportDigestFrequency`
  (`off` | `weekly` | `monthly`, new column, off by default) plus a
  genuine `@nestjs/schedule` cron (`ReportsSchedulerService`, added as a
  real dependency — pinned to `6.1.3` since the latest major needs Nest
  v11/v12 and this scaffold is still on v10), not a settings field
  nothing reads. The daily job (`findAccountsDueForDigest`) checks every
  opted-in account's `reportDigestLastSentAt` against a plain day-count
  threshold (7 or 30 days — same order-of-magnitude approximation
  `summarize_lease_status`'s own `FREQUENCY_DAYS` already uses, not a
  real calendar) and sends whoever's due. `ReportsService.sendDigest` —
  the exact method both the cron and a manual "Send me one now" button
  call — emails every member of the account (same "notify whoever's
  actually behind this account" reasoning the tenant-signup
  notification above already uses) via the same `EmailService` the
  invite flow and tenant notifications use, and always stamps
  `reportDigestLastSentAt` so a manual send counts toward the schedule
  too.
- **New `PATCH /reports/digest-subscription`** (`property:write` — a
  standing config change, not a read) and **`POST /reports/
  digest-subscription/send-now`** (`property:read` — sending a copy of a
  report the caller can already see doesn't need a higher bar). The web
  `Reports` page's new "Email digest" card is both the opt-in control
  and, since "send now" runs the identical code the cron would run,
  the way this job's own correctness is actually verifiable without
  waiting a real day for it to fire.
- **Verified live**: exported the CSV and confirmed both tables' numbers
  matched the dashboard exactly (including correct RFC 4180 handling);
  set the digest to "Weekly," confirmed it read back correctly after a
  full page reload; clicked "Send me one now" and confirmed the server
  log shows a real send attempt per account member (`Portfolio digest
  for account ... — ... (email send failed — see the EmailService error
  above)` — "failed" here is Resend's sandbox-key restriction, the same
  one every other notification in this scaffold hits in this dev
  environment, not a bug); confirmed the new routes carry the same
  permission gate as the existing dashboard route (a role without
  `property:read` gets the identical 403).
- **What this doesn't do.** The daily cron itself was never observed
  actually firing on its own schedule — that would take a real 24-hour
  wait — so what's verified is that `sendDigest` (the method it calls)
  works correctly and that the job registers without error at startup;
  its own timer firing is unverified, structurally identical code to
  what was verified, but still unverified. No PDF export, and no digest
  content beyond the same numbers the dashboard already shows. A real
  report builder was out of scope for this pass specifically — see "A
  real report builder" further below, which closed that gap in a later
  pass.

## AI-generated renovation visualizations — the 2D half only (this pass)

"AI-generated renovation visualizations" was Priority 6's own last
open item, explicitly gated on real AR/VR existing at all — since named
and scoped as Module 23: AR/VR Property Viewing (this README originally
mislabeled it "Module 22" before Module 22's own real scope, Smart Home/
IoT/Sustainability, was supplied — see "Module 23: AR/VR Property
Viewing — Phase 1" below for the correction and what *is* now built from
it). It doesn't, and this pass doesn't build it — real AR needs either a native
mobile app (ARKit/ARCore; this scaffold has no mobile app) or WebXR
(which doesn't work in iOS Safari, ruling out a large share of real
users), real VR needs a full 3D content pipeline (three.js or
equivalent, actual 3D assets), and turning room photos into a 3D space
at all needs photogrammetry or NeRF-based reconstruction — no library or
service for any of that is wired up here, and picking/integrating one
is a multi-week research problem in its own right, not a bounded slice.
Attempting even a stub felt like it would cost far more than it's worth
for a scaffold, so it's documented here as a real, large, deliberately
out-of-scope undertaking rather than faked.

What *is* buildable, and what this pass builds instead: a bounded 2D
slice — point at a room photo, describe a renovation, get back an
AI-edited "after" image. Not a render of the user's actual space, a
draft to get a feel for an idea.

- **`RenovationVisualization`** (new model) — `beforeImageUrl` (same
  "URL you provide yourself" convention `Document.fileUrl` already
  uses — no upload pipeline exists in this scaffold), `prompt`,
  `afterImageUrl` (set once generation succeeds), `status` (`pending` |
  `completed` | `failed`) and `errorMessage` — same "record what
  actually happened, then re-throw" shape `IdentityService.verifyNin`
  already uses for a third-party call that might fail or might not be
  configured. Optionally linked to a `Project`, always to a `Property`.
  Deliberately *not* routed through the `AiRequest`/`AiOutput`/
  `AiActionApproval` pipeline every `AiSkill` uses (`AiSkillResult` is
  `{ draftLabel, items: string[], warn }` — text only, no image output
  shape exists there at all) — there's no "draft to accept/discard"
  here the way a generated description has; the image itself is the
  delivered result, closer in shape to `PropertyValuation` than to an
  AI skill's draft text.
- **`OpenAiImageService`** (`src/visualizations/openai-image.service.ts`)
  — same "plain fetch, no SDK, `isConfigured` gate" shape
  `SumsubService`/`PaystackService` already use. Calls OpenAI's Images
  *edit* endpoint (an existing photo plus a prompt → a genuinely edited
  version — the actual fit for "renovate this room," not a from-scratch
  text-to-image call). **Real money per call, no sandbox/test mode** —
  flagged plainly in `.env.example`, unlike every other optional
  integration in this scaffold, which all have a free sandbox tier.
- **`StorageService`** (`src/visualizations/storage.service.ts`) — the
  other new piece "Search, media, and vector layers" (below) already
  flagged as entirely missing: real object storage (Cloudflare R2,
  S3-compatible), not a fake "just keep the provider's own URL"
  shortcut — OpenAI's own result is `b64_json` (no hosted URL to even
  borrow), and R2 is where the *decoded* image actually ends up living
  permanently. The one deliberate exception to this scaffold's own
  "plain fetch, no SDK" convention: uses the official
  `@aws-sdk/client-s3` package rather than hand-rolling one, because
  what makes every other integration here simple enough to hand-roll is
  that they're plain bearer-token REST calls — S3's protocol is
  SigV4-signed requests (canonical request construction plus an
  HMAC-SHA256 signing chain), real cryptographic protocol work a
  well-audited SDK already does correctly, not a shortcut worth
  avoiding a dependency for.
- **New `VisualizationsModule`** — `POST`/`GET /visualizations/
  property/:propertyId` (same "`/documents/property/:propertyId` rather
  than `/properties/:propertyId/documents`" independence
  `DocumentsController`'s own comment already explains, so this module
  and `PropertiesModule` stay decoupled; `PermissionsGuard`'s `:propertyId`
  ABAC keys on the param name regardless of which controller it's on).
  `property:write` to generate (a new record, same tier `addValuation`
  sits at), `property:read` to list — no new permission keys.
- **Web UI**: a "Renovation visualizer" card on `pages/properties/
  [id].tsx`, next to Valuations — a form (before-photo URL, prompt,
  optional project link) and a history list showing before/after images
  side by side once complete, or a red "Failed" badge with the real
  error message when generation didn't work. A disclaimer line makes
  the "not a real render of your space" caveat impossible to miss.
- **Verified live**: with no `OPENAI_API_KEY` configured (no real key
  was available while this was first written — same bar `SumsubService`/
  `StripeService` were both held to before their own credentials
  arrived), submitted a real request through the actual form and
  confirmed the exact clear error surfaced ("Image generation is not
  configured on this server — set OPENAI_API_KEY to enable it"), that
  the attempt was still persisted as a `failed` row with that same
  message (visible in the history list, red badge, after a reload — not
  silently dropped), and that the new routes carry the same permission
  gate as the rest of this scaffold (a role without `property:read` gets
  the identical 403).
- **Update: a real `OPENAI_API_KEY` arrived shortly after.** Confirmed
  it's genuinely valid (a direct model lookup call authenticated and
  returned `gpt-image-1`'s own metadata), then ran
  `OpenAiImageService.generateEdit`'s exact request logic standalone
  against the real API — fetched a real photo, built the same multipart
  request this service builds, sent it to OpenAI's edit endpoint.
  Authentication and request-shaping are both confirmed correct: OpenAI
  responded with a real, specific error rather than a connection or
  validation failure — `"insufficient_quota" / "credit_balance_exhausted"
  — You have no credits remaining"` — a billing issue on the account
  the key belongs to, not a bug in this integration. Real end-to-end
  generation (and `StorageService`'s R2 upload step, which also isn't
  configured yet — see the schema comment on why it needs five separate
  values, not the two `.env` had at this point) both remain unverified
  until credits are added and R2 is fully configured.
- **Update: real R2 credentials arrived (all five, correctly named)
  shortly after that.** Ran `StorageService.uploadImage`'s exact logic
  standalone against the real bucket — a real `PutObjectCommand` through
  `@aws-sdk/client-s3` succeeded, and the resulting public URL
  (`R2_PUBLIC_BASE_URL` plus the generated key) was independently
  fetchable and returned the uploaded image with the correct
  `Content-Type` — full confirmation of the one deliberate "real SDK,
  not plain fetch" exception this file's own comment explains. OpenAI
  generation itself is still blocked on the same billing issue above
  (unrelated to R2, and unchanged) — so a full generate-then-store
  request through the actual web form still isn't possible yet, but
  every piece of the chain except OpenAI's own account balance is now
  independently confirmed working with real credentials.
- **Update: a new `OPENAI_API_KEY` (the billing issue resolved) arrived
  later still — real end-to-end generation is now fully confirmed.**
  Submitted a real request through the actual web form (a real photo
  URL, a plain-language prompt) and this time it ran to completion:
  `status: "completed"`, a real `afterImageUrl` on the R2 bucket
  (`.../visualizations/<propertyId>/<uuid>.png`), both the before and
  after images rendering correctly in the UI. Every piece of the chain
  named in the two "Update" bullets above — OpenAI's own request/auth,
  R2's own upload/public-URL step, and now the actual image edit itself
  — is confirmed working end to end with real credentials, not just
  independently exercised.
- **What this doesn't do.** No real AR/VR, per the design decision
  above. Generation is synchronous (the request stays open until OpenAI
  and R2 both finish, no polling) since no job queue exists in this
  scaffold and OpenAI's edit call is itself a single request/response —
  fine at this scale, but a real deployment doing many of these
  concurrently would want a queue instead of holding an HTTP connection
  open per generation.

## Requiring a license for a regulated trade before a vendor can be assigned (this pass)

Closes "no way to require a vendor actually have a license before it
can be picked" — flagged for both Property inspections and Maintenance
requests once `Vendor.licenseNumber` existed to check in the first
place (see "A self-reported professional license for vendors" above).

- **`PropertiesService.requireVendor`** — the one referential-integrity
  check both `inspectorVendorId` (inspections) and `assignedVendorId`
  (maintenance requests) already pass through, so extending it once
  closes the gap for both at the same choke point. Now rejects the
  assignment with a clear `BadRequestException` if the picked vendor's
  own `serviceCategory` is one of `LICENSE_REQUIRED_CATEGORIES`
  (`electrical`, `security_installation`, `general_contracting` — the
  same trio `Vendor.licenseNumber`'s own schema comment already names as
  where a license actually means something) and that vendor has no
  license on file, or has one that's expired. Every other category —
  including a vendor picked as a general inspector — is unaffected, and
  the freeform `inspectorName`/`assignedTo` path next to this one still
  records nothing about licensing at all, same as before: there's no
  vendor record for a freeform name to check against.
- **Verified live**: created a fresh `VENDOR`-type account
  (`serviceCategory: "electrical"`) with no license on file, and
  confirmed scheduling an inspection with it as `inspectorVendorId`
  through the real form failed with the exact expected message
  (`"Test Electrical Co has no professional license on file — required
  for a electrical vendor to be assigned here"`); added a real license
  through `pages/vendors/me.tsx`'s own license form, retried the
  identical action, and confirmed it succeeded. Confirmed no regression
  for the existing `renovation`-category seeded vendor (whose license
  happens to be expired, from an earlier pass's own testing) — still
  assignable, since `renovation` isn't in the gated list.
- **A real bug found and fixed while verifying this** — unrelated to the
  license check itself, but it blocked testing it: creating the fresh
  test vendor account above hit `pages/vendors/me.tsx` stuck
  permanently on "Loading…" instead of showing the "Create your vendor
  profile" form. Root cause was in the shared `request()` helper
  (`lib/api.ts`), not this page: `GET /vendors/me` for an account with
  no vendor profile yet returns `null` (Nest sends an empty body with no
  `Content-Type` header for that, not the literal JSON string `"null"`,
  the exact same shape `GET /tenant/lease` and several other "not found
  yet" endpoints already use) — but `request()` only ever called
  `res.json()` when the response actually declared an
  `application/json` content-type, and returned `undefined` otherwise.
  Several pages (`VendorDashboardPage` among them) use `undefined` as
  their own "still loading" sentinel for exactly this kind of state, so
  a real, successful "no profile yet" result was indistinguishable from
  "hasn't resolved yet" and left those pages stuck forever — a
  pre-existing bug affecting every such endpoint app-wide, not something
  this pass introduced, just never triggered before because no earlier
  pass happened to live-test a truly fresh, zero-profile account through
  this exact page. Fixed by having the non-JSON branch drain the body
  and resolve to `null` instead of `undefined` — the same sentinel every
  affected page's own "no profile yet" check already expects, and it
  also stopped the browser reporting these responses as aborted/
  unconsumed streams (`net::ERR_ABORTED` was showing in the network
  tab for every affected call, despite the server itself always
  returning a clean `200`).

## Fuzzy free-text search for all three marketplaces (this pass)

Closes half of "Search and vector layers still entirely missing" below —
the search half. Property listings, vendors, and materials/products could
previously only be filtered by exact-match fields (category, city,
listing type); there was no way to type a name or phrase and find
approximate matches.

- **Postgres `pg_trgm`, not a real Elasticsearch/OpenSearch cluster** —
  a deliberate choice (see the options laid out and the decision made
  when this pass started) to reuse the existing Postgres instance rather
  than stand up a new external service. `CREATE EXTENSION pg_trgm` plus
  five `gin_trgm_ops` indexes (`property_listings.title`/`.description`,
  `vendors.businessName`, `products.name`/`.description`) is the entire
  new infrastructure footprint. This is honestly not Elasticsearch — no
  relevance tuning, no fielded queries, no distributed index — but it
  does close the actual user-facing gap ("let me search by name/keyword
  and tolerate typos") without a new service to run, pay for, or operate.
- **The pattern, used identically in `ListingsService.findAll`,
  `VendorsService.findAll`, and `MaterialsService.findProducts`**: a raw
  `$queryRaw` (Prisma's own tagged-template parameterization — never
  string-concatenated) picks matching ids and ranks them by
  `word_similarity()`, then a normal Prisma `findMany({ where: { id: {
  in: ids } } })` hydrates the full typed rows with their usual
  `include`s, then a JS `.sort()` restores relevance order (SQL's `id IN
  (...)` doesn't preserve one). This is the first use of `$queryRaw`
  anywhere in this codebase — everywhere else, Prisma's query builder was
  enough.
- **`word_similarity()` compared to an explicit `0.3`, not the `%`
  operator and not the `<%` operator either — both were tried and both
  were wrong, caught by live-testing, not by reasoning about it up
  front.** Plain `similarity()`/`%` scores the *entire* two strings
  against each other; a search phrase shorter than the field it's
  matching against loses even to an exact substring match once the field
  is long enough (`"Ocean Drive"` against a full listing title scored
  0.29 — below the 0.3 default threshold — for an *exact* match).
  Switching to `word_similarity()` (designed for exactly this: "does my
  short phrase match some substring of this longer text") fixed that,
  but the `<%` operator form of it is gated by a *different*, stricter
  GUC (`pg_trgm.word_similarity_threshold`, defaulting to 0.6, vs `0.3`
  for plain `%`) — a real `"Cermic Tile"` vs `"Ceramic Floor Tile
  (60x60)"` word-similarity score of 0.48 passed the raw function but
  silently failed the `<%` operator. The final, verified-live form calls
  `word_similarity(query, column) > 0.3` directly in the `WHERE` clause,
  matching plain similarity's own threshold instead of depending on a
  session GUC.
- **Web**: a debounced (250ms) search box added to all three marketplace
  pages (`pages/vendors/index.tsx`, `pages/marketplace/index.tsx`,
  `pages/marketplace/materials/index.tsx`), alongside their existing
  exact-match filters rather than replacing them — `q` and the other
  filters combine with `AND` in every case (e.g. category + search text).
- **Verified live** for all three marketplaces, including the two bugs
  above and their fixes: `"Leki Renovation"` (misspelled) → `Lekki
  Renovations Co.`; `"Ocean Drve"` (misspelled) → `14 Ocean Drive —
  Renovated 4-Bed Family Home`; `"Cermic Tile"` (misspelled, and only a
  fragment of the full product name) → `Ceramic Floor Tile (60x60)`; an
  unrelated nonsense query returned zero results in each marketplace, not
  a false-positive match.
- **Not done**: no typo-tolerant search on any other field (property
  address, project titles, document names, ...) — only the three
  marketplaces the blueprint's own search gap called out. Relevance
  ranking beyond trigram similarity closed in a later pass — see
  "Marketplace search relevance boosting" below.

## Marketplace search relevance boosting (this pass)

Closes "no ranking beyond trigram similarity (no relevance boosting by
recency, rating, or verification status)" — the one gap the fuzzy-search
pass above left open. Before this, two results with the same or similar
text relevance broke ties in whatever order Postgres happened to return
them, ignoring signals a real search product would obviously use.

- **One shared, generic scoring function** (`rankingBoost` in
  `apps/api/src/common/search-ranking.util.ts`), not three separate
  weightings that happen to look similar — this is bounded arithmetic
  (recency decay, a normalized rating, a flat verified bonus), not a
  domain-specific judgment call the way a trust score is, so it lives in
  `common/` and is imported by all three marketplace services rather
  than duplicated per marketplace the way this codebase's own per-domain
  business logic usually is.
- **Deliberately small and additive, never a replacement for text
  relevance**: each of the three signals contributes at most `0.05` (a
  maximum `0.15` total), added on top of the `word_similarity()` score
  the existing fuzzy search already ranks by. Because the SQL `WHERE`
  clause already excludes anything below the `0.3` relevance threshold
  before the boost is ever applied, a weakly-relevant match can
  structurally never outrank a strongly-relevant one — the boost only
  ever reorders *within* the set of already-relevant results, breaking
  near-ties in a sensible direction (newer, better-rated, verified).
- **Real signals per marketplace, not the same three everywhere**:
  listings get recency + verification (a `PropertyListing` has no rating
  field of its own); vendors get all three directly; materials/products
  get rating + verification from the product's own `Supplier` (a
  `Product` has neither field itself) plus the product's own recency —
  `MaterialsService.findProducts`'s existing `supplier` include gained
  `verificationStatus` alongside the `ratingAverage` it already selected.
- **The raw SQL changed from selecting just `id` to also returning the
  similarity `score`** for all three searches — the boost math (in
  TypeScript, not SQL) needs the actual relevance number to add to, not
  just an ordinal position, so the final sort is `word_similarity() +
  rankingBoost()` computed per row after Prisma hydration, same "raw SQL
  for the part Prisma can't express, TypeScript for everything else"
  split this feature already established.
- **Verified live with a controlled, rigorous test, not just a
  plausible-looking result**: created two real vendors named "Precision
  Plumbing Ltd" (unverified, no rating, 400 days old) and "Precision
  Plumbing Co" (verified, 4.8 rating, brand new) — confirmed by direct
  SQL query that both scored an *identical* `word_similarity()` of
  `1.0` against the query "Precision Plumbing" (a perfect substring
  match for both), so any reordering could only come from the boost,
  not a coincidental relevance difference. Searching that exact phrase
  through the real running app returned "Precision Plumbing Co" first,
  confirming the boost worked exactly as designed. Re-ran the existing
  fuzzy-search regression checks for all three marketplaces (misspelled
  vendor name, misspelled listing title, misspelled+partial product
  name) and confirmed no change in behavior for cases where relevance
  itself, not a tie, determines the order.
- **Not done**: no popularity/click-through signal (`PropertyListing.
  viewCount` exists but isn't used here — deliberately: it measures
  attention, not quality, and conflating the two felt like a real
  product decision, not a bounded technical one); the boost weights
  (`0.05` each) are a reasonable starting point, not tuned against real
  usage data, since none exists yet for this scaffold.

## Stub LLM argument extraction (this pass)

Closes "the stub LLM provider doesn't extract structured arguments from
free text." Turned out to be a much smaller gap than it sounded:
`model_roi_scenario` is the *only* skill in this entire registry whose
`inputSchema` declares anything beyond `NO_INPUT_SCHEMA` — every other
skill reads nothing from `input` at all, everything comes from
`moduleContext` plus platform data (see `ai-skill-input-schema.ts`'s own
comment, confirmed again here by grepping the whole skill registry).
So "extract structured arguments" reduces to one dedicated heuristic
parser for one skill, not a general schema-driven engine.

- **`extractModelRoiScenarioInput`** (`stub-llm.provider.ts`) — plain
  regexes over the same lowercased sentence `KEYWORD_ROUTES` already
  matches against, deliberately not generalized to read the schema
  itself: a registry of one real consumer doesn't justify a generic
  engine, and if a second skill ever grows a real schema, that's the
  point to reconsider the tradeoff, not before. Detects `scenario` from
  phrasing ("sell now", "rent increase", ...), pulls whichever of
  `rentIncreasePercent`/`appreciationRatePercent` is relevant to that
  scenario, `holdYears`, and a `currentMonthlyRent` amount.
- **A real bug caught before it ever shipped, not after**: the first
  version of the rent-amount regex used a negative lookahead
  (`(?!\s*%)`) to avoid matching a percentage figure — for "increase the
  rent by 15% to 500,000", it backtracked onto a *partial* digit run
  (just the "1" out of "15") once the full "15" failed the lookahead,
  silently returning `currentMonthlyRent: 1` instead of the intended
  500000 (or, correctly, nothing at all from that fragment). Caught by a
  standalone test script before touching the live app, not by the live
  test itself. Fixed by tracking which character ranges a percentage or
  "N year(s)" phrase already consumed, then picking the *largest*
  remaining freestanding number in the sentence (a real rent figure is
  reliably bigger than a percentage capped at 500 or hold-years capped
  at 50 by the schema itself) — proximity-to-a-keyword was exactly the
  brittle approach that produced the bug, so the fix doesn't lean on
  proximity at all.
- **Verified live through the real running app** (this environment has
  no `ANTHROPIC_API_KEY` configured, so `StubLlmProvider` is what
  actually answers every Ask AI request here, not a mocked path): asked
  "what if i increase the rent by 15% to 500,000 naira" against a real
  property and got back a real `model_roi_scenario` draft computing
  against `Current rent: 500,000 NGN/month` and `At +15%: 575,000
  NGN/month` — both numbers correct, confirming the exact bug above
  stayed fixed end-to-end, not just in the standalone test. Asked
  "should i sell now or hold for 5 years at 7% appreciation" and got
  back `Hold 5 year(s) at 7%/year appreciation` — confirming
  `holdYears` and `appreciationRatePercent` extract correctly and
  independently from the `rent_increase` scenario's own two fields, with
  no cross-contamination between scenarios.
- **Not done**: no extraction for any other skill, because no other
  skill has anything to extract; a real `ANTHROPIC_API_KEY` still
  produces meaningfully better argument-filling than this heuristic ever
  will (it reads the actual schema and full sentence semantics, not a
  handful of regexes) — this only ever had to do better than the `{}`
  it replaced, not compete with a real model.

## Semantic property search — pgvector + OpenAI embeddings (this pass)

Closes the other half of "Search and vector layers still entirely
missing" — the vector half, specifically "a vector DB for AI context
retrieval." The decision (see the options laid out and the choice made
when this pass started) was `pgvector` on the existing Postgres instance,
not a dedicated vector DB service (Pinecone/Weaviate/Qdrant) — same
reasoning as choosing `pg_trgm` over Elasticsearch above: no new service
to run, pay for, or operate.

- **`PropertyEmbedding` model** (`Unsupported("vector(1536)")` — Prisma
  has no native vector type, so every read/write of this one column goes
  through raw SQL, never the Prisma Client query builder) plus a
  hand-written migration (`CREATE EXTENSION vector`, one table, no
  ivfflat/hnsw ANN index — row counts at this scale don't need one, a
  plain cosine-distance `ORDER BY embedding <=> query` is fast enough).
  `accountId` is denormalized onto the embeddings table itself so
  semantic search can filter by account directly, without a join — the
  same tenant-isolation boundary `property:read` enforces everywhere
  else in this codebase.
- **`OpenAiEmbeddingService`** — the same "plain fetch, no SDK,
  `isConfigured` gate" shape every other optional third-party
  integration in this codebase uses (`OpenAiImageService`, `SumsubService`
  before it). `text-embedding-3-small` (1536 dimensions), OpenAI's
  cheapest embedding model — fine for a portfolio-search feature, not a
  precision-critical one.
- **Automatic indexing is fire-and-forget, not "record failure then
  re-throw"** — a deliberate difference from the visualizer/identity
  services' own pattern. A property's embedding is an enrichment nobody
  is waiting on synchronously; `PropertiesService.create` calls
  `indexEmbedding` without awaiting its result on the response path, and
  swallows+logs any failure so an unconfigured or out-of-credit OpenAI
  account never breaks property creation itself. There's no `update()`
  endpoint on `Property` in this scaffold yet, so create is currently the
  only automatic trigger.
- **Manual reindex for backfill**: `POST /properties/reindex-embeddings`
  (account-scoped) re-embeds every property on the current account,
  sequentially (gentle on OpenAI's own rate limit, not `Promise.all`),
  collecting per-property failures instead of aborting the whole batch on
  the first one — since "OpenAI has no credit" fails every property
  identically, the caller should see that clearly rather than a single
  opaque 500.
- **`GET /properties/search?q=...`** (account-scoped): embeds the query,
  then the exact same "raw SQL ranks ids by relevance, Prisma hydrates
  the full typed rows, JS `.sort()` restores order" split the pg_trgm
  marketplace search above uses — cosine distance (`<=>`) instead of
  `word_similarity()` is the only real difference.
- **Web**: a "Semantic search" box on the Portfolio page
  (`pages/properties/index.tsx`), separate from the plain property list
  rather than a client-side filter of it, and a "Reindex for search"
  button for backfill. Deliberately submit-only (Enter/button), not
  debounced-as-you-type like the free pg_trgm search — each call is a
  real OpenAI API request, not a free Postgres query.
- **Verified live, honestly**: every part of the pipeline that doesn't
  require an actual OpenAI response — routing (`/properties/search`
  registered ahead of `GET :propertyId` so it isn't swallowed as a
  property id), auth/account-scoping, the fire-and-forget hook not
  blocking property creation (confirmed: creating a property returned
  immediately, with a `Skipping embedding for property ...` warning
  logged afterward), and both new endpoints surfacing a clean, specific
  `BadRequestException` instead of a crash or opaque 500 — all verified
  live against the real running app. The embedding call itself used to
  hit the same pre-existing OpenAI billing block documented for the
  visualizer (`"You have no credits remaining"`) — since resolved, see
  the "Update" bullet below.
- **Update: a new `OPENAI_API_KEY` arrived — real end-to-end generation
  now fully confirmed.** `POST /properties/reindex-embeddings` against
  the real running app returned `{"total":4,"indexed":4,"failed":0}` —
  every property on the account really re-embedded. Then, the real
  point of the feature: `GET /properties/search?q=renovated family home
  in Lekki` correctly ranked "14 Ocean Drive" (an actual renovated,
  4-bed family home in Lekki) first among four real properties, ahead of
  a bare test house and two placeholder rows with no matching
  description at all — genuine cosine-similarity ranking against real
  embeddings, not a coincidence of row order.
- **Not done**: no automatic re-indexing on property update (no
  `PATCH`/update endpoint existed on `Property` when this was written —
  one exists now, see "Module 3: Property Details" above, but this
  pass's own reindex hook was never revisited to fire from it), no
  embeddings for anything other than `Property` (listings, vendors,
  projects, documents — all still pg_trgm/exact-match only), no hybrid
  search combining vector similarity with the pg_trgm results above.

## A real report builder (this pass)

Closes "only one fixed report shape exists (portfolio overview + CSV
export + email digest)." Before this, "Reports" meant exactly one
dashboard — every user saw the same numbers in the same layout, with no
way to pick a subset, save it, or come back to it later.

- **A fixed metric registry, not a dynamic query engine**
  (`METRIC_REGISTRY` in `reports.service.ts`) — 13 keys, each a
  projection function from the *one* `getPortfolioOverview` computation
  the fixed dashboard above already runs (`properties_total`,
  `maintenance_open`, `top_vendors`, ...). A saved report is an ordered
  list of these keys, nothing more — there's no query language to parse,
  no per-metric database round-trip, and no way to express something the
  registry doesn't already name. Running or exporting a saved report
  computes the overview exactly once and picks rows out of it.
- **`ReportDefinition`** (`accountId`, `name`, `metrics: Json`) — a
  normal Prisma-managed model (unlike this pass's other two features, no
  `Unsupported` column here), with its own hand-written migration.
- **`GET /reports/metrics`, `POST/GET /reports/definitions`, `DELETE
  /reports/definitions/:id`, `GET /reports/definitions/:id/run`, `GET
  /reports/definitions/:id/export`** — `property:read` for anything that
  only reads (the registry, saved reports, a run result), `property:write`
  for create/delete, the same split every other self-service account
  setting in this codebase already uses. The CSV export reuses the exact
  same `csvField`/`csvRow` RFC-4180 escaping helpers the portfolio-overview
  export already established — one escaping implementation, not two.
- **Web**: a "Report builder" card on the Reports page
  (`pages/reports/index.tsx`) below the existing dashboard and digest
  card — a checkbox grid of every registry metric, a name field, a "Save
  report" button, and a list of saved reports each with Run (renders a
  table inline), Export CSV (reuses the page's existing `downloadCsv`
  helper), and Delete.
- **Verified live end-to-end**: saved a report with 2 metrics
  (`maintenance_total`, `top_vendors`) against real seeded data, ran it
  (correctly returned `Total maintenance requests: 8` and `Top vendor:
  Lekki Renovations Co. (NGN): 901000` — matching the fixed dashboard's
  own open+resolved+other breakdown), exported it (fetched the actual
  response body over the network, confirmed exact matching CSV), and
  deleted it (list correctly returned to empty). No server errors at any
  step.
- **Not done**: no scheduling a saved report's own digest (only the one,
  fixed portfolio-overview digest from the pass before this one exists);
  no sharing a saved report with other account members beyond it already
  being account-wide; no metrics outside the registry — see "Extending
  the report builder to Payments, Documents, and Tenant" further below,
  which closed that specific gap in a later pass.

## Extending the report builder to Payments, Documents, and Tenant (this pass)

Closes the report builder's own "no metrics outside the registry —
nothing from Payments, Documents, or Tenant modules is projectable yet"
gap. Eight new registry keys, still zero new query paths: seven reuse
the identical "compute the one overview, project rows out of it" split
the original 13 already established; the eighth (Payments) reuses
another module's own service method outright rather than recomputing
its logic a second time.

- **Payments — `payments_open_disputes`, `payments_deposited_by_currency`,
  `payments_released_by_currency`, `payments_escrow_balance_by_currency`**
  — the one metric group in this pass that isn't a new Prisma query at
  all: `ReportsService` now injects `PaymentsService` (via
  `ReportsModule` importing `PaymentsModule`, which already exported it)
  and calls the exact same `getAccountOverview` the Payments dashboard
  itself uses, inside the same `Promise.all` `getPortfolioOverview`
  already runs. One computation, one source of truth for escrow/deposit/
  release numbers, not a second copy of that grouping logic living in
  two services.
- **Documents — `documents_total`, `documents_by_verification_status`**
  — a plain count and a `verificationStatus` breakdown, the same
  `countByStatus` helper `properties_by_status`/`projects_by_status`
  already use, just fed `Document` rows instead.
- **Tenant/leases — `tenant_active_leases`, `tenant_overdue_leases`** —
  the one genuinely new piece of logic: an account-wide "does this
  lease look overdue" check, ported from `summarize_lease_status`
  (`ai/skills/summarize-lease-status.skill.ts`), which only ever ran
  per-property for one landlord-facing AI narration. Duplicated rather
  than imported — same "parallel copy with a cross-reference comment"
  convention `VendorTrustAudit`/`SupplierTrustAudit` already established
  for near-identical logic used in two different contexts — and scoped
  to every active lease across the whole account, not one property.
- **Verified live against real seeded data**: built a 3-metric report
  (`payments_deposited_by_currency`, `documents_by_verification_status`,
  `tenant_overdue_leases`), ran it, and confirmed every number —
  `Deposited (NGN): 1558000`; `Documents — verified: 7`, `rejected: 1`,
  `not_verified: 3`, `submitted: 1`; `Leases with rent overdue: 1` —
  then exported it and confirmed the CSV response body matched exactly.
  No server errors, no circular-dependency issue from the new
  cross-module `PaymentsService` injection.
- **Not done**: no metrics from Vendor/Supplier trust scores, identity
  verification status, or the compliance tracker — this pass covered
  the three modules the original gap specifically named, not every
  remaining module in the app.

## A platform compliance tracker (this pass)

Neither real AR/VR nor the compliance gap below has a direct code fix —
AR/VR needs infrastructure (native/WebXR, photogrammetry, a 3D pipeline)
that doesn't exist here, and compliance is regulatory/legal work no code
can perform. Asked which bounded, honest slice to build instead of
either, the answer was this: a real place to track that the compliance
work exists and where it stands, without pretending to do the work
itself.

- **`ComplianceItem`** — genuinely platform-wide, like `Role`/
  `Permission` (the only other account-independent tables in this
  schema): `jurisdiction` and `category` are free text, not enums — this
  scaffold can't know every market the platform might expand into —
  plus `title`, `status` (`not_started`/`in_progress`/`done`), and
  `notes`. No `accountId` anywhere: this tracks the platform operator's
  own regulatory posture, not any one tenant's.
- **`compliance:read`/`compliance:write`, granted only to
  `platform_reviewer`** — the exact same isolation every other
  neutral-reviewer permission already uses (`vendor:verify`,
  `dispute:arbitrate`, `document:arbitrate`, `review:moderate`): the role
  that owns this data never gets it, and no tenant-facing role carries
  either key. `platform_reviewer` itself is nothing special at the
  account level — confirmed by re-reading how it already works — it's an
  ordinary `AccountMember` role inside an ordinary `Account`
  (`accountType: COMPANY`, the seeded "PropertyOnTheGo Trust & Safety"
  account); "platform-wide" comes entirely from the permission only ever
  being granted to that one role, and from these routes carrying no
  `:accountId`/`:propertyId`/`:projectId` param for `PermissionsGuard`'s
  ABAC check to key on — the same shape `VendorsService.
  setVerificationStatus` already established for `vendor:verify`.
- **The two new permissions are inserted directly in the migration**
  (`INSERT INTO permissions ...` / `INSERT INTO role_permissions ...`,
  keyed off `roles.key = 'platform_reviewer'`), not left to a re-seed —
  this is data on the live shared database, not just schema, and
  `seed.ts`'s own `PERMISSIONS`/`ROLES` entries were updated identically
  so a fresh seed run never disagrees with what the migration already
  did. Verified directly against the live database that both rows
  landed and are linked only to `platform_reviewer`.
- **Web**: a new "Compliance" nav item — unlike `platform_reviewer`'s
  other actions (vendor/supplier verification, dispute arbitration,
  document verification, review moderation), which all reach their
  screens through the Vendors/Documents/Payments nav items that already
  exist for other reasons, this is its own, unrelated concern with
  nowhere existing to live, so it gets a dedicated item — shown only to
  this one role, the same exception `TENANT_NAV_ITEM` already
  established for tenant accounts. The page itself has no client-side
  role gate; it just renders whatever `GET /compliance/items` returns, or
  a plain "switch accounts" message if that 403s.
- **Verified live, both sides of the gate**: visited `/compliance` as
  the ordinary demo property-owner account — got the exact 403-driven
  message, no nav item shown. Switched to the seeded platform-reviewer
  account — nav item appeared, and a full create → change status →
  in_progress → save a note → delete cycle round-tripped correctly
  against the real API, each step confirmed against the actual network
  response, not just the UI updating optimistically. No server errors at
  any step.
- **Not done, and not pretending otherwise**: this grants no license,
  verifies no jurisdiction's actual legal requirements, and enforces no
  data residency — it's bookkeeping for humans doing that work, nothing
  more. No due-date/reminder mechanism, no file attachments per item, no
  audit trail of who changed what (only `updatedAt`, no history).

## A dedicated Inspector role (this pass)

Closes "a Vendor account can be picked for the job, but there's no
distinct role type." A `VENDOR`-type account previously always got the
identical `vendor` role — full marketplace permissions (bidding on
projects, disputes, payouts, rentals) — regardless of whether it was
actually a general contractor or a professional whose whole business is
being picked as `PropertyInspection.inspectorVendorId`.

- **A real, narrower `Role`, not a new `AccountType`** — the account
  creation flow already picks exactly one fixed role per account type
  (`AccountsService.create`'s `DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE`); this
  adds the one place that isn't fixed. `CreateAccountDto.vendorRole`
  (`"vendor"` | `"inspector"`, a closed enum, never free text) is read
  only when `accountType === "VENDOR"` and picks between the existing
  `vendor` role and a new `inspector` role — built entirely from a
  *smaller* slice of permissions the `vendor` role already has
  (`vendor:read`, `vendor:write`, `document:read`, `ai:act` — no
  `quote:*`, `dispute:*`, `payout:read`, `rental:*`, `product:read`). No
  new permission keys were needed.
- **Deliberately doesn't gate who can be picked as an inspector** — a
  property owner can still assign *any* `Vendor` (any role) to
  `inspectorVendorId`/`assignedVendorId`, still subject to the same
  license check regulated trades already require (see "Requiring a
  license for a regulated trade before a vendor can be assigned" above).
  This role only narrows what the account itself can *do* — it's a
  professional-identity choice for the vendor, not a new access-control
  gate on the property owner's side.
- **Web**: a "Vendor type" picker on the account-creation screen
  (`pages/accounts/new.tsx`), shown only when `VENDOR` is selected.
- **A real bug found and fixed while verifying this** — creating an
  inspector-role vendor profile and loading its own dashboard
  (`pages/vendors/me.tsx`) surfaced a confusing top-level "Missing
  permission(s): dispute:read" error banner, even though the profile
  itself, license form, and bank-details form all loaded and worked
  fine. Root cause: `VendorDashboardPage.load()` used `Promise.all` over
  `myQuotes()`/`myPayouts()`/`myDisputes()` — fine when every vendor
  account had every one of those permissions, which was true for every
  role that existed before this pass, but an inspector-role account
  legitimately 403s on all three by design, and `Promise.all` rejects
  the whole load on the first failure. Fixed with `Promise.allSettled`,
  keeping whichever of the three actually succeed and silently leaving
  the rest at their empty-array default — no error shown for a
  permission gap that isn't a bug.
- **Verified live**: created a real `VENDOR` account choosing
  "Inspector," confirmed the account switcher shows `vendor · inspector`
  (not `vendor · vendor`); confirmed `POST /vendors` (creating the
  profile) succeeds; confirmed `GET /vendors/me/quotes`,
  `.../me/payouts`, and `.../me/disputes` all correctly 403 for it;
  confirmed the dashboard renders cleanly with no error banner after the
  fix above.
- **Not done**: no way to change an existing account's role after
  creation (this is a creation-time choice only); the dashboard still
  renders empty Quotes/Disputes/Payouts sections for an inspector
  account rather than hiding them outright — cosmetic, not a correctness
  issue, since they're honestly empty rather than erroring.

## Structured evidence-submission channels for document and vendor/supplier verification (this pass)

Closes "only dispute arbitration has a real evidence channel — document
verification and vendor/supplier verification don't." Document
verification already had a `"submitted"` status meaning "needs more
evidence" (and vendor/supplier's `"pending"` was already commented as
meaning the same thing), but neither had anywhere to actually *put* that
evidence — `DocumentsService.arbitrateVerify`'s own comment used to say
outright that "more evidence" meant "whatever the account does outside
this flow."

- **`DocumentEvidence`, `VendorVerificationEvidence`,
  `SupplierVerificationEvidence`** — three separate, parallel models
  (not one shared/polymorphic table), matching this codebase's
  established preference for parallel implementations over cross-cutting
  abstractions (the same choice `VendorTrustAudit`/`SupplierTrustAudit`
  already made). All three mirror `DisputeEvidence`'s exact shape
  (`note`, optional `fileUrl`, `submittedByUserId`, `createdAt`) — the
  one real difference: a dispute has two parties who might each submit,
  a document/vendor/supplier has exactly one owning account, so there's
  no `requireDisputeParty`-style ownership-resolution step, just a plain
  `accountId` match.
- **Symmetric read access, same shape across all three**: the owning
  account reads its own submissions (`GET /documents/:id/evidence`,
  `GET /vendors/me/verification-evidence`, `GET
  /suppliers/me/verification-evidence`); the reviewer reads any of
  them platform-wide gated on the exact same permission that already
  arbitrates them (`document:arbitrate`, `vendor:verify`,
  `supplier:verify`) rather than a new key. Document evidence also
  appears inline in `findPendingForArbitration`'s own response (same
  place `PaymentsService.findOpenDisputesForArbitration` already
  includes `DisputeEvidence`), so the reviewer sees it without a second
  fetch.
- **Web**: a "Submit evidence" control appears on the document's own row
  once a reviewer sets it to `"submitted"`, and a "Verification
  evidence" card appears on the vendor/supplier dashboard whenever that
  profile isn't yet verified (not gated to a specific status — evidence
  toward a first-time verification is exactly as legitimate as evidence
  in response to a specific reviewer request). Both attach an optional
  file via the new upload pipeline (see below). The reviewer's own
  screens (`DocumentArbitrationRow`, both vendor/supplier
  `PlatformReviewPanel`s) render the submitted thread inline.
- **Verified live, both directions, for documents and vendors** (the
  supplier path is byte-for-byte the same code, spot-checked via its own
  "already verified" guard and its `GET` endpoint returning `200 []`,
  not run through the full UI cycle): set a real document to
  `"submitted"` as the platform reviewer, switched to the owning
  account, submitted evidence, confirmed `POST` returned `201` and the
  account's own view showed "1 item already submitted," switched back to
  the reviewer and confirmed the submitted note appeared inline in the
  arbitration queue. Identical cycle repeated for vendor verification
  evidence against a real vendor profile, confirmed on the vendor's
  detail page's Platform review panel.
- **Not done**: no way for the reviewer to reply/converse within the
  evidence thread (it's one-directional — account submits, reviewer
  reads); no evidence-submission channel for review moderation
  (`review:moderate`) — "flagged" already plays an analogous "needs a
  decision" role there, raised by the reviewed party rather than
  requested by the reviewer, so nothing parallel was missing.

## Unifying two-party dispute resolution with arbitration (this pass)

Closes "two-party dispute resolution and arbitration coexist, not
unified." `PaymentsService.applyDisputeResolution` (shared by both
`resolveDispute` and `resolveDisputeAsVendor`) only ever checked for an
already-*final* status (`resolved`/`rejected`) before allowing a
two-party resolution — it never checked for `under_review`. That meant
once a `platform_reviewer` set a dispute to `under_review` (explicitly
saying "I'm looking into this, send more evidence"), either original
party could still call the two-party resolve endpoint and silently
overwrite the reviewer's in-progress arbitration, including resetting
`resolvedAt` to a fresh value — a real, live-confirmed bug, not a
hypothetical one.

- **The fix**: `applyDisputeResolution` now also rejects
  (`ConflictException`, same exception type the already-final check
  already used) when `dispute.status === 'under_review'`, with a message
  pointing the caller at evidence submission instead. Once a
  `platform_reviewer` touches a dispute, the two-party path is locked
  out **for good** — arbitration supersedes it rather than merely
  pausing it, so a dispute a reviewer has taken on stays theirs to
  resolve even if they set it back to `under_review` a second time. A
  dispute neither party nor reviewer has escalated is completely
  unaffected — the two paths still coexist exactly as before *until*
  arbitration is actually invoked on that specific dispute.
- **Verified live** against a real dispute and a real project/vendor
  assignment: created a dispute, had the platform reviewer set it to
  `under_review` through the real arbitration queue UI, then called the
  owning account's own `resolveDispute` endpoint directly — got back the
  new `409 Conflict` with the exact intended message. Confirmed no
  regression on a second, untouched dispute: the same two-party resolve
  endpoint succeeded normally (`201`, `status: "resolved"`) when
  arbitration had never been invoked on it.
- **Not done**: no way for a `platform_reviewer` to hand a dispute back
  to the two-party path once taken on (by design, per the "supersedes,
  doesn't pause" decision above) — if that turns out to be needed, it
  would be a deliberate new capability, not a bug fix.

## A general file-upload pipeline (this pass)

Closes "the only real object storage (R2) is narrowly wired for
AI-generated visualization images; `Document.fileUrl` is still
bring-your-own-URL." `StorageService` (Cloudflare R2 via
`@aws-sdk/client-s3`) existed only inside the visualizations module,
reachable only from the one AI-image-generation code path.

- **`StorageService` moved to its own `StorageModule`**
  (`apps/api/src/storage/`), imported by `VisualizationsModule` rather
  than owned by it — the same service, now shared. Its one method grew
  from `uploadImage(buffer, contentType, keyPrefix)` (image-only,
  extension picked from a fixed 3-format lookup table) to a general
  `upload(buffer, contentType, keyPrefix, originalFilename?)` — a real
  upload always has a filename to take a real extension from, which a
  content-type lookup table alone can't cover for arbitrary file types
  (PDFs, Office docs, ...) the way it could for the AI visualizer's own
  fixed output formats. `uploadImage` still exists as a one-line wrapper
  so that call site needed no changes.
- **`POST /uploads`** (`multipart/form-data`, field name `file`, 25MB
  cap) — real bytes in, a real R2 URL out. Deliberately gated on nothing
  but `JwtAuthGuard`/`AccountContextGuard` (any authenticated account
  member), no `@RequirePermissions`: uploading bytes to storage isn't
  itself the sensitive action, and every existing `fileUrl` field this
  now feeds (`Document.fileUrl`, `DisputeEvidence`/`DocumentEvidence`/
  `Vendor-`/`SupplierVerificationEvidence.fileUrl`) was already a plain
  string the same caller could set to anything — the real authorization
  happens at whichever permission gates attaching that URL to a real
  resource afterward.
- **No schema changes needed anywhere** — every field that used to say
  "paste a URL you already host" still is one; this just gives every one
  of them a second, real way to get a URL, on the web side by calling
  `POST /uploads` first (`ApiClient.uploadFile`) and using the URL it
  returns. Wired into the Documents upload form (a real `<input
  type="file">` now, not a URL text box) and into all three of this
  pass's new evidence-submission forms (document, vendor, supplier).
- **Verified live against the real R2 bucket**, not mocked: since a
  native OS file-picker dialog can't be driven by browser automation,
  verification used the exact request shape the real web client makes —
  a `fetch` with a `FormData`/`Blob` body plus the same CSRF token and
  `X-Account-Id` header `ApiClient` always sends — executed from inside
  the actual logged-in page. Got back a real `201` and a real
  `https://pub-....r2.dev/uploads/<accountId>/<uuid>.txt` URL; fetched
  that URL back in a separate tab and confirmed the exact uploaded bytes
  came back. The Documents-page evidence-submission cycle (see above)
  additionally exercised the whole flow through `DocumentsService`
  end-to-end, short of the browser's own native file-picker step.
- **A real, unrelated config regression found and fixed while verifying
  this**: `.env`'s R2 variable names had reverted to (or still had) a
  mismatch from before this session's own earlier R2 setup pass —
  `CLOUDFARE_R2_ACCESS_KEY_ID`/`CLOUDFARE_R2_SECRET_ACCESS_KEY`
  (misspelled prefix), `BUCKET_NAME`, and `PUBLIC_URL`, none matching
  what `StorageService` actually reads
  (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/
  `R2_PUBLIC_BASE_URL`). Renamed the keys in place (values untouched,
  `.env` stays gitignored) so `StorageService.isConfigured` — and this
  entire pass's live verification — could actually run against real
  credentials instead of silently falling back to the "not configured"
  error path.
- **Not done**: no per-file-type validation beyond the 25MB size cap
  (any content type is accepted and stored as-is); no virus/malware
  scanning; no deletion endpoint — an uploaded file is permanent once
  stored, same as a pasted URL always effectively was.

## A comparable-sales valuation estimate (this pass)

Closes the rest of Module 15's valuation gap: `PropertyValuation` gave a
manual/AI-narrated history, and `model_roi_scenario` gave rent-increase/
sell-vs-hold modeling, but nothing produced an actual *automated*
estimate. "Comparable" means the same city and `propertyType` among
other accounts' own active sale listings — a real market signal already
sitting in `PropertyListing`, not a new integration or external data
source.

- **`PropertiesService.getComparableValuation`** — finds every other
  active, `listingType: "sale"` `PropertyListing` in the same city and
  `propertyType` (excluding the property's own listings — comparing a
  property to itself isn't a comparable-sales estimate), grouped by
  currency and never averaged across currencies (the same caution every
  other cross-listing money computation in this codebase already
  applies — `PaymentsService.getAccountOverview`, the vendor-spend
  grouping in the report builder). Below a minimum of 2 comparables, it
  still reports what it found (so the caller sees there's *something*
  nearby) but returns no averaged estimate — one listing is an anecdote,
  not a market.
- **`estimate_comparable_value`** — the new AI skill, `NO_INPUT_SCHEMA`,
  gated by the same `property:read` every other property-scoped skill
  uses. Deliberately re-implements the same search/grouping logic rather
  than calling the service method — `AiSkillDeps` only ever hands a
  skill `prisma` and `llm`, never other Nest services, the exact "kept
  in sync, not shared" split `model_roi_scenario`'s own comment already
  established against `PropertiesService.getRoiSummary`.
- **No new endpoint to "save" the estimate** — `GET
  /properties/:id/comparable-valuation` is read-only, and saving one as
  a real valuation reuses the *existing* `POST /properties/:id/valuations`
  endpoint unchanged, just with a new allowed `source: "comparable_sales"`
  value alongside `manual`/`ai_estimate`. Nothing here writes back to
  `Property.estimatedValue` automatically — same "record what's true,
  don't auto-recompute" tradeoff `addValuation` already established.
- **Web**: a "Comparable-sales estimate" card on the property detail
  page, next to the existing ROI & valuation dashboard — shows the
  estimate, the comparable count, and a min–max range, with a "Save as
  valuation" button that calls the existing valuation endpoint and feeds
  the same `valuations` state the ROI chart already watches, so saving
  one immediately updates the ROI dashboard's own "current value" too
  (no separate refresh path to keep in sync).
- **Verified live against real data, both paths independently**:
  seeded two comparable properties/listings in the same city and type
  (₦200,000,000 and ₦220,000,000 asking price) and confirmed the web
  card computed the exact expected average (₦210,000,000, range
  ₦200,000,000–₦220,000,000); clicked "Save as valuation" and confirmed
  the real `POST` request, the new entry appearing in the Valuations
  list with `source: "comparable_sales"`, and the ROI dashboard
  recalculating its own Simple ROI/current-value tiles from it
  immediately. Separately triggered the `estimate_comparable_value` AI
  skill (both via its quick-action button and by confirming its
  `POST /ai/actions` response) and confirmed its independent
  implementation computed the identical ₦210,000,000 figure. Also
  confirmed the "not enough comparables" path renders cleanly (a plain
  "No comparable active listings found in ... yet" message, no error)
  against a real property with none nearby.
- **Not done**: no comparable estimate for rent-type listings (only
  `listingType: "sale"` — a rental comparable would need a different,
  per-period basis, a real product decision this pass didn't make);
  no distance/radius matching beyond an exact city-name match — two
  properties in the same metro area but a differently-spelled or
  differently-granular city field won't match each other.

## Risk flags for projects and leases (this pass)

Closes the other named sub-piece of "the rest of risk flags/trust scores
beyond listings and vendors/suppliers" — `assess_listing_risk` was the
only entity with an explicit, flat risk-flag list; a project or a lease
only ever got prose narration (`summarize_project`,
`summarize_lease_status`) with no discrete "here's what's wrong" output
to act on.

- **`assess_project_risk`** — account-scoped (`ctx.accountId`), unlike
  `assess_listing_risk`: a project has no public/buyer-facing angle a
  marketplace listing does, so there's no reason for anyone outside the
  owning account to ask whether it looks risky. Flags overdue milestones,
  open disputes, spend released exceeding the project's own budget, and
  a project marked `in_progress` with no vendor assigned at all.
- **`assess_lease_risk`** — scoped at the *property* level, same
  `moduleContextPrefix` `summarize_lease_status` already uses, not
  per-lease: a property can carry more than one lease over time, and
  "which of this property's leases need attention" is the real
  owner-facing question. Flags each active lease that looks overdue
  (the identical anchor/period-day calculation `summarize_lease_status`
  already uses) or is ending within 60 days.
- **Both are separate skills from their existing `summarize_*`
  counterparts, not replacements for them** — the same split
  `assess_listing_risk`/`summarize_listing` already draws for listings:
  the `summarize_*` skill narrates overall health in prose: this pair
  produces a flat, explicit flag list plus a `warn` boolean a caller can
  act on without parsing a paragraph. Both reach the account's existing
  Ask AI panel automatically (`AskAiPanel` renders every registered
  skill generically) — no new REST endpoint, no new dashboard card,
  matching `assess_listing_risk`'s own footprint exactly rather than
  the fuller service+endpoint+web-card treatment the comparable-
  valuation pass just above used.
- **Verified live against real data**: ran `assess_project_risk` against
  the demo "Kitchen Renovation" project (which was carrying a real
  `under_review` test dispute from an earlier pass's own verification)
  and got back `"1 open dispute(s) on this project"` with `warn: true`;
  ran `assess_lease_risk` against "14 Ocean Drive" (carrying a real
  overdue lease from earlier seed/test data) and got back `"Overdue
  Test Tenant: rent looks ~66 day(s) overdue"` with `warn: true`;
  confirmed the clean path too — a property with no leases at all
  returned `"No risk factors flagged..."` with `warn: false`, not an
  error.
- **Not done**: no persisted/historical risk score (each call
  recomputes fresh from current data, same as every other `assess_*`/
  `summarize_*` skill in this registry); no portfolio-wide "show me
  every at-risk project/lease" view — each skill answers for one
  project or one property at a time, reachable only through that
  record's own Ask AI panel, not a cross-portfolio dashboard.

## AI narration for the report builder (this pass)

Closes the rest of what turned out to be Module 24's own "natural-
language report generation on top of every report type" (see the note
on `generate_portfolio_report`'s own README entry on the numbering
correction) — `generate_portfolio_report` already
narrated the one fixed portfolio-overview report; the report *builder*'s
own custom, saved reports had no narration option at all.

- **`narrate_report`** — `moduleContextPrefix: "account"`, same shape
  `generate_portfolio_report` already uses (a saved `ReportDefinition`
  is account-scoped, not tied to one property/project/listing). The
  *second* skill in this entire 22-skill registry with a real
  (non-empty) `inputSchema`, after `model_roi_scenario` — a required
  `reportDefinitionId` field, since there's no sensible default for
  "which saved report," unlike `model_roi_scenario`'s own all-optional,
  all-defaulted fields.
- **A deliberate, one-time exception to "duplicate, don't share"**:
  every other skill that overlaps with a REST service
  (`model_roi_scenario`/`getRoiSummary`, `estimate_comparable_value`/
  `getComparableValuation`) re-implements its own small (10-20 line)
  computation directly against `prisma`, rather than calling the
  service — `AiSkillDeps` only ever exposed `prisma` and `llm`. This
  skill breaks that pattern on purpose: `ReportsService.runDefinition`
  is a 100+ line, cross-module computation (the fixed metric registry
  itself, plus a real dependency on `PaymentsService.getAccountOverview`
  via `ReportsModule`'s own import) — duplicating *that* a third time
  would be the actual anti-pattern, not sharing it. `AiSkillDeps` gained
  a third field, `reports: ReportsService`, and `AiModule` now imports
  `ReportsModule` (which gained a real `exports: [ReportsService]` it
  didn't have before — nothing outside its own controller could inject
  it until now), the same "AiService already imports another module's
  service when a skill genuinely needs it" shape `AiModule` already
  established by importing `ProjectsModule`/`ListingsModule` for its own
  accept-drafted-action chaining.
- **Deliberately not reachable via free-text chat or a generic quick-
  action button** — unlike every other skill, `narrate_report` has no
  `KEYWORD_ROUTES` entry in `StubLlmProvider`: there's no sentence-level
  heuristic (or, for a real model, no context) that tells you *which*
  saved report id a free-text sentence means, and `AskAiPanel`'s own
  generic per-field form would otherwise ask the user to paste a raw
  UUID. Instead, a "✦ Narrate" button sits directly on each saved
  report's own row in the report builder (next to Run/Export/Delete),
  which already has that report's real id in hand — the narration
  result renders through the exact same `AiDraftCard`
  (Accept/Edit/Discard) component every other AI output in this app
  uses, not a bespoke text block.
- **Verified live end-to-end**: clicked "Narrate" on a real saved
  report (3 metrics: deposited-by-currency, documents-by-status,
  overdue-leases) and confirmed the narrated numbers matched the
  report's own "Run" output exactly — proof `runDefinition` was actually
  reused, not recomputed differently by the skill. Accepted the
  resulting draft and confirmed the real `POST /ai/outputs/:id/decision`
  call and the card updating to show "Accepted." No server errors, and
  no circular-dependency issue at boot from the new
  `AiModule` → `ReportsModule` → `PaymentsModule` import chain.
- **Not done**: no universal `warn` signal — unlike
  `generate_portfolio_report` (which can key its own warning on its one
  fixed open-dispute count), a saved report is an arbitrary, user-chosen
  combination of metrics with no universal way to decide what counts as
  "needs attention," so `warn` is always `false` here, deliberately, not
  an oversight.

## Risk flags for vendors and suppliers (this pass)

Closes the last named sub-piece of "the rest of risk flags/trust scores
beyond listings" — `Vendor` and `Supplier` had a trust-*score* (`explain_
vendor_trust_score`, `explain_supplier_trust_score`) but no flat,
explicit risk-*flag* list the way `assess_listing_risk`/
`assess_project_risk`/`assess_lease_risk` already have.

- **`assess_vendor_risk`** — public/buyer-facing like `assess_listing_
  risk` and `explain_vendor_trust_score`, not filtered by
  `ctx.accountId`: anyone browsing the vendor marketplace can ask
  whether a vendor carries flagged risk factors before hiring them.
  Flags: verification status not `verified`, any open/`under_review`
  dispute on a project this vendor is currently assigned to, an expired
  self-reported professional license, and a `major_concerns`/
  `minor_concerns` rating from the vendor's own most recent
  `VendorTrustAudit`.
- **`assess_supplier_risk`** — the materials-marketplace counterpart,
  same shape. Flags: verification status not `verified`, any cancelled
  order on record (suppliers have no `Dispute`-equivalent model — a
  cancelled order is the closest analogue, same substitution
  `computeSupplierTrustScore` itself already makes), and the same
  audit-rating flag.
- **Deliberately separate skills from `explain_*_trust_score`, not
  replacements** — same split every other `assess_*`/`summarize_*` pair
  in this registry already draws: the `explain_*` skill narrates the
  whole score in prose; these produce a flat, explicit flag list plus a
  `warn` boolean, reusing the same underlying signals (verification,
  disputes/cancellations, the platform's own audit, license expiry)
  rather than recomputing a different set from scratch. Both reach the
  vendor/supplier's existing Ask AI panel automatically (`AskAiPanel`
  renders every registered skill generically) — no new REST endpoint, no
  new dashboard card.
- **Verified live against real data**: ran `assess_vendor_risk` against
  the demo "Lekki Renovations Co." (verified, but carrying a real
  `under_review` test dispute on its "Kitchen Renovation" assignment, an
  expired license, and a real `minor_concerns` `VendorTrustAudit` from
  earlier seed data) and got back all three flags with `warn: true`, and
  correctly *no* "not verified" flag since this vendor is verified;
  ran it again against a clean vendor ("Precision Plumbing Co" —
  verified, no license on file, no disputes, no audit) and got back "No
  risk factors flagged..." with `warn: false`. Ran `assess_supplier_risk`
  against "Lagos BuildMart" (carrying a real `major_concerns`
  `SupplierTrustAudit`) and got back that one flag with `warn: true`.
- **Not done**: no persisted/historical risk score (recomputed fresh
  every call, same as every other `assess_*` skill) — see "A
  cross-portfolio at-risk view for vendors and suppliers" below for the
  aggregate dashboard built on top of these two skills' own flag logic.

## A cross-portfolio at-risk view (this pass)

Closes the "no cross-portfolio 'show every at-risk record' view exists"
gap in full — started as vendors/suppliers only in the previous pass
(`getAtRiskPartners`), then extended in the same pass to cover projects
and leases too, since every `assess_*_risk` skill has the identical
problem: each only ever answers for one record at a time, reachable
only through that record's own Ask AI panel. There was no single place
to see "what across my whole account needs attention right now."

- **Renamed, not duplicated**: `ReportsService.getAtRiskPartners`
  became `getAtRiskOverview` (`GET /reports/at-risk-overview`,
  `property:read`, same tier as `portfolio-overview`) rather than adding
  a second, near-identical endpoint for projects/leases — "partners"
  never fit projects/leases anyway, since those are the account's own
  assets, not external parties it works with. Returns four identically-
  shaped buckets (`projects`, `leases`, `vendors`, `suppliers`), each
  `{ total, atRisk: [{ id, label, flags }] }`.
- **Two more shared flag-helper extractions**, same reasoning
  `getVendorRiskFlags`/`getSupplierRiskFlags` already established (a
  deliberate departure from this codebase's usual "duplicate
  near-identical logic with a cross-reference comment" convention — see
  `isLeaseOverdue` in `reports.service.ts` for that convention's own
  reasoning): `getProjectRiskFlags` (`projects/risk-flags.ts`) and
  `getPropertyLeaseRiskFlags` (`properties/lease-risk-flags.ts`), both
  now shared between their `assess_*_risk` skill and this dashboard so
  the wording can never drift between the two surfaces. Lease risk stays
  scoped at the *property* level in both places, same reason
  `assess_lease_risk` itself is — a property can carry more than one
  active lease, so the dashboard's own "lease" row is a property (with
  each flag naming its own tenant), and its `total` counts properties
  with at least one active lease, not raw lease rows.
- **A dashboard card on the Reports page** (`AtRiskOverviewCard`,
  renamed from `AtRiskPartnersCard`, self-fetching) — one generic
  `AtRiskEntryRow` renders all four buckets identically rather than
  four near-duplicate blocks, since every bucket now shares the exact
  same `{id, label, flags}` shape.
- **Verified live**: the demo owner account's "Kitchen Renovation"
  project (its real `under_review` test dispute) and "14 Ocean Drive"
  (its real overdue lease) both appeared in `GET /reports/
  at-risk-overview` alongside the vendor/supplier rows from the
  previous pass. Re-ran `assess_project_risk` and `assess_lease_risk`
  against those same two records directly afterward and got back
  exactly the same flag text the dashboard showed — proof the
  extraction reused the logic rather than recomputing a second,
  possibly-diverging version of it.
- **Not done**: no persisted history — recomputed fresh on every
  request, same as every `assess_*` skill; no severity ranking or
  sorting across the four buckets — every at-risk record is shown, in
  the order its own category query returned it.

## Admin operations — a platform accounts directory and account suspension (this pass)

The first real sub-piece of the genuinely undefined Modules 3, 16-21, 24
bucket — nothing in this repo's history, including the blueprint review
itself, ever names what those modules actually contain beyond bare
labels ("compliance," "community management," "AR/VR," "admin
operations"). Compliance already has a real tracker (see "A platform
compliance tracker" above) and AR/VR has a written feasibility spike;
"admin operations" had nothing. Picked over "community management" for
this pass specifically because it's a well-understood SaaS pattern with
an undebatable gap in this codebase, while "community management" on a
property/vendor/materials marketplace could mean several genuinely
different things (tenant forums, HOA tools, event postings) with no
existing hint of which — building it would mean guessing at scope, not
closing a defined gap.

- **The actual gap**: this platform is fully multi-tenant by design —
  every account only ever sees its own data — but nothing platform-wide
  existed to *operate* the platform itself: no way to see every account
  that exists, no way to act on one that's abusive or dormant, no record
  of who did what. `platform_reviewer` (Module 6's neutral reviewer)
  never crosses tenant boundaries either — it reviews one vendor/
  supplier/dispute/document/review at a time, never lists or acts on
  accounts themselves.
- **A new `platform_admin` role**, deliberately distinct from
  `platform_reviewer` — trust & safety review and platform operations
  are different jobs a real platform would likely staff separately. Same
  "one user, several accounts" demo pattern as every other role in this
  scaffold: a sixth membership on the demo user, on a new "PropertyOnTheGo
  Operations" account (`COMPANY` type, not a new enum value — same
  reasoning the existing "PropertyOnTheGo Trust & Safety" account already
  uses). Carries exactly two permissions, `account:read_all` and
  `account:suspend` — not even `ai:act`, same "a handful of mechanical
  actions on other accounts' data" scope `platform_reviewer` itself
  keeps to.
- **`GET /platform-admin/accounts`** — the directory itself: every
  account platform-wide, with `accountType`, `status`, `memberCount`, and
  `createdAt`. Deliberately no "last activity" signal — nothing on
  `Account` tracks that honestly (`updatedAt` only moves when the account
  row itself changes, not on general use), and a fabricated signal would
  be worse than none. Suspended accounts sort first, for triage.
- **`POST /platform-admin/accounts/:targetAccountId/{suspend,reinstate}`**
  — wires up `Account.status`, a column that has existed in the schema
  since Module 1 and was never once read or written anywhere in this
  codebase until now. A suspended account can no longer act as itself on
  *any* route — enforced in `AccountContextGuard` itself (the one place
  every authenticated request already resolves its account context), not
  a new check bolted onto each controller. No token to revoke and
  nothing cached: the very next request re-hits the same guard and gets
  turned away immediately. A real, cheap safeguard against self-lockout:
  a platform_admin cannot suspend the account it's currently acting as.
  Both actions require a `reason`, and both are recorded in a new
  `PlatformAdminAction` table — permanent, never edited or deleted, same
  "an audit with no reasoning recorded isn't an audit" reasoning
  `VendorTrustAudit.notes` already established — surfaced as
  `GET /platform-admin/audit-log`.
- **A subtle correctness detail worth naming**: every route here uses
  `:targetAccountId`, never literally `:accountId` — `PermissionsGuard`
  already hardcodes a same-account IDOR check on any route param
  literally named `:accountId` (see its own comment), which would have
  silently 404'd a `platform_admin` trying to act on any account but its
  own. `vendor:verify`'s own `:vendorId` param avoids the identical trap
  for the identical reason.
- **A new `/admin` page**, shown only to the `platform_admin` role — same
  "gated entirely server-side, this page just renders whatever the API
  returns" shape `CompliancePage` already uses for its own single-role
  screen.
- **Not done**: no severity/pagination on the audit log (capped at 200,
  most recent first); no way to suspend a *member* rather than a whole
  account (Module 6's own moderation tools already cover a misbehaving
  individual within an otherwise-fine account); nothing here obtains a
  license, verifies a jurisdiction, or performs any of the actual
  regulatory work — that's still Section 15, tracked but not done by
  code, same as the compliance tracker above.

## Community management — landlord-to-tenant announcements (this pass)

The second, and last, sub-piece the genuinely undefined Modules 3,
16-21, 24 bucket has real scope for — see "Admin operations" above for
the first, and its own comment for why building this bucket at all
means picking a scope rather than finding one in a blueprint that never
names what it contains. "Community management" means the same thing in
every real property-management product: a landlord communicating with
the tenants of its own portfolio — an announcement/notice board, not a
social feature.

- **`PropertyAnnouncement`** — `propertyId` is deliberately nullable:
  null reaches every tenant currently linked to any of the account's
  properties (a portfolio-wide notice — "the tenant portal will be down
  this weekend"), set reaches only that one property's own tenant(s) (a
  building-specific notice — "the elevator is broken"). No new
  permission keys — reuses `property:write`/`property:read` for the
  landlord side and `lease:read` for the tenant side, the same "reuse
  what already gates the exact same tenancy" reasoning `TenantController`
  itself documents for every one of its own routes.
- **`POST/GET/DELETE /properties/announcements`** — account-wide, not
  nested under `:propertyId` (an announcement can reach the whole
  portfolio), registered before `GET /properties/:propertyId` for the
  same route-ordering reason `semanticSearch`'s own comment gives for
  "search". A `propertyId` supplied in the body is validated by hand
  against the caller's own account — `PermissionsGuard`'s `:propertyId`
  ABAC only ever fires for a route *param* of that exact name, never a
  body field.
- **`GET /tenant/announcements`** — a tenant sees exactly two kinds: one
  scoped to its own leased property, and any portfolio-wide one from the
  same account that owns that property. Never another landlord's
  account, and never another property's own announcement — enforced by
  the query itself (`propertyId = my lease's property OR (propertyId IS
  NULL AND accountId = my property's owning account)`), on top of
  `AccountContextGuard`'s own membership check, which already refuses
  the request entirely for an account the caller doesn't belong to.
- **Web**: an "Announcements to your tenants" card on the Portfolio page
  (create/list/delete, with a property picker defaulting to "All
  properties"), and an "Announcements from your landlord" card at the
  top of the tenant's own "My Lease" page.
- **A real bug found and fixed during verification**: the create
  response is a plain `Prisma.create()` result with no joined
  `property` — the web page's optimistic list update was showing "All
  properties" for a announcement actually scoped to one property, until
  the next full reload corrected it. Fixed by resolving the property
  name client-side from the portfolio list already in hand, rather than
  trusting the raw create response's shape to match the list endpoint's
  joined one.
- **Verified live end-to-end**: posted one portfolio-wide and one
  property-scoped announcement as the demo owner, confirmed both showed
  the correct property label immediately (no reload needed, post-fix),
  switched to the linked "Demo Tenant" account and confirmed both
  appeared in `GET /tenant/announcements` — the property-scoped one
  because it matches the tenant's own lease, the portfolio-wide one
  because it matches the owning account — and confirmed delete removes
  one from the landlord's own list.
- **Not done**: no read receipts, no notification (email/push) when one
  is posted — a tenant only sees it by opening their own portal; no edit
  after posting, only delete-and-repost.

## Module 3: Property Details — specs, amenities, and a photo gallery (this pass)

Unlike Modules 16-24, Module 3 was never a bare label with no real
scope — it's a genuinely missing sequential module number, sitting
between Module 2 (`src/properties` — property portfolio CRUD) and
Module 4 (`src/documents` — the document vault), both already named
and built earlier in this scaffold's history. Positional inference, not
a blueprint quote: no text anywhere names what Module 3 itself contains
either, but the numbering gap between "manage your properties" and
"manage your paperwork" pointed at one obvious, self-evidently-missing
piece already hinted at elsewhere in this codebase — see below.

- **A real gap the code already flagged on its own**: `PropertiesService
  .embeddingText`'s own comment gives `"3 bedroom flat in Lekki under
  renovation"` as an example semantic-search query — and until this
  pass, `Property` had no `bedrooms` field, or any physical
  characteristic at all beyond `propertyType`/`estimatedValue`, for that
  query to ever actually match against.
- **`bedrooms`, `bathrooms`, `squareFootage`, `yearBuilt`, `amenities`
  (`String[]`), `photoUrls`(`String[]`)** — all optional, same "a
  property is real and useful before its owner fills in every field"
  reasoning every other optional column on `Property` already follows.
  `photoUrls` is the property's own general gallery — distinct from
  `PropertyListing.photoUrls` (a listing's own marketing photos) and
  `RenovationVisualization`'s before/after pair — same "URL you provide
  yourself" convention every other `*Url` field in this schema uses; no
  upload pipeline changed.
- **The first update endpoint the base `Property` record has ever had**
  (`PATCH /properties/:propertyId`, `property:write`) — every other
  field on `Property` (name, address, status, `currentUse`,
  `estimatedValue`, ...) was create-only until now; only nested
  resources (valuations, inspections, leases, maintenance) could be
  edited after creation. Reuses `PermissionsGuard`'s own `:propertyId`
  ABAC check for tenant isolation, the same as every other route already
  keyed on that param — no new isolation logic needed.
- **`embeddingText` now actually includes what its own example query
  needs** — bedrooms/bathrooms/square footage/year built/amenities all
  feed the same semantic-search embedding text now, and `create`/
  `updateProperty` both re-index fire-and-forget on every change,
  closing the gap the comment's own words used to point at with nothing
  behind them.
- **Web**: the "+ Add property" form now collects bedrooms/bathrooms/
  square footage/year built up front; a new "Property details" card on
  the property page shows amenities as badges and photos as a real
  gallery grid, with an "Edit details" toggle backing the new PATCH
  endpoint (amenities/photo URLs as comma-separated text, not a bespoke
  tag-input widget — same tradeoff this app already accepts for fields
  with no fixed vocabulary). The portfolio grid's own cards show
  bed/bath/sq-ft inline when set. **Photos moved off that comma-
  separated text field in a later pass** — see "Real photo uploads for
  the property gallery" above: editing photos is now the real
  `PhotoPicker` upload widget every other real photo field in this
  codebase already uses, not a paste-your-own-URL box. Amenities stay
  comma-separated text on purpose — no fixed vocabulary to build a
  picker against.
- **Verified live**: created a property with bedrooms/bathrooms/sq-ft/
  year built set, confirmed all four persisted and rendered on both the
  portfolio card and the detail page; used "Edit details" to add
  amenities and a photo URL, confirmed the `PATCH` response and the
  rendered badges/gallery matched; ran "Reindex for search" against the
  updated property and confirmed it still fails the same documented way
  (`"You have no credits remaining"`) rather than a new, different
  error — the embedding-text change didn't introduce a regression, it's
  blocked on the same pre-existing OpenAI billing issue as everywhere
  else semantic search is discussed in this file (since resolved — see
  "Semantic property search" above).
- **Not done**: no way to reorder or caption individual photos, no
  amenities autocomplete/fixed vocabulary (freeform, matching the
  "record what's true" tradeoff `Lease.tenantName` already accepts).

## Module 17: Estate and Community Management — Phase 1 (this pass)

Unlike Module 3 and unlike the rest of the 16-24 bucket, this one has
real, user-supplied scope: "apartment buildings, estates, gated
communities, and managed communities" — resident records, service
charge collection, community announcements, visitor access requests,
facility booking, estate dues, complaint management, security notices,
community polls/voting, and estate reports, with `communities`,
`residents`, `community_announcements`, `visitor_access_requests`,
`facility_bookings`, `community_dues`, and `community_polls` as the
suggested entities. Ten features and seven entities is too much for one
pass — Phase 1 builds the three that everything else would need to
exist first anyway: **Communities**, **Residents**, and **Community
Announcements**. The other seven features are explicitly deferred, not
attempted partially.

- **A genuinely different shape from Property/Lease, on purpose.** An
  estate has many residents managed by one account at once — a
  meaningfully different relationship than a single owner's single
  tenant. `Community` is a new top-level owned resource (`accountId`,
  same as `Property`/`Project`), deliberately not linked to `Property`
  or `Lease` at all: a `Resident` is a simpler record (name, unit
  number, contact) than a full `Property`, matching how `Lease.
  tenantName` itself started as freeform text long before a real Tenant
  identity existed — resident self-service (a resident logging in to
  see its own community) is the same kind of later phase this
  codebase's own Module 13 history already went through, not attempted
  here.
- **`Community { accountId, name, address, communityType }`,
  `Resident { communityId, name, unitNumber, email?, phone?,
  residentType }`, `CommunityAnnouncement { communityId, title, body,
  createdByUserId }`** — every `Resident` field but name/unit is
  optional, same "record what's true, no forced workflow" reasoning
  `Lease.tenantName`/`MaintenanceRequest.assignedTo` already document.
  `CommunityAnnouncement` is the estate-level counterpart to
  `PropertyAnnouncement` (see "Community management" above) — same
  "landlord communicating with the people it houses" shape one level
  up, but always scoped to exactly one community (no nullable
  portfolio-wide broadcast the way `PropertyAnnouncement.propertyId`
  has) — an account managing several communities at once broadcasting
  across all of them isn't a need this phase's scope covers.
- **Two new permissions, `community:read`/`community:write`**, granted
  to the same three owner-tier roles `property:read`/`write` already
  sit on (`property_owner`, `family_admin`, `company_admin`) — not a
  new role, since managing an estate is a natural extension of what an
  account that already manages properties can do, not a distinct job
  the way `platform_reviewer`/`platform_admin` are.
- **`PermissionsGuard` gained a fourth ABAC check, for `:communityId`**
  — structurally identical to its existing `:propertyId`/`:projectId`
  checks (see its own comment): every route nested under a community
  (residents, announcements) gets tenant isolation for free, the same
  way `Property`'s own nested resources (valuations, inspections, ...)
  already do, rather than each `CommunitiesService` method re-validating
  ownership by hand.
- **`GET/POST /communities`, `GET/POST/DELETE .../residents`,
  `GET/POST/DELETE .../announcements`** — a new `CommunitiesModule`,
  and a new "Communities" nav item shown at the same reach as Portfolio
  itself (same three roles carry both permission pairs).
- **Verified live**: created "Palm Court Estate" as the demo owner,
  added a resident ("Jane Doe," unit "Block B, Flat 3"), posted a
  community announcement ("Gate maintenance"), and confirmed all three
  persisted and rendered correctly on the community's own detail page.
  Confirmed the vendor account (no `community:*` permission at all) gets
  a real 403 attempting the same route.
- **Not done, by explicit scope, not oversight**: service charge/estate
  dues collection, visitor access requests, facility booking, complaint
  management, security notices, community polls/voting, and estate
  reports — all seven remaining named features, and their four
  remaining suggested entities (`visitor_access_requests`,
  `facility_bookings`, `community_dues`, `community_polls`). No resident
  self-service portal yet (a `Resident` has no linked account the way
  `Lease.tenantAccountId` does) — the same phasing gap Module 13 itself
  had before its own Tenant identity pass.

## Module 18: Dispute Resolution and Mediation — Phase 1 (this pass)

Real, user-supplied scope, on top of a dispute system that already went
further than most of Module 18's own feature list before this pass:
raise, evidence upload, resolution status, payment/milestone hold, and
platform-wide arbitration all already existed for *project* disputes
(Modules 6/11). What genuinely didn't exist: every other relationship
Module 18's own Purpose names — "owners, vendors, contractors, tenants,
suppliers, buyers, sellers" — since `Dispute.projectId` was required, a
project was the *only* thing a dispute could ever be about. The
engineering notes are explicit about where to start: "Dispute cases
should be tightly linked to payments, orders, projects, and contracts"
— payments and projects were already covered; orders were not linked at
all.

- **`Dispute.projectId` is now optional, `orderId` joins it** — exactly
  one of the two is set per dispute (enforced in `PaymentsService`, not
  a DB constraint, same "the service enforces the rule" shape this
  schema already uses elsewhere). Leases ("contracts"/tenant complaints)
  and listings (property-listing disputes) are deliberately deferred —
  the engineering notes name payments/orders/projects explicitly; adding
  all three new linkages at once risked missing something in each of
  Payments/Materials/Properties/Listings for one pass.
- **`disputeType`** — the blueprint's own "Dispute Types" list (poor
  workmanship, delayed project, material delivery issue, payment
  disagreement, property listing dispute, tenant complaint, vendor
  misconduct, refund request, other), required on every new dispute,
  defaulted to `"other"` for every dispute raised before this pass so
  existing rows stay valid without a backfill.
- **`POST/GET /orders/:orderId/disputes`, `.../disputes/:disputeId/
  {resolve,evidence}`** — one unified route both the buyer and the
  supplier call, unlike the existing project-dispute pair split across
  an owner-side (`/projects/:projectId/disputes`, `PermissionsGuard`'s
  own ABAC) and vendor-side (`/vendors/me/disputes`, manually checked)
  route: Order has no natural "owner-side ABAC route" the way Project
  already had when the vendor-side routes were added, so there was no
  reason to split this into two mirrored flavors. `requireOrderParty`
  (the dual buyer-or-supplier check) mirrors `MaterialsService.
  findOrder`'s own identical check.
- **A real gap closed in passing**: the `supplier` role had *no* dispute
  permissions at all before this — a materials order gone wrong had no
  path for the supplier's own side to even participate, unlike a vendor,
  which already had `dispute:read`/`write` for its own project disputes.
- **Evidence submission/reading is dispute-type-agnostic by
  construction**: `requireDisputeParty` (shared by every evidence route,
  project or order) branches internally on which of `projectId`/
  `orderId` a given dispute actually has — the order-side evidence
  routes call the exact same `submitDisputeEvidence`/`findDisputeEvidence`
  methods the project-side routes always have, no new evidence logic
  needed. Arbitration (`findOpenDisputesForArbitration`/
  `arbitrateDispute`) was already fully generic — no dispute-type check
  anywhere in it — so it needed only one change: including the order's
  own identifying info (supplier name) for the arbitrator's queue to
  render when a dispute has no project to show instead.
- **Web**: every dispute-raising form (project owner-side, vendor-side,
  and the new order-side) now collects a dispute type from the same
  shared list; the arbitration queue shows an order's supplier name in
  place of a project title when a dispute has no project; a new
  "Disputes" card on the order detail page (buyer and supplier both see
  it) mirrors the project page's own raise/resolve/evidence-thread UI.
- **Verified live end-to-end**: raised an order dispute as the buyer
  (Demo Owner, "material delivery issue"), confirmed the supplier
  (Lagos BuildMart) could see and resolve it with notes; raised a second
  one as the supplier ("payment disagreement") and left it open;
  switched to the neutral `platform_reviewer` account and confirmed it
  appeared in the arbitration queue as "Order — Lagos BuildMart"
  alongside a real pre-existing *project* dispute (which correctly still
  shows `disputeType: "other"`, its pre-migration default) — then
  arbitrated it successfully through the exact same, unmodified
  `PATCH /payments/disputes/:disputeId/arbitrate` endpoint.
- **Not done, by explicit scope, not oversight**: lease/tenant disputes
  and property-listing disputes (2 of the blueprint's 8 dispute types
  have no entity to attach to yet); chat history (evidence is
  one-directional notes, not a real back-and-forth thread); mediator
  *assignment* (any `platform_reviewer` can pick up any open dispute —
  there's no concept of assigning one to a specific reviewer); vendor/
  supplier penalty history; and a dedicated dispute timeline view beyond
  `createdAt`/`resolvedAt` plus the evidence thread.

## Module 19: Communication and Notifications — Phase 1 (this pass)

Real, user-supplied scope. Of the blueprint's own channel list (Email,
SMS, WhatsApp, Push, In-app, Voice), Email already had a real provider
(`EmailService`/Resend, used for password reset, invites, and report
digests) before this pass — the actual gap was every other channel. Of
those, only one is achievable with no new paid infrastructure: **In-app
notifications**. SMS/WhatsApp/push/voice would each need a real provider
account and API key, the same kind of external dependency Paystack
payouts and OpenAI embeddings are already blocked on elsewhere in this
file — not attempted, not faked with a stub that pretends to send
something it can't.

- **`Notification { accountId, type, title, body, link?, readAt? }`** —
  `type` is a plain string (not an enum), matching every other "kind"
  field already in this schema (`Document.documentType`,
  `Dispute.disputeType`, ...); `link` is a relative app path the web
  client navigates to directly on click, the same "URL you provide
  yourself" shape as this schema's external `*Url` fields, just internal.
- **`InAppNotificationsService`**, in the pre-existing `notifications`
  module alongside `EmailService` — the two real channels this pass
  covers. `GET /notifications`, `PATCH /notifications/:id/read`,
  `POST /notifications/read-all` carry **no permission gate** — every
  role of every account type reads and clears its own inbox, the same
  way nothing gates which account a member is acting as; `PermissionsGuard`
  already returns true for a route that declares no required permission.
- **Five real, event-driven triggers** (per the engineering notes' own
  "use event-driven notification triggers"), covering 4 of the
  blueprint's 9 named features — chosen for being genuinely simple to
  wire into an *already-real* action rather than inventing one:
  - **Project updates** — `ProjectsService.addUpdate` notifies every
    vendor assigned to the project. Always owner→vendor, never the
    reverse: `project:write` (the permission every route reaching this
    method requires) is never granted to the vendor role, so there's no
    "which side posted it" ambiguity the way disputes have.
  - **Maintenance updates** — `resolveMaintenanceRequest` notifies the
    request's linked tenant account, only when one actually exists
    (`Lease.tenantAccountId`) — the same "optional, no forced workflow"
    gate every tenant-identity-dependent feature in this codebase
    already respects.
  - **Marketplace inquiry messages** — `ListingsService.createInquiry`
    notifies the listing's owning account — previously surfaced only if
    the owner happened to check the listing's own inquiries list.
  - **Payment alerts** (dispute half) — all three of Module 18's own
    raise-dispute entry points (`raiseDispute`, `raiseDisputeAsVendor`,
    `raiseOrderDispute`) now notify whichever party didn't raise it.
  - **Document expiry reminders** — the one *scheduled* trigger, a real
    `@nestjs/schedule` daily cron (`NotificationsSchedulerService`,
    mirroring `ReportsSchedulerService`'s own shape) that checks for
    documents expiring within 30 days, deduplicated per document (a
    document is only ever notified about once, not re-nagged daily) —
    gated behind `account:read_all` (platform_admin) for an on-demand
    manual trigger, the same "verify without waiting a real day"
    reasoning `ReportsController.sendDigestNow` already established.
- **Web**: a real bell icon in the app header (`NotificationBell`) —
  self-fetching per account, polled every 60s, an unread-count badge,
  a dropdown listing every notification, click-to-mark-read-and-navigate,
  and "mark all read."
- **Verified live end-to-end**: posted a project update as the owner,
  confirmed the assigned vendor's own bell showed an unread badge and
  the correct notification, and confirmed clicking it marked it read
  and navigated to the vendor's own dashboard; raised a project dispute
  and confirmed the same vendor's bell picked up a second, distinct
  notification; submitted a marketplace inquiry on a listing this
  account doesn't own and confirmed (via direct query, since the demo
  login has no membership on that account to check its own bell) the
  notification was created correctly for the listing's real owner.
- **Not done, by explicit scope, not oversight**: SMS, WhatsApp, push,
  and voice channels (no provider); `notification_preferences` (no
  per-type/per-channel opt-in/out yet — everything eligible always
  notifies); `message_templates` (every title/body here is composed
  inline, not rendered from a stored template); `delivery_logs` (no
  retry/delivery-tracking table — in-app notifications either exist in
  the database or don't, there's no separate "delivery" step to log);
  and four of the nine named features (inspection reminders, rent
  reminders, vendor messages as a real two-way thread, approval
  reminders) that would each need either a new scheduled check or a new
  "messages" entity this phase didn't build. Rent reminders (and lease
  renewal reminders alongside them) were closed in a later pass — see
  "Proactive rent and lease reminders" above; inspection reminders,
  vendor messages, and approval reminders remain open.

## Module 20: AI Property Assistant — Phase 1 (this pass)

Real, user-supplied scope. Of the blueprint's 14 named AI features, 8 were
already fully built by prior passes under different names: AI property
summary (`summarize_property`), AI listing description generator
(`generate_listing_description`), AI budget estimator (`estimate_budget`),
AI BOQ helper (`generate_boq`), AI document checklist
(`suggest_document_checklist`), AI vendor comparison summary
(`compare_vendor_quotes`), AI project report summary
(`summarize_project`/`narrate_report`), and AI risk summary (collectively,
the five `assess_*_risk` skills from Module 6's risk-flag work). Rather than
pad the registry with more overlapping skills, this pass targeted the two
things the blueprint asked for that genuinely didn't exist yet:

- **`GET /ai/usage`** — the blueprint's own `ai_usage_logs` entity, taken
  literally: every AI action already writes an `AiRequest`/`AiOutput`row
  (and, once decided, an `AiActionApproval`), but nothing had ever
  aggregated them. `AiService.getUsageSummary` returns total requests,
  requests in the last 30 days, how many drafts are still undecided, a
  breakdown by `actionType` (most-used first), and a breakdown by decision
  (accepted/edited/discarded) — all computed from data that already
  existed, no new table. Surfaced as a real card (`AiUsageCard`) on the
  Reports dashboard.
- **`summarize_dispute`** — the one genuinely missing feature (AI dispute
  summary) that Module 18's own generalization work (optional
  `Dispute.projectId` + `orderId`, `disputeType`) made possible to build
  once, for both dispute kinds, with no per-type branching. Same
  party-check shape as `PaymentsService.requireDisputeParty` (project
  owner or assigned vendor; order buyer or supplier) — duplicated directly
  in the skill rather than exposing `PaymentsService` to `AiSkillDeps`,
  since the check is ~15 lines and doesn't clear the bar Module 15's
  `narrate_report`/`AiSkillDeps.reports` exception set. Surfaced as a
  per-dispute "✦ Summarize" button (not a generic chat field) next to
  "View/add evidence" on both the project dispute list and the order
  dispute list, using the same `AiDraftCard` accept/edit/discard flow
  every other skill in this codebase already uses.
- **Verified live**: the usage dashboard showed real, correct numbers (44
  total actions, correctly sorted by action type, correct decision
  counts) computed from actions taken across this whole session's prior
  testing. `summarize_dispute` was called on a real, still-`open` project
  dispute and returned a correct, factual paragraph plus its evidence
  list with `warn: true`; called again on a real, `resolved` order
  dispute and returned the correct summary with `warn: false` — proving
  the same skill code handles both dispute shapes without modification.
- **Not done, by explicit scope, not oversight**: `ai_templates` (skills
  compose prompts inline, same as every other skill in this codebase —
  no stored/editable template system exists anywhere yet, not just here);
  `ai_credit_usage`/metering or billing per AI action; AI renovation scope
  generator, AI project checklist generator, AI maintenance
  recommendation, AI inspection checklist, and AI tenant communication
  drafts (five more genuinely new skills the blueprint names that this
  pass didn't build, to keep this slice bounded to the two most
  evidence-backed gaps rather than mass-producing skills).

## Module 21: Diaspora Property Management — Phase 1 (this pass)

Real, user-supplied scope. Of the blueprint's 11 key features, the large
majority were already fully built by prior passes: remote property
dashboard (the portfolio view every account already has), verified vendor
access (Module 6's trust/verification work), escrow payments, independent
inspections, progress photos/videos, legal document vault, and multi-currency
payments. This pass used the same "dead schema" technique that closed
Module 3's `bedrooms` gap and Module 16's `Account.status` gap: two fields
have existed since Module 1 with **zero** code ever reading or writing them
beyond creation — the single most defensible, evidence-based scope, since
it's a provable historical gap rather than an invented one.

- **`PropertyAccessGrant`** (existed in the schema since Module 1, confirmed
  via grep to have no references anywhere in the codebase before this pass)
  → **Family representative access** and **Milestone approvals**.
  `POST/GET /properties/:propertyId/access-grants` and `DELETE
  .../access-grants/:grantId` let a property owner grant an existing
  account member `canView`/`canEdit`/`canApprovePayments` on one property,
  independent of that member's platform role. `PaymentsService
  .releaseMilestone` now accepts the release if the caller either holds
  the `payment:approve` role permission **or** holds a grant with
  `canApprovePayments` on the milestone's project's property — an
  additive OR that can only ever widen who can act, never narrow existing
  access. Deliberately not wired into the generic `PermissionsGuard`
  (used by every protected route in the app — too broad a blast radius for
  a one-route need); instead the `@RequirePermissions('payment:approve')`
  decorator was removed from this one route only, and the real
  authorization decision moved into the service method itself, which now
  receives the caller's full role/permissions shape instead of a bare
  account id. `AccountContextGuard`'s own active-membership and
  `:projectId`-ownership checks still gate the route regardless — this
  change only affects *which* already-legitimate account members can
  additionally take this one action.
- **`Account.timezone`** (write-only since account creation, confirmed via
  grep to never be read anywhere before this pass) →
  **Time-zone-aware notifications**. Module 19's document-expiry cron
  (`NotificationsSchedulerService`) now runs hourly instead of once daily,
  and only actually creates a notification for an account when the
  current wall-clock hour in that account's own timezone matches a fixed
  local target hour (9am) — using Node's built-in `Intl.DateTimeFormat`,
  no new dependency. An account with an invalid/unrecognized timezone
  fails closed (never notified at the wrong hour, rather than silently
  guessing UTC). The manual trigger
  (`POST /notifications/check-document-expiry`) takes an optional
  `targetLocalHour` query param so this could be verified over real HTTP
  without waiting for a real matching hour to occur.
- **Verified live end-to-end, including the security-sensitive part**:
  granted a real "viewer"-role account member `canApprovePayments: true`
  on the demo property via the new UI (`AccessGrantsCard`), confirmed via
  the real `201 Created` response; reset that member's own login password
  (test-only, in the local dev database), signed in as them through the
  real browser, confirmed the client's own account switcher auto-selected
  the granted account with role "Viewer" showing, navigated to the
  project, and clicked the pre-existing, ungated "Release funds" button
  on a real pending milestone ("PayPal payout test") — the real
  `POST /projects/:id/milestones/:id/release` call returned
  `201 Created` with a real payout record
  (`amount: "500"`, `status: "processing"`), proving a member with **no**
  `payment:approve` role permission released real milestone funds solely
  because of the grant. The grant was revoked again afterward to leave
  the demo account back in its original state.
- **Not done, by explicit scope, not oversight**: remote handover
  approvals (the handover stage already exists on projects; no
  diaspora-specific approval step was added on top of it); any UI
  surfacing of `Account.timezone` itself (still set only at signup, no
  settings page to change it); per-notification-type timezone rules
  (only the one existing document-expiry cron was made timezone-aware);
  and multi-representative workflows beyond a flat per-property grant
  list (no approval hierarchy or delegation chains between
  representatives).

## Module 22: Smart Home, IoT, and Sustainability — Phase 1 (this pass)

Real, user-supplied scope, but the module's own engineering notes are
explicit that this is "a later-stage module" whose job right now is
architecture, not live device data: "design architecture should allow
device integrations later through API connectors." Of its 9 named
features, 7 need a real, currently-unwired third-party device or utility
API to mean anything at all (smart meter, energy, water, camera, lock,
and solar readings, plus device-triggered maintenance alerts) — faking
readings for hardware nothing is actually connected to would be
inventing data, not building a feature, the same reasoning that kept
SMS/WhatsApp/push notifications unattempted in Module 19.

- **`PropertyDevice`** (new model) — the literal "architecture for
  later" the notes ask for: `POST/GET /properties/:propertyId/devices`
  and `DELETE .../devices/:deviceId` let an owner register a device by
  type (smart meter, water meter, security camera, smart lock, solar
  inverter), name, and an optional freeform provider name (e.g.
  "Shelly", "SolarEdge"). `status` defaults to, and can currently only
  ever honestly be, `"not_connected"` — this is a registry of intent to
  connect a device, not a live telemetry feed; no adapter exists for any
  of these device types yet, and the UI says so plainly rather than
  implying otherwise.
- **`estimate_carbon_footprint`** (AI skill) — the one version of
  "Carbon estimate" buildable without a real smart-meter integration: a
  published average kg-CO2e-per-square-metre-per-year figure for
  residential electricity use, scaled by the property's own
  `squareFootage` (Module 3). A genuine, clearly-labeled-as-approximate
  computation from real data already on the record, not a fabricated
  device reading — and it says so in its own output. Guards on missing
  `squareFootage` (returns a warning asking the owner to fill in
  Property Details first, rather than silently computing from nothing).
- **`suggest_green_checklist`** (AI skill) — "Green building checklist,"
  same shape as Module 6's `suggest_document_checklist`: a fixed, generic
  default list, phrased and lightly tailored to the property's own type
  and `yearBuilt` by the LLM. No jurisdiction-specific green-building
  code is wired up (there isn't one anywhere in this scaffold, the same
  gap Module 6's own document checklist already flags), and no new
  stateful "checked/unchecked" tracking model — read-only guidance, same
  as every other `*_checklist` skill in this registry.
- **Verified live**: registered a real "Kitchen smart meter" device
  (provider "Shelly") on the demo property via the new UI and confirmed
  the real `201 Created` response and the "Not Connected" badge it
  renders with; ran `estimate_carbon_footprint` against a property with
  no `squareFootage` on record and got the correct guard-rail warning;
  ran it against "Module 3 Test House" (2,200 sq ft) and got
  `6,132 kg CO2e/year` — matching the published-average math exactly
  (2,200 sq ft × 0.092903 m²/sq ft × 30 kg CO2e/m²/year); ran
  `suggest_green_checklist` against the same property and confirmed its
  `yearBuilt` (2015) was correctly woven into the intro sentence.
- **Not done, by explicit scope, not oversight**: any actual device
  telemetry (smart meter/energy/water/camera/lock/solar readings) —
  needs a real, currently-unpicked provider integration for each device
  type, the module's own notes defer this to "later"; device-triggered
  maintenance alerts (depends on the above); any adapter/webhook
  endpoint for a real device to actually report into `PropertyDevice`
  (the model exists, nothing calls it yet).

## Module 23: AR/VR Property Viewing — Phase 1 (this pass)

Real, user-supplied scope — and the module this scaffold's own prior
"AI-generated renovation visualizations — the 2D half only" section had
already been built against, under the wrong number (it called this
"Module 22" before Module 22's own real scope, Smart Home/IoT/
Sustainability, existed — see that section's own corrected note). Real
AR (a live camera overlay) and real VR (a 3D walkable space) both need
infrastructure this scaffold doesn't have and this pass doesn't add
either — native ARKit/ARCore or WebXR (which doesn't work in iOS
Safari), a full 3D content pipeline, and photogrammetry/NeRF
reconstruction from photos, the same multi-week-research-problem
reasoning as before. What the module's own engineering notes ask for
regardless of that gap is concrete and buildable without any of it:
"store media metadata in a way that supports 360 content and virtual
tour assets."

- **`PropertyTourAsset`** (new model) — exactly that: an ordered list of
  360° photos (or videos) per property, each a URL the caller already
  hosts (same "URL you provide yourself" convention this whole schema
  uses) plus an optional room label and sort position.
  `POST/GET /properties/:propertyId/tour-assets` and
  `DELETE .../tour-assets/:assetId` manage it.
- **`Panorama360Viewer`** (web) — a genuine pannable viewer for an
  equirectangular photo, covering "360 property tours" and "Remote
  walkthroughs" (viewing a property's tour assets in sequence). Built
  with plain pointer events and CSS — this app has no UI or 3D
  dependency at all (`apps/web/package.json` has exactly three runtime
  packages: next/react/react-dom), and adding one (three.js, pannellum)
  for a single feature felt like the wrong tradeoff for a scaffold. The
  image renders at double width and drags horizontally with wraparound —
  a bounded, honest stand-in for "look around a room" on the web, not a
  claim of parity with a real spherical/WebGL renderer.
- **Virtual staging** — reuses `RenovationVisualization`'s entire
  pipeline (schema, `VisualizationsService`, `OpenAiImageService`)
  wholesale rather than duplicating any of it: a new `kind` field
  (`renovation` | `staging`) on the same model, a "Stage this room"
  toggle next to "Renovate" on the existing visualizer card that swaps
  in a sensible default staging prompt, and a `kind` badge on each
  rendered result. This is also literally Module 23's own "Before/after
  visualization" feature — the 2D renovation-preview work already
  covered it before this pass gave it a name.
- **AR renovation preview** and **Virtual inspections** — not attempted.
  The AR half needs the same native/WebXR infrastructure gap as above;
  virtual inspections would need real video-conferencing infrastructure
  (Daily.co, Twilio Video, or similar) that isn't wired up anywhere in
  this scaffold, the same "no provider, not faked" reasoning that kept
  SMS/WhatsApp/push notifications unattempted in Module 19.
- **Verified live**: added a real 360° photo to the demo property via
  the new UI, confirmed the `201 Created` response, and confirmed
  dragging across the rendered viewer actually pans the image with
  visible wraparound at the seam (checked both visually and via the
  underlying `<img>` elements' computed `left` offsets); toggled "Stage
  this room" on the visualizer, confirmed the staging-specific default
  prompt appeared, and submitted it with a deliberately-unreachable
  photo URL (to avoid spending real money on OpenAI's paid image-edit
  call just for a plumbing check — see the README's own note on that
  call's real cost) — confirmed via direct query that the resulting
  record persisted with `kind: "staging"` and the correct default
  prompt, failing at the "fetch the before image" step, before ever
  reaching OpenAI.
- **Not done, by explicit scope, not oversight**: real AR/VR of any
  kind; multi-room hotspot navigation between tour assets (today's
  "walkthrough" is just viewing the ordered list, not a linked
  point-to-point navigation graph); video-based virtual inspections; any
  upload pipeline for 360° media (same "URL you provide yourself"
  convention, no new gap here).

## Module 24: Reports and Analytics — Phase 1 (this pass)

Real, user-supplied scope: 17 named reports across Owner, Company, and
Marketplace categories. Two were already fully covered before this pass
(Owner's "Property portfolio summary" is the existing dashboard itself;
Owner's "Document status report" is the existing `documents_total`/
`documents_by_verification_status` metrics plus the Documents page). This
pass audited the remaining 15 the same way Module 20 audited its own 14
AI features — found the genuinely new, evidence-backed gaps, closed the
5 most valuable and coherent of them, and left the rest explicitly
documented rather than invented.

- **Five new report-builder metric groups**, added to
  `ReportsService.METRIC_REGISTRY` and computed inside the same
  `getPortfolioOverview` call every other metric already comes from (this
  file's own "compute once, project down, never a second independent
  query path" rule) — which means **zero new frontend code**: "A real
  report builder" (an earlier pass) already built a fully dynamic
  metric-picker UI that lists whatever `GET /reports/metrics` returns,
  so these 5 new keys just appear as selectable checkboxes, and running/
  exporting/AI-narrating a saved report that includes them already
  worked, unchanged.
  - **`property_expenses`** (Owner's "Property expense report") — real
    `Payout` spend, grouped by property (joined through
    `Payout.project.propertyId`) and currency. Previously only ever
    summed account-wide (`vendorSpendByCurrency`/`topVendors`), never
    broken down per property. (A later pass added a real `Branch` model
    and its own dedicated `facility_cost_report` — see below — this
    bullet's original claim that "Facility cost report" was already
    covered here didn't hold up once a real Facility/Branch concept
    existed to check it against.)
  - **`property_rental_income`** (Owner's "Rental income report") —
    real `LeaseRentPayment.amount`, grouped by property and currency.
    That table has existed since Module 13 and was, until now, only
    ever read to decide whether rent looks overdue — never summed as
    income, and deliberately *not* scoped to active leases only (unlike
    the overdue check): a lease that has since ended still collected
    real rent while it ran, so income sums across every lease the
    property has ever had, via a dedicated query decoupled from the
    active-only one `leases.active`/`leases.overdue` already uses.
  - **`vendor_performance`** (Company's "Vendor performance report" and
    Marketplace's "Vendor job completion" — the same underlying
    question, one metric group answers both rather than building two
    near-identical ones) — per vendor this account has ever assigned to
    a project: jobs assigned, jobs completed, and this account's own
    average review rating of that vendor (`VendorReview.accountId`-
    scoped — this owner's own experience, not the vendor's platform-wide
    trust score `explain_vendor_trust_score` already covers elsewhere).
  - **`supplier_sales`** (Marketplace's "Supplier sales report") —
    reframed honestly as this account's own buying history, not a
    supplier's own sales dashboard: this whole Reports feature has only
    ever been scoped to an owning account's own portfolio, and
    `Order.accountId` is the *buying* account. Per supplier: order
    count and total spend by currency. A supplier's own sales dashboard
    would need a parallel supplier-account-scoped view of this same
    data — a real, different feature, out of scope here.
  - **`material_order_trends`** (Marketplace's "Material order trends")
    — top 10 products by spend across this account's own orders placed
    in the last 90 days, from `OrderItem.lineTotal`/`quantity`. The one
    new group here capped to a top-N (product catalogs/order histories
    can genuinely get large; every other new group is naturally small —
    this account's own properties/vendors/suppliers).
- **Verified live**: built a real saved report selecting all 5 new
  metrics, ran it, and confirmed correct real numbers for every one —
  including catching and fixing a real bug during verification: the
  first version of `property_rental_income` reused the existing
  active-leases-only query and silently returned nothing for a property
  whose only recorded rent payment was on a since-ended lease; fixed by
  adding a dedicated all-leases rent-payment query, re-verified, and
  confirmed the property's real historical rent (₦1,200,000 across
  multiple ended leases) now appears. Also verified CSV export and AI
  narration both correctly include the new metrics unchanged, then
  deleted the test report definition to leave the demo account clean.
- **Not done, by explicit scope, not oversight, at the time**: **Asset
  utilization report** (Company), **Compliance report** (Company),
  **Maintenance report** (Owner, beyond open/resolved counts), and
  **Project progress report** (Owner, beyond the existing per-project
  `ProjectStageBar`) were all cut here for missing data (no
  rental-out tracking, no account-scoped compliance model, no
  maintenance cost field, no portfolio-wide progress rollup). All four
  were later closed once that data existed — see "Module 24: Asset
  utilization, Compliance, Maintenance cost, and Project progress
  reports" below. (**Branch property report**, **Investment performance
  report**, **Listing performance**, and **Inquiry conversion** — cut
  here for the same reason — were closed earlier still; see "Module 24:
  Branch, Investment, Listing, and Inquiry reports" below.)

## Property development agreements — invite a developer to build (this pass)

A user-requested feature, not from the numbered blueprint: a property
owner invites a developer to build on their property under a real deal
— either a time-boxed fractional ownership stake, or a share of the
property's eventual sale proceeds. Audited first (same discipline every
numbered module gets): `PropertyOwner` has existed in this schema since
Module 1 with `ownershipPercentage`/`startDate`/`endDate` fields and zero
code anywhere reading or writing it — the same "dead field" shape
`PropertyAccessGrant`/`Account.timezone`/`Account.status` were each in
before their own passes — and `AccountInvite` already has a complete
"invite someone who may not be registered yet" pattern (hashed token,
expiry, email send with a raw-token fallback, a public preview, a "my
invites" inbox). This clones that pattern rather than reusing
`AccountInvite` itself (a developer deal carries terms an account
membership invite has no fields for), and finally wires up `PropertyOwner`
for the ownership-stake half.

- **`PropertyDevelopmentAgreement`** (new model) — `developerEmail` +
  hashed `tokenHash` + `expiresAt`, exactly `AccountInvite`'s own shape.
  `agreementType` is `temporary_ownership` (`ownershipPercentage` +
  `termMonths`) or `proceeds_share` (`proceedsSharePercentage`), plus a
  required freeform `terms` field — percentages alone don't capture a
  real deal (what gets built, what happens at the end of the term, etc).
- **Owner side** (`POST/GET /properties/:propertyId/development-agreements`,
  `DELETE .../:agreementId`) — propose, list, and cancel a still-pending
  invite. `property:write`/`property:read`, same tier `PropertyAccessGrant`
  already sits at.
- **Developer side** (`/development-agreement-invites/...`, its own
  controller, mirroring `InvitesController`'s separation from
  `AccountsController`) — a public token preview
  (`GET /development-agreement-invites/:token`, reachable signed out),
  accept/decline by token, and a `mine` inbox
  (`GET .../mine` + accept/decline by id) scoped to the signed-in user's
  own email — the in-app fallback for when no email provider is
  configured, the common case in this scaffold, the same gap
  `AccountsService.findMyInvites` closed for account invites.
- **Accepting actually does something real, not just flips a status**:
  for `temporary_ownership`, accepting writes a real `PropertyOwner` row
  (`ownerType: "account"`, the accepting account's own id,
  `ownershipPercentage`, `startDate: now`, `endDate: now + termMonths`) —
  in one transaction with marking the agreement `accepted`. For
  `proceeds_share`, accepting only marks the agreement `accepted` — no
  `PropertyOwner` row, since a proceeds claim isn't fractional ownership
  of the property while it's held.
- **Accepting requires an account, not just a user** — unlike joining
  someone else's account (`AccountInvite`'s own shape), the accepting
  party needs an account of their own to actually hold the stake or the
  claim, so the accept routes sit behind `AccountContextGuard`
  (`CurrentAccountMember`, not just `CurrentUser`). The accept page
  handles every state this implies: not signed in + no account yet →
  register; not signed in + already registered → sign in; signed in, no
  account selected → prompted to create one (e.g. a Vendor account) and
  come back to the same link; signed in with a mismatched email → told to
  sign in as the invited address instead.
- **Web**: `DevelopmentAgreementsCard` on the property page (propose
  form with an ownership-vs-proceeds toggle, list with status badges,
  cancel) — same self-fetching shape `AccessGrantsCard`/`DeviceRegistryCard`
  already use; `accept-development-agreement.tsx`, the landing page for
  the email link, mirroring `accept-invite.tsx`'s own branching; a "You've
  been invited to develop a property" banner on the Portfolio page (only
  rendered when the signed-in user has a pending invite) for in-app
  discoverability without needing the email at all.
- **Verified live, end to end, including the real database write**:
  proposed a `temporary_ownership` deal (20% for 18 months) from the
  Demo Owner account to a brand-new email with no platform account yet;
  followed the fallback link (no `RESEND_API_KEY` configured) signed
  out, registered a new Vendor account for that email, and confirmed the
  in-app "invited to develop" banner showed the correct terms; accepted
  it, and confirmed by direct query that a real `PropertyOwner` row was
  created — `ownerAccountId` matching the new Vendor account,
  `ownershipPercentage: 20`, `startDate` now, `endDate` exactly 18
  months later. Proposed a second, `proceeds_share` deal (15%), declined
  it from the same banner, and confirmed by query that its status became
  `declined` and — correctly — no second `PropertyOwner` row was ever
  created. Proposed and then cancelled a third, owner-side, confirming
  the cancel button works.
- **Not done, by explicit scope, not oversight**: actual payout of a
  `proceeds_share` claim. Nothing anywhere in this schema fires when a
  `PropertyListing` transitions to `"sold"` — no code ever sets that
  status at all, confirmed by inspection — and there's no proceeds-split
  or escrow-like mechanism for a sale event to pay into. Building that
  is a real, separate undertaking (an actual sale-closing flow, plus a
  payout engine for it, likely reusing `Payout`/`EscrowLedgerEntry`'s own
  shapes) — recorded here as a real, binding term on the agreement, not
  executed. Also not done: `canView`/`canEdit`-style access for an
  accepted developer on the property itself (an accepted
  `temporary_ownership` developer holds a real ownership percentage but
  no `PropertyAccessGrant` — they can't yet see or act on the property
  through the app, only hold the stake on record); multiple simultaneous
  developers on one property (nothing prevents proposing more than one
  agreement, but there's no UI or validation reasoning about *total*
  percentage across them); and renewal/renegotiation once a
  `temporary_ownership` term ends (an ended stake's `PropertyOwner` row
  simply has a past `endDate` — nothing currently reads that to mean
  "and therefore excluded from X," since nothing else in this schema
  reads `PropertyOwner` at all yet beyond this pass's own write).

## Live view — a real Google Map and Street View per property (this pass)

Another user-requested feature, not from the numbered blueprint: "each
property to have a live view adopting google map live view." Worth
naming plainly what this is and isn't, the same discipline Module 23's
own AR/VR section applies: Google Maps' actual "Live View" is an AR
walking-navigation feature that only exists inside the Google Maps
*mobile app* (it overlays directions on the phone's live camera feed
using ARCore/ARKit) — there is no web embed of it, and no public API
exposes it to a website at all. What *is* real and embeddable is Google
Maps' own Embed API: a genuinely live, interactive map, plus a Street
View mode for an actual "look around from street level" view — both
just an iframe, no SDK. That's what this pass builds, named "Live view"
rather than "Live View" to be honest about the difference.

- **`GoogleGeocodingService`** (new, `src/properties/`) — same "plain
  fetch, isConfigured gate" shape `OpenAiImageService`/`PaystackService`
  already use. Turns a property's own free-text address into real
  coordinates via Google's Geocoding API. Never throws — a bad address,
  no API key, or a Google-side error all just mean "not located this
  time," logged and swallowed, the same "enrichment, not a blocking
  step" reasoning `PropertiesService.indexEmbedding`'s own fire-and-
  forget call already established for search.
- **`Property.latitude`/`longitude` are finally populated** — both
  fields, plus full `class-validator` coverage, have existed in
  `CreatePropertyDto`/`UpdatePropertyDto` since Module 1, but no caller
  anywhere, client or server, had ever actually set them; every existing
  property's coordinates were `null`. Now geocoded automatically,
  fire-and-forget, whenever a property is created, and re-geocoded
  whenever its address is edited — in both cases only when the caller
  didn't already hand-supply coordinates of their own, so manual
  `latitude`/`longitude` (still accepted by both DTOs) is never
  silently overwritten.
- **`POST /properties/regeocode`** — manual backfill for properties that
  existed (or whose address was set) before `GOOGLE_MAPS_API_KEY` was
  ever configured, same "Reindex for search" precedent
  `reindexEmbeddings` already established for the identical class of
  problem. A "Locate for Live View" button next to "Reindex for search"
  on the Portfolio page.
- **`PropertyLiveViewCard`** (web) — Map/Street View toggle, right at
  the top of the property page. Just an `<iframe>` against Google's Maps
  Embed API (`.../maps/embed/v1/place` and `.../streetview`) — no new
  UI/map dependency, same "no library for one feature" call the 360°
  viewer already made. Reads `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (a
  second, browser-exposed key, separate from the API's own server-side
  `GOOGLE_MAPS_API_KEY` — Google's own guidance for anything shipped to
  the browser).
- **Verified live, the parts verifiable without a real API key**: created
  a new property with no `GOOGLE_MAPS_API_KEY` configured and confirmed
  it still saved successfully with `latitude`/`longitude` both `null` —
  geocoding failed silently, exactly as designed, no error surfaced to
  the caller; confirmed the property page's Live View card correctly
  shows "Live view isn't configured on this deployment" (no
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`); ran the new "Locate for Live View"
  backfill button against 4 real properties missing coordinates and
  confirmed a correct, honest `"Located 0/4"` result with zero failures
  (a graceful no-op, not an error, when unconfigured — the same
  distinction `regeocodeProperties`'s own return shape makes). The
  actual map/Street View iframe render itself — and a real geocode
  actually resolving an address to coordinates — needs a real
  `GOOGLE_MAPS_API_KEY`/`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` pair neither of
  which exists in this environment; same "verify the not-configured path
  now, the configured path once a real key exists" split this README
  already used for `OPENAI_API_KEY`/Sumsub.
- **Not done, by explicit scope, not oversight**: any actual AR — see
  this section's own opening paragraph for why that's not a "not yet,"
  it's a "doesn't exist to embed at all"; a manual "pin the exact
  location on a map" editor (geocoding from the address is the only way
  coordinates get set); multi-photo/panorama Street View stitching
  beyond whatever single-point coverage Google's own Street View already
  has at that address (which the embed simply shows "no imagery here"
  for, gracefully, when it doesn't).

## Public profiles — a one-page website per account (this pass)

Another user-requested feature, not from the numbered blueprint: "every
company, user, vendors and etc, to have a one page website that contains
their listings and summary of their business." This is the first
genuinely public, no-login surface in this codebase beyond two existing
token-gated invite previews — every other route that reads real data,
including this app's own "public marketplace browse" (`GET /vendors/:id`,
`GET /suppliers/:id`, `GET /listings`), still sits behind
`JwtAuthGuard`. That distinction matters: the new endpoint doesn't reuse
`VendorsService.findOne`/`MaterialsService.findSupplier`'s own return
shapes, because those include real sensitive data no anonymous visitor
should ever receive — `Vendor`'s bank/payout fields
(`bankAccountNumber`, `paystackRecipientCode`, ...), a
`platform_reviewer`'s internal `verificationNotes`, and a trust score's
`latestAudit.notes`. `PublicProfilesService` hand-picks a whitelist
instead.

- **`GET /public/accounts/:accountId`** (new module, no guards at all)
  — one endpoint, three shapes depending on `Account.accountType`:
  - **VENDOR** — `businessName`, `serviceCategory`, `locationCoverage`,
    `verificationStatus`, `ratingAverage`, a stripped-down
    `trustScore` (`{score, band}` only — never the factors object, which
    would otherwise leak the audit notes above), and non-hidden reviews
    (`rating`/`comment`/`response`, never the moderation fields).
  - **SUPPLIER** — the same shape, plus its active product catalog
    (`ListingsService.findPublishedForAccount`'s materials-marketplace
    counterpart was already there via `MaterialsService`'s own
    `status: 'active'` product filter, just reused directly).
  - **INDIVIDUAL / FAMILY / COMPANY** — published listings via a new
    `ListingsService.findPublishedForAccount`, deliberately distinct
    from the existing `findMine` (which includes drafts, meant only for
    the owner's own dashboard): `status: {in: ['active','under_offer']}`
    only, and — same privacy line this codebase's own existing public
    marketplace browse (`findAll`) already draws — the property's
    `city`/`country` only, never its exact `addressLine`. There's
    genuinely nothing else to show for this account type: confirmed by
    audit that `Account.name` is the only identifying text field these
    account types have (no bio/logo/description anywhere on `Account`).
  - **TENANT** — no public page at all (`404`), on purpose: a renter
    owns nothing to list and runs no business to summarize, so a public
    "here's a renter" page would only ever cost privacy with no
    offsetting value. A suspended account (`Account.status`, Module 16)
    is treated the same way.
- **`apps/web/pages/go/[accountId].tsx`** — a real standalone page, not
  wrapped in `AppShell` and never calling `useRequireAuth()` (the one
  thing that would have forced a login redirect) — plain `useAuth()`
  only, same as every other unauthenticated page already in this app
  (login/register/the two accept-invite pages), fetching with no token
  at all, same shape `getInvite(token)` already uses. Renders a listings
  grid, a product grid, or a review list depending on which of
  `vendor`/`supplier`/`listings` the response actually carries.
- **Discoverability**: a "View my public page ↗" link on each account's
  own dashboard where one already exists — the vendor's `/vendors/me`,
  the supplier's `/marketplace/materials/me`, and the Portfolio page
  header for an owning account — each opening the real `/go/:accountId`
  URL in a new tab.
- **Verified live, fully unauthenticated** (no session cookie sent,
  confirmed via the real network response): loaded a real owner
  account's page and confirmed its one active listing rendered
  correctly with `city`/`country` only, no `addressLine` or internal
  ids anywhere in the response; loaded a real vendor's page and
  confirmed the exact sanitized shape server-side — `trustScore` was
  `{score, band}` only, reviews carried no moderation fields, and
  nothing resembling a bank/payout field or an audit note appeared
  anywhere in the raw JSON; loaded a real supplier's page and confirmed
  its product grid (including a rentable item's daily rate) and reviews
  rendered correctly; loaded a real `TENANT` account's URL directly and
  confirmed a real `404` with no crash; confirmed the "View my public
  page" link on the Portfolio page points at the correct URL.
- **Not done, by explicit scope, not oversight**: friendly/slug URLs —
  confirmed by audit that no model in this schema has ever had a `slug`
  field; every link here is by raw account UUID
  (`/go/00000000-...-0001`), the same "ship by id first" tradeoff this
  scaffold already accepts everywhere else (`/vendors/:id`,
  `/properties/:id`, ...); any bio/logo/cover-photo editing UI — there's
  no field anywhere on `Account` to hold one yet, so an owner-type
  account's public page is, honestly, just its listings; sold/rented
  listing history (only currently active/under-offer listings show, not
  a past-sales portfolio); and any way to opt out of having a public
  page at all (every non-TENANT, non-suspended account gets one
  automatically — there's no `Account.publicProfileEnabled`-style flag).

## A real public landing page (this pass)

Another user-requested feature: "the landing page, should be elegantly
built while projecting the vendor and marketplace amongst other things
on it." Audited first, same as everything else in this file — `pages/
index.tsx` never actually rendered anything: it was a pure router that
sent every signed-out visitor straight to `/login` with nothing shown in
between (confirmed by reading its prior version — a loading spinner and
an effect, no markup). There was no landing page to improve; this builds
the first one.

- **`GET /public/marketplace/highlights`** (new route, same module and
  "no guards at all" shape as the public-profiles work) — a small, real
  cross-section of the marketplace: up to 6 active/under-offer listings,
  6 verified vendors, and 6 verified suppliers, each ranked the same way
  their own in-app browse already ranks them (rating, then recency).
  Same hand-picked field whitelist discipline as `getProfile` — this
  does *not* reuse `VendorsService.findAll`'s own return shape, which is
  the raw `Vendor` row (bank/payout fields included); it re-derives a
  small, safe subset instead.
- **`pages/index.tsx`** — a real page now, for the one case the router
  used to skip straight past: signed out, nothing to redirect to. A
  signed-in visitor still gets exactly the prior behavior, untouched
  (the same effect, same destinations). Sections: a hero with three real
  stat callouts (payment gateways, AI skills, escrow coverage — pulled
  from what this README itself documents as built, not invented
  numbers), the live listings grid, a verified-vendors/suppliers grid
  whose cards link straight to that account's own public `/go/:accountId`
  page (no login needed to follow them — this is the first page in the
  app two separately-shipped public features actually connect to each
  other), and a feature grid naming real, built capabilities only.
  `Fraunces` (Google Fonts) for the display headings, layered over the
  app's existing navy/teal token set — no new color system, just a
  second typeface reserved for this one page's hero/section titles.
- **A real bug caught during verification**: `photoUrls` on this
  scaffold are "you host it yourself" links (same convention as
  `Document.fileUrl`), and the seeded demo data's own example photo URLs
  don't actually resolve to anything. The first version used
  `background: url(...) center/cover` with the brand gradient only as a
  fallback for *no* photo — for a listing that had a photo URL which
  simply failed to load, that left a blank white gap instead of showing
  anything. Fixed by always layering the gradient as a second background
  underneath the photo attempt (a failed `background-image` layer paints
  nothing and lets the layer behind it show through) — confirmed via the
  actual computed style after the fix, not just visually.
- **Verified live**: loaded `/` signed out and confirmed real data
  throughout — real listings (including one whose title/price/location
  matched a known seeded row), real verified vendors and suppliers with
  correct trust bands and star ratings; clicked a vendor card and landed
  on that account's real public profile page, confirming the two
  features genuinely connect; confirmed both "Get started" links point
  at `/register`; loaded `/` again while signed in and confirmed the
  pre-existing redirect-to-portfolio behavior is completely unchanged.

## Platform fee on milestone releases — (this pass)

The first real, working piece of the platform's own revenue model — a
take-rate on the money that already flows through the app, not a new
subscription or a placement fee. Discussed as one of several
monetization options; the user picked this one to scope and build, then
made the two decisions that actually govern it:

- **Who pays**: the vendor. A milestone's full value still leaves escrow
  exactly as before — the owner's own project cost, ROI "total
  invested," and every budget comparison in the app are completely
  unaffected. The fee comes out of the vendor's own payout.
- **Rate**: 5%, via `PLATFORM_FEE_PERCENT` in `apps/api/.env.example`
  (`src/payments/platform-fee.ts`) — an env-configured whole number, not
  a per-account or tiered rate, with an invalid/out-of-range value
  (negative, 100+) falling back to the same default rather than a
  runtime error.

**What's built**:

- `Payout` gained two real columns alongside the existing `amount`
  (`prisma/migrations/20260911100000_add_platform_fee_to_payouts`):
  `grossAmount` (the milestone's full value — what leaves escrow) and
  `platformFeeAmount` (the platform's real revenue). `amount` is
  redefined as **net** — what the vendor actually receives, and what's
  actually sent through whichever real gateway that payout used.
  Pre-existing payout rows are backfilled `grossAmount = amount`,
  `platformFeeAmount = 0` — historically accurate, since no fee was ever
  taken from them.
- `PaymentsService.releaseMilestone` computes the split via
  `computePlatformFee` and sends **net** to the real gateway
  (Paystack/Flutterwave/PayPal) or the manual-instant path, across all
  four branches. `finalizePayout` debits the escrow balance and records
  the `EscrowLedgerEntry` 'release' entry at **gross** (the full
  milestone value "leaves" escrow whether it goes to the vendor or is
  retained as fee — zero structural change to the ledger, no new entry
  type), and issues the vendor's `Receipt` at **net** (what they
  actually got).
- **A systematic ripple-effect audit**, done before writing any
  downstream code: grepped every `prisma.payout.*` read across the API
  to find anything that used to read `amount` as gross by coincidence
  (pre-fee, gross always equalled net). Fixed 8 real call sites —
  `reports.service.ts` (portfolio vendor spend, Module 24 property
  expenses), `properties.service.ts` (ROI dashboard's total project
  spend), `projects/risk-flags.ts` (budget-exceeded check), and the AI
  skills `summarize-project`, `model-roi-scenario`, `flag-payment-anomaly`,
  and `explain-fees` — all switched to `grossAmount` for any
  owner-perspective "spend"/"invested"/"budget" figure.
- **A real bug the audit caught, not testing**: `flag_payment_anomaly`
  compared `payout.amount` against the milestone's own `paymentAmount`
  to flag "payout doesn't match milestone" — once `amount` became net,
  that would have false-positived on every single legitimate payout
  going forward. Fixed to compare `grossAmount` instead, before it ever
  ran against real fee-bearing data.
- `explain_fees` (the AI skill) no longer uses its old
  `PLATFORM_FEE_RATE = 0.025` stub constant (previously commented as
  "illustrative... not actually deducted anywhere yet") — it now sums
  real `grossAmount`/`amount`(net)/`platformFeeAmount` off actual
  `Payout` rows.
- Frontend: `Payout` type (`lib/api.ts`) carries all three fields; the
  project page's payout list and the vendor's own "My payouts" list
  (`pages/vendors/me.tsx`) both show a fee-transparency line under the
  net amount whenever a real fee was taken (`platformFeeAmount > 0`) —
  e.g. "of ₦2,000 released — platform fee ₦100".
- **Verified live**, four separate real-data checks: (1) a real
  Flutterwave release — response body confirmed
  `grossAmount: "1000"`, `platformFeeAmount: "50"`, `amount: "950"`, and
  that `950` (net), not `1000`, is what was sent to the gateway; (2) a
  full manual-path release (₦2,000 milestone) exercising
  `finalizePayout` end-to-end — confirmed via direct DB query that the
  escrow balance dropped by the full gross ₦2,000 (658,000 → 656,000),
  the ledger 'release' entry recorded gross (₦2,000), and the receipt
  recorded net (₦1,900) with a ₦100 fee; (3) the ROI dashboard's "Total
  invested" rendering the correct gross-based figure (₦185,903,500)
  with no errors; (4) `explain_fees` on a project with a real mix of
  historical (pre-fee) and new payouts correctly reporting "Released
  from escrow: 903,500 NGN... vendor received 903,400 NGN net of a 100
  NGN platform fee" — matching the one real fee actually taken across
  that project's payout history.

**Not done — explicit scope, not oversight**:

- No per-account or tiered fee rates (e.g. a lower rate for
  package-subscribed vendors) — a single global env-configured percent.
- No fee on materials-marketplace `Order` payments — this pass covers
  project milestone escrow releases only.
- No real transfer of the retained platform fee to an actual platform
  bank account — it's tracked correctly (`platformFeeAmount` sums are
  real and queryable) but stays inside the scaffold's own accounting,
  same as every other balance in this app.
- No admin-facing "platform revenue" report — the fee is fully computed,
  persisted, and readable per-payout/per-project, but nothing yet
  aggregates it across the whole platform into its own dashboard.

## Visibility packages — Phase 1 of 2 (this pass)

The second monetization idea discussed alongside the platform fee above
(the other being "packages that once an individual, family, company, or
vendor subscribes to... adverts appear verified with the package title
and top of the list" — plus, in the same request, an "earn credits for
AI usage" mechanic). Scoped into two phases: **this pass is the boost
itself** — a real catalog, a real purchase that activates it, and the
actual top-of-list + badge effect across every marketplace browse
surface. The next pass (explicitly deferred, not forgotten) is real
recurring auto-billing instead of today's "renewing is just subscribing
again" model, plus the AI-credits mechanic, which needs its own
usage-metering layer that doesn't exist yet — there's currently no
per-call cost on any AI skill to spend a credit against.

**What's built**:

- `VisibilityPackage` — a real, admin-defined catalog (seeded: Featured
  and Premium, each monthly or annual — 4 rows), not a free-text plan
  name. `PackageSubscription` — one row per purchase, append-only same as
  Payment/Payout, not a single mutable "current plan" column on Account.
  See both models' own schema comments.
- Buying one is a real one-off charge — `PackagesService.subscribe`
  mirrors `PaymentsService.deposit`'s own shape (Paystack/Flutterwave/
  PayPal/Stripe real gateway checkout, or the "manual" instant-complete
  simulation), just with no project/escrow to attach to, so it duplicates
  that shape rather than reusing `Payment` (its `projectId`/
  `escrowAccountId` columns are both `NOT NULL`). No stored "expired"
  status — whether a subscription is *currently* boosting is always
  computed live (`status === 'active' && expiresAt > now`), never a cron
  flipping a flag.
- The actual effect — `src/packages/boost.util.ts`, one shared helper
  wired into `ListingsService.findAll`, `VendorsService.findAll`,
  `MaterialsService.findSuppliers`, and the landing page's own
  `PublicProfilesService.getMarketplaceHighlights`: every currently-
  boosted account's listing/vendor/supplier row moves to the top of the
  default (no search query) browse order and carries a `packageBadge`
  (`{ packageTitle, boostWeight }`). A real search (`q` present) leaves
  this alone on purpose — `search-ranking.util.ts`'s own much smaller
  relevance tiebreak stays in sole control there, so a boosted account
  can never bury a strongly-relevant match; it still shows its badge,
  just doesn't jump the queue. Two tiers compete by `boostWeight` when
  more than one boosted account would land in the same slot (e.g. the
  landing page's own top-6 teaser).
- Deliberately **not** named/worded "verified" anywhere in the field name
  or the UI badge — `verificationStatus` already means something else
  entirely (the platform's own KYC-style review outcome) on Vendor/
  Supplier/PropertyListing, and this is paid placement, a different
  concept. The badge reads "★ {package title}" (e.g. "★ Premium"), styled
  distinctly (gold) from the existing verification/trust badges.
  `PackageBadge`'s own type comment in `lib/api.ts` explains the same
  choice on the frontend. A currently-boosted account's own public
  `/go/:accountId` profile page carries the badge too.
- A new **Boost** nav item and `/packages` page — the catalog with a
  Subscribe form per package (provider picker, same shape as the
  project page's own deposit form), the account's current active boost
  summary, and its full subscription history. `package:read`/
  `package:write` are new permissions — every role that can spend money
  elsewhere (`property_owner`, `family_admin`, `company_admin`,
  `vendor`, `supplier`) gets both; `viewer` gets read-only, matching its
  existing `payment:read`-without-`payment:write` pattern.
- **Verified live**: subscribed the demo owner account to Premium
  (monthly, manual provider) — activated instantly with the correct
  `expiresAt` (+1 month); confirmed `GET /packages/me/active` and the
  `/packages` page's own summary card both reflect it. Confirmed the
  boost then actually moved that account's listing ("14 Ocean Drive") to
  the top of `GET /listings` ahead of two comparable listings created
  more recently (which `orderBy: createdAt desc` would otherwise have
  ranked first) — both in the raw API response and rendered in the
  Marketplace page with its gold "★ Premium" badge. Confirmed the same
  badge + ordering on the completely public, signed-out
  `GET /public/marketplace/highlights` (the landing page's own data
  source) and on that account's own `/go/:accountId` public profile
  page — a real, un-authenticated request, not just the logged-in view.

**Not done — explicit scope, not oversight**:

- No "earn credits for AI usage" mechanic — needs its own per-skill
  usage-metering layer first (there's no concept of what one AI skill
  call costs today), a separate subsystem from the boost itself. Still
  deferred after Phase 2 below.
- No admin UI to manage the package catalog — the 4 seeded rows
  (`prisma/seed.ts`) are real and live, but adding/editing/retiring one
  needs a direct database change, not a screen.
- No per-`Product` boost on the materials marketplace, only `Supplier` —
  matches Vendor's own granularity (a business, not each individual
  listing within it) on that marketplace.

## Visibility packages — Phase 2 of 2, real auto-renewal (this pass)

Closes the one gap Phase 1 above deliberately left open: renewing used
to mean subscribing again by hand. This pass adds a real recurring
charge — Paystack only (the one gateway this scaffold already treats as
"full-featured" elsewhere, e.g. its own bank list/resolve routes for
payouts) — plus the actual "cancel my subscription" action, a self-serve
"renew now," and the daily job that fires it automatically.

**What's built**:

- `PaystackService.verifyTransaction` now captures Paystack's own
  `authorization.reusable` flag off a successful charge — when true, the
  `authorization_code` (a real, chargeable-with-no-cardholder-present
  token) is persisted on the `PackageSubscription` row alongside the
  exact `payerEmail` Paystack associated with it. A new
  `PaystackService.chargeAuthorization` (`POST /transaction/
  charge_authorization`) is the actual real charge — same amount/
  currency mismatch rigor `verifyDeposit`'s own Paystack branch already
  applies.
- Requesting `autoRenew: true` at subscribe time is refused outright for
  any provider but Paystack (`PackagesService.subscribe`); once activated,
  if Paystack's own charge turns out not to be reusable (some cards
  aren't), the requested `autoRenew` is silently downgraded to `false`
  rather than left pointing at a token that doesn't work — the UI's own
  "no reusable card on file" message covers exactly this case.
- `PackagesService.chargeRenewal` — the one real method both the manual
  and scheduled paths share (same "the cron and the manual trigger run
  the identical code" shape `ReportsSchedulerService.sendDueDigests`
  already establishes for the digest cron): charges the saved
  authorization at the package's *current* catalog price (not the
  original row's historical amount — a package's own price can change
  between cycles), creates a new `PackageSubscription` row chained via
  `renewedFromId`, and flips `autoRenew` off the row being renewed either
  way — on success because the new row is now the chain's own head, on
  failure because this scaffold deliberately has no retry/dunning logic:
  a declined card just ends the chain and notifies the account
  (`InAppNotificationsService`, surfaced in the existing notification
  bell) to resubscribe manually.
- `PackagesSchedulerService` — a real `@nestjs/schedule` `@Cron` (daily),
  not a fake toggle, calling `PackagesService.processAutoRenewals`: finds
  every `autoRenew: true`, Paystack, still-`active` subscription due
  within 24 hours and renews each one, so a boost never has a real gap
  between cycles. No webhook receiver — same deliberate choice
  `PaystackService`'s own header comment already explains for deposits
  (this scaffold runs on localhost with no public callback URL), so
  renewal is polling/cron-driven exactly like every other gateway check
  in this codebase, not push-based.
- Two new self-service routes: `PATCH /packages/subscriptions/:id/
  auto-renew` — the real "cancel my subscription" action. Deliberately
  never touches the current row's own `status`/`expiresAt`: "cancel"
  means "stop future charges," not "revoke what's already been paid
  for," so an existing boost still runs out naturally. `POST /packages/
  subscriptions/:id/renew-now` — charges the same saved card the cron
  would, on demand; both a genuinely useful "renew early" button and, not
  incidentally, a way to prove the exact cron code path works without
  waiting a day.
- Frontend: an "Auto-renew" checkbox on the subscribe form (only shown
  once Paystack is picked), the current-boost summary card shows
  "Auto-renews on {date} — charged to the card on file" instead of a
  plain expiry when active, with real "Turn off/on auto-renew" and
  "Renew now" buttons, and the subscription history shows an
  "auto-renews" badge plus "renewed automatically" on any row that
  chains from a prior one.
- **Verified live, the full real chain**: subscribed via a real Paystack
  test-mode checkout with Auto-renew checked — confirmed the callback
  verify captured a real `authorization_code` and activated `autoRenew:
  true`. Clicked "Renew now" — a real `charge_authorization` call
  succeeded, created a second row chained via `renewedFromId`, flipped
  `autoRenew` off the first row, and posted a real "Boost renewed"
  notification (confirmed in the notification bell). Then, rather than
  waiting a day, ran `PackagesService.processAutoRenewals` directly
  through a real Nest application context (not a reimplementation) after
  pulling a row's `expiresAt` to 12 hours out — it correctly found the
  one due subscription and produced a third chained row the same way,
  proving the exact method the daily cron calls.

**Not done — explicit scope, not oversight**:

- No retry/dunning on a declined renewal — one attempt, then the chain
  ends and the account is notified to resubscribe by hand.
- Flutterwave/PayPal/Stripe can't auto-renew — only Paystack's API gives
  this scaffold a clean "charge a saved token with no cardholder
  present" call; a manual subscription (or any other gateway) simply
  isn't eligible, same as before this pass.
- No way to change *which* card backs an existing auto-renewing
  subscription — turning auto-renew off and subscribing again with a new
  card is the only path.

## Google Sign-In (SSO) — real, for both register and login (this pass)

The user asked directly whether social/SSO sign-in was available — it
wasn't (auth was exclusively hand-rolled email+password, no passport, no
OAuth dependency anywhere in the repo), so this closes that gap with a
real Google Identity Services integration rather than a styled button
that goes nowhere.

**What's built**:

- One backend call handles both "register" and "log in" —
  `AuthService.googleAuth`, reached via `POST /auth/google`. There's no
  separate "sign up with Google" step the way password auth needs one:
  Google already proves the email is real, so the same call either logs
  in a returning user or creates one on the spot. The response's
  `isNewUser` is what tells the frontend which just happened, the same
  way register.tsx/login.tsx already route differently after a
  successful password auth.
- Real verification, not a shortcut — `google-auth-library`'s
  `OAuth2Client.verifyIdToken` checks the ID token Google Identity
  Services' own browser widget produced against Google's actual public
  keys and this server's own `GOOGLE_OAUTH_CLIENT_ID` as `audience`,
  the same "never trust what the client claims, verify with the real
  provider" rule every payment gateway integration in this codebase
  already follows. An email Google itself reports as unverified is
  refused outright.
- `User.passwordHash` is now nullable and `User.googleId` (unique) is
  new — a Google-only account genuinely has no password to hash.
  `AuthService.login` refuses a password attempt against a null hash
  with a clear message instead of crashing `bcrypt.compare` on it, and
  points at "Forgot password" as a real way to add one later — that flow
  needed zero changes, since `resetPassword` already unconditionally
  overwrites this column regardless of its prior value.
- Account linking, not account collision — a verified Google email that
  matches an *existing* password account's email links `googleId` onto
  that same row rather than refusing ("email already registered") or
  silently failing (email is `@unique`, a duplicate isn't possible
  either way). That account now has two real ways in. A returning
  Google user is looked up by `googleId` first, falling back to email
  only for that one-time link.
- Same invite-token handling register() already has — `googleAuth`
  accepts an optional `inviteToken` and, only on creating a brand-new
  user, validates and consumes it via a `validateInvite` helper
  extracted out of `register()` itself (previously duplicated inline,
  now one shared check both call). An invited person who lands on
  `/register?inviteToken=...` and clicks "Continue with Google" joins
  the inviting account exactly like finishing the password form would.
- Frontend: `components/GoogleSignInButton.tsx` loads Google's own
  `accounts.google.com/gsi/client` script and renders the real Google
  widget — on both `/login` and `/register`, wired to the same
  `googleAuth` client call, each page routing the result the same place
  its own password flow already goes (`/accounts/new` for a brand-new
  user, `/properties` for one who joined via invite, otherwise the
  normal signed-in destination). Renders nothing at all — no broken or
  disabled-looking placeholder — when
  `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` is unset; password sign-in/
  register keep working unaffected either way.
- **Verified live**: confirmed `/login` and `/register` render cleanly
  with no Google button and no console errors while unconfigured (this
  environment has no real Google Cloud OAuth Client ID — same external-
  credential gap the Maps/OpenAI features had before the user supplied
  real keys), confirmed `POST /auth/google` returns a clear "Google
  sign-in is not configured" 400 (through the app's own CSRF-protected
  request path, not a raw unauthenticated call), and confirmed the
  existing password login flow is completely unaffected (real sign-in,
  201, redirected to the portfolio). Then verified every piece of
  `googleAuth`'s own logic for real — new-user creation, returning-user
  recognition (no duplicate row), the login() rejection message on a
  Google-only account, email-based auto-linking onto an existing
  password account (which keeps its password working too), unverified-
  email refusal, and real invite-token consumption (a fresh Google user
  actually joined the invited account, the invite flipped to
  "accepted") — all run through the real Nest application (not a
  reimplementation), with only the one unavoidable external call
  (Google's own token-verification network request) stubbed, since that
  specifically requires a live Google account and a real registered
  OAuth client this environment doesn't have.

**Not done — explicit scope, not oversight**:

- No real end-to-end browser test of the actual Google consent screen —
  needs a real `GOOGLE_OAUTH_CLIENT_ID` from
  https://console.cloud.google.com/apis/credentials with
  `http://localhost:3000` as an authorized JavaScript origin (see
  `apps/api/.env.example`'s own comment on this feature). Everything
  short of that literal external handshake is verified live, per above.
- No other social providers (Apple, Facebook, GitHub) — Google only,
  matching what was actually asked for.
- No way to unlink a Google account from a password account, or remove a
  password once one exists — both credentials just keep working side by
  side once linked.

## Email verification (this pass)

A gap surfaced during a pre-push review of the whole session's own work:
password registration created a fully-working, fee-paying account off
whatever email someone typed, with no confirmation it was real —
standing out specifically against the Google Sign-In feature above,
which hands over a *verified* email for free. Closes that asymmetry with
a real send-a-link-and-check-it flow, the same shape password reset
already uses.

**What's built**:

- `User.emailVerifiedAt` (null = unverified) and `EmailVerificationToken`
  — same tokenHash/expiresAt(24h)/usedAt one-time-use shape as
  `PasswordResetToken`, for the same reasons (see that model's own
  schema comment).
- `register()` fires a real verification email the moment the account is
  created — same `EmailService`/Resend integration password reset
  already uses, with the identical graceful fallback (log the link
  server-side, and return it in the response) when Resend can't actually
  deliver, whether that's because `RESEND_API_KEY` is unset or, as
  confirmed live below, because Resend's own sandbox sender refused a
  recipient outside the account it's registered to.
- Google Sign-In needs no separate flow at all — a brand-new Google user
  gets `emailVerifiedAt` set directly at creation (Google already proved
  the address), and linking Google onto an *existing* password account
  upgrades that account to verified too, in both cases only if it wasn't
  verified already.
- `resetPassword` also marks the email verified now — actually clicking
  a link mailed to that exact address is the same real proof of inbox
  control this whole feature is built around, so it would be strange not
  to count it.
- `POST /auth/verify-email` (the link's own target, unauthenticated —
  the token is the credential) and `POST /auth/resend-verification`
  (authenticated, 3/min) round out the flow. `GET /auth/me` changed from
  echoing the JWT payload to a real DB lookup, specifically so
  `emailVerified` is always fresh — encoding it into the 1-hour access
  token instead would mean a UI that just verified could still show
  stale state for up to an hour.
- **Deliberately non-blocking** — nothing in this app actually gates any
  action on a verified email. `EmailVerificationBanner` shows on every
  screen via `AppShell` until verified, with a working "Resend" button,
  but password sign-in/register/every other action keep working exactly
  as before. A real prompt, not a wall — see "Not done" below for why
  hard-gating specific actions is a deliberate line this pass doesn't
  cross.
- **Verified live, the complete loop**: registered a brand-new password
  account — confirmed `GET /auth/me` reported `emailVerified: false` and
  the banner rendered on a real `AppShell` page. Clicking "Resend"
  surfaced the dev-mode fallback link (Resend genuinely rejected
  delivery to the test account's address, confirmed in the server log —
  a real external response, not a stub), and clicking that real link
  through the actual `/verify-email` page flipped the account to
  verified and made the banner disappear on the next page load.
  Separately confirmed the token is truly one-time-use (reusing it
  returned a clean 400) and that resending after verification correctly
  reports "already verified" instead of minting a needless new token.

**Not done — explicit scope, not oversight**:

- Nothing is actually gated behind a verified email (no blocked
  payments, no blocked package purchases) — this pass closes the
  "accounts are created with unconfirmed emails" gap itself; deciding
  *which* real-money actions ought to require verification first touches
  payments, packages, and materials orders each separately and is a
  real, separate scope decision, not a natural extension of this one.
- No re-verification if a user's email address changes — there's no
  "change my email" feature at all yet for this to hook into.
- No expiry reminder or automatic resend — a link that lapses after 24
  hours just needs a manual "Resend" click, no scheduled nudge.

## Inspection photo evidence (this pass)

The one real gap a code-level audit of the product thesis turned up:
`PropertyInspection`/`InspectionFinding` were real and wired to real
routes, but findings were text-only (area/description/severity) — a
"cracked tile in bathroom" finding with no photo isn't actually
verifiable by an owner who isn't standing in the room. Remote *viewing*
already existed (`PropertyTourAsset`'s 360° media, AI-generated
`RenovationVisualization`); remote *verification of a specific claim*
didn't. This closes that.

**What's built**:

- `PropertyInspection.photoUrls` and `InspectionFinding.photoUrls` — both
  plain `String[]`, same convention `ProjectUpdate.mediaUrls`/
  `PropertyListing.photoUrls` already use. Inspection-level photos are
  general walkthrough/overview shots; finding-level photos are tied to
  the *specific* claim they back, which is the actual point — evidence
  for "the roof has a leak" needs to be a photo of the leak, not just
  somewhere in the same batch of uploads.
- `CompleteInspectionDto` (and its nested `InspectionFindingInput`) both
  gained an optional `photoUrls?: string[]` — set once, at completion
  time, since that's the only point evidence actually exists (nothing to
  photograph yet when an inspection is merely scheduled).
- Real uploads, not pasted URLs — a new `PhotoPicker` component
  (`apps/web/components` — used inline in `pages/properties/[id].tsx`)
  uploads through the same real `POST /uploads` (Cloudflare R2) pipeline
  `vendors/me.tsx`/`marketplace/materials/me.tsx`/`documents` already
  use, with multi-file select, live thumbnails, and a remove button —
  not the raw comma-separated text field `Property.photoUrls` itself
  still uses elsewhere on this same page. A `PhotoThumbs` component
  renders the read-only result wherever a completed inspection or its
  findings are shown.
- **Verified live, the real pipeline end to end**: uploaded a real PNG
  through `POST /uploads` — confirmed a genuine Cloudflare R2 URL came
  back (`pub-....r2.dev/uploads/<accountId>/<uuid>.png`), not a stub.
  Completed a real scheduled inspection with that URL attached both at
  the inspection level and on a specific finding ("Bathroom (moderate):
  Cracked tile near shower") — confirmed both `photoUrls` arrays
  persisted correctly in the API response, then reloaded the property
  page and confirmed both thumbnails actually render from the real R2
  URL, at both the inspection-overview and per-finding level.

**Not done — explicit scope, not oversight**:

- `Property.photoUrls` itself (the property record's own general photos,
  separate from any inspection) used the older pasted-URL text field on
  this same page at the time this was written — that's since been
  upgraded to the same real `PhotoPicker` in a later pass, see "Real
  photo uploads for the property gallery" above.
- No annotation/markup on a photo (e.g. circling the exact crack) — the
  photo itself is the evidence, nothing draws on top of it.
- No required-photo enforcement — a finding can still be saved with no
  photo at all, same as before; this adds the capability, it doesn't
  mandate using it.

## Module 24: Platform Admin Reports (this pass)

The one category a code-level audit of Module 24 found completely
unbuilt: `ReportsService` is account-scoped by design (`getPortfolioOverview
(accountId)`, "never a second, independent query path" per its own
`METRIC_REGISTRY` comment), so none of the 7 named platform-wide reports
could ever have lived there. They belong next to `PlatformAdminService`'s
own existing platform-wide work (the account directory, suspend/
reinstate, the audit log) instead — same module, same
`account:read_all` gate, same "genuinely platform-wide, no accountId
scoping anywhere" shape that module's own comment already describes.

**What's built** — `PlatformAdminService.getPlatformReports()`
(`GET /platform-admin/reports`), seven real numbers:

- **Active users** / **Active properties** — real counts (`User.status
  === 'active'`, `Property.count()`).
- **Marketplace GMV** — delivered orders + paid-out milestones
  (`Payout.grossAmount`, not the vendor's net), grouped by currency.
  Excludes property-listing sales: at the time this was written, nothing
  on `PropertyListing` recorded an actual closing price, so including
  one would have meant inventing a number. That's no longer strictly
  true — the marketplace purchase-to-portfolio pass (see that section
  above) added `ListingSale.amount`, a real, recorded closing price — but
  this metric was never revisited to pull it in, so GMV still excludes
  listing sales today, just for a narrower reason than before (see the
  "Not done" bullet below).
- **Escrow volume** — two real, different figures rather than one
  ambiguous one: lifetime deposits (every completed `Payment`, ever) and
  the current balance snapshot across every `EscrowAccount`, both by
  currency.
- **Vendor performance (platform-wide)** — the exact same jobsAssigned/
  jobsCompleted/avgRating definition `ReportsService`'s own account-scoped
  version already uses, just with no account filter: every
  `ProjectVendorAssignment` and `VendorReview` on the platform, plus a
  top-10 leaderboard by jobs completed.
- **Dispute rate** — disputes raised as a fraction of everything a
  dispute can actually be raised against (every `Project` + every
  `Order`, any status), not gated on success the way GMV is. That
  distinction is real, not cosmetic: querying this database directly
  showed 10 of 13 real disputes are project-level with no specific
  order/payout/milestone attached at all, so a "completed transactions
  only" denominator (the first version built, then corrected) would have
  undercounted the real disputes it excluded and produced a nonsense
  >100% rate with no explanation. The corrected version can still read
  above 100% on a small, test-heavy demo dataset (confirmed live: 260%,
  13 disputes against just 1 project + 4 orders, from this session's own
  repeated dispute-flow testing) — that's an honest reflection of the
  data, not a bug, which is why the raw counts are always shown alongside
  the percentage rather than the percentage alone.
- **Verification backlog** — every item platform-wide currently waiting
  on a `platform_reviewer` decision, broken out by type (vendors,
  suppliers, listings, documents, identity checks) rather than one
  opaque total, since a reviewer needs to know *what* to go look at.
- Frontend: a new "Platform reports" section on `/admin`, above the
  existing account directory, using the same `StatTile`/card conventions
  the rest of the app already uses — not a new design language for one
  screen.
- **Verified live**: loaded `/admin` as the seeded `platform_admin`
  account and confirmed every figure against this database's own real
  state — 16 active users, 6 properties, real GMV/escrow numbers, a
  vendor leaderboard, and (after catching and fixing the dispute-rate
  definition bug above) a dispute rate whose arithmetic checks out exactly
  against a direct database query.

**Not done — explicit scope, not oversight**:

- No time-windowed trend (this month vs. last, a rolling chart) — every
  figure is a live, all-time snapshot. This scaffold doesn't have enough
  real historical volume yet for a trend line to mean anything.
- No CSV export for this report the way the account-scoped portfolio
  overview already has one — a real, low-risk follow-up, not part of
  closing the "these reports don't exist at all" gap.
- Marketplace GMV still doesn't include property-listing sales. The
  original reason (no recorded sale price existed anywhere) is gone —
  `ListingSale.amount` is real now — but nothing in
  `PlatformAdminService`'s own GMV query was ever updated to reference
  it, so this is now a real, narrower, still-open gap: pull in
  `ListingSale.amount` for completed sales, not schema work.

## Module 24: Branch, Investment, Listing, and Inquiry reports (this pass)

The four remaining Module 24 gaps a code-level audit found — three of
them (Listing performance, Inquiry conversion, Investment performance)
were buildable immediately from data that already existed; the fourth
(Branch/Facility reports) needed a real new model first, since nothing
in this schema had ever recorded that a COMPANY (or any) account
organizes its properties across more than one physical location.

**What's built**:

- **`Branch`** (new model) — an account-owned location/office a property
  can optionally belong to (`Property.branchId`, nullable — a property
  never has to have one, and every report below treats "unassigned" as a
  real, permanent bucket, not a migration gap to clean up). Deliberately
  not restricted to `accountType: COMPANY` at the schema level, same as
  nothing else here gates on account type beyond what a role's own
  permissions decide. Full CRUD (`branches.module.ts`, `branch:read`/
  `branch:write`, granted to the same three owner-tier roles as every
  other account-owned resource) plus a `/branches` list page and detail
  page, and a branch picker on the property create/edit forms.
- **`branch_property_report`** — properties grouped by branch (count +
  total estimated value), including a zero-property branch (a company
  that just created one) and the Unassigned bucket.
- **`facility_cost_report`** — project spend (`Payout.grossAmount`,
  re-aggregating the exact same data `property_expenses` already
  computed, just re-summed by branch instead of by property) grouped by
  branch. Reframed honestly the same way "Supplier sales" already was:
  this account's own spend, not a facility's real-world operating cost.
- **`listing_performance`** — real per-listing engagement:
  `PropertyListing.viewCount` (already live, already incremented on
  every detail view) alongside inquiry/offer/favorite counts via
  Prisma's own relation `_count`, not three extra queries.
- **`inquiry_conversion`** — deliberately framed at the listing level,
  not the individual-inquiry level: `ListingInquiry` and `ListingOffer`
  aren't linked to each other anywhere in this schema (both only carry
  `listingId`), so this reports "did a listing that received at least
  one inquiry go on to actually sell or rent" rather than claiming any
  specific inquiry caused any specific sale, which this data can't
  actually prove.
- **`investment_performance`** — the same `acquisitionValue`/
  `currentValue`/`simpleRoiPercent` formula `PropertiesService.
  getRoiSummary` already uses per-property, computed for every property
  in the portfolio at once (reusing data already fetched for other
  metrics rather than N+1 calls to that endpoint) and rolled up into
  real portfolio totals, grouped by currency.
- All five are pure `METRIC_REGISTRY` additions inside the same
  `getPortfolioOverview` call every other metric already comes from —
  zero new frontend code for the report-builder side, same as the first
  five Module 24 metrics; they just appear as new selectable checkboxes.
- **Verified live, cross-checked against real data**: created a real
  branch, assigned the demo property to it, built a saved report
  selecting all five new metrics, and ran it — confirmed the Unassigned
  bucket correctly held the other 3 demo properties, the branch's own
  facility cost (₦903,500) and investment totals (₦185,903,500 invested,
  13.0% ROI) matched figures independently verified earlier this session
  for this exact property, listing performance showed the real view
  count (18) with correctly-zero inquiries/offers, and inquiry
  conversion correctly reported 0% rather than a crash or `NaN` on an
  account with no real inquiries yet.

**Not done — explicit scope, not oversight**:

- No way to reassign multiple properties to a branch at once — one at a
  time, from each property's own edit form.
- Investment performance's per-property ROI reads 0% for any property
  that has never received a separate `PropertyValuation` (acquisitionValue
  and currentValue both fall back to the same `estimatedValue`) — correct
  behavior, not a bug, but worth knowing before reading a portfolio full
  of 0%s as "nothing is appreciating."
- Inquiry conversion still can't attribute a specific sale to a specific
  inquiry, for the real schema reason above — an `inquiryId` on `ListingOffer`
  would need to exist first, and that's a UX decision (does making an
  offer require citing which inquiry prompted it?) not just a schema
  addition.

## Module 24: Asset utilization, Compliance, Maintenance cost, and Project progress reports (this pass)

The last four Module 24 gaps a code-level audit found — all four were
cut from the first Phase 1 pass for missing data (no rental-out
tracking, no account-scoped compliance model, no maintenance cost
field, no portfolio-wide progress rollup), not skipped scope. Each is
closed here by reframing honestly onto data that already exists, plus
one small, real schema addition (`MaintenanceRequest.cost`).

**What's built**:

- **`MaintenanceRequest.cost`** (new nullable `Decimal` field) — set
  alongside `resolutionNotes` at resolution time
  (`ResolveMaintenanceRequestDto.cost`, optional — a false alarm or a
  self-fix has no real cost to record), since that's the only point the
  real cost is actually known. No separate currency field, same
  convention `Property.estimatedValue` already uses.
- **`maintenance_cost_report`** — total and per-property maintenance
  spend, summing only requests with a real recorded `cost` (most
  historical rows have none, correctly excluded rather than treated as
  a real zero).
- **`compliance_report`** — a real composite of compliance-relevant
  signals already tracked elsewhere in this account's own portfolio
  (documents needing attention, inspections needing attention, leases
  with rent overdue), plus one genuinely new check (vendor license
  expiry, within a 30-day warning window). Deliberately not a rename of
  the platform-wide `ComplianceItem` tracker (Admin operations, above)
  — that model is `platform_admin`'s own jurisdiction/category data
  with no `accountId` of its own to scope by, so it can't answer "is my
  own portfolio compliant."
- **`asset_utilization`** — reframed honestly: "asset" means a
  property, "utilization" means whether it's currently generating value
  (an active lease, or a project actually `in_progress` right now — not
  `planning`/`on_hold`, which are real states but not "generating value
  today"). A property under an active project and occupied by a lease
  counts in both; "idle" means neither.
- **`project_progress`** — real stage/milestone completion per project,
  portfolio-wide (`ProjectStage.status`/`ProjectMilestone.status`
  counted per project). A project with no stages/milestones yet
  correctly reads 0%, not `NaN`.
- All four are `METRIC_REGISTRY` additions inside the same
  `getPortfolioOverview` call every other metric already comes from —
  zero new frontend code for the report-builder side beyond the one new
  "Cost (optional)" input on the maintenance-request resolve form.
- **Verified live, cross-checked against real data**: built a real
  saved report ("Final 4 verification") selecting all four metrics and
  ran it — "Documents needing attention": 4, "Inspections needing
  attention": 2, "Leases with rent overdue": 1, "Lekki Renovations Co.
  — license expired: 01/01/2025" (a real, already-expired date matching
  a value seen earlier this session), "Total properties": 4 /
  "Occupied": 1 / "Under an active project": 0 / "Idle": 3 /
  "Utilization rate": 25.0% (arithmetic checks out: 1 of 4 occupied,
  none under an active project), and "Kitchen Renovation — stages":
  0/5 (0%) / "milestones": 3/6 (50%) (matching this project's known
  payout history). Then resolved a real open maintenance request
  ("Leaking kitchen tap") with a real cost of ₦45,000 through the
  property detail page's resolve form, confirmed the `POST .../resolve`
  response persisted `cost: "45000"`, and re-ran the same saved report
  — "Total maintenance cost (NGN)" correctly moved from 0 to 45000,
  proving the write path end-to-end rather than just the read side.

**Not done — explicit scope, not oversight**:

- `MaintenanceRequest.cost` only gets set at resolution — a cancelled
  or still-open request has no cost by design, not a gap.
- Asset utilization's "idle" doesn't distinguish "never occupied" from
  "recently vacated" — both read the same.
- Compliance report's 30-day license-expiry window is a fixed,
  non-configurable threshold, not a per-account setting.
- Project progress is report-builder rows only (numbers and
  percentages) — no chart/visual rendering was added.
- The Reports & Permissions audit separately found no endpoint anywhere
  updates a `ProjectStage`'s own status. Closed in a later pass — see
  "New operational roles, ProjectStage progress, and vendor-assignment
  ABAC" below.

## New operational roles, ProjectStage progress, and vendor-assignment ABAC (this pass)

The last three gaps the Reports & Permissions audit flagged as needing
real product decisions, not more report code: named roles narrower than
the owner-tier admin roles, a way to actually advance a project's
stages, and a real access rule for the vendor a project is hired out
to (not just the owning account).

**What's built**:

- **Three new roles** — `property_manager`, `facility_manager`,
  `project_manager` (Section 7's named operational roles). Each a
  job-scoped slice of `property_owner`/`family_admin`/`company_admin`'s
  permissions rather than full account control: none gets
  `account:manage_members`, `payment:write`/`approve`, or
  `branch:write`. Invitable the same way `viewer`/`family_admin`/
  `company_admin` already are — no backend change needed beyond the
  role/permission seed data, since `POST /accounts/:accountId/members`
  already accepts any seeded `roleKey` generically.
- **`project:update_progress`** (new permission) — deliberately
  narrower than `project:write`: advancing a project stage or posting a
  progress update, not creating/completing the project or touching its
  money. Granted to every owner-tier role, `project_manager`, and —
  unlike `project:write`, which is never granted to it — the `vendor`
  role too.
- **`PATCH /projects/:projectId/stages/:stageId`** (new endpoint) — the
  actual gap: `ProjectStage.status` was set once at creation and never
  writable again anywhere in the codebase. A matching stage-by-stage
  status editor was added to the project detail page, next to the
  existing read-only stage bar.
- **Real vendor-assignment ABAC** — a new `@AllowAssignedVendor()`
  decorator plus a `PermissionsGuard` extension: a route so marked lets
  an account through its `:projectId` ownership check not just when it
  *owns* the project, but also when it's a `Vendor` with a real
  `ProjectVendorAssignment` on that exact project — checked against the
  database, not inferred from the `vendor` role alone. Applied to
  `GET /projects/:projectId` (a hired vendor can now see the full
  project — stages, milestones, updates — not just its own quote),
  the new stage endpoint, and `POST /projects/:projectId/updates`
  (a vendor can now post its own progress update, not just the owner).
  Every other `:projectId` route (create milestones, request/accept a
  quote, complete the project) is untouched — still owner-account-only.
- `addUpdate`'s notification logic now routes by who actually posted:
  the owning account still notifies every assigned vendor as before;
  an assigned vendor instead notifies the owning account — needed once
  posting stopped being one-directional.
- The project detail page's secondary loads (escrow, payouts, receipts,
  disputes) switched from `Promise.all` to `Promise.allSettled`, since
  a vendor can now legitimately reach this page without holding
  `payment:read`/`payout:read`/`dispute:read` on it — one 403 no longer
  blanks the whole page in an error banner.

**Verified live, with a real contrasting pair, not just the happy
path**: as the owning account, set the demo project's "Quote" stage to
`in_progress` through the new editor — persisted (confirmed via the
`PATCH` response). Switched account context to the demo project's
actually-assigned vendor (Lekki Renovations Co.) — the project page,
previously a hard 404 for this account, loaded in full; set "Materials"
to `in_progress` as the vendor — persisted; posted a real progress
update as the vendor — the owning account received a real
`project_update` notification linking back to the project, confirmed
via `GET /notifications`. Then created a second real project on the
same owning account with no vendor assignment and confirmed the same
vendor account gets a real 404 on both `GET /projects/:id` and
`POST /projects/:id/updates` for it — proving the ABAC checks the
specific assignment, not just "any vendor, any project." Also invited a
real member as `project_manager` through the members page — the invite
was created with that role's real `roleId`, and the seed script's own
`findUniqueOrThrow` on every permission key in each new role's list
(which would have crashed the seed on a typo) already proves the
RBAC wiring is referentially correct.

**Not done — explicit scope, not oversight, at the time**:

- `Finance Approver`, the fourth named role the audit flagged, and the
  UI-side permission gating and escrow/payout/receipt/dispute empty-
  vs-forbidden distinction named just above, were all closed in a later
  pass — see "Finance Approver, UI-side permission gating, and the
  empty-vs-forbidden distinction" below.
- `@AllowAssignedVendor()` was only added to the three routes a vendor
  has a real reason to reach — it wasn't swept across every
  `:projectId` route.

## Finance Approver, UI-side permission gating, and the empty-vs-forbidden distinction (this pass)

The three gaps left after the roles/ProjectStage/vendor-ABAC pass above:
a fourth named role, buttons that rendered regardless of permission and
relied on the server's 403, and a vendor's own escrow/payout/receipt/
dispute cards showing "nothing yet" when the real reason was "you can't
see this."

**What's built**:

- **`finance_approver`** (fourth new role) — the money-release gate
  itself, split out from `project_manager`: can approve a milestone's
  evidence (`milestone:write`, the actual permission
  `PaymentsController.approveMilestone` checks) and release its funds
  (`payment:approve`), but never `payment:write` (can't deposit into
  escrow) and never `project:write` (can't create, edit, or complete a
  project). Reuses `PaymentsService.releaseMilestone`'s existing
  "`payment:approve` OR a per-property `PropertyAccessGrant.
  canApprovePayments`" gate unchanged — no new permission key needed,
  this role just reaches that same gate on the RBAC side. Invitable the
  same way the other four operational roles already are.
- **`GET /auth/accounts` now returns each membership's real
  `permissions: string[]`** (`AuthService.listAccounts`, extended to
  include `role.permissions.permission.key`) — the same key set
  `PermissionsGuard` checks server-side, now available to the frontend
  before a button is ever clicked. A new `auth.hasPermission(key)`
  helper (`lib/auth.tsx`) wraps it. Never the actual authorization
  boundary on its own — every request still hits the real
  `PermissionsGuard` check regardless of what this says, so a stale or
  tampered client value fails safe (a button might hide when the action
  would actually have worked, never the reverse).
- **UI-side permission gating on the project detail page** — the page
  the earlier "Not done" bullet named specifically. Every action button
  (Mark complete, Request/Accept quote, Deposit, Approve/Release
  milestone, the stage-status editor, Post update, Raise dispute,
  Resolve/Reject a dispute, Add evidence, payout Check status, and
  review Edit/Delete/Submit) now checks `auth.hasPermission(...)` against
  the real permission each one's own controller route requires, instead
  of always rendering and relying on a 403 + error banner. A dispute's
  "you raised this, the other party resolves it" message is now kept
  separate from "you don't have permission to resolve disputes" — two
  different reasons that used to collapse into one `canResolve` check.
- **A real bug this same pass caught during its own live verification**:
  permission alone isn't enough to predict whether a button will work —
  `raiseDispute`/`updateReview`/`deleteReview`/`reviewVendor` (and
  every other owner-only route on this page) were never extended with
  `@AllowAssignedVendor()`, so they stay owner-account-only no matter
  what RBAC permission the caller holds. The demo vendor holds
  `dispute:write` (for its own, separate `/vendors/me/disputes` routes),
  so gating "+ Raise dispute" on that permission alone left the button
  visible for an assigned vendor on the *owner's* dispute route —
  confirmed by actually clicking it as the vendor and getting a real
  404. Fixed by computing `isOwningAccount = project.accountId ===
  auth.currentAccountId` and requiring both checks together for every
  button on an owner-only route; only the stage editor and "+ Post"
  update correctly stay permission-only, since
  `@AllowAssignedVendor()` genuinely does let an assigned vendor use
  those two.
- **The empty-vs-forbidden distinction** — `load()` now records which
  of escrow/payouts/receipts/disputes came back a real 403 or 404 (via
  `Promise.allSettled` + `ApiError.status`), not just whether the array
  came back empty. Both codes mean the same thing from here — "you
  can't see this from this page" — even though they're different
  server-side reasons: escrow/receipts 403 for the vendor role entirely
  (no `payment:read`), while payouts/disputes 404 for it specifically
  because those two routes were never extended with
  `@AllowAssignedVendor()` (vendor does hold `payout:read`/
  `dispute:read` as role permissions — just not a path to use them from
  this page). Each card renders "You don't have permission to view ___
  on this project" instead of "No ___ yet" when the reason was one of
  those two, not genuine emptiness; the escrow balance itself shows
  "not visible to you" instead of a fake "NGN 0 / not funded" that
  looked like a real, empty account.

**Verified live**: confirmed via `GET /auth/accounts` that each demo
account's `permissions` array matches its real seeded role (the vendor
account's list includes `project:update_progress` but not
`project:write`, exactly as seeded). Switched to the assigned demo
vendor and reloaded the project page — "Mark complete," "+ Deposit,"
"+ Add" (milestone), "Approve," "Release funds," and the review
Edit/Delete buttons were all correctly absent, while the stage editor
and "+ Post" update button — both backed by the `project:update_progress`
permission this role does hold, and reachable via `@AllowAssignedVendor()`
— rendered and worked exactly as the previous pass already proved. The
Escrow, Payouts, Receipts, and Disputes cards showed "You don't have
permission to view ___ on this project" instead of a false "nothing
yet" (widened to also catch a 404, not just a 403 — see the bug below),
and the escrow balance showed "not visible to you" instead of a fake
₦0. First pass through, "+ Raise dispute" still showed up for this same
vendor despite none of the above — see the bug that verification
caught, and its fix, above. Re-verified after the fix: correctly gone.
Switched back to the owning account and confirmed zero regressions —
every button still renders exactly as it always did.

**Not done — explicit scope, not oversight, at the time**:

- The "Release funds" button's blind spot (couldn't see a per-property
  `PropertyAccessGrant.canApprovePayments` grant, only the
  `payment:approve` role permission) was closed in a later pass — see
  "Exposing a member's own PropertyAccessGrant" below.
- `hasPermission` combined with `isOwningAccount` covers every route on
  this page precisely because none of them sit in between "owner-only"
  and "assigned-vendor-reachable" — but the combination is still a
  manual, per-button judgment call, not something derived automatically
  from each route's own decorators. A future route added without
  updating this page's gating to match could drift out of sync with the
  server again.
- This gating pass covered the project detail page only — the page
  named in the earlier audit. Every other page was swept in a later
  pass — see "Sweeping UI-side permission gating across the rest of the
  app" below.

## Exposing a member's own PropertyAccessGrant (this pass)

The one gap left after the UI-gating pass above: the "Release funds"
button only ever checked the `payment:approve` role permission, never
`PaymentsService.releaseMilestone`'s own second path — a per-property
`PropertyAccessGrant.canApprovePayments` grant — because nothing let
the frontend ask "do I hold a grant on this property" without already
having `property:write` (the admin-facing `GET .../access-grants`
route's own gate, which the grant exists to substitute for in the
first place).

**What's built**:

- **`GET /properties/:propertyId/access-grants/me`** (new endpoint,
  `PropertiesService.getMyAccessGrant`) — the current account member's
  own grant on a property, or `null` if none. Gated at `property:read`,
  not `property:write` — the much lower bar every realistic grant
  holder already clears (grants only ever target a member of the
  *same* owning account; `createOrUpdateAccessGrant` already refuses
  one for any other account's member).
- **`getMyAccessGrant`** (new API client method) and a `myAccessGrant`
  state on the project detail page, fetched in the same
  `Promise.allSettled` batch as escrow/payouts/receipts/disputes.
- **"Release funds" now checks both paths**: `auth.hasPermission
  ("payment:approve") || myAccessGrant?.canApprovePayments === true` —
  mirroring `releaseMilestone`'s own OR exactly. The payout
  "Check status"/"Enter OTP" buttons deliberately do **not** get this
  same OR: `verifyPayout`/`finalizePayoutOtp` check `payment:approve`
  alone server-side, with no grant fallback, so extending their UI
  gating to the grant would have shown a button that still 404s.

**Verified live, end-to-end, not just the button rendering**:
registered a real second user, added them to the demo account as
`viewer` (a role with no `payment:approve`), confirmed via
`GET /auth/accounts` that this account genuinely has zero
`payment:approve`, then granted them `canApprovePayments: true` on the
demo property via the existing owner-facing endpoint. Logged in as that
user and reloaded the project — "Release funds" correctly appeared on
three pending, approved milestones despite the role permission being
absent, while "+ Deposit," "+ Add" milestone, the payout
"Check status" button, "+ Raise dispute," and review Edit/Delete all
stayed correctly absent (this role holds none of those). Clicked
"Release funds" on "Platform fee test milestone" — it worked for real:
a genuine ₦950 payout (of ₦1,000 gross, ₦50 platform fee) dispatched to
a real Flutterwave sandbox transfer, proving the grant path all the way
through the server, not just past the button.

**Not done — explicit scope, not oversight**:

- `getMyAccessGrant` only covers the one grant field this page actually
  uses (`canApprovePayments`). `canView`/`canEdit` remain unenforced
  anywhere in this codebase, same as before this pass — the new
  endpoint returns them, nothing reads them yet.
- No UI anywhere lets a grant holder see their own grant outside of its
  effect on this one button — there's no "your access to this property"
  screen, just the one gate this pass needed.

## Sweeping UI-side permission gating across the rest of the app (this pass)

The project detail page's own gating pass explicitly scoped itself to
just that one page. This pass applied the identical discipline — every
action button wrapped in `auth.hasPermission(...)`, an added
`isOwningAccount`/`isOwner`/`isSupplier` check wherever the underlying
route is ALSO restricted to a specific account and isn't
`@AllowAssignedVendor()`-covered, and role-name/account-type checks
(`role === "platform_reviewer"`, `.accountType === "VENDOR"`) replaced
or supplemented with the real permission — across every other page in
`apps/web/pages` with a real mutating action: `properties/[id].tsx`,
`properties/index.tsx`, `projects/index.tsx`, `documents/index.tsx`,
`communities/index.tsx` + `[id].tsx`, `branches/index.tsx` + `[id].tsx`,
`vendors/index.tsx` + `[id].tsx` + `me.tsx`, `tenant/index.tsx`,
`admin/index.tsx`, `payments/index.tsx`, `packages/index.tsx`,
`accounts/members.tsx`, and the full marketplace surface
(`marketplace/index.tsx`, `new.tsx`, `[id].tsx`, `me.tsx`, and
`materials/[id].tsx` + `me.tsx` + `orders/[id].tsx` + `rentals.tsx`) and
`reports/index.tsx` — 25 files in total.

**What's built**: every button/form on those pages that calls a
`@RequirePermissions`-gated controller route now checks the matching
`auth.hasPermission(key)` before rendering (a few pages that already
disabled a button on an unrelated condition, like "zero properties yet"
or "already subscribed," added the permission check alongside that
existing `disabled` logic rather than switching to hide/show). Several
pages also got the same `Promise.allSettled` + "you don't have
permission to view ___" treatment `projects/[id].tsx` pioneered, for
whichever of their own secondary data-fetches could otherwise 403/404
and silently render a false "nothing here": `properties/[id].tsx`'s
main load (valuations/inspections/leases/maintenance/vendors/
visualizations all load independently now), `vendors/me.tsx`'s
quotes/payouts/disputes, and `marketplace/[id].tsx`'s owner-only
inquiries/offers fetch (which used two different permissions,
`listing:write` and `offer:read`, under one `.catch(() => undefined)`
that swallowed either 403 into the same false-empty message).

**Two real bugs this same pass caught live, not just in review** (the
same "permission alone doesn't prove the route is reachable" class of
bug the project detail page's own pass found and fixed):
- `documents/index.tsx` and `payments/index.tsx` each have a top-level
  branch deciding which of two role-specific views to render (a normal
  view vs. an arbitration/moderation queue), gated on two independent
  permissions. Neither page had a third branch for "holds neither" —
  so an account like `vendor` (which holds `document:read` but not
  `payment:read`, and neither `dispute:arbitrate` nor
  `document:arbitrate`) hit `payments/index.tsx` and got stuck on
  "Loading your payments overview…" forever, since the fetch itself was
  now correctly gated behind the permission it lacked but nothing ever
  told the user why. Fixed by adding the missing third branch to both:
  "You don't have permission to view ___."
- `documents/index.tsx`'s `load()` also ran a `Promise.all` between
  `listDocuments()` (gated on `document:read`) and `listProperties()`
  (gated on `property:read`, used only to label a document's property
  in the list) — a real, pre-existing bug this pass exposed rather than
  caused: the `vendor` role has `document:read` but not `property:read`,
  so the whole page crashed on a raw `"Missing permission(s):
  property:read"` error the moment a vendor could reach it at all (this
  gating pass is what let vendor reach this page's real branch for the
  first time — previously the only branch check was a role-name
  `isPlatformReviewer`, which never applied to vendor either, so the
  same crash was already latent). Fixed by decoupling the two fetches:
  `listProperties()` failing now just means every document shows
  "Unknown property" instead of its real property name, not a dead page.

**Verified live**: logged in as a real, freshly-registered account with
the `viewer` role (no write permissions on anything) and confirmed the
demo property's full detail page — documents, projects, valuations,
inspections, leases, maintenance, the works — rendered completely with
every write/edit/report/resolve/record-payment button correctly absent,
nothing crashed by a missing permission on any one section. Switched to
the demo vendor account (`document:read`, `payout:read`, `dispute:read/
write`, but no `payment:read`, `property:read`, or either arbitrate
permission) and confirmed: `/payments` now shows "You don't have
permission to view payments" instead of loading forever; `/documents`
loads its real (empty) document list instead of crashing on the
`property:read` 403, with "+ Upload document" correctly absent.

**Not done — explicit scope, not oversight**:

- This was a mechanical sweep applying an established pattern, not a
  fresh audit of every route's own ABAC shape — a route added later
  without a matching gate on its page's button would silently drift out
  of sync with the server again, same caveat the project detail page's
  own pass already noted.
- No automated test enforces "every `@RequirePermissions` route has a
  matching `hasPermission` check somewhere in the frontend" — this is
  still a manual discipline, not a lint rule.

## Closing the vendor project-discoverability gap (this pass)

The Key Workflows Audit's own finding: `ProjectsController` has let an
assigned vendor reach `GET /projects/:projectId` and post progress
updates since the earlier vendor-ABAC pass (`@AllowAssignedVendor()`),
but `/vendors/me` never gave a vendor any way to find out which
projects those even are — `myQuotes` only ever showed what it
*submitted*, not what it was actually *hired* onto, and nothing on the
page linked through to a project even when one was known.

**What's built**:

- **`GET /vendors/me/projects`** (new endpoint, `VendorsService.
  myProjects`) — the real "hired" list: every `ProjectVendorAssignment`
  this vendor holds, each with its project's title, status, currency,
  property name, and stage list. Gated on `project:read`, which the
  vendor role already has.
- **A new "Your projects" card** on `/vendors/me`, above the quotes
  section — each assignment renders as a real `Link` straight to
  `/projects/:id`, with a status badge and an "X/Y stages complete"
  line. This is the actual fix: the backend capability existed, the
  entry point to reach it didn't.
- **Two existing lists now link through too, precisely where it's
  safe to**: the Quotes section's project title is a `Link` only when
  `quote.status === "accepted"` (the one status that guarantees
  `acceptQuote` already created a real assignment — any earlier status
  would link to a project the vendor can't open yet, a dead end this
  pass deliberately avoids). The Payouts section always links (a
  payout can only ever exist for a project the vendor was actually
  paid on, so it's unconditionally safe).

**Verified live**: as the demo vendor (Lekki Renovations Co.), the new
"Your projects" card showed the real Kitchen Renovation assignment —
correct property name, "Completed" status, real stage count. Clicked
through and landed on the real project detail page, with the "+ Post"
update button and the project's stage editor both present and usable
(closing the audit's paired "Progress Updates" finding at the same
time, since it was the same missing entry point). The Quotes section's
now-linked accepted quote and all seven Payouts rows were confirmed to
carry the same real `href`.

**Not done — explicit scope, not oversight**:

- "Your projects" shows every assignment regardless of project status
  (completed, cancelled, etc.) rather than filtering to only
  `in_progress` ones — matches this page's own existing convention
  (Payouts/Quotes already show full history, not a filtered "pending"
  view), not an oversight.
- No dedicated stage-progress visual (bar/chart) on this card, just a
  fraction — the full stage bar already exists on the project page
  itself, one click away.

## Proactive rent and lease reminders (this pass)

The workflow audit's own finding: overdue-rent and lease-ending-soon
were both real *computations* — `reports.service.ts`'s
`isLeaseOverdue`, `lease-risk-flags.ts`'s `overdueDays` and "ending
within 60 days" check — but purely reactive, run only when a report or
AI query happened to ask. The only real proactive, scheduled push
anywhere in the codebase was document-expiry. Nothing ever created a
`Notification` for rent or a lease's own end date.

**What's built**:

- **`InAppNotificationsService.checkLeaseReminders`** — the same shape
  as the existing `checkDocumentExpiry`: a real, idempotent sweep over
  every active lease. Deliberately a third copy of the same small
  30-day-per-period overdue formula the other two files already have
  their own copies of, rather than a shared import — this codebase's
  own established "duplicate, don't share" convention for a computation
  this small.
- **Two real notification types**: `rent_overdue` (fires once a lease
  crosses into its next unpaid period — the dedupe key encodes the
  *anchor date* the overdue calculation is based on, not just the
  lease id, so a tenant who pays and then falls behind again gets a
  real new reminder for the new period, not silence forever after the
  first one) and `lease_ending_soon` (fires once, when a lease's
  `endDate` first comes within 60 days — the same threshold
  `lease-risk-flags.ts` already uses).
- **Notifies both real sides**: the landlord's own account always (a
  lease always resolves to one via its property), and the tenant's own
  account too, whenever `Lease.tenantAccountId` is actually linked —
  Workflow 8's own step names the tenant specifically, but a landlord
  with an unlinked tenant deserves to know rent is overdue too, since
  nothing else would ever tell them.
- **Wired into the existing hourly cron** (`NotificationsSchedulerService`,
  the same timezone-aware "~9am local" gate `checkDocumentExpiry`
  already established), plus a matching manual-trigger endpoint
  (`POST /notifications/check-lease-reminders`, `account:read_all` —
  same shape and same permission as the document-expiry one) to verify
  without waiting a real hour.

**Verified live**: ran the manual trigger for real — it found the
already-existing "Overdue Test Tenant" lease (no tenant account linked)
and correctly created one real landlord-side notification: "Overdue
Test Tenant's rent looks about 73 day(s) overdue" — the exact figure
independently verified earlier this session via the at-risk dashboard.
Re-ran it immediately after: `created: 0`, confirming idempotency.
Since no existing lease had an `endDate` set, created two real test
leases (one linked to a real tenant account, one not) with a
40-days-ago start (genuinely overdue for a monthly lease) and an end
date 20 days out (inside the 60-day window) to exercise the untested
paths — re-ran the trigger and got exactly the predicted count:
`created: 6` (2 notifications × 1 unlinked lease + 2 notifications × 2
sides × 1 linked lease). Confirmed each notification's real content:
both leases correctly showed "10 day(s) overdue" (40 days elapsed − 30
day period) and "ends on 02/10/2026," the tenant account received its
own two (correctly scoped only to the lease actually linked to it, not
the unlinked one), and a second re-run again created zero. Confirmed
the real "Rent Overdue" lease badges on the property page line up
exactly with which leases triggered a reminder, and that the landlord's
own notification bell shows the real "Rent overdue" entries.

**Not done — explicit scope, not oversight**:

- No email channel — same as every other in-app notification this
  codebase has, this is `Notification` rows only; `EmailService` exists
  for other flows but isn't wired to these two triggers.
- `lease_ending_soon` fires exactly once per lease, ever — there's no
  second, more urgent reminder as the date gets closer (e.g., a 60-day
  and a 7-day warning). `rent_overdue` does effectively recur (a new
  unpaid period produces a new anchor, hence a new reminder), but this
  one doesn't need to — the end date itself never moves.
- No UI lets a landlord or tenant configure or disable these two
  reminder types independently — they fire unconditionally, like
  document-expiry already does.

## The marketplace purchase-to-portfolio flow (this pass)

The workflow audit's biggest single finding: buying a property from the
marketplace worked cleanly right up to an accepted offer, then simply
stopped. `ListingsService.respondToOffer` flipped the listing to
`under_offer` and nothing else ever happened — no document checklist, no
deposit tracking, no completion, and no code anywhere that transferred
a `Property` row between accounts. `Payment`/`EscrowAccount` couldn't
help either: both require a `projectId`, and a property purchase isn't
a renovation project.

**What's built**:

- **`ListingSale`** (new model) — created the moment an offer is
  accepted, one per listing (`@unique` on both `listingId` and
  `offerId`, `upsert`-guarded against a theoretical double-accept).
  Deliberately **not** wired into `Payment`/`EscrowAccount` — same
  "record what's true, don't fake a payment rail that isn't there"
  restraint `LeaseRentPayment`'s own comment already established for
  rent; `depositRecordedAt` is a plain timestamp, not a real charge.
- **A document checklist that's never stored** — `ListingsService.
  getSale` computes it live from the property's own real `Document`
  rows against the exact same `DEFAULT_DOCUMENT_CHECKLIST` the
  `verify_property_documents` AI skill already uses (title document,
  survey plan, certificate of occupancy, building approval) — a
  document verified (or newly uploaded) after the sale started shows up
  immediately, with nothing to keep in sync by hand.
- **Two new real preconditions gating completion** — `POST .../sale/
  complete` throws a specific, real 400 if the deposit hasn't been
  recorded yet, and a second, separate real 400 naming exactly which
  checklist documents aren't yet `verified` if any aren't. Not a button
  that always works regardless of state.
- **A real transfer, not a copy** — completion reassigns the existing
  `Property.accountId` to the buyer's own account: the one field every
  permission/ABAC check in this codebase already keys on for "who owns
  this," so the property is immediately reachable from the buyer's own
  `GET /properties` with its full real history (documents, timeline,
  any existing leases/projects) intact, not a stripped-down clone. Also
  sets the listing to `sold`, logs a real `PropertyTimelineEvent`, and
  notifies both sides.
- **A new "Purchase in progress" / "Sale completed" card** on the
  listing detail page, visible to both the buyer and seller (backed by
  a new `requireSaleParty` check — the first thing on `ListingsController`
  a non-owning account is allowed to reach) — the real amount (the
  *accepted* offer amount, not the original asking price), the live
  checklist, deposit status, and Record deposit / Complete sale buttons,
  gated on `offer:write` per this session's own permission-gating sweep.

**Verified live, the full real transaction, not a shortcut**: created a
real second property and listing as the seller, registered a genuinely
separate second user and INDIVIDUAL account as the buyer, submitted and
accepted a real offer (`₦44,000,000`, below the `₦45,000,000` asking
price — confirmed the sale correctly used the accepted amount, not the
listing price). Confirmed `POST .../sale/complete` correctly refused
with "Record the deposit before completing the sale," then — after
recording a real deposit — refused again with "Document checklist
incomplete — not yet verified: Title Document, Survey Plan, Certificate
Of Occupancy, Building Approval" (all four, by name). Uploaded and
verified all four real documents, confirmed the checklist picked them
up live, and completed the sale for real. Confirmed: the seller's own
`GET /properties` no longer includes it; the buyer's own account —
logged into for real, not just switched into — does, with the property
page's own real timeline showing "Sold via marketplace listing ... —
ownership transferred" alongside its genuine document history; the
listing itself now reads `sold`; both sides received a real, correctly
worded completion notification; and a second `complete` call correctly
refused with "This sale is already completed."

**Not done — explicit scope, not oversight**:

- No counter-offer UI (the audit's own earlier finding) — an owner can
  still only Accept or Reject from this page, even though
  `RespondOfferDto` has supported `countered` with a real re-priced
  amount since before this pass. Closed in a later pass — see
  "Counter-offers on marketplace offers" below.
- No real payment gateway integration for the deposit — same
  restraint as `LeaseRentPayment`, not an oversight; wiring a real
  charge would mean either loosening `Payment`'s `projectId`/
  `escrowAccountId` requirement (risking the well-tested renovation
  escrow flow) or building a second, parallel payment path — a real,
  separate, larger piece of work.
- Only one offer per listing can ever have a real `ListingSale` (the
  `@unique` constraint) — `respondToOffer` itself still doesn't prevent
  a second "accepted" call on a different offer for the same listing;
  it just can't create a second sale once one exists.
- No UI surfaces `PropertyOwner` (~~the separate, still-inert
  multi-owner/%-split model the audit flagged~~ — that model got a real
  create/edit/remove CRUD in a later pass, see "Ownership structure — a
  real create/edit UI for co-owner shares" below) as part of this flow
  — the transfer is a clean single-owner handoff via `Property.accountId`,
  deliberately not conflated with that separate feature.

## Counter-offers on marketplace offers (this pass)

The workflow audit's own earlier finding, left open by the purchase-
to-portfolio pass: `RespondOfferDto` already let a seller set an offer
to `countered` with a real re-priced amount, but nothing existed for
the buyer to act on it — no endpoint, no UI, not even a notification.
A countered offer was a dead end; the buyer's only way to find out was
to keep manually re-checking `myOffers()`, and even then had no way to
respond.

**What's built**:

- **`POST /listings/:listingId/offers/:offerId/respond-to-counter`**
  (new route, new `RespondToCounterDto`) — the buyer's own half of the
  negotiation. Deliberately narrower than the seller's
  `RespondOfferDto`: accept or reject only, no re-countering — a
  bounded, one-round counter-offer, not a full negotiation engine.
  Checked against the offer belonging to the caller and currently
  `countered` (a clear 400 naming the offer's actual status otherwise),
  not against `requireOwnListing` — the buyer never owns the listing.
- **A shared `acceptOfferIntoSale` helper** — the seller accepting a
  fresh offer and the buyer accepting the seller's counter both end in
  exactly the same place (a `ListingSale` created, both sides
  notified), so that logic exists once, not twice. An `initiatedBy`
  parameter picks who gets told "accepted" and which side of the deal
  that notification names — never the account that just clicked the
  button, always the other side.
- **Notifications on every transition, not just acceptance** — a
  countered or rejected offer used to notify no one; the seller
  countering, the seller rejecting outright, and the buyer rejecting a
  counter now all notify the other side, each with its own real
  wording (`listing_offer_countered`, `listing_offer_rejected`,
  `listing_counter_rejected`).
- **Seller UI** (listing detail page): a "Counter" button next to
  Accept/Reject on a `submitted` offer opens an inline amount input;
  once countered, the buttons disappear in favor of a plain "countered"
  badge — it's the buyer's turn next, so the seller has nothing left to
  click until they respond.
- **Buyer UI** (`/marketplace/me`): a `countered` offer now shows real
  "Accept counter" / "Reject" buttons in place of a plain status badge.

**Verified live** with the real seller (`demo-owner`) and the real
second buyer account from the purchase-to-portfolio pass
(`sale-verification-buyer@propertyonthego.test`): submitted a real
offer, countered it at a genuinely different amount, confirmed the
buyer's own offer list picked up the new amount and status, and
confirmed a real `listing_offer_countered` notification arrived.
Accepted the counter from the buyer's own UI and confirmed the
resulting `ListingSale` was created at the *countered* amount (not the
original offer), the listing detail page's existing document-
checklist/deposit/complete flow was reachable exactly as before, and
the seller received a real notification correctly worded "Your
counter-offer ... was accepted" (not "your offer," which would have
been wrong — the seller is the one who countered). Separately verified
the reject-the-counter path (seller notified "The buyer declined your
counter-offer") and, as a regression check, that a seller rejecting a
fresh (never-countered) offer still notifies the buyer correctly.
Caught and fixed one real bug in this pass: `respondToCounter`'s
Prisma update didn't `include` the listing relation, so accepting or
rejecting a counter from `/marketplace/me` silently dropped that
offer's listing title/link from the page the instant the response
replaced it in local state — fixed by including the same `{ id, title,
status }` shape `myOffers()` itself already selects.

**Not done — explicit scope, not oversight**:

- Accept-or-reject only, no re-countering — a buyer who wants to
  negotiate further has no in-app way to send a second counter back;
  they'd have to reject and ask the seller to relist or start over.
- No expiry on a `countered` offer — it sits there indefinitely until
  the buyer responds, with no reminder nudging them to.
- No history of prior amounts — once countered, the original offer
  amount is overwritten in place; nothing records what the buyer
  originally offered before the counter.

## Buyer receipt confirmation on material orders (this pass)

The workflow audit's own finding on Workflow 6 (Buy Construction
Materials): only a supplier could ever set an order's delivery status,
including "delivered" — the buyer/site had no confirm-receipt action of
its own; its only post-delivery action was leaving a review. One side
of the transaction could unilaterally declare "delivered" with nothing
from the other side checking that claim.

**What's built**:

- **`Delivery.confirmedAt`** (new column) — deliberately separate from
  the existing `deliveredAt` the supplier already sets, so "the
  supplier says it arrived" and "the site says it actually has it" stay
  two distinct, independently-true facts rather than one party being
  able to silently claim the other's half.
- **`POST /orders/:orderId/confirm-receipt`** (new route,
  `MaterialsService.confirmReceipt`) — buyer-only (checked against
  `Order.accountId`, not `requireOwnSupplier`), and only reachable once
  the supplier has actually marked the order `delivered`: a real,
  specific 400 either way — before delivery, or on a second attempt
  once already confirmed.
- **A real notification to the supplier** (`order_receipt_confirmed`)
  the moment the buyer confirms — the first notification either side of
  a material order has ever received; before this pass, `Order` had no
  `.notify(` call site at all, checked across the whole module.
- **Buyer UI** (order detail page): a "Confirm receipt" button appears
  once the supplier has marked an order delivered, replaced by a
  "Receipt confirmed [date]" badge afterward.
- **Supplier UI**: the existing `DeliveryEditor` now shows a read-only
  "Buyer confirmed receipt on [date]" line once confirmed, so the
  supplier doesn't have to guess whether the buyer ever saw it arrive.

**Verified live** end-to-end with the demo login's own two real,
distinct accounts (an INDIVIDUAL buyer and the seeded "Lagos BuildMart"
supplier account, same underlying user, switched via the account
selector — not simulated): placed a real order, confirmed
`confirm-receipt` correctly refused with "This order has not been
marked delivered by the supplier yet" while still `pending`, marked it
delivered from the supplier side, then confirmed receipt for real from
the buyer's own order page. Confirmed the button was replaced by a real
"Receipt confirmed" badge with the actual date, that switching to the
supplier's own account showed the matching read-only confirmation line
on `DeliveryEditor`, and that a real `order_receipt_confirmed`
notification reached the supplier's own notification bell with the
correct order-specific wording. Also verified a second confirm-receipt
call correctly refused with "Receipt was already confirmed for this
order," and that the supplier's own account is refused outright
(404 — "Order not found in your account") if it tries to confirm
receipt on its own order.

**Not done — explicit scope, not oversight**:

- No enforcement tying receipt confirmation to anything downstream —
  `Order.status`/`Project.budget` are unaffected by confirmation; it's
  a real fact recorded, not (yet) a gate on anything else.
- No reminder if a delivered order is never confirmed — same reactive-
  only pattern this codebase already has elsewhere (rent/lease
  reminders were the exception this session built, not the rule);
  confirmation sits open indefinitely with no nudge.
- No dispute auto-raised on a mismatch — if the buyer never confirms,
  or would dispute what arrived, that's still the same manual
  "+ Raise dispute" flow as before, not wired to this new state.

## Maintenance request categorization and category-filtered vendor assignment (this pass)

The workflow audit's own finding on Workflow 7 (Maintenance Request):
`MaintenanceRequest` had no `category` field at all, only `priority` —
"no plumbing/electrical-style taxonomy exists." A closely related
finding one step later in the same workflow: the vendor picker used to
assign a request was "a plain unfiltered `<select>`, not the vendor
marketplace's own search/filter experience" — every vendor on the
platform in one list regardless of what the issue actually needed.

**What's built**:

- **`MaintenanceRequest.category`** (new column, `@default("general")`)
  — a flat taxonomy (plumbing, electrical, hvac, appliance, structural,
  pest_control, landscaping, painting, roofing, cleaning, general,
  other), the same shape `priority` already uses, deliberately not a
  sub-category/licensing-requirement system (a market-specific config
  problem, same restraint `CreateVendorDto`'s own comment already
  applies to vendor service categories). Settable on report, editable
  afterward, real validation (`IsIn`) rejecting anything outside the
  list.
- **Both real report paths** — the landlord/manager form on the
  property page and the tenant's own portal form — both gained the
  category selector, not just one of them.
- **Category-filtered vendor assignment** — `VendorOrNameField` (used
  both when first reporting an issue and when starting one) now filters
  its vendor list to `serviceCategory === category` whenever a real
  match exists, with a visible "Showing N `<category>` vendors only"
  hint, and silently falls back to the full unfiltered list when a
  category has no vendor equivalent (structural, hvac, appliance,
  pest_control, general, other) — rather than showing an empty,
  dead-end picker for those.

**Verified live**: reported four real requests on a real property —
`electrical`, `structural`, `plumbing`, and one left uncategorized to
confirm it defaulted to `general` — and confirmed a request with an
invalid category string is rejected with a real 400 naming the full
allowed list. Started the `electrical` request and confirmed the
vendor picker correctly narrowed to exactly the 3 real electrical
vendors on the platform with the "Showing 3 electrical vendors only"
hint visible; started the `structural` one and confirmed it correctly
showed all 7 vendors unfiltered, with no misleading hint. Edited an
existing request's category from `general` to `appliance` and
confirmed it persisted and re-rendered correctly. Separately verified
the tenant-facing form end-to-end: logged in as the real tenant
account, reported an issue with category `electrical`, and confirmed
it appeared correctly categorized on the tenant's own request list.

**Not done — explicit scope, not oversight**:

- No sub-categories or per-category licensing rules — same restraint
  vendor service categories already accept; a flat list, not a
  taxonomy tree.
- The vendor filter here is a client-side narrowing of an already-
  fetched list, not a new search/filter endpoint. ~~The audit's own
  broader finding (no location/rating/verification filtering anywhere
  on the vendor marketplace itself) is unrelated and still open~~ —
  closed; see "Vendor marketplace location/rating/verification filters"
  below.
- No category-based reporting/analytics (e.g., "most common issue type
  this quarter") — the field exists and is queryable, but nothing
  aggregates it yet.

## Photo evidence on maintenance requests (this pass)

The workflow audit's own finding on Workflow 7 (Maintenance Request):
`MaintenanceRequest` had no photo/attachment field at all — resolution
recorded only free-text notes and a cost number, with no way to show
what was actually wrong or prove it was actually fixed.

**What's built**:

- **Two separate photo arrays, not one** — `MaintenanceRequest.photoUrls`
  (what's actually wrong, settable at report time) and
  `resolutionPhotoUrls` (proof it was fixed, settable only at resolve
  time). Deliberately kept apart: conflating them would lose which
  photo was taken when, the same reasoning `PropertyInspection`'s own
  inspection-level vs. finding-level photos already established.
- **Real uploads, not pasted URLs** — both fields go through the same
  `POST /uploads` (Cloudflare R2) pipeline every other real photo field
  in this codebase already uses, via the existing `PhotoPicker`
  component (already shared by the inspection overview/finding pickers).
- **Both real report paths get it** — the landlord/manager form on the
  property page, the tenant's own portal form, and the edit form (to
  add photos to an already-open request) all gained a real photo picker;
  the resolve form gained its own, separate one for receipt/completion
  photos.
- **Rendered everywhere the request itself is**: thumbnails linking to
  the full-size image on the property page's maintenance list and the
  tenant's own "My Lease" maintenance list, issue photos shown above the
  resolution notes and receipt photos below them.

**Verified live**: uploaded real images through the actual R2 pipeline
(not mocked) as both the owner and the tenant. Reported a real request
with a real issue photo, confirmed it persisted on a fresh re-fetch (not
just echoed back), edited the same request to add a second photo,
resolved it with a real, separate receipt photo, and confirmed all
three photos rendered in the right place on the property page — two
issue photos above the resolution note, one receipt photo below it.
Separately verified the tenant's own report form end-to-end: a real
tenant-uploaded photo appeared correctly on both the tenant's own list
and the owner's view of the same request. Confirmed a request reported
with no photos defaults cleanly to two empty arrays rather than null,
and that a non-string value in `photoUrls` is rejected with a real 400.

**Not done — explicit scope, not oversight**:

- No per-photo caption or ordering — photos render in upload order with
  no way to annotate which one shows what.
- No enforcement that a resolution actually includes a photo — it's a
  real, available field, not a required one; an owner can still resolve
  a request with notes only, same as before this pass.
- No photo evidence on `start` (e.g., a "before work began" photo
  distinct from the original issue report) — only report-time and
  resolve-time photos exist.

## Real photo uploads for the property gallery (this pass)

The workflow audit's own finding on Workflow 1 (Add Existing Property):
"No real upload widget for the gallery — it's a comma-separated
paste-your-own-URL text field, unlike documents/inspections/licenses
which all use the real R2 upload pipeline." True since Module 3 first
added `Property.photoUrls` — see "Module 3: Property Details" above,
whose own text plainly said "no upload pipeline changed" at the time.

**What's built**:

- **No backend change at all** — `UpdatePropertyDto.photoUrls` was
  already a real `string[]`; the gap was entirely in the frontend
  reducing that array down to a comma-joined text box and back.
- **The property detail page's "Edit details" form now uses the same
  `PhotoPicker` component** every other real photo field in this
  codebase already shares (maintenance requests, inspections) — real
  uploads through `POST /uploads` (Cloudflare R2), removable thumbnails,
  multi-file select. Amenities deliberately stay comma-separated text —
  unlike photos, there's no fixed vocabulary to build a picker against,
  the same distinction this module's own original comment already drew.

**Verified live**: uploaded two real images through the actual upload
pipeline (not pasted URLs), saved them onto a real property, and
confirmed both rendered in the existing photo-gallery grid on the
non-editing view. Reopened "Edit details" and confirmed both photos
appeared as real removable thumbnails (not text), removed one, saved,
and confirmed the property now shows only the remaining photo — both on
a fresh page load and via a direct re-fetch of the property record, not
just an optimistic UI update.

**Not done — explicit scope, not oversight**:

- No photo reordering or captions — same limitation the maintenance-
  request and inspection photo pickers already carry, not new to this
  fix.
- Amenities remain freeform comma-separated text, unchanged — a
  deliberate choice, not a missed half of this same gap.

## Marketplace price and verification-status filters (this pass)

The workflow audit's own finding on Workflow 2 (Buy Property from
Marketplace): "Backend supports price range + propertyType, but the UI
only exposes `listingType` and `city` — no price inputs. Verification-
status filtering doesn't exist anywhere, frontend or backend."

**What's built**:

- **Price filter** — no backend change needed; `minPrice`/`maxPrice`
  query params already existed on `GET /listings` and were already
  wired into the API client, just never exposed as inputs on the
  marketplace page itself. Added real min/max number inputs.
- **Verification-status filter** — genuinely new on both sides:
  `SearchListingsQuery.verificationStatus` (new query param) applied
  directly in `ListingsService.findAll`'s existing `where` clause —
  `PropertyListing.verificationStatus` already existed and already fed
  the ranking boost, it just had no filter of its own. A "Verified
  only" checkbox on the marketplace page maps to
  `verificationStatus: "verified"`.
- **A verification badge on each listing card** — previously invisible
  anywhere in the browse view; now a real "✓ verified" badge renders
  next to a verified listing's type badge, so the new filter has
  something visible to filter *for*, not just an invisible toggle.

**Verified live**: a direct database check found every active test
listing was `not_verified`, so set one real listing to `verified` to
have a real positive case to filter for (there's no reviewer-facing
action anywhere that sets this — see "Not done" below), then confirmed:
the "✓ verified" badge appeared only on that listing; checking
"Verified only" narrowed the browse view to exactly that one listing
and unchecking it restored the rest; setting a min/max price range
correctly narrowed results across listings in different currencies (a
raw numeric compare, not currency-aware at the time — since closed, see
"Not done"); and the empty-state message correctly read "match those
filters" once any filter was active, not just city/type/search as
before.

**Not done — explicit scope, not oversight**:

- **A real, separate, adjacent gap surfaced while building this**: there
  is no `listing:verify` action anywhere in the codebase — unlike
  vendors, suppliers, and documents, which each have a real neutral-
  reviewer `setVerificationStatus`-style endpoint, nothing ever sets
  `PropertyListing.verificationStatus` except at creation. The filter
  built in this pass works correctly against whatever value is already
  there; it doesn't add a way to change that value. Closed in a later
  pass — see "A real listing:verify action for the neutral reviewer"
  below.
- ~~No currency-aware price filtering — `minPrice`/`maxPrice` compare
  `askingPrice` as a raw number regardless of the listing's own
  `currency`~~ — closed; see "Currency-scoped price filtering on the
  marketplace" below.
- ~~No propertyType filter exposed in the UI, even though the backend
  already accepts one~~ — closed; see "Marketplace propertyType filter"
  below.

## A real listing:verify action for the neutral reviewer (this pass)

Surfaced while building the marketplace filters pass above: unlike
`Vendor`, `Supplier`, and `Document` — each of which has a real neutral-
reviewer `setVerificationStatus`-style endpoint — nothing anywhere ever
set `PropertyListing.verificationStatus` off its own default. The
platform-admin verification backlog has counted `submitted` listings
since Module 24's own pass, but nothing could ever get a listing into
that state, and nothing could ever act on it once there.

**What's built**:

- **`PropertyListing.verificationNotes`** (new column) — the same
  "reviewer's note" field `Vendor`/`Supplier`/`Document` already carry,
  closing that gap too, not just the missing action.
- **`PATCH /listings/:listingId/verification`** (new route,
  `ListingsService.setVerificationStatus`) — mirrors
  `VendorsService.setVerificationStatus` exactly: no `:propertyId` param
  for `PermissionsGuard`'s ABAC to key on, so it reaches any listing
  platform-wide, gated on a new `listing:verify` permission instead.
- **`listing:verify` granted only to `platform_reviewer`**, alongside a
  new `listing:read` grant that role didn't have before (it couldn't
  browse listings at all until now) — never granted to `listing:write`
  roles, the same self-verification lockout `vendor:verify`/
  `supplier:verify` already enforce.
- **A real review panel on the listing detail page** — mirrors the
  Vendor page's own "Platform review" panel (status buttons + a notes
  field), visible only to `listing:verify` holders. A verified listing
  now shows a real "✓ verified" badge on both the listing detail page
  and the marketplace browse cards.

**Verified live**: granted the seeded platform-reviewer account
`listing:read`/`listing:verify` via the reseed. Over the real API,
moved a real listing through `not_verified → submitted → verified` with
a real note attached at each step, confirmed the note persisted on a
fresh re-fetch, and confirmed the listing's own owning account gets a
real 403 calling the same endpoint directly — the panel's own
invisibility to that account isn't the only thing stopping it. Then,
logged into the actual UI as the reviewer account: confirmed it could
now browse the marketplace and open a listing it doesn't own (both were
impossible before this pass, with no `listing:read` at all); used the
real "Platform review" panel to flip the listing to `not_verified` and
back to `verified`, confirming the "✓ verified" badge disappeared and
reappeared on the listing header in sync with each click, and that the
notes textarea was pre-populated with the note set moments earlier over
the API. Switched back to the listing's own owning account and
confirmed the panel doesn't render for it at all.

**Not done — explicit scope, not oversight**:

- No dedicated "pending review" queue endpoint — a reviewer finds a
  listing to review the same way they'd find a vendor or supplier to
  review: browse the public list and open one. A still-`draft` listing
  (never published) isn't visible via the public browse either way, the
  same as it isn't to anyone else — verification realistically applies
  once a listing is live, not before.
- No structured "submit for verification" channel from the listing
  owner's side (the equivalent of `VendorVerificationEvidence`) — a
  reviewer can act at any time, but an owner can't proactively request
  review or attach supporting evidence the way a vendor can.
- No trust-score or audit-trail equivalent — this closes the one-field
  gate `vendor:verify`/`supplier:verify` provide, not the deeper
  audit-history system built specifically for vendors.

## Marketplace propertyType filter (this pass)

Closes the narrower-scope gap the marketplace price/verification-status
filters pass left explicit: "No propertyType filter exposed in the UI,
even though the backend already accepts one." No backend change at
all — `SearchListingsQuery.propertyType` and `ListingsService.findAll`'s
own `property: { propertyType: ... }` where-clause already existed from
before this pass; only the UI never exposed it.

**What's built**:

- A "Property type" dropdown on the marketplace page, listing all 12
  values `CreatePropertyDto` accepts (land, residential_house,
  apartment, short_let, commercial_building, office, shop, warehouse,
  estate, farm, industrial, mixed_use) — same fixed-list-for-a-usable-
  dropdown treatment the vendor service-category filter already uses
  for its own freeform-on-the-backend field.
- Wired into the existing `searchListings` call and the page's
  `hasActiveFilters` check, alongside the pre-existing type/city/price/
  verified/search filters.

**Verified live**: confirmed all 12 options render correctly. Selecting
"residential_house" sent `GET /listings?propertyType=residential_house`
(confirmed via direct network inspection) and returned all 4 seeded
test listings unchanged — genuinely correct, not a no-op, since every
seeded test listing is in fact `residential_house`. To get a real
negative case, selected "land" instead (a type none of the seeded
listings have) and confirmed the browse view correctly narrowed to zero
results with the existing "No active listings match those filters"
empty state — proving the filter genuinely restricts results rather
than silently matching everything.

**Not done — explicit scope, not oversight**:

- ~~No currency-aware or combined price+type faceting beyond what
  already exists~~ — the currency half is closed; see "Currency-scoped
  price filtering on the marketplace" below.

## Vendor marketplace location/rating/verification filters (this pass)

Closes the broader audit finding the maintenance-category pass left
explicitly open: "no location/rating/verification filtering anywhere on
the vendor marketplace itself" — vendor cards already display
`locationCoverage`, `ratingAverage`, and `verificationStatus`, but there
were no server-side query params to filter on any of them.

**What's built**:

- **`GET /vendors`** gained three new optional query params —
  `location`, `minRating`, `verificationStatus` — alongside the
  existing `serviceCategory`/`q`, applied in `VendorsService.findAll`'s
  `where` clause. `location` is a real substring match
  (`contains`/`insensitive`) against the vendor's own freeform
  `locationCoverage` text, since there's no fixed region taxonomy to
  match exactly against (the same reasoning `city` used before it
  became a real column elsewhere); `minRating` is a numeric floor
  (`gte`) against `ratingAverage`; `verificationStatus` is an exact
  match, mirroring the listing side's own verification filter.
- A "Any location" text input, a "★ 4+/3+/2+" rating dropdown, and a
  "Verified only" checkbox on the vendor marketplace page — same shape
  and placement as the marketplace listing page's own price/verified
  filter row, with `flexWrap: "wrap"` added to the filter bar now that
  it holds five inputs.

**Verified live** against the real seeded vendor set (7 vendors: 2×
"Spark Electrical Co" and "Lekki Renovations Co." carrying
`locationCoverage: "Lagos, Nigeria"`, the rest with none;
"Precision Plumbing Co" at ★4.8 and "Lekki Renovations Co." at ★4.0,
the rest unrated; 2 verified, 5 not). Confirmed via direct network
inspection: `?location=Lagos` narrowed 7 vendors to exactly the 3 with
"Lagos, Nigeria" in their coverage text; `?minRating=4` narrowed to
exactly the 2 vendors rated ★4.0 and above; `?verificationStatus=verified`
narrowed to exactly the 2 verified vendors. Each filter cleared
correctly back to the full list.

**Not done — explicit scope, not oversight**:

- No combined "vendors near me" geo-radius search — `location` is a
  freeform substring match against existing text, not coordinate-based.
- No saved filter presets or URL-shareable filter state.

## Project budget vs. real spend tracking (this pass)

Closes an audit finding on the project financial model: `Project.budget`
is a static number set at creation, read only for AI budget-comparison
narration — nothing anywhere ever decremented it against real spend, so
an owner had no way to see how much of a project's budget was actually
gone.

**What's built**:

- **`GET /projects/:id`** now returns `milestonesReleased`,
  `materialsSpent`, and `totalSpent` alongside the existing fields —
  computed live on every read via `ProjectsService.getSpend`, not a
  stored running total this codebase would then have to keep in sync
  across every place money actually moves. Same "compute on read"
  restraint the document checklist and vendor trust score already use
  for exactly this reason.
- Two real spend sources, summed separately so the breakdown means
  something: `Payout.grossAmount` (the milestone's own full payment
  value actually debited from escrow, unaffected by the platform fee
  that only reduces the vendor's take-home) for payouts with
  `status: 'paid'`, and `Order.totalAmount` for every materials order
  tied to the project excluding cancelled ones.
- The project detail page now shows "`X` spent · `Y` remaining" (or
  "`X` over budget" when spend exceeds budget) directly under the
  existing budget figure, with a milestones/materials breakdown
  parenthetical.

**A real bug caught during verification, not by inspection**: the first
version aggregated `Payout.grossAmount` across every status. On the real
"Kitchen Renovation" project, that summed to 906,000 — but only three
payouts were actually `status: 'paid'` (800,000 + 100,000 + 2,000 =
902,000); the other 4,000 came from `processing` and `failed` test
payouts that never actually moved money out of escrow. Confirmed via a
direct read of the real `Payout` rows for that project, then fixed the
aggregation to filter on `status: 'paid'` and re-verified live: the page
now shows 902,000 milestones released, matching the 3 real "Paid"
payouts exactly.

**Verified live** on "Kitchen Renovation" (budget NGN 2,500,000): after
the fix, shows "NGN 1,242,000 spent · NGN 1,258,000 remaining
(NGN 902,000 milestones, NGN 340,000 materials)" — internally
consistent (902,000 + 340,000 = 1,242,000; 2,500,000 − 1,242,000 =
1,258,000) and matching the real underlying `Payout`/`Order` rows for
that project exactly.

**Not done — explicit scope, not oversight**:

- No "over budget" alerting beyond the existing `assess_project_risk`
  AI skill, which already flags "spend released exceeding the project's
  own budget" separately — this pass only makes the same underlying
  numbers visible on the project page itself.
- No currency conversion — `totalSpent` sums `grossAmount`/`totalAmount`
  as raw numbers, assumed to already share the project's own currency
  (true for every real payout/order path in this codebase).
- Not surfaced on the projects list view, only the single-project
  fetch — the list view has no per-project financial detail today
  beyond the budget figure it already showed.

## Currency-scoped price filtering on the marketplace (this pass)

Closes a real correctness gap the marketplace price/verification-status
filters pass named in its own "Not done" list and the audit's own
finding restated since: `minPrice`/`maxPrice` compared `askingPrice` as
a raw number regardless of a listing's own `currency` — a NGN 500,000
listing and a USD 500,000 listing matched the same price search, even
though those are wildly different amounts of money.

**What's built**:

- **`SearchListingsQuery.currency`** (new, optional query param) —
  applied in `ListingsService.findAll`'s `where` clause as an exact,
  case-insensitive match against `PropertyListing.currency`, the same
  shape `city` already uses.
- **The actual fix**: `askingPrice`'s range filter now only applies
  when `currency` is *also* specified. This codebase has no FX-
  conversion infrastructure anywhere, so rather than fake precision
  with a made-up exchange rate, a price range with no currency attached
  is simply not applied — an unfiltered-but-correct result instead of a
  silently wrong one. A direct API caller who omits `currency` gets
  every listing back, not a comparison across incompatible currencies.
- **A "Currency" input on the marketplace filter bar** (freeform text,
  same convention `City` already uses — `currency` has no fixed enum
  anywhere in this schema, just like `city`) plus a muted hint line that
  appears whenever a price bound is set without a currency, explaining
  why the price filter isn't narrowing anything: "listings in different
  currencies aren't comparable as raw numbers."

**Verified live** against the real seeded listings (2 USD: 90,000 and
180,000; 2 NGN: 200,000,000 and 220,000,000). Setting `minPrice=100000,
maxPrice=200000` with no currency left all 4 listings showing (the hint
text rendered, and the network request confirmed via direct inspection
sent the price params but the server correctly did not filter by them);
adding `currency=USD` to that same range narrowed correctly to just the
180,000 USD listing; switching to `currency=NGN, minPrice=210000000,
maxPrice=250000000` narrowed correctly to just the 220,000,000 NGN
listing — excluding both the 200,000,000 NGN listing (below the floor)
and both USD listings (wrong currency) at once.

**Not done — explicit scope, not oversight**:

- No live currency conversion — this closes the "comparing incompatible
  numbers" bug, not "let me search in NGN across a USD listing." A real
  FX-rate integration is a genuinely different, larger feature this
  scaffold doesn't attempt.
- No fixed currency dropdown — freeform text, matching `city`'s own
  shape; a typo (`ngn` vs `NGN`) still matches via the same
  case-insensitive compare `city` already relies on, but a currency
  spelled differently between listings (`USD` vs `US Dollars`) would
  not unify. Not observed in real seeded data, not defended against.

## Owner approval before maintenance work starts (this pass)

Closes the audit's own finding on Workflow 7 (Maintenance Request):
"`MaintenanceRequest.status` has no `approved`/approval-status state at
all, unlike `ProjectMilestone`." Anyone who could start a request could
also approve it, since there was nothing to approve — the "owner
approves" step simply didn't exist.

**What's built**:

- **`MaintenanceRequest.approvalStatus`** (new column, `@default
  ("not_requested")`) — three states, not `ProjectMilestone`'s four: no
  `requested` here, since nothing in this codebase ever actually
  transitions a milestone to `requested` either (its own enum comment
  names it, but only `not_requested -> approved` is ever exercised) —
  no reason to add a state this pass wouldn't use. Also gained
  `approvalNotes` (freeform, same "reviewer's note" shape `verify`-style
  actions elsewhere already carry).
- **`PATCH /properties/:propertyId/maintenance-requests/:requestId/approval`**
  (new route, `PropertiesService.setMaintenanceApproval`) — sets
  `approved` or `rejected` with an optional note, gated on a new
  **`maintenance:approve`** permission. Deliberately its own permission,
  not folded into `maintenance:write`: `tenant` holds `maintenance:write`
  to report its own requests, but must never be able to approve its own
  request — the same self-approval lockout `payment:approve`/
  `vendor:verify` already enforce. Granted to `property_owner`,
  `family_admin`, `company_admin`, and `property_manager`; withheld from
  `tenant` and `facility_manager` (coordinates vendors/work, not
  financial authority — the same split `project_manager` vs.
  `finance_approver` already draws for project money).
- **The actual gate**: `startMaintenanceRequest` now requires
  `approvalStatus === 'approved'` before flipping a request to
  `in_progress` — mirrors `releaseMilestone`'s own `approvalStatus !==
  'approved'` guard exactly. An approval that didn't block anything
  would just be a label; this makes it load-bearing.
- **UI**: an "Approve"/"Reject" action pair on the property page's
  maintenance list, visible only to `maintenance:approve` holders while
  a request is `open`; a "Needs approval before work can start" hint
  replaces the Start button until it's approved. The tenant portal shows
  a read-only "Approved — work can begin" / "Rejected" line once a
  decision lands, since a tenant who reported the issue is notified of
  the outcome either way (new `maintenance_approval` notification type,
  reusing the same lease-linked-tenant delivery path
  `resolveMaintenanceRequest` already established).

**A real, deliberate behavior change, not a bug**: every existing
"open" maintenance request in the real seeded/test data defaulted to
`approvalStatus: 'not_requested'` on migration, so all of them now show
"Needs approval before work can start" until an owner-tier account acts
on them — confirmed live, not just for a fresh request.

**Verified live**: reported a real new request ("Approval gate
verification test leak") on the real "14 Ocean Drive" property —
confirmed it rendered with a "Needs Approval" badge and no Start
button, just the hint text. Clicked "Approve" (confirmed via direct
network inspection: `PATCH .../approval → 200 OK`) and confirmed the
Start button appeared in its place; started it for real (`POST
.../start → 201 Created`), moving it to `in_progress`. Separately
confirmed the backend gate isn't just a hidden button: called `POST
.../start` directly against a different real, still-`not_requested`
request ("Leaking pipe under sink") and got back a real `400` with
"This request must be approved before work can start" — the same
guard, exercised directly, not just observed through the UI that
happens to hide the button.

**Not done — explicit scope, not oversight**:

- No bulk approve/reject across multiple requests — one at a time,
  same granularity every other approval-style action in this codebase
  (milestones, documents, listings) already uses.
- Approval decisions aren't themselves reversible once work has
  started — `setMaintenanceApproval` only applies while `status ===
  "open"`, the same "before it matters" boundary `updateMaintenanceRequest`
  already draws for edits.
- Rejecting a request doesn't auto-cancel it — `approvalStatus` and
  `status` stay orthogonal fields, the same relationship `ProjectMilestone`'s
  `status`/`approvalStatus` already have; an owner who rejects can still
  separately cancel or edit the request if that's what they actually
  want next.

## A real receipt for rent payments (this pass)

Closes the audit's own finding on Workflow 8: "`Receipt` only attaches
to project payments/payouts — `LeaseRentPayment` has no receipt
relation, and no receipt UI appears anywhere in the tenant or owner
lease views." Every other real money-record in this codebase (escrow
deposits, vendor payouts) gets a real receipt; rent, recorded since
Module 13, never did.

**What's built**:

- **`Receipt.leaseRentPaymentId`** (new column, optional and unique —
  same shape `paymentId`/`payoutId` already have; exactly one of the
  three is ever set per receipt) plus the matching back-relation on
  `LeaseRentPayment`.
- **`PropertiesService.recordRentPayment`** now creates a real
  `Receipt` alongside the `LeaseRentPayment` in the same call —
  `accountId` is the property's own owning account (the landlord, the
  party that actually "received" the rent), the same reasoning
  `releaseMilestone`'s own receipt uses the vendor's account rather than
  the project's. Same non-sequential, unique-and-traceable
  `RCT-<year>-<8 hex>` numbering `PaymentsService`'s own `receiptNumber()`
  already uses — duplicated rather than imported, same "duplicate small
  pieces" convention this codebase already follows elsewhere (see the
  maintenance photo-evidence pass's own comment on the same choice).
- **UI**: both the owner's lease view (`properties/[id].tsx`) and the
  tenant portal's own rent-payment history now show each payment's real
  receipt number instead of just an amount, once one exists.

**A deliberately non-retroactive fix, not a bug**: `LeaseRentPayment`
rows recorded before this pass have no receipt — `Receipt` is a new,
optional relation, not backfilled. The UI falls back to showing the
amount for those older rows instead of a missing receipt number.

**Verified live** against the real "14 Ocean Drive" property: recorded
a real rent payment on the "New Auto Tenant" lease (linked to a real
tenant account) and confirmed the API response carried a real receipt
(`RCT-2026-2BFDD1C3`, `leaseRentPaymentId` set, `accountId` matching
the property's own owning account) — reloaded the page and confirmed
that exact receipt number renders on the owner's lease row in place of
an amount. Confirmed the non-retroactive fallback is real, not assumed:
the "Chidi Nwosu" lease's two pre-existing payments still show their
plain amounts (`NGN 450,000` each), not a missing/blank receipt field.
Also confirmed the tenant-facing query (`TenantService.findMyLease`'s
own `include`) returns the same receipt correctly for the linked tenant
account, using the exact query shape that endpoint runs.

**Not done — explicit scope, not oversight**:

- No PDF or downloadable receipt — same lightweight "receipt number +
  type + date + amount" text display the Payments page's own Receipts
  panel already uses for project receipts, not a generated document.
- No backfill for existing rent payments — a real historical gap, left
  as-is rather than fabricating receipts after the fact for money that
  was already recorded without one.

## A real "on hold" indicator for disputed milestones and payments (this pass)

Closes the audit's own finding on Workflow 9: "Payment may be placed
on hold — real enforcement, but implicit; there's no `on_hold` status,
an open dispute just blocks `releaseMilestone`/`refundPayment` as a
side-effect guard, not a first-class hold state." The guard was always
real; there was just nothing telling anyone about it until they clicked
"Release funds" and got a 400.

**What's built**:

- **`ProjectsService.getOnHoldMilestoneIds`** and the equivalent inline
  in **`PaymentsService.findPayments`** — each computes `onHold` live
  from the exact same `dispute.findMany({ status: { in: ['open',
  'under_review'] } })` query `releaseMilestone`/`refundPayment`
  themselves already run to decide whether to reject the request. Not a
  stored status this codebase would then have to keep in sync with
  every place a dispute opens or resolves — same "compute on read"
  restraint `getSpend` already uses for project budget tracking.
- **`GET /projects/:id`** now returns `onHold` on each milestone;
  **`GET /projects/:projectId/payments`** now returns it on each
  payment.
- **UI**: a red "⚠ on hold" badge plus an explanatory line on any
  milestone with an open dispute against it, and the "Release funds"
  button is hidden entirely rather than left clickable-but-doomed to
  fail — the same "hide the action, show why" treatment the maintenance
  approval gate already uses. "Approve" stays available regardless: it
  only marks evidence reviewed, which `approveMilestone` never actually
  gated on disputes in the first place, so hiding it would have claimed
  a restriction that doesn't exist.

**Verified live** on the real "Kitchen Renovation" project. Confirmed
baseline: the "Platform fee test milestone" (pending, already
approved) showed a normal "Release funds" button. Raised a real dispute
against it (`POST /projects/:id/disputes`, `201`) and confirmed on
reload: the milestone now shows "⚠ On Hold" and the hint text in place
of "Release funds", while the two other pending milestones on the same
project ("Paystack payout test", "PayPal payout test") were correctly
unaffected. Did the same for a real payment — raised a dispute against
one of nine real payments on the project and confirmed via direct API
inspection that only that one payment's `onHold` flipped to `true`,
the other eight stayed `false` — then confirmed `POST .../refund`
against it returned the same real `400` ("This payment has an open
dispute — resolve it before refunding") the guard always gave, now
visible ahead of time instead of only after a failed attempt. Both
test disputes were left in place as real data, the same way earlier
passes this session left their own verification artifacts (the
approved maintenance request, the recorded rent payment) rather than
cleaning up after themselves.

**Not done — explicit scope, not oversight**:

- No refund UI exists anywhere in the frontend to gate in the first
  place — `Payment.onHold` is real and correct, but there's nothing on
  the project page that calls `refundPayment` today. The computed field
  is there for whenever that UI gets built, not decorative.
- No `on_hold` value added to `Dispute.status` or `Payment.status`
  itself — `onHold` stays a computed, derived signal, not a first-class
  stored state, on purpose (see "What's built" above).
- Payouts aren't covered — `Payout.payoutId` disputes exist in the
  schema, but nothing in `PaymentsService` actually guards a payout
  action on them (unlike milestones/payments), so there's no real
  enforcement yet to surface a hold indicator for.

## Buyer-initiated inspection requests (this pass)

Closes the audit's own finding on Workflow 2: "`PropertyInspection` is
real but every route is ABAC-scoped to the property's own owning
account — there is no buyer-initiated 'request an inspection on this
listing' endpoint anywhere." A buyer browsing the marketplace had no
way to ask to see a property before making an offer on it.

**What's built**:

- **`PropertyInspection.status`** gained a `requested` state (alongside
  the existing `scheduled | completed | cancelled`) and a new
  `requestedByAccountId` — a soft reference, not a formal relation,
  same as `ListingOffer.accountId` ("the buyer's account — soft
  reference") for the identical reason: a cross-account buyer action on
  someone else's property.
- **`POST /listings/:listingId/inspection-requests`** (new,
  `ListingsService.requestInspection`) — reuses `offer:write`, the same
  permission a buyer already holds to act on a listing, rather than a
  new dedicated permission: requesting an inspection is the same kind
  of pre-purchase buyer action as making an offer, with no
  self-request conflict a dedicated permission would need to guard
  against. Resolves the listing's own `propertyId`, creates the
  inspection as `requested`, and notifies the listing's owning account.
- **`POST /properties/:propertyId/inspections/:inspectionId/confirm`**
  (new) — the owner's real sign-off step: a requested inspection can't
  be edited or completed until it flips to `scheduled` here first
  (`updateInspection`/`completeInspection` both still gate on
  `status === 'scheduled'`, confirmed unchanged — a direct `complete`
  attempt against a still-`requested` inspection returns a real `400`).
  Declining reuses the existing `cancelInspection` action rather than a
  separate route — a requested inspection nobody confirms is
  functionally the same "no" a cancelled scheduled one already means.
- **`GET /listings/me/inspection-requests`** (new,
  `ListingsService.myInspectionRequests`) — the buyer's own view of
  every request it's made, same shape `myOffers` already gives for
  offers, since a buyer isn't a member of the property's own account
  and can't reach it any other way.
- **UI**: a "Request an inspection" form on the marketplace listing
  page (alongside the existing offer/inquiry forms), a "Requested by a
  buyer" note plus real Confirm/Decline actions on the property page's
  own inspection list, and a new "Inspection requests you've made"
  section on the buyer's "My listings & offers" page.

**Verified live** end to end across two genuinely different accounts —
not the same account switching context, a real buyer account and a
real, independently-owned property account ("Comparable House A",
owned by a distinct `property_owner`). Requested an inspection as the
buyer (`POST .../inspection-requests → 201`), confirmed the real
in-app notification landed on the owner's account
(`type: 'inspection_requested'`, correct title/body/link), and
confirmed `GET /listings/me/inspection-requests` returned it with the
property joined in. Logged into the actual owner account and confirmed
the property's own `GET .../inspections` listed the real request; tried
completing it before confirming and got a real `400` ("This inspection
is already 'requested'"); confirmed it and watched `status` flip to
`scheduled`. Raised a second request and confirmed Decline (the reused
`cancelInspection`) correctly flipped it to `cancelled` instead.

**Not done — explicit scope, not oversight**:

- No way for the buyer to propose a specific time slot beyond a single
  preferred date, and no counter-proposal from the owner — the owner
  confirms the date as given or declines; rescheduling still goes
  through the existing `updateInspection` edit form once confirmed.
- No inspection-request-specific notification for the buyer when
  declined — the buyer finds out by checking "My listings & offers"
  (`GET /listings/me/inspection-requests`), same as how an offer's own
  status is checked today rather than pushed.

## A structured resolution type for disputes (this pass)

Closes the audit's own finding on Workflow 9: "'proposing a resolution'
is just a status flip + free-text note, no structured proposal object."
A resolved dispute recorded whatever words happened to end up in
`resolutionNotes` — nothing said, in a queryable way, whether the
outcome was a refund, a release, rework, or nothing at all.

**What's built**:

- **`Dispute.resolutionType`** (new, optional column) — `refund |
  release | rework | no_action | other`, shared as `RESOLUTION_TYPES`
  in both `ResolveDisputeDto`/`ArbitrateDisputeDto` (backend) and
  `lib/api.ts` (frontend, same centralizing reasoning `DISPUTE_TYPES`
  already documents there — a fixed vocabulary reused across every
  dispute-resolving form, not duplicated per form). Deliberately
  doesn't move money or trigger anything itself — refund/release/
  rework still happen through their own separate, pre-existing actions
  once the dispute's own guard clears; this only records what the
  resolution actually decided.
- **All four real dispute-resolving surfaces** gained the same
  "Resolution type" dropdown and display: the platform reviewer's
  arbitration queue (`payments/index.tsx`), the project owner's
  two-party resolve (`projects/[id].tsx`), the vendor-side resolve
  (`vendors/me.tsx`), and the order two-party resolve
  (`marketplace/materials/orders/[id].tsx`) — all four call into one of
  two shared service methods (`applyDisputeResolution`/
  `arbitrateDispute`), so the one backend change reaches every caller.

**Verified live** against real disputes on the real "Kitchen
Renovation" project, across both backend code paths independently:
arbitrated a real open dispute ("Countertop color doesn't match what
was approved") as the platform reviewer with `resolutionType: 'rework'`
(`PATCH .../arbitrate → 200`, confirmed persisted, confirmed it
dropped out of the open-disputes queue, confirmed "Resolution: rework"
rendered on the project page). Separately raised a fresh dispute and
resolved it through the *other* code path — as the assigned vendor,
via `resolveDisputeAsVendor` — with `resolutionType: 'no_action'`,
confirming the shared `applyDisputeResolution` method persists it
identically regardless of which of its three callers (project,
vendor, or order two-party resolve) is used.

**Not done — explicit scope, not oversight**:

- Doesn't itself execute anything — choosing "refund" doesn't trigger
  `refundPayment`, choosing "release" doesn't trigger `releaseMilestone`.
  Wiring a resolution type to automatically fire its own action would
  remove the deliberate human-in-the-loop step every money-moving
  action in this codebase already requires elsewhere.
- "Rework" still has no tracking mechanism of its own beyond this label
  — ~~no re-inspection trigger~~ (a real, manually-invoked one exists
  now, see "A real re-inspection trigger for 'rework' disputes"
  below), no rework-specific milestone. Recording that rework was the
  decision is real progress on the audit's own finding; a full rework
  workflow closing the loop back onto the milestone itself is a
  separate, larger feature.

## Ownership structure — a real create/edit UI for co-owner shares (this pass)

Closes the audit's own finding on Workflow 1: "`PropertyOwner` (%-split
multi-owner) exists in the schema but is completely inert — no create/
edit endpoint anywhere, and `properties/[id].tsx` never renders
`property.owners` even though it's fetched. Only ever written as a
side-effect of accepting a development agreement." The model has
existed since Module 1; this is the first time anything other than
`DevelopmentAgreementsService.applyAccept` ever wrote to it, and the
first time the frontend ever read it back.

**What's built**:

- **`POST/PATCH/DELETE /properties/:propertyId/owners`** (new,
  `property:write` — same permission the property record and its access
  grants already sit behind). A `PropertyOwner` row represents a stake
  carved *out of* the property's own primary account, not a replacement
  for it — the primary account implicitly holds whatever isn't
  explicitly split off, the same shape a `temporary_ownership`
  development agreement's own developer stake already uses.
- **A real 100%-ceiling validation** — the one thing that makes this a
  functioning ownership ledger rather than a free-text list: adding or
  raising a share is rejected if the sum of every currently-active
  co-owner share (no `endDate`, or one still in the future) would
  exceed 100%. Computed live on every write, not a stored running
  total — same "compute on read" restraint `ProjectsService.getSpend`
  already uses for project budget tracking.
- **`ownerType: 'user'` is restricted to a real member of the
  property's own owning account** — "which family member holds this %
  stake," not an arbitrary user anywhere on the platform.
  `ownerType: 'account'` has no such restriction, matching the
  development-agreement precedent where the co-owner is a genuinely
  different account.
- **`ownerName` resolved server-side** (`PropertiesService.
  withOwnerNames`) — `ownerAccountId`/`ownerUserId` are soft references
  (no Prisma relation, same convention `ListingOffer.accountId`'s own
  schema comment documents), so a plain `include` can't join them; the
  frontend would otherwise have nothing but a bare id to show.
- **UI**: a real "Ownership structure" card on the property page —
  add a co-owner (a dropdown of the account's own members, or a raw
  account id for a genuinely different account), see every owner's
  resolved name/percentage/dates, "End stake" (sets `endDate` to now)
  or "Remove" (a hard delete, for correcting a mistaken entry — a
  different real action from a stake genuinely ending on a real date).

**Verified live** on the real "14 Ocean Drive" property, which already
had one real `PropertyOwner` row from an earlier, unrelated pass's
accepted `temporary_ownership` development agreement ("Dev Test
Developer Co," 20%) — confirmed it now renders with its real resolved
account name where the page previously showed nothing at all. Added a
real 30% stake for a real account member ("Third User") and confirmed
it rendered correctly; confirmed the 100% ceiling genuinely rejects an
over-allocation (`POST` with a further 51% returned a real 400 quoting
the exact resulting total, 101%); confirmed the "must be a member of
this account" guard rejects an unrelated user id. Ended the 30% stake
(`PATCH` with `endDate`) and confirmed a *new* 75% stake was then
accepted — proving an ended stake genuinely stops counting toward the
100% ceiling, not just cosmetically. Removed that verification-only
stake afterward; the real "Dev Test Developer Co" (active) and "Third
User" (ended) rows were left as real evidence, the same convention
earlier passes this session already established.

**Not done — explicit scope, not oversight**:

- No UI to edit an existing owner's percentage directly — only adding,
  ending, and removing. The backend (`PATCH .../owners/:ownerId`)
  already accepts `ownershipPercentage`; only the form is missing.
- No picker for `ownerType: 'account'` — a raw account id text field,
  since there's no "search accounts" feature anywhere else in this
  codebase either (development agreements use an email-based invite,
  not an account picker).
- No UI surfacing of the *implicit* remaining share held by the
  property's own primary account (e.g. "60% unaccounted for") — only
  the explicitly recorded co-owner rows are shown.

## A real, visible rent schedule (this pass)

Closes the audit's own finding on Workflow 8: "No `RentSchedule` model
— just `rentFrequency` + `startDate`, with due dates derived on the fly
wherever overdue-checking happens to run." The math already existed
and was already trusted for real reminders (`InAppNotificationsService.
checkLeaseReminders`); it just never surfaced anywhere a person could
actually look ahead and see it.

**What's built**:

- **`computeUpcomingRentDueDates`** (new shared util,
  `apps/api/src/common/rent-schedule.util.ts`) — the exact same
  anchor-date math the real reminder cron already runs (last recorded
  payment's `periodEnd`, or `startDate` if none yet, plus
  `rentFrequency`'s own day-count), projected forward instead of only
  ever checked against "now." Stops early at the lease's own `endDate`
  if one exists, so a fixed-term lease never projects a due date past
  its own end.
- **`GET /properties/:propertyId/leases`** (and the single-lease
  fetch) and **`GET /tenant/lease`** now return `upcomingDueDates` on
  every active lease — computed live on read, not a stored schedule
  this codebase would then have to keep in sync every time a payment is
  recorded or a lease is edited, same restraint `getSpend`/
  `getActiveOwnershipTotal` already use elsewhere this session.
- **UI**: both the owner's lease view and the tenant's own portal show
  the projected due dates — the tenant portal gets its own "Upcoming
  rent due dates" card (its "next due" date is the single most
  actionable thing on that page), the owner's view shows the same list
  inline per lease.

**Verified live** against all six real active leases on "14 Ocean
Drive," each a genuinely different real case: "New Auto Tenant" (one
real recorded payment, `01/09–30/09/2026`) correctly projected its
first upcoming date as `30/10/2026` — exactly 30 days after the real
payment's own `periodEnd`, not just its `startDate`. The two real
"Reminder Verification Tenant" leases (fixed-term, `03/08–02/10/2026`,
no payments recorded) correctly projected only 2 dates
(`02/09/2026, 02/10/2026`) instead of the requested 6 — confirming the
end-date truncation is real, not cosmetic. "Demo Tenant" (annually)
correctly projected dates roughly 365 days apart. Confirmed the
tenant-facing `GET /tenant/lease` returns the identical computed dates
for that same "Demo Tenant" lease via its own account.

**Not done — explicit scope, not oversight**:

- No `RentSchedule` model, by design — a stored schedule would need to
  be regenerated every time a payment posts or a lease is edited; a
  live projection off the same trusted anchor math can't drift out of
  sync with reality the way a stored one eventually would.
- Not calendar-precise — `rentFrequency`'s own day-count
  (30 for monthly, 365 for annually) is the same approximation the real
  reminder cron already accepts; a due date can drift a day or two
  across months of different lengths, unchanged from before this pass.
- No "upcoming due date" push notification — only the existing
  overdue/lease-ending-soon reminders push proactively; a forward
  schedule with nothing yet actually due doesn't need one.

## A real spend-approval gate on materials orders (this pass)

Closes half of the audit's own finding on Workflow 6: "`Order`/
`Payment` are entirely disconnected — no gateway call, no charge on
order creation, and no spend-approval routing mechanism at all." A
real payment gateway charge on order creation is a separate, larger
feature (this scaffold's own restraint on "real payment provider"
scope, same boundary `Payment`/`LeaseRentPayment` already draw
elsewhere); the spend-approval routing half is real, contained, and
now built.

**What's built**:

- **`Order.approvalStatus`** (new, `not_requested | approved |
  rejected` — same three-state shape `MaintenanceRequest.
  approvalStatus` already uses) plus `approvalNotes`.
- **The actual gate**: `MaterialsService.updateOrderStatus` now
  refuses to move an order from `pending` to `confirmed` unless
  `approvalStatus === 'approved'` — mirrors
  `PropertiesService.startMaintenanceRequest`'s own guard exactly. A
  supplier can still cancel a still-unapproved order; only the
  "proceed with fulfillment" transition is gated.
- **`PATCH /orders/:orderId/approval`** (new) — gated on
  `payment:approve`, the same permission that already authorizes
  releasing a project's own escrow funds, reused rather than a new
  permission: both are "does this account's own spend authority sign
  off on this," just for a materials order instead of a milestone. Only
  applies while `status === 'pending'` — once a supplier has acted, a
  late approval/rejection wouldn't mean anything real.
- **UI**: a "needs approval" badge and real Approve/Reject buttons on
  the buyer's own order page while pending; the supplier's own "Mark
  confirmed" action is hidden (not just disabled) until approved, with
  a hint explaining why — same "hide the action, show why" treatment
  the maintenance-approval gate already uses.

**Verified live** end to end. Created a real order (`POST /orders →
201`, `Modern Kitchen Cabinet Set` from "Lagos BuildMart", NGN 380,000)
and confirmed attempting to mark it confirmed as the supplier
immediately failed with a real `400` ("This order must be approved by
the buyer before it can be confirmed"). Approved it as the buyer
(`PATCH .../approval → 200`) and confirmed the identical confirm
attempt then succeeded (`200`, `status: confirmed`). Confirmed
approval is genuinely locked to `pending` — attempting to reject the
now-confirmed order returned a real `400` ("already 'confirmed' —
approval only applies before the supplier acts on it"). Created a
second real order and confirmed the buyer's own order page renders
the real "Needs Approval" badge with working Approve/Reject buttons
while pending; confirmed the already-confirmed first order correctly
shows neither, since both only apply while `status === 'pending'`.
Both real orders left in place — one showing the full happy path
through to `confirmed`, the other still `pending` showing the gate
itself.

**Not done — explicit scope, not oversight**:

- No real payment gateway charge on order creation — `Order`/`Payment`
  stay disconnected, same as before this pass. This closes the
  approval-routing half of the audit's own finding, not the
  charge-on-creation half.
- No spend threshold — every order requires approval unconditionally,
  same "no configurable threshold with nothing else in this codebase
  to back it" restraint the maintenance-approval gate already applies.
- Today's real role grants mean the same owner-tier account usually
  both creates and approves its own orders (`order:write` and
  `payment:approve` are both only ever granted to `property_owner`/
  `family_admin`/`company_admin`/`finance_approver` — no role holds
  `order:write` without also being able to satisfy this gate itself).
  Real, still-meaningful process discipline either way — the same
  reasoning milestone approval already applies, where the same account
  can hold both `milestone:write` and `payment:approve` too — and it's
  already correctly positioned for if a future pass extends
  `order:write` to a role like `project_manager` that doesn't hold
  `payment:approve`.

## A real inspection gate on project handover (this pass)

Closes the audit's own finding on Workflows 3 & 4: "`PropertyInspection.
projectId` links the two, but nothing wires an inspection's result to
gate or advance a stage — they're independently updated, no automatic
connection" / "'Handover' is just one more seeded stage name — no
distinct sign-off/final-inspection logic beyond the generic
stage-completion mechanism." Scoped to the one stage a final inspection
actually belongs to, not an invented "every stage needs an inspection"
rule this blueprint never asked for.

**What's built**:

- **`ProjectsService.updateStage`** now refuses to mark the "Handover"
  stage `completed` unless the project has a real, completed
  `PropertyInspection` with `overallResult: 'pass'` tied to it
  (`PropertyInspection.projectId`). Every other stage transition, and
  every other status on Handover itself, is unchanged — this is one
  targeted check, not a general rewrite of stage-completion rules.
- **UI**: the project page now fetches the property's own inspections
  and shows a real proactive hint under the Handover selector — "Needs
  a completed inspection with a 'pass' result first" — before the user
  ever hits the error, the same "hide/explain the gate, don't just let
  it fail" treatment the maintenance-approval and order-approval gates
  already use.

**A real bug caught during verification, not by inspection**: the
first version of the frontend hint checked `inspections.some(i =>
i.status === 'completed' && i.overallResult === 'pass')` without
filtering by `i.projectId` — since `listInspections` returns every
inspection on the *property*, not just the one project, a passing
inspection from a completely different project on the same property
(discovered live: "Kitchen Renovation" and "ABAC verification project"
share "14 Ocean Drive") silently satisfied the hint for a project that
had no qualifying inspection of its own. The real backend gate was
never wrong — it already filtered by `projectId` correctly — only the
proactive UI hint was. Fixed to check `i.projectId === project.id` and
re-verified live.

**Verified live** against real, pre-existing data on "Kitchen
Renovation": its one real inspection had `overallResult: 'needs_attention'`,
and attempting to mark Handover complete correctly failed with a real
`400` naming the exact requirement. Confirmed a different stage
("Materials") completes with no gate at all — no regression on the
other four stages. Created a real inspection tied to the project,
completed it with `overallResult: 'pass'`, and confirmed Handover then
completed successfully (`200`). Confirmed the proactive hint renders
on "ABAC verification project" (real project, zero inspections of its
own, same property as Kitchen Renovation) — the exact case that caught
the property-vs-project scoping bug above.

**Not done — explicit scope, not oversight**:

- No gate on any other stage — Scope/Quote/Materials/Work all complete
  freely, matching the audit's own narrower Handover-specific finding
  rather than the broader "gate every stage" reading.
- The qualifying inspection can be *any* passing inspection ever
  completed on the project, not necessarily a recent one or one
  explicitly typed `post_renovation` — no "must be the last inspection
  before handover" staleness check. A real, simple existence check, not
  a chronology-aware one.
- Development-workflow-specific inspection gating (Workflow 4's own
  "Inspections approve stages" framing, beyond Handover) isn't built —
  this closes the concrete, actionable half both workflows agree on.

## Compare products side by side (this pass)

Closes the audit's own finding on Workflow 6: "No compare-suppliers UI
or endpoint — the product grid shows one supplier per card, no
side-by-side view."

**What's built**:

- **`GET /products/compare?ids=a,b,c`** (new, `product:read` — the
  same permission product browsing already uses) — resolves each
  product's real supplier and computes its real `trustScore` the same
  way `GET /suppliers/:id` already does (`getSupplierTrustScore`,
  shared, not reimplemented), not just the raw `ratingAverage`/
  `verificationStatus` the grid card already shows. Re-sorted back into
  the order the caller asked for, since `id IN (...)` doesn't preserve
  it — same reasoning `ListingsService.findAll`'s own relevance re-sort
  already documents.
- **UI**: a "Compare" checkbox on every product card (capped at 4 at
  once), a sticky selection bar with Clear/Compare actions, and a new
  comparison page (`/marketplace/materials/compare?ids=...`) rendering
  price, stock, supplier, location, verification, rating, trust score,
  and delivered/cancelled order counts as real side-by-side rows.

**Verified live** with a genuinely meaningful real-world result, not
just a mechanically-checked one. Only one real supplier existed in the
seeded data ("Lagos BuildMart"), so created a second real one end to
end through the actual API — registered a new user, created a
`SUPPLIER` account ("Abuja Hardware Co"), a real supplier profile
(`not_verified`, no rating), and a real competing tile product
(`NGN 7,200/sqm` vs. Lagos BuildMart's `NGN 8,500/sqm`). Comparing the
two real tiles surfaced something the plain product grid genuinely
doesn't: Lagos BuildMart looks strictly better on the raw fields
(`verified`, ★5.0) but its real computed trust score is only `59/100
"fair"` — a real `SupplierTrustAudit` on file rated `major_concerns` —
while the unverified, unrated Abuja Hardware Co scores `50/100 "fair"`,
genuinely close despite looking worse at a glance. Confirmed this exact
comparison renders correctly on the real comparison page, and
separately confirmed the grid page's own selection flow end to end:
checked two real product cards, watched the sticky bar correctly read
"2 products selected," and confirmed its "Compare" link carried the
exact two selected product ids through to the comparison URL.

**Not done — explicit scope, not oversight**:

- Capped at 4 products per comparison — an arbitrary but real UX
  bound, not enforced by the backend endpoint itself (which accepts any
  number of ids), only by the grid page's own selection UI.
- No cross-category guard — comparing a tile against a concrete mixer
  is allowed and renders (the grid's own free-text category filter
  already lets a buyer narrow to comparable items first, same as
  before this pass).
- No saved/shareable comparison beyond the URL's own `?ids=` query
  string — reloading or sharing the link reproduces the same
  comparison, but there's no named "saved comparison" feature.

## A real quote mechanism for maintenance tickets (this pass)

Closes the audit's own finding on Workflow 7: "Quote is submitted —
`VendorQuote` ties only to `Project`, never to a `MaintenanceRequest` —
no quote mechanism for a maintenance ticket exists." Before this pass,
a vendor assigned to a maintenance request had no way to tell the owner
what the job would cost before work started — only `cost`, a field set
alongside `resolutionNotes` at *resolution* time, after the fact.

**Deliberately not a `VendorQuote` row.** A project's quotes are
several vendors competing for one job before any is picked, which is
why `VendorQuote` exists as its own comparable-rows model. A
maintenance ticket already has exactly one assigned vendor
(`assignedVendorId`, chosen from the category-filtered picker an
earlier pass built) before a quote is ever relevant — there's nothing
to compare. So this is four flat fields on `MaintenanceRequest` itself
— `quotedAmount`/`quotedCurrency`/`quotedNotes`/`quotedAt` — a single
number the assigned vendor can set and revise, not a list. Same
"don't force a shape the data doesn't need" reasoning `Order.
approvalStatus` and `MaintenanceRequest.approvalStatus` already used
rather than inventing a heavier mechanism for a lightweight ticket.

**What's built**:

- `MaintenanceRequest.quotedAmount`/`quotedCurrency`/`quotedNotes`/
  `quotedAt` (migration `20260914010000_add_maintenance_quote`), all
  nullable — a request nobody's quoted on yet just has nulls.
- `POST /vendors/me/maintenance-quotes` (`VendorsService.
  submitMaintenanceQuote`) — vendor-initiated, deliberately not
  `/properties/:propertyId/...` so it never hits PermissionsGuard's
  `:propertyId` ABAC check, the exact same reasoning `submitQuote`'s
  own comment already gives for the project-quote route. Checked in
  order: the account has a vendor profile at all; that vendor is the
  request's own `assignedVendorId` (not just any vendor); the request
  is still `open`/`in_progress` (no quoting a resolved or cancelled
  ticket). Upserts on the request itself — re-quoting overwrites the
  last figure, same as `submitQuote`'s own upsert-by-`(projectId,
  vendorId)` behavior.
- A real discoverability fix bundled with it, not scope creep: before
  this pass a vendor assigned to a maintenance request had *no way to
  find it* — every maintenance route lived under
  `PropertiesController` (`:propertyId`-scoped, ABAC-blocked for a
  non-owning account), the exact same gap an earlier pass already
  fixed for projects via `GET /vendors/me/projects`. `GET /vendors/
  me/maintenance-requests` (`VendorsService.myMaintenanceRequests`) is
  the maintenance-side twin — without it, the quote endpoint above
  would've been unreachable in practice.
- `maintenance:read` granted to the `vendor` role (seed.ts) — new,
  since a vendor previously had zero maintenance permissions at all.
  Reached only through the two `:propertyId`-free "me" routes above,
  never `maintenance:write`/`maintenance:approve` (start/resolve/
  approve stay the owner/manager's own actions, unchanged).
  `POST /vendors/me/maintenance-quotes` itself reuses `quote:write` —
  the same permission `me/quotes` already checks, since this is a
  quote, just on a different resource, not a new capability.
- `vendors/me.tsx` — a new "Maintenance requests assigned to you"
  section, mirroring "Your projects" exactly: the assigned request's
  title, property, and status, with a quote form (amount + optional
  notes) that becomes "revise your quote" once one's on file.
- `properties/[id].tsx` — the owner's own maintenance request row now
  shows "Vendor's quote: ⟨amount⟩ — ⟨notes⟩" whenever one exists,
  surfaced right above the approval status so an owner sees the
  proposed cost before approving, not just after.

**Verified live** against the real seeded "Test vendor-assigned issue"
maintenance request (assigned to the real "Lekki Renovations Co."
vendor, both under the demo account). Submitted a real quote as that
vendor — `NGN 45,000`, "Replace the corroded fitting and re-test the
line — half-day job." — confirmed it round-tripped through
`GET /vendors/me/maintenance-requests` and rendered correctly on the
vendor dashboard, then confirmed the owner's own
`GET /properties/:id/maintenance-requests` returns the identical
`quotedAmount`/`quotedNotes` for the same request. Separately verified
the ownership guard for real: attempted to submit a quote as this same
vendor against a *different* maintenance request assigned to a
different vendor ("Precision Plumbing Ltd," on "Leaking pipe under
kitchen sink") and got a real 400 — `"This maintenance request is not
assigned to you"` — not a silent overwrite.

**Not done — explicit scope, not oversight**:

- No notification when a quote is submitted — the owner sees it the
  same way they see category/approval status, by visiting the
  property page. `Module 19's` own "maintenance updates" trigger only
  fires on resolution (see `resolveMaintenanceRequest`'s own comment:
  "the one status change the reporting side actually needs to hear
  about") — adding a second trigger here would be a new, separate
  decision, not part of closing this gap.
- Quoting isn't a gate on approval — an owner can still approve a
  maintenance request with no quote on file, same as before this
  pass. The audit's own Workflow 7 lists "Quote is submitted" and
  "Owner approves" as two separate steps; this only builds the first.
- No currency default beyond `'USD'` when the vendor omits one — same
  restraint `SubmitQuoteDto`'s own project-quote counterpart already
  takes, not a new gap this feature introduces.

## A real property-status transition on construction completion (this pass)

Closes the audit's own finding on Workflow 4: "Property status: land ->
completed building — No such lifecycle state exists — `propertyType`
is a flat category list (land, residential_house, ...), not a state
machine, and nothing ever mutates it on project completion. The only
edit form doesn't even expose the field."

**The backend was never actually the gap.** `UpdatePropertyDto` has
accepted `propertyType` since Module 3 — `PropertiesService.
updateProperty`'s own `data: { ...dto, ... }` spread already persisted
it. The audit's own two complaints were both real, both frontend: no
edit-form control existed for it, and nothing ever offered to change
it at the one moment that actually matters.

**What's built**:

- `properties/[id].tsx`'s own "Property details" edit form — the same
  form this pass's companion Key Workflows audit already covers for
  bedrooms/bathrooms/amenities/photos — gained a real "Property type"
  dropdown (all 12 real `PROPERTY_TYPES` values, mirroring
  `CreatePropertyDto`'s own list), first field in the form, wired
  straight into the existing `updateProperty` call.
- `projects/[id].tsx` — a new "Construction complete?" card, rendered
  only when every real precondition this codebase already tracks is
  true: the project is `projectType: "new_build"`, its own property is
  still `propertyType: "land"`, and the project's real Handover stage
  — gated on a genuine passing inspection since an earlier pass — is
  `completed`. Picking a building type and confirming calls the same
  `updateProperty` endpoint the edit form above uses; the card itself
  disappears once the property is no longer `land`, since its own
  render condition is no longer true.
- Deliberately not a new lifecycle state machine — `propertyType`
  stays the same flat category list it always was. This is a real
  trigger wired to a real moment, not a new state model the codebase
  didn't ask for.

**Verified live**, real data throughout: created a real `land`
property ("Epe Development Plot") and a real `new_build` project on
it through the actual API, scheduled and completed a real
`PropertyInspection` on that project with `overallResult: "pass"`,
then confirmed the Handover stage transition to `completed` — blocked
before that inspection existed, allowed once it did (an earlier
pass's own gate, exercised for real here). The "Construction
complete?" card appeared on the real project page as designed;
selected "Residential house," clicked "Mark construction complete,"
and confirmed a real `PATCH /properties/:id` fired and the property's
`propertyType` actually changed — the card itself then correctly
disappeared on reload, since the property was no longer `land`.
Separately verified the edit-form half on the real, long-lived "14
Ocean Drive" demo property: changed its type to "Apartment" through
the new dropdown, confirmed the header's own "Type" field updated to
match, then changed it back to "Residential House" to leave the demo
data as found.

**Not done — explicit scope, not oversight**:

- No automatic transition — an owner has to actively pick the
  building type and confirm; nothing infers it from the project's own
  scope description or AI-drafted content. A wrong guess written
  automatically would be worse than a real person confirming what was
  actually built.
- Only offered for `new_build` projects on `land` properties — a
  `renovation` project reaching Handover never shows this card, since
  the property's own type was never in question to begin with.
- No history of the transition — the property's own `updatedAt`
  changes, but nothing records "this used to be land" anywhere a user
  can see later. Same restraint most single-field edits on this record
  already accept.

## A real re-inspection trigger for "rework" disputes (this pass)

Closes the audit's own finding on Workflow 9: "Refund, rework, or
payment release is processed — Resolving a dispute never itself moves
money — refund/release are separate, manually-invoked endpoints once
the guard clears. 'Rework' has no mechanism at all." `resolutionType`
(an earlier pass) gave "rework" a real, structured label; nothing
happened once it was set.

**Deliberately not automatic.** `Dispute.resolutionType`'s own schema
comment already commits to this: "Doesn't itself move money or trigger
rework — the actual refund/release/rework action still happens through
its own existing, separate endpoint once the dispute's own guard
clears... this just records what the resolution actually decided." A
"rework" resolution firing something automatically the instant it's
set would break that already-documented human-in-the-loop discipline —
the same one refund and release already follow. So this is that
missing action's real counterpart: a genuine, separate, manually
invoked endpoint, not a side effect.

**What's built**:

- `POST /projects/:projectId/disputes/:disputeId/schedule-rework-
  inspection` (`PaymentsService.scheduleReworkInspection`) — gated on
  `inspection:write`, the exact permission `PropertiesService.
  scheduleInspection` already checks, since this creates the same kind
  of row. Guarded on the dispute actually being `resolved` with
  `resolutionType: "rework"` — a real 400 otherwise, verified against a
  real dispute resolved `no_action` on the same project.
- Creates a real `PropertyInspection` (`inspectionType: "post_
  renovation"`, `scheduledFor` now, tied to the project and its
  property) — the same model an earlier pass's Handover gate already
  made load-bearing, not a decorative record.
- `projects/[id].tsx` — a "Schedule rework inspection" button appears
  on any dispute resolved with `resolutionType: "rework"`, gated on
  `inspection:write` client-side too so it never renders for a role
  that would 403 on it. Becomes "Re-verification inspection scheduled"
  once clicked.

**Verified live** against a real, pre-existing dispute on the real
"Kitchen Renovation" project — "Countertop color doesn't match what
was approved," already resolved `rework` from an earlier pass's own
verification. Clicked the real button on the real project page;
confirmed a real `POST` fired and returned `201`, and the button
correctly swapped to its confirmation text. Separately confirmed the
guard for real: called the same endpoint against a different real
dispute on the same project resolved `no_action` instead, and got a
real 400 — `"This dispute was not resolved with \"rework\" — nothing
to schedule"`.

**Not done — explicit scope, not oversight**:

- No re-inspection ↔ dispute link — the created `PropertyInspection`
  has no field pointing back to the dispute that triggered it, so
  there's no way to later ask "which inspection was this rework's
  own re-check?" beyond matching timestamps by eye. Adding that link
  would mean widening `PropertyInspection`'s own schema for a single
  caller, not something this pass's narrower scope called for.
- No "rework completed" state — once the real re-inspection is itself
  completed (an earlier pass's own real action), nothing closes the
  loop back to the dispute or the milestone. The audit's own two named
  gaps were "no re-inspection trigger" and "no rework-specific
  milestone" — this closes the first; the second, a real trigger back
  onto `ProjectMilestone`, is a separate, larger feature.
- Clicking it twice schedules two real inspections — no dedup guard.
  Harmless, and no existing action-button pattern in this codebase
  (e.g. "+ Request quote") guards against a duplicate click either.

## Architect and engineer vendor categories (this pass)

Closes the audit's own finding on Workflow 4: "No architect/engineer
role, permission, or vendor category anywhere. The fixed service-
category dropdown has no such option — hiring one would silently
reuse the generic contractor flow."

**Deliberately the smallest fix that closes the actual gap.** The
audit's own two sentences describe two different things: the missing
*category* (a real, named bug — the dropdown genuinely had no such
option) and hiring one *reusing the generic contractor flow* (stated
as the current behavior, not a complaint about it — every other
category, from `plumbing` to `security_installation`, already goes
through that same shared quote/assignment flow). Building a distinct
architect/engineer-specific hiring workflow would be answering a
question this audit never actually asked.

**What's built**: `architect` and `engineer` added to the one
`SERVICE_CATEGORIES` source of truth (`CreateVendorDto`) and its two
duplicated frontend copies (`vendors/index.tsx`'s own filter dropdown,
`vendors/me.tsx`'s own profile-creation form) — the same three-file
shape every prior category-list edit in this codebase has needed,
since `Vendor.serviceCategory` is a plain, freeform `String` column
with no database-level enum to migrate.

**Verified live**, real data: created a real VENDOR-type account and a
real vendor profile ("Lagos Structural Engineers," `serviceCategory:
"engineer"`) through the actual API — no seed-script shortcut.
Confirmed `GET /vendors?serviceCategory=engineer` returns exactly that
one vendor, and confirmed on the real, live vendor-marketplace browse
page that "engineer" appears as a real option in the category filter
and the new vendor renders correctly on the grid.

**Not done — explicit scope, not oversight**:

- Not added to `PropertiesService`'s own `LICENSE_REQUIRED_CATEGORIES`
  (`electrical`, `security_installation`, `general_contracting`) —
  that list's own comment already states it's deliberately narrow
  ("nothing here decides which of those are genuinely regulated
  trades in a given jurisdiction"), not a comprehensive licensing
  policy this pass should extend on its own judgment.
- No distinct architect/engineer hiring workflow — as the audit's own
  language already anticipated, hiring one still reuses the same
  quote-request/accept flow every other vendor category uses. A
  separate professional-services flow (scoped drawings, stamped
  engineering approval, etc.) is real, unbuilt scope beyond just
  having the category exist.

## Real location/rating/verified filters on the vendor-assignment picker (this pass)

Closes the remaining half of the audit's own finding on Workflow 7:
"the picker now filters to vendors matching the request's own category
when a real match exists, falling back to the full list otherwise.
Still not the vendor marketplace's own full search/filter experience —
no location, rating, or free-text search on this picker." The category
match (an earlier pass) closed the first half; this closes the second.

**One component, four call sites.** `VendorOrNameField` — the shared
vendor/freeform-name picker `properties/[id].tsx` already reused for
inspector assignment (schedule + edit) and maintenance-vendor
assignment (report + start) — is where the fix lives, so all four
pickers gained the same real filters in one change, not four separate
ones.

**Deliberately client-side, not a second server round-trip.** The
vendor marketplace's own browse page (an earlier pass) filters via
`GET /vendors?location=&minRating=&verificationStatus=`; this picker
already has the full vendor directory in memory (`vendors`, fetched
once on page load for the select itself) — the exact same data that
endpoint would return unfiltered. Filtering it in place, the same
`location`/`minRating`/`verificationStatus` fields, same substring/
threshold/equality semantics, costs no extra request and no loading
state a form control shouldn't need.

**What's built**: a collapsed "Filter vendors" toggle next to the
existing select — a location text input (substring match on
`locationCoverage`), a "★ 4+/3+/2+" rating floor, and a "Verified
only" checkbox, stacking on top of the existing category-preference
match rather than replacing it. The hint line beneath the select now
reports whichever is active — the category-only count when no filter
is set, or "N of M vendors match your filters" once one is.

**Verified live** on the real "Report a maintenance issue" form
(reaches the same `VendorOrNameField` all four call sites share): the
picker started with all 8 real vendors on the platform (including two
created earlier this session — "Lagos Structural Engineers" and the
new-category "engineer" vendor). Checking "Verified only" narrowed it
to exactly the 2 real verified vendors ("2 of 8 vendors match your
filters"); adding `location: "Lagos"` on top narrowed it further to
exactly 1 — "Lekki Renovations Co.," the platform's own verified,
Lagos-based, ★4.6 demo vendor — confirmed by reading the select's own
remaining option, not just the count.

**Not done — explicit scope, not oversight**:

- No free-text search on business name — the audit's own language
  named "location, rating, or free-text search" as the gap; location
  and rating are real, free-text isn't, since none of the four call
  sites this component serves have a case where searching by name
  (rather than filtering by a real attribute) is the likely need — an
  inspector or maintenance vendor is picked by trust signal, not
  recalled by name.
- Filters reset on form close/reopen, same as every other field in
  these forms — no persisted "last filter used" preference.

## A real AI-generated project scope (this pass)

Closes the audit's own finding on Workflow 3: "Defines scope, or AI
generates it — AI-generated scope doesn't exist — the AI skills that
touch scope only read an existing one to estimate budget or draft a
materials list; none writes it."

**Keyed on the property, not the project — deliberately.** Every other
draft skill in this registry (`draft_project_status_update`,
`generate_listing_description`) runs against a resource that already
exists. Scope has to be defined *before* a project exists — filling
out the "New Project" form is the one point in this app where there's
a real property but no `Project` row yet — so `generate_project_scope`
is the first skill in this registry with `moduleContextPrefix:
"property"` that isn't actually a property-level concern; it's what
the form has on hand at the moment scope is needed.

**No chained write on Accept — a deliberate difference from the two
skills that do chain one.** `AiService.applyChainedAction`'s own
comment already names the reason edited drafts never chain ("the notes
on an edit describe what the human changed, not the corrected text
itself"); the same reasoning extends further here. The scope textarea
on that same "New Project" form is already the real destination for
this text, and the owner still has to fill in a title and click
"Create project" themselves — a stronger human-in-the-loop guarantee
than a chained write would give, not a weaker one, since nothing
becomes real until the owner's own separate, pre-existing action.

**What's built**:

- `apps/api/src/ai/skills/generate-project-scope.skill.ts` — a real
  input schema (`projectType`, optional freeform `goals`), the second
  skill in this registry (after `model_roi_scenario`) to declare one
  rather than reading an untyped `input: {}`. Grounds the draft in the
  property's own real `propertyType`/location, same "facts from the
  database, LLM only writes the paragraph around them" split every
  other draft skill here uses.
- `projects/index.tsx`'s own "New Project" form — a "✦ AI-draft scope"
  toggle next to the Scope field reveals a goals input and a real
  `AiDraftCard` (the same accept/edit/discard component every other
  skill's draft uses). Accepting copies the draft text into the
  existing `scopeDescription` state; editing deliberately does not
  (see above) — the owner types their own correction directly into the
  textarea instead.

**Verified live**, real data throughout: drafted a scope for a real
renovation project on the real "14 Ocean Drive" property with real
goals ("Replace the leaking roof and repaint the exterior"), confirmed
the draft correctly grounded itself in the property's real
`propertyType`/location ("residential house in Lagos, NG"), clicked
Accept, and confirmed via the DOM that the scope textarea was
populated with the exact accepted text — ready for the existing, real
`POST /projects` call to persist once the owner fills in a title and
submits.

**Not done — explicit scope, not oversight**:

- No AI-generated BOQ/materials-list wiring here — `boq_to_order`
  already exists as its own separate skill and stays separate; scope
  generation and BOQ generation are two different steps in the
  audit's own workflow (steps 3 and 5), not one feature.
- Draft doesn't persist if the owner navigates away before creating
  the project — same as every field in this form already behaves,
  not a new gap this feature introduces.

## Real bulk quote requests for materials suppliers (this pass)

Closes the audit's own finding on Workflow 6: "Places an order or
requests a bulk quote — Placing an order is real. Bulk-quote/RFQ
doesn't exist for suppliers — VendorQuote is renovation-only."

**Mirrors `RentalBooking`, not `VendorQuote`.** `VendorQuote` assumes
several vendors competing for one project before an owner picks one —
a bulk quote is always one buyer asking one supplier about one
product, structurally a booking, not a bid. The one real difference
from `RentalBooking`: this needs an actual negotiated price the
supplier sets, since a catalog's own `unitPrice` is exactly what a
bulk buyer is asking to move off of — `createOrder` always reads
`product.unitPrice` directly, with no way to override it, which is
why this couldn't just reuse that endpoint either.

**What's built**:

- A real `BulkQuoteRequest` model (migration
  `20260915000000_add_bulk_quote_requests`) —
  `requested → quoted → accepted/declined`, with `quotedUnitPrice`/
  `quotedNotes` set only at the "quoted" step.
- `POST /products/:productId/bulk-quote-requests` (buyer), `PATCH
  /bulk-quote-requests/:id/respond` (supplier, sets the real price),
  `POST .../accept` and `.../decline` (buyer) — all reusing
  `order:read`/`order:write`, the same permissions every other
  buyer/supplier materials action already uses, no new permission
  keys. `MaterialsService.acceptBulkQuote` creates a real `Order` +
  `OrderItem` at the *negotiated* price and decrements stock exactly
  like `createOrder` does, just sourcing `unitPrice` from the accepted
  quote instead of the catalog.
- Buyer UI: a "Request bulk quote" toggle on every product row (the
  product detail page), a new "My bulk quotes" page listing real
  requests with Accept/Decline once quoted. Supplier UI: a "Bulk quote
  requests" card on the supplier dashboard with a real respond form
  (set a unit price, optional notes).

**Verified live**, real data and a real negotiated discount
throughout: requested a real bulk quote for 20 units of "Interior
Emulsion Paint (20L)" (catalog price NGN 45,000), responded as the
real "Lagos BuildMart" supplier with a real discounted bulk rate of
NGN 39,500, then accepted as the buyer — confirmed the resulting real
`Order` carried `unitPrice: 39500` (not the catalog 45,000) and
`totalAmount: 790000` (39,500 × 20, exact), confirmed the product's
real stock dropped from 53 to 33, and confirmed a second accept
attempt on the same request got a real 400 ("no quote to accept").
Separately verified the full UI round trip: clicked "Request bulk
quote" on a real product, submitted a real quantity, confirmed the
request rendered correctly on both "My bulk quotes" (buyer) and the
supplier dashboard's own "Bulk quote requests" card, respond form and
all.

**Not done — explicit scope, not oversight**:

- No expiry on a "quoted" request — a supplier's own negotiated price
  stays acceptable indefinitely until the buyer accepts or declines.
  Real RFQ systems often time-box a quote; this scaffold doesn't model
  time-limited pricing anywhere else either (a listing's own
  `askingPrice` doesn't expire), so adding it here alone would be a
  one-off, not a consistent pattern.
- No multi-item bulk quotes — one request is always one product, same
  granularity `RentalBooking` already uses. A buyer wanting bulk
  pricing on several products submits several requests.
- Supplier can't counter-decline with a reason beyond `quotedNotes` at
  the quoting step — there's no separate "we can't fulfill this"
  action; a supplier simply not responding is the closest equivalent.

## A real "import from BOQ" — Accept now writes to the cart (this pass)

Closes the audit's own finding on Workflow 6: "'Imports from BOQ' is
not a marketplace feature — `boq_to_order` only drafts a text list via
the AI side panel; nothing writes to a cart or order."

**The third skill in this registry to chain a real action on Accept,**
after `draft_project_status_update` and `generate_listing_description`
— same human-in-the-loop rule: nothing happens until a human decides,
and "Edited" still never chains (the notes describe what changed, not
a corrected value there's anything safe to write automatically).
`AiService.applyChainedAction` now has three switch arms instead of
two; the comment above it that named `boq_to_order` as one of the
skills deliberately staying advisory is corrected in place, since this
pass is exactly what makes that no longer true.

**What's built**:

- `findCheapestMatchedProducts` — the matching logic `boq_to_order`'s
  own `run()` always had (keyword-match the scope description, look up
  the cheapest active product per match) is now a shared, exported
  helper, called both by `run()` (to build the human-readable draft)
  and by the new `applyChainedAction` case (to know exactly which real
  products Accept should add to the cart). Re-deriving the same real
  query in both places rather than parsing product ids back out of the
  draft's own display text, which is meant to be read, not parsed.
- Accepting the draft now calls the real `MaterialsService.
  upsertCartItem` for each matched product — reading the buyer's
  current cart first and incrementing rather than overwriting, so
  accepting a second time (or a project whose scope matches an item
  already in the cart from browsing) adds to what's there instead of
  silently resetting it back down.
- Zero new frontend code — `boq_to_order` was already reachable
  generically through `AskAiPanel` (every skill for a given
  `moduleContext` renders as a quick-action button automatically), and
  Accept/Edit/Discard already route through the one generic
  `AiDraftCard` → `decideAiOutput` path every other skill uses. The
  entire feature is a backend change.

**Real bug caught during wiring, before it shipped**: adding
`MaterialsService` to `AiService`'s constructor and `MaterialsModule`
to `AiModule`'s imports passed `tsc` clean but failed at runtime — Nest
couldn't resolve `MaterialsService` in `AiModule`'s context after a
hot-reloaded incremental rebuild, even though the wiring was correct.
A full dev-server restart (not just the file-watcher's own incremental
recompile) resolved it — worth noting since `tsc` passing is not by
itself proof a NestJS DI graph change actually works; only a real boot
does.

**Verified live** on the real "Kitchen Renovation" project, whose own
real scope ("new cabinets, countertop, tiling, painting, plumbing, and
electrical rework") matches four keywords, one with a real product in
the catalog. Confirmed the cart started empty, ran the skill, accepted
the draft, and confirmed the real cart now held exactly the one
matched product ("Modern Kitchen Cabinet Set") at quantity 1. Ran and
accepted a second time and confirmed the quantity became 2, not reset
to 1 — the increment-not-overwrite guard working as designed.
Separately verified the same flow through the real "Ask AI" panel UI:
clicked the real "Turn scope into a materials order draft" quick
action, confirmed the new "Accepting this draft adds 1 unit…" note
rendered on the real `AiDraftCard`, clicked the real Accept button,
and confirmed via a fresh `GET /cart` that the real click produced the
same real cart write the direct API calls did.

**Not done — explicit scope, not oversight**:

- Still no real per-item quantity estimate — this closes Workflow 6's
  own "nothing writes to a cart" finding, not Workflow 4's separate
  "no quantities" one. 1 unit per matched item is a real, honest
  starting point a buyer adjusts in their own cart, not a guessed
  number dressed up as a BOQ-grade estimate.
- No persisted `BillOfQuantities` record — the real, persisted
  artifact this closes the gap with is the cart itself
  (`CartItem` rows), not a new BOQ-specific model. A project's own
  scope description is already the real, re-runnable source of truth
  this feature reads from each time, so there was nothing a separate
  persisted BOQ record would capture that scope + cart don't already.
  Still true of *this* feature specifically — `boq_to_order` still
  reads free-text scope, not a structured record. A real
  `ProjectBoqItem` model exists now (see "A real Bill of Quantities"
  below), but it closes a different audit finding (Workflow 4's own
  "Plans and BOQ are uploaded") and is deliberately not wired into this
  cart-import mechanism at all.
- Items with no matching product in the catalog are still just
  reported as text ("no matching product in the catalog yet") —
  nothing suggests the closest category or prompts the buyer to browse
  for one.

## A real, immutable project contract (this pass)

Closes the audit's own finding on Workflow 5: "Milestones (title/
amount/due date) are fully real. No Contract model exists anywhere —
a 'contract' here is nothing more than the freeform scope description
plus milestones, no binding-terms artifact."

**Deliberately the one real snapshot in a codebase that otherwise
always computes on read.** `ProjectsService.getSpend`/
`getOnHoldMilestoneIds` (earlier passes) both deliberately avoid a
stored, mutable running total, computing fresh from real rows every
time instead — the reasoning documented on both is "don't keep a
number in sync with every place it could change." A contract is the
opposite kind of thing: its entire point is to freeze what was
actually agreed to at one moment, not keep reflecting whatever the
project's own scope or milestones say later. Storing a snapshot here
isn't a lapse in that discipline — it's the same discipline applied
correctly to a case that calls for the opposite answer.

**Not triggered automatically by `acceptQuote`.** Accepting a quote
only fixes the vendor — no milestones exist yet at that point, and a
"contract" with an empty terms list wouldn't be one. A real, separate,
owner-invoked action instead, gated on the two real preconditions this
codebase already tracks: a vendor actually assigned
(`ProjectVendorAssignment`) and at least one real milestone.

**What's built**:

- A real `ProjectContract` model (migration
  `20260916000000_add_project_contracts`) — `@unique` on `projectId`,
  never regenerated once created. Snapshots `scopeDescription`,
  `totalAmount` (the real sum of every milestone's own
  `paymentAmount` at generation time), `currency`, and a full
  `milestonesSnapshot` (title/description/amount/due date per
  milestone) as real `JSONB`, the same column type `AiOutput.
  draftBody` already uses in this schema.
- `POST /projects/:projectId/contract` (`project:write`, owner-only)
  — real 400s for "no vendor assigned yet" and "no milestones yet,"
  a real 409 ("this project already has a contract") on a second
  attempt.
- A real "Contract" card on the project page: a "Generate contract"
  button once both real preconditions are met and no contract exists
  yet; once one does, the frozen terms — amount, vendor, scope, and
  every milestone's own snapshotted amount — render read-only, with an
  explicit note that later edits to scope or milestones won't change
  it.

**Verified live** on the real "Kitchen Renovation" project: generated
a real contract and confirmed `totalAmount` (NGN 904,500) exactly
matched the sum of its six real milestones, confirmed a second
generation attempt got a real 409, and confirmed the real "Contract"
card rendered every snapshotted milestone with its own real amount.
Separately created a brand-new real project through the actual API and
confirmed the two real guards in sequence: a real 400 ("no vendor
assigned yet") before any quote was accepted, and — after really
requesting, submitting, and accepting a real vendor quote on it — a
different real 400 ("no milestones yet") once a vendor existed but no
milestone did.

**Not done — explicit scope, not oversight**:

- No amendment or versioning workflow — a real contract, once
  generated, cannot be regenerated or edited to reflect later changes.
  Real contracts get amended through their own separate process; a
  scaffold-appropriate v1 is "generate once, treat as final," not a
  full contract-lifecycle system.
- No e-signature or acceptance step on the contract itself — the
  vendor's own real acceptance already happened earlier, at
  `acceptQuote`. This is a real record of terms, not a second consent
  gate on top of a decision that's already made.
- No PDF or downloadable document — the contract's real terms render
  on the project page; there's no export/print path yet.

## AI-generated lease agreement (this pass)

Closes the audit's own finding on Workflow 8: "Lease agreement is
uploaded or generated — Upload: real, via `Document.leaseId`.
Generation (template, e-sign) doesn't exist anywhere." Generation is
real now; e-signature stays out on purpose (see below).

**Every fact in the draft comes from real rows, not the model.** Same
split every other draft skill in this registry uses: the LLM only
writes the agreement's own prose, never a figure. The skill's system
prompt explicitly forbids inventing any figure, date, or term not
given — telling it to write `[to be specified]` for anything ordinarily
in a lease (like a notice period) that isn't recorded, rather than
making one up.

**First skill in the 33-skill registry keyed on the lease itself**
(`moduleContextPrefix: "lease"`) rather than the property — every other
lease-adjacent skill (`summarize_lease_status`) is keyed on the
property because it summarizes every lease on it at once. Reached
directly via `POST /ai/actions` from a purpose-built button on the
lease row, the same "call `runAction` directly, skip the generic
Ask-AI skill list" shape `generate_project_scope` already established.

**Accept chains a real write to a new `Document`, not a text field.**
Unlike `generate_listing_description`'s own field, there's nowhere on
`Lease` to write agreement prose into — and `Document.fileUrl` is
required, not nullable, so a generated document can't just live as raw
text in the database either. Accept uploads the draft text to real
object storage (`StorageService`, the same Cloudflare R2 service
already used for AI-visualization images — this is the same "backend
generates content, uploads it, gets a real URL" shape, just text
instead of an image this time) and creates a real `Document` row
(`documentType: "lease_agreement"`, `leaseId` set) pointing at it,
through the same pipeline every other piece of lease paperwork already
goes through.

**What's built**:

- `generate_lease_agreement` AI skill (`lease:write`) — drafts a full
  structured agreement (Parties, Property, Term, Rent, Security
  Deposit, standard obligations) from the real `Lease`/`Property` rows.
- Accept chains a real write: uploads the accepted text to R2 via
  `StorageService.upload`, then creates a real `Document`
  (`documentType: "lease_agreement"`) via `DocumentsService.create`.
- A "✦ Generate lease agreement" button on each active lease row
  (`lease:write`), rendering the standard `AiDraftCard` (Accept / Edit
  / Discard) with a confirmation pointing at the page's own Documents
  section once accepted.

**Verified live** on the real "Demo Tenant" lease (`14 Ocean Drive`,
NGN 2,400,000/annually, deposit NGN 200,000): ran the skill via direct
`fetch()`, confirmed the draft's every fact matched the real lease and
property rows exactly, accepted it, and confirmed a real `Document` row
was created with a real R2 `fileUrl`
(`https://pub-7a3c8019a4734a16a8463e3097877624.r2.dev/lease-agreements/
…txt`) — fetched that URL directly and confirmed it served the exact
accepted text back. Separately verified the real UI: clicked the real
"Generate lease agreement" button on the lease row, clicked "Draft
agreement," confirmed the real `AiDraftCard` rendered the same draft,
clicked the real Accept button, confirmed the "Accepted" badge and the
"see it in Documents below" note, and confirmed a `lease agreement`
row (`Not Verified`) really appeared in the property page's own
Documents section afterward.

**Not done — explicit scope, not oversight**:

- No e-signature — a real third-party integration (DocuSign or
  similar) this scaffold doesn't attempt anywhere else either. The
  audit's own finding named this as a separate gap from generation;
  closing generation doesn't imply closing this one too.
- The generated document is plain text, not a formatted PDF — same
  "real content, no formatting pipeline" scope every other
  AI-generated artifact in this codebase (portfolio reports, project
  scopes) already stops at.
- No re-generation or versioning — accepting a second draft creates a
  second `Document` row rather than replacing the first; nothing
  merges or supersedes prior generated agreements.

## A real Bill of Quantities (this pass)

Closes the audit's own finding on Workflow 4: "Plans and BOQ are
uploaded — Plans: possible via the freeform document-type escape
hatch. Real BOQ: doesn't exist. `boq_to_order` is an AI keyword-matcher
over free-text scope with no quantities and no persisted model — not
an upload feature."

**A genuinely different gap from the one `boq_to_order` already
closed.** That AI skill (Workflow 6, an earlier pass) turns a
project's free-text scope into cart items, and deliberately has no
persisted model of its own — the reasoning on record is that scope +
cart already capture everything *that* mechanism needs. This finding
is a different literal thing: the real take-off artifact itself, with
real quantities, the thing the audit says doesn't exist anywhere. The
two stay deliberately unconnected — `ProjectBoqItem` rows are not read
by `boq_to_order`, and `boq_to_order`'s cart writes don't touch this
table. Building one doesn't quietly reopen the other's closed scope;
they answer two different steps in the same audit.

**What's built**:

- A real `ProjectBoqItem` model (migration
  `20260917000000_add_project_boq_items`) — `description`, `quantity`,
  an optional `unit`, an optional `estimatedUnitCost`, scoped to a
  project.
- `POST /projects/:projectId/boq-items` and
  `DELETE /projects/:projectId/boq-items/:itemId` — reusing
  `milestone:write`, not `project:write`: a BOQ line item is the same
  kind of work-breakdown detail a milestone is, not an edit to the
  project's own core fields, so the same narrower set of roles that
  can add milestones can add these.
- A real "Bill of Quantities" card on the project page: an add-item
  form and a real delete action per line, sitting above Milestones —
  the same card shape and permission gate (`isOwningAccount` +
  `milestone:write`) Milestones itself already uses.

**Verified live** on the real "Kitchen Renovation" project: added two
real items via direct API calls (120 bags of cement at an estimated
NGN 8,500/unit, 450 sq ft of ceramic tiles with no cost estimate),
confirmed both persisted on a fresh `GET`, deleted one and confirmed
only the other remained, and confirmed a delete through a *different*
project's own route got a real 404 rather than silently succeeding
cross-project. Separately verified the real UI: the "Bill of
Quantities" card rendered the seeded item, added "Reinforcement rods
(12mm)" (75 pieces) through the real form, confirmed it appeared
immediately, then clicked the real "Remove" button on it and confirmed
it was gone — both real writes confirmed against a fresh `GET
/projects/:id` afterward, not just trusted from the client-side state.

**Not done — explicit scope, not oversight**:

- Not wired into `boq_to_order` or the cart — see above. A future pass
  could have the skill prefer real BOQ items over free-text scope when
  they exist; this pass deliberately doesn't attempt that, to keep this
  closing one finding, not quietly redesigning another.
- No edit action, only add/remove — correcting a quantity means
  deleting the row and re-adding it. The same minimal shape
  `ProjectMilestone` itself shipped with (no `PATCH` there either).
  Milestones stayed that way; the analogy suggested this new sub-
  resource start the same way rather than sailing past its own model.
- No unit-price rollup or budget comparison — `estimatedUnitCost` is
  stored and shown per line, but nothing sums it against the project's
  own `budget` field. A real total is a small extension, not something
  this pass claims it doesn't need.

## A real document vault for vendors and suppliers (this pass)

Closes the audit's own finding on the Vendor and Supplier sidebars:
"Documents — missing as a general vault, only verification-evidence
upload exists" (vendor) and "missing as a general section, same as
Vendor" (supplier). The nav item itself was never the problem — the
codebase's own single flat `AppShell` nav (see the audit's own
Navigation section) already showed "Documents" unconditionally to
every role, vendor included. What was missing was the permission
behind it: a vendor held `document:read` but never `document:write`,
so the page's own upload form was permanently hidden for it; a
supplier held neither, so the page 403'd outright — "You don't have
permission to view documents."

**Nothing new to build on the document side — this closes a
permissions gap, not a feature gap.** The generic `/documents` page,
its upload form, and the underlying `Document` model were all already
real and already scoped correctly by `accountId` (see
`DocumentsService.findForAccount`) — the exact same isolation every
other account type's documents already rely on. Closing this meant
granting `document:write` to the `vendor` role and `document:read` +
`document:write` to the `supplier` role (`prisma/seed.ts`), then
re-running the seed script so the grants applied to the already-
seeded roles.

**What's built**:

- `vendor` role gains `document:write` — it already had `document:read`.
- `supplier` role gains both `document:read` and `document:write` — it
  had neither before this pass.
- No frontend change at all: `pages/documents/index.tsx` already
  renders the "+ Upload document" button and form for any account
  holding `document:write`, and already 403s cleanly with "You don't
  have permission to view documents" for any account lacking
  `document:read` — both already correct, just newly reachable.

**Verified live**: as the real seeded vendor account (`Lekki
Renovations Co.`), `GET /documents` returned real `200` (previously
would have, since it already had read) and a real `POST /documents`
(`documentType: "insurance_policy"`) returned a real `201`, scoped to
the vendor's own `accountId`. As the real seeded supplier account,
`GET /documents` flipped from what would have been a real `403` to a
real `200`, and a real `POST /documents` (`documentType:
"business_license"`) also returned a real `201`. Confirmed account
isolation held: the vendor's own document list contained only its own
`insurance_policy` row, the supplier's own list contained only its own
`business_license` row, and the owner account's own (separately
seeded) `insurance_policy` document is a different row entirely — a
different `id`, same `accountId` as every other owner-side document,
never the vendor's. Then repeated both as real UI: switched the active
account to the vendor, confirmed the "+ Upload document" button now
renders and the real "Insurance Policy" document appears in the list;
switched to the supplier, confirmed the same button renders and the
real "Business License" document appears.

**Not done — explicit scope, not oversight**:

- Vendor/supplier documents still aren't tied to `propertyId` or any
  project/order — they're account-level paperwork (insurance, license,
  certifications), the same "Not tied to a property" shape the generic
  upload form already offers every account type. Nothing here adds a
  vendor-specific or supplier-specific document category.
- No verification workflow change — `document:verify`/
  `document:arbitrate` stay exactly as scoped before this pass; a
  vendor or supplier's own uploaded documents go through the same
  review path any other document already does.

## A portfolio-wide Maintenance view (this pass)

Closes the nav audit's own finding on the Owner/Admin Sidebar:
"Maintenance — missing, lives only inside each property's own detail
page, no portfolio-wide view." Every maintenance action — report,
start, resolve, approve — was already real; there was simply no way to
see every request across every property in the account at once
without opening each property one at a time.

**Same shape the Documents nav item already established for a
per-property-scoped resource.** `documents/index.tsx` already proved
this pattern: a flat, account-wide, read-only list with an optional
`?propertyId=` filter, each row naming its own property. `Maintenance`
reuses it exactly, rather than inventing a second convention for the
same kind of gap.

**What's built**:

- `PropertiesService.findAllMaintenanceRequestsForAccount(accountId)`
  — joins through the owning property (`where: { property: { accountId
  } }`), since `MaintenanceRequest` never carried its own `accountId`.
- `GET /properties/maintenance-requests` (`maintenance:read`) —
  registered before `GET /properties/:propertyId`, the same ordering
  `search` above already documents doing, so the literal path doesn't
  get swallowed as a property id.
- A new `/maintenance` page: every request across the account, each
  showing its own property, category, priority, assigned vendor (if
  any), and status, linking straight through to that property's own
  page for the real actions — this page is deliberately a view, not a
  second place those actions live.
- A real "Maintenance" item on the always-visible `AppShell` nav,
  between Documents and Payments.

**Verified live**: `GET /properties/maintenance-requests` as the real
seeded owner account returned all 17 real, pre-existing maintenance
requests across the account, each correctly carrying its own real
property name; confirmed the pre-existing `GET /properties/search` and
`GET /properties/:propertyId` routes still resolved correctly
afterward — no route collision regression from the new literal path.
Confirmed real account isolation: the same call as the vendor account
(which owns no properties) correctly returned an empty list, not
another account's data. Then verified the real UI: the new
"Maintenance" nav item is present, `/maintenance` renders all 17 real
requests with their real details, and clicking one navigates straight
to its real property page.

**Not done — explicit scope, not oversight**:

- Read-only — no filter/sort UI beyond the existing `?propertyId=`
  query param, no status or priority filter. The audit's own finding
  was "no portfolio-wide view," not "no portfolio-wide filtering";
  this closes the former.
- No aggregate counts or "needs attention" callout on this new page —
  that already exists elsewhere (the portfolio digest / reports
  surfaces this session built earlier), and duplicating it here wasn't
  the gap this pass closes.

## A portfolio-wide Tenants & Leases view (this pass)

Closes the nav audit's own finding on the Owner/Admin Sidebar:
"Tenants & Leases — missing, only inside each property's own page."
The identical shape the Maintenance view above just closed, applied to
the other resource the same audit named alongside it: every lease
action (record payment, edit, end, link tenant, generate agreement)
stays exactly where it already lived; this closes only the "see every
lease across every property at once" half.

**What's built**:

- `PropertiesService.findAllLeasesForAccount(accountId)` — joins
  through the owning property, same reasoning
  `findAllMaintenanceRequestsForAccount` already documents, since
  `Lease` carries no `accountId` of its own either.
- `GET /properties/leases` (`lease:read`) — registered before
  `GET /properties/:propertyId`, the same ordering `search` and
  `maintenance-requests` above already use to avoid the route
  collision.
- A new `/leases` page: every lease across the account, each showing
  its own property, tenant, rent, status, and (for active leases) the
  next real due date, linking straight through to that property's own
  page for the real actions.
- A real "Tenants & Leases" item on the `AppShell` nav, between
  Maintenance and Payments.

**Verified live**: `GET /properties/leases` as the real seeded owner
account returned all 9 real, pre-existing leases, each correctly
carrying its own real property, and each active lease its own real
next-due-date; confirmed `GET /properties/search` and
`GET /properties/:propertyId` still resolved correctly afterward — no
route collision regression. Confirmed real account isolation: the same
call as the vendor account correctly 403'd (`vendor` never held
`lease:read` in the first place — a real, pre-existing permission
boundary, not something this pass changed). Then verified the real UI:
the new "Tenants & Leases" nav item is present, `/leases` renders all
9 real leases with their real details, and clicking one navigates
straight to its real property page.

**Not done — explicit scope, not oversight**:

- Read-only — same restraint the Maintenance view above documents; the
  finding was "no portfolio-wide view," not "no portfolio-wide
  filtering."
- No portfolio-wide overdue-rent rollup on this specific page — the
  real overdue/ending-soon detection this session built earlier
  (`assess_lease_risk`, the rent-reminder cron) already covers that
  ground elsewhere; this page's own job is the plain list the audit
  named as missing, not a second risk surface.

## A portfolio-wide Inspections view (this pass)

Closes the nav audit's own finding on the Owner/Admin Sidebar:
"Inspections — missing, only inside each property's own page." The
third and last instance of the exact gap Maintenance and Tenants &
Leases (both earlier passes) already closed — a resource scoped
per-property with no cross-property list. Every inspection action
(schedule, edit, complete, confirm/decline a buyer-requested one)
stays exactly where it already lived.

**What's built**:

- `PropertiesService.findAllInspectionsForAccount(accountId)` — joins
  through the owning property, same reasoning
  `findAllMaintenanceRequestsForAccount`/`findAllLeasesForAccount`
  already document.
- `GET /properties/inspections` (`inspection:read`) — registered
  before `GET /properties/:propertyId`, the same ordering `search`,
  `maintenance-requests`, and `leases` above already use.
- A new `/inspections` page: every inspection across the account, each
  showing its own property, type, scheduled date, inspector (vendor or
  named), and result, linking straight through to that property's own
  page for the real actions.
- A real "Inspections" item on the `AppShell` nav, between Tenants &
  Leases and Payments.

**Verified live**: `GET /properties/inspections` as the real seeded
owner account returned all 12 real, pre-existing inspections spanning
two different real properties ("14 Ocean Drive" and "Epe Development
Plot"), each correctly carrying its own real property, inspector, and
result; confirmed `GET /properties/search` and
`GET /properties/:propertyId` still resolved correctly afterward — no
route collision regression. Confirmed real permission isolation: the
same call as the vendor account correctly 403'd (`vendor` never held
`inspection:read`, a real pre-existing boundary, not something this
pass changed). Then verified the real UI: the new "Inspections" nav
item is present, `/inspections` renders all 12 real inspections across
both real properties with their real details, and clicking one
navigates straight to its real property page.

**Not done — explicit scope, not oversight**:

- Read-only — same restraint the Maintenance and Tenants & Leases
  views above document; the finding was "no portfolio-wide view," not
  "no portfolio-wide filtering."
- With this, every Owner/Admin Sidebar row the audit called "missing —
  only inside each property's own page" is now closed. The remaining
  Owner/Admin Sidebar gaps (Materials & Tools reachable only via a
  button, no `/settings` route anywhere) are a different shape of
  finding, not this one — left for a separate pass.

## Properties & Listings on the Platform Admin console (this pass)

Closes the nav audit's own finding on the Platform Admin Sidebar:
"Properties / Listings — missing, no property/listing management
routes for admin at all." Deliberately a read-only directory, the same
shape the existing account list on this page already uses — no new
edit/suspend action on a property or listing: a property stays its
owning account's own to manage, and a listing's verification stays
`platform_reviewer`'s (a distinct role from `platform_admin` — the
audit's own note on that split, unrelated to this finding, still
holds).

**What's built**:

- `PlatformAdminService.listProperties()` / `listListings()` — every
  real `Property`/`PropertyListing` row platform-wide, each joined to
  its owning account's name, gated by the same `account:read_all`
  every other admin-console read already uses.
- `GET /platform-admin/properties` and `GET /platform-admin/listings`.
- A new "Properties & listings" section on the existing `/admin` page,
  between Platform reports and the account directory — two scrollable
  lists, each row naming its own owning account.

**Verified live**: `GET /platform-admin/properties` and
`GET /platform-admin/listings` as the real seeded platform-admin
account returned 8 real properties and 9 real listings, spanning
several genuinely different real owning accounts ("Demo Owner",
"Sale Verification Buyer", "Comparable House A/B"), not just one;
confirmed the same calls as the regular owner account correctly
403'd (`account:read_all` stays `platform_admin`-only, unchanged).
Then verified the real UI: switched the active account to
platform-admin, loaded `/admin`, and confirmed the new "Properties &
listings" section rendered all 8 real properties and all 9 real
listings with their real owning-account names, prices, and statuses.

**Not done — explicit scope, not oversight**:

- Read-only — no admin-side edit, verify, or delete action on a
  property or listing. The finding was "no management routes... at
  all"; a directory is the honest first step, not a claim that admin
  now moderates listings the way `platform_reviewer` already does.
- No pagination or filtering — every property/listing loads at once,
  the same scale assumption the existing account directory on this
  page already makes.

## A real Transactions ledger for the Platform Admin console (this pass)

Closes the nav audit's own finding on the Platform Admin Sidebar:
"Transactions — missing as a ledger — only an aggregate 'Marketplace
GMV' dollar total, not a transaction count/list." No new modeling
decision here — `listTransactions` itemizes the exact two real sources
`getPlatformReports`'s own GMV figure already sums (delivered orders,
paid-out milestones), just as individual rows instead of one summed
number per currency.

**What's built**:

- `PlatformAdminService.listTransactions()` — every delivered `Order`
  and every paid `Payout` platform-wide, normalized into one list
  (type, amount, currency, when it happened, counterparty, owning
  account), sorted newest first.
- `GET /platform-admin/transactions` (`account:read_all`).
- A new "Transactions" section on `/admin`, between Properties &
  listings and the account directory.

**Verified live**: `GET /platform-admin/transactions` as the real
platform-admin account returned 5 real rows (2 orders, 3 payouts); the
5 amounts summed to exactly NGN 970,000 — the identical figure
`GET /platform-admin/reports`'s own `marketplaceGmvByCurrency` already
reports for NGN, confirming the ledger and the existing aggregate
agree because they're built from the same two real sources, not two
different definitions of "transaction." Confirmed the regular owner
account still 403s. Then verified the real UI: `/admin` rendered all 5
real transactions with their real accounts, counterparties, dates, and
amounts.

**Not done — explicit scope, not oversight**:

- No property-listing sales — same restraint `getPlatformReports`'s
  own GMV figure already documents: nothing in this schema ties a
  confirmed closing price to a sold listing (`askingPrice` is an ask,
  not a recorded sale amount), so including one here would mean
  inventing a number this codebase doesn't actually have.
- Read-only, no pagination or filtering — same restraints the
  Properties & listings section above documents.

## An Escrow directory on the Platform Admin console (this pass)

Closes the nav audit's own finding on the Platform Admin Sidebar:
"Escrow — missing as its own page — only an aggregate stat tile." Same
"itemize the exact rows the existing aggregate already sums" shape as
the Transactions ledger just before it — no new modeling decision,
just the individual `EscrowAccount` rows instead of one summed balance
per currency.

**What's built**:

- `PlatformAdminService.listEscrowAccounts()` — every real
  `EscrowAccount` row platform-wide (one per project), each carrying
  its own project title, owning account, balance, currency, and
  status. No status filter, matching `getPlatformReports`'s own
  escrow-volume aggregate, which sums a closed account's balance too.
- `GET /platform-admin/escrow` (`account:read_all`).
- A new "Escrow" section on `/admin`, between Transactions and the
  account directory.

**Verified live**: `GET /platform-admin/escrow` as the real
platform-admin account returned the one real seeded escrow account
("Kitchen Renovation," NGN 656,000, active); its balance matched
exactly the NGN figure `GET /platform-admin/reports`'s own
`escrowVolume.currentBalanceByCurrency` already reports — the same
confirmation the Transactions ledger's own GMV match already
established, this time for the escrow-volume aggregate. Confirmed the
regular owner account still 403s. Then verified the real UI: `/admin`
rendered the real escrow account with its real project, account, and
balance.

**Not done — explicit scope, not oversight**:

- Read-only, no pagination or filtering — same restraints the
  Properties & listings and Transactions sections above document.
- No ledger-entry drill-down — this lists accounts, not their
  individual `EscrowLedgerEntry` deposit/release history; that detail
  already exists on the project's own Escrow card.

## Materials & Tools on the main nav (this pass)

Closes the nav audit's own finding on the Owner/Admin Sidebar:
"Materials & Tools — missing from the sidebar, reachable only via a
button inside the Marketplace page." The materials marketplace itself
(`pages/marketplace/materials/index.tsx`) was always real and entirely
self-contained — it fetches its own catalog on mount and carries no
dependency on anything from the property-listing Marketplace page it
used to require passing through first. The only real gap was the entry
point.

**What's built**: a real "Materials & Tools" item on the always-visible
`AppShell` nav, between Marketplace and Documents — nothing else
changed; the page it points to needed no code of its own.

**Verified live**: as the real seeded owner account, confirmed the new
nav item renders and clicking it navigates straight to
`/marketplace/materials`, which rendered the real seeded catalog (five
real products — tiles, paint, a concrete mixer, a cabinet set — each
with its own real supplier, price, and stock count) without first
visiting `/marketplace`.

**Not done — explicit scope, not oversight**: the item renders
unconditionally for every role, the same flat-nav shape every other
item already uses (a supplier or vendor account clicking it sees the
buyer-side catalog, not a mismatch this pass introduces — the same
"visible ≠ tailored to this role" pattern the nav audit's own read of
this codebase already documents elsewhere).

## Milestones due on the Vendor Dashboard (this pass)

Closes the Vendor Dashboard's own finding: "Milestones due — nothing
on this page shows milestone-due data." The same "the data already
existed, it just never got surfaced on the one page a vendor actually
starts from" shape the Your projects section (an earlier pass)
already closed for project assignments themselves — a vendor could
always open a project directly and see its milestones' real due
dates; there was just no way to see them all in one place, across
every assigned project, without opening each one.

**What's built**:

- `VendorsService.myProjects` now includes each project's own real
  `milestones` (id, title, payment amount, due date, status) in the
  same query the Your projects section already fetches — no new
  endpoint, no new round trip.
- A real "Milestones due" card on `/vendors/me`: every milestone with
  a real due date across every project this vendor is assigned to,
  excluding completed ones, soonest due date first, each linking
  straight to its own project.

**Verified live**: `GET /vendors/me/projects` as the real seeded
vendor account confirmed the new `milestones` field is present and
correctly scoped to the vendor's own assigned projects. The real
seeded milestones on "Kitchen Renovation" all predate this pass and
have no due date recorded, so to prove the feature actually surfaces
one, created a real milestone with a real due date
("Final inspection walkthrough," NGN 50,000, due in 14 days) via the
existing `POST /projects/:projectId/milestones` endpoint, and
confirmed the vendor's own `GET /vendors/me/projects` response
included it. Then verified the real UI: `/vendors/me` rendered the
real "Milestones due" card with that exact milestone, its real
project name, due date, and amount.

**Not done — explicit scope, not oversight**: no reminder/notification
for an approaching due date — this closes "the data is visible," not
a proactive push; the existing rent/lease reminder cron this session
built earlier is a different, already-scoped feature and this pass
doesn't extend it to milestones.

## Not built yet

Deliberately out of scope for this pass — beyond Priority 6 in the
blueprint, or explicitly cut from it:

- **Modules 6, 14, 16-24** (the full property-verification/trust
  workflow; compliance, community management, AR/VR, admin
  operations, ...) — this scaffold now proves the pattern for Modules 1,
  2, 3, 4, 5, 7, 9, 10, 11, 18, and a slice of 6, 8, 12, 13, 14, 15, 17,
  19, 23, and now two real slices of the 16-24 bucket itself — see "Admin
  operations — a platform accounts directory and account suspension" and
  "Community management — landlord-to-tenant announcements" above: a
  `platform_admin` role with a cross-tenant accounts directory, account
  suspension/reinstatement (wiring up `Account.status`, unused since
  Module 1), and an audit log; and a landlord-to-tenant announcement
  board, scoped either to one property or the whole portfolio. Module 3
  is closed too — see "Module 3: Property Details — specs, amenities,
  and a photo gallery" above: unlike 16-24, it was never an unscoped
  bucket, just a numbering gap between Module 2 (property CRUD) and
  Module 4 (documents) with one self-evidently missing piece the code's
  own comments already pointed at (bedrooms/bathrooms/square footage/
  year built/amenities/a photo gallery, plus the first update endpoint
  the base property record has ever had). Module 17 (Estate and
  Community Management) now has real, user-supplied scope too — see
  "Module 17: Estate and Community Management — Phase 1" above:
  Communities, Residents, and Community Announcements are built; service
  charges, visitor access, facility booking, complaints, security
  notices, polls, and estate reports are explicitly deferred, not
  attempted. Module 18 (Dispute Resolution and Mediation) is the same
  shape — see "Module 18: Dispute Resolution and Mediation — Phase 1"
  above: the dispute system already went further than most of its own
  feature list for *project* disputes; this pass generalized it to
  *order* disputes too (the engineering notes' own explicit "payments,
  orders, projects, contracts" linkage list), added the blueprint's own
  dispute-type categorization, and closed a real permission gap (the
  `supplier` role had no dispute access at all before this). Lease/
  tenant and listing disputes, chat history, mediator assignment, and
  penalty history are explicitly deferred. Module 19 (Communication and
  Notifications) is the same shape again — see "Module 19: Communication
  and Notifications — Phase 1" above: Email already had a real provider;
  this pass added the one other channel achievable with no new paid
  infrastructure (in-app notifications), wired to five real, event-driven
  triggers across four different modules — later passes grew that to
  nine real triggers (marketplace offer countered/rejected/accepted,
  material-order receipt confirmation, package renewal/renewal-failure,
  and proactive rent-overdue/lease-ending-soon reminders — see "The
  marketplace purchase-to-portfolio flow," "Buyer receipt confirmation
  on material orders," and "Proactive rent and lease reminders" above),
  closing rent reminders off this pass's own deferred list. SMS/WhatsApp/
  push/voice, notification preferences, message templates, delivery
  logs, and three of the remaining named features (inspection reminders,
  vendor messages as a real two-way thread, approval reminders) are
  still explicitly deferred. Module 20 (AI
  Property Assistant) and Module 21 (Diaspora Property Management) now
  have real, user-supplied scope too — see "Module 20: AI Property
  Assistant — Phase 1" and "Module 21: Diaspora Property Management —
  Phase 1" above: an AI usage dashboard and a new `summarize_dispute`
  skill for Module 20; a `PropertyAccessGrant`-based delegated
  payment-approval flow (verified live to actually authorize a real
  milestone release for an account with no role-level permission to do
  so) and a timezone-aware notification cron for Module 21, both closing
  fields that had sat unused in the schema since Module 1. Module 22
  (Smart Home, IoT, and Sustainability) and Module 23 (AR/VR Property
  Viewing) now have real, user-supplied scope too — see "Module 22:
  Smart Home, IoT, and Sustainability — Phase 1" and "Module 23: AR/VR
  Property Viewing — Phase 1" above: a device-connector registry and two
  new AI skills (carbon estimate, green building checklist) for Module
  22; 360°-tour media metadata with a real pannable web viewer, and
  virtual staging reusing the existing renovation-visualization pipeline,
  for Module 23 — both modules' own engineering notes flagged them as
  needing real device/AR infrastructure this pass deliberately doesn't
  add, so each ships the concrete, buildable architecture piece its own
  notes actually asked for instead. Module 24 (Reports and Analytics) now
  has real, user-supplied scope too — see "Module 24: Reports and
  Analytics — Phase 1" above: 5 new report-builder metric groups
  (property expenses, rental income, vendor performance/job completion,
  supplier sales, material order trends) closing 6 of its 17 named
  reports, added as pure `METRIC_REGISTRY` entries with zero new frontend
  code, since the existing report-builder UI already lists whatever
  `GET /reports/metrics` returns. Branch/facility/asset-utilization/
  compliance reports, a maintenance *cost* report, portfolio-wide
  project-progress/investment rollups, and listing performance/inquiry
  conversion were explicitly deferred at the time — see that section for
  why each one specifically. **All of them shipped in later passes** —
  see "Module 24: Platform Admin Reports," "Module 24: Branch,
  Investment, Listing, and Inquiry reports," and "Module 24: Asset
  utilization, Compliance, Maintenance cost, and Project progress
  reports" above: every one of the 17 originally-named reports now
  exists, plus a bonus 7-metric platform-admin suite outside the
  original 17. There is genuinely no module left in the 6/14/16-24
  bucket without real, user-supplied scope now. Module 6's risk-flag coverage is
  complete now across every entity type that has one — see "Risk flags
  for projects and leases" and
  "Risk flags for vendors and suppliers" above: `assess_listing_risk` used
  to be the only entity with a flat, explicit flag list; `Project`,
  `Lease`, `Vendor`, and `Supplier` now all have the same treatment
  (`assess_project_risk`, `assess_lease_risk`, `assess_vendor_risk`,
  `assess_supplier_risk`). A cross-portfolio "show every at-risk record"
  view exists now too, across all four — see "A cross-portfolio at-risk
  view" above (`GET /reports/at-risk-overview`).
  Module 15 is a bigger slice now too — see "A comparable-
  sales valuation estimate" above: a real automated estimate from other
  active sale listings nearby, alongside the manual/AI-narrated history
  and rent/hold-sell modeling that already existed. Still not a real
  AVM (automated valuation model) integration or anything beyond a
  same-city, same-property-type comparison. Module 14
  (Reports) is a bigger slice now — see "A project summary skill, and a real
  Reports dashboard" and "CSV export and scheduled email digests for
  Reports" above: `GET /reports/portfolio-overview` (real counts across
  a portfolio), a CSV export of the same data, and real scheduled email
  digests (a genuine `@nestjs/schedule` cron, not a fake toggle). A real
  report *builder* exists now too — see "A real report builder" further
  below — though it's a fixed metric registry projected from the same
  portfolio computation, not a custom-query designer; it also now has an
  AI-narration option of its own — see "AI narration for the report
  builder" above — closing the piece of Module 24's "natural-language
  report generation on top of every report type" that
  `generate_portfolio_report` alone didn't reach (the report builder's
  own custom, saved reports). Modules 8 and 12
  are slices, not the full modules — both can point an inspector/
  assignee at a real `Vendor` account, now optionally carrying a
  dedicated `inspector` role (see "A dedicated Inspector role" above),
  but still fall back to freeform text for a non-platform professional;
  Module 13 has no Tenant identity to link to at all, platform vendor or
  otherwise. Module 6's own evidence-request gap is now closed for three
  of its four neutral-reviewer actions — see "Structured
  evidence-submission channels for document and vendor/supplier
  verification" above — leaving only review `moderationStatus` without
  one, which isn't a gap: "flagged" already plays an analogous "needs a
  decision" role there, raised by the reviewed party rather than
  requested by the reviewer.
- **Property inspections — closer to closed still.** `inspectorVendorId`
  can point at a platform `Vendor` now, that vendor can self-report a
  professional license, picking an electrical/security-installation/
  general-contracting vendor with no license (or an expired one) is
  actually rejected, and a vendor can now carry a dedicated `inspector`
  role distinct from the general marketplace `vendor` role (see "A
  self-reported professional license for vendors," "Requiring a license
  for a regulated trade before a vendor can be assigned," and "A
  dedicated Inspector role" above). What's left: the role is a
  professional-identity choice at account-creation time, not an
  access-control gate — a property owner can still pick *any* vendor
  (any role) as an inspector, and the freeform `inspectorName` path for a
  non-vendor still records nothing about licensing at all, inherent to
  that path. Editing a scheduled inspection's date/type/project/inspector
  is now possible — see "Edit endpoints for Inspections, Leases, and
  Maintenance requests" below.
- **Leases — Tenant identity is fully closed now.** A tenant has a real
  account type, role, and its own lease/document/maintenance view; a
  tenant signing up auto-links to a matching lease and notifies the
  landlord; documents can be tagged to a tenancy; `summarize_my_tenancy`
  exists (see "A real Tenant identity" and "Closing the three Tenant
  identity gaps" above). Editing a lease's rent/dates/deposit, and
  overdue-rent detection, are also possible now — see "Edit endpoints"
  and "Overdue-rent detection" below.
- **Maintenance requests — closer to closed still.** `assignedVendorId`
  can point at a platform `Vendor` now, that vendor can self-report a
  professional license the same way a vendor-linked inspector can, and
  assigning an unlicensed (or expired-license) electrical/security-
  installation/general-contracting vendor is now actually rejected —
  the same `requireVendor` check inspections use, since both pass
  through it (see "Maintenance requests", "Linking inspectors and
  maintenance assignees to real vendor accounts", "A self-reported
  professional license for vendors", and "Requiring a license for a
  regulated trade before a vendor can be assigned" above). `assignedTo`
  is still freeform text for anyone off-platform — inherent to that
  path, not a license-check gap. Editing a request's title/description/
  priority is now possible — see "Edit endpoints" below.
- **Vendor and supplier trust scores are no longer *only* the platform's
  own arithmetic, but still aren't a full independent audit of the
  business.** See "Vendor and supplier trust audits" above: the score
  now blends in a `platform_reviewer`'s own recorded judgment call
  (`VendorTrustAudit`/`SupplierTrustAudit`, kept as history, most recent
  one scored) and whether the account's own operator has passed real
  identity verification (Sumsub) — real signals, not just recomputed marketplace
  activity. What it still isn't: a reviewer's audit checks what that
  reviewer chose to check (there's no mandated checklist — a physical
  site visit, insurance/license lookups, credit history), and nothing
  requires an audit to exist at all, so a vendor/supplier with no audit
  on record just scores on activity plus identity, same as before this
  pass.
- **The neutral reviewer's decisions carry real context for all four
  fields covered at the time this was written, and three of the four
  have a real evidence-submission channel behind them too.**
  `platform_reviewer` covered `Vendor`/`Supplier.verificationStatus`,
  dispute arbitration, `Document.verificationStatus`, and review
  `moderationStatus` (see "A real neutral reviewer", "Extending the
  neutral reviewer to dispute arbitration", "Extending the neutral
  reviewer to document verification", and "Review moderation" above).
  Dispute arbitration and document verification both have an
  evidence-request step (`under_review` / `submitted`); vendor/supplier
  verification's `pending` plays the same "awaiting evidence" role. All
  three now also have a real, structured way for the reviewed account to
  *submit* evidence in response — see "Structured evidence-submission
  channels for document and vendor/supplier verification" above — not
  just general tools unrelated to the review itself. Review
  `moderationStatus` is the one exception, by design rather than
  oversight: "flagged" already plays an analogous "needs a decision"
  role there, raised by the reviewed party rather than requested by the
  reviewer, so there's nothing parallel to add. **A fifth field joined
  this list in a later pass**: `PropertyListing.verificationStatus` —
  see "A real listing:verify action for the neutral platform reviewer"
  above, which mirrors the vendor/supplier shape exactly (a real
  `verificationNotes` field, `platform_reviewer`-only, never granted to
  `listing:write`) but, like vendor/supplier verification and unlike
  dispute/document arbitration, has no structured evidence-submission
  channel of its own yet.
- **Real AR/VR renovation visualization — deliberately not attempted.**
  See "AI-generated renovation visualizations — the 2D half only" above:
  a bounded 2D "AI-edited before/after photo" slice is built, and every
  piece of it — R2 storage and the OpenAI image generation call itself —
  is now confirmed live end to end with real credentials, a real
  generated image included. Real AR/VR itself still needs a native mobile app or
  WebXR, photogrammetry/3D reconstruction, and a full 3D content
  pipeline — none of which exist here, and none of which are a bounded
  addition to this scaffold the way everything else on this list is. See
  [`docs/ar-vr-feasibility-spike.md`](docs/ar-vr-feasibility-spike.md)
  for a written-only (no code) breakdown of what each of those four
  pieces would actually require, the mobile-vs-web tradeoff underneath
  all of it, and one genuinely bounded first slice (a WebXR,
  Android-only material/color preview) that would fit inside this repo
  if a future pass wants to start somewhere real instead of nowhere.
- **The stub LLM provider now extracts structured arguments for the one
  skill that has any to extract.** See "Stub LLM argument extraction"
  above: `model_roi_scenario` is the only skill in the registry whose
  `inputSchema` declares anything beyond `NO_INPUT_SCHEMA`, so a
  dedicated heuristic parser (plain regexes, not a schema-driven engine)
  closes the actual gap rather than a generic one built for a registry
  of one real consumer. `AnthropicLlmProvider` (a real model reading the
  sentence and the schema together) still does this properly for every
  skill; the stub only ever had to do better than always sending `{}`,
  which it now does for the one skill where that mattered.
- **All four gateways Section 16 named are live now — deposits on all
  four, payouts on three of them.** See "A real payout gateway —
  Paystack Transfers", "Flutterwave and PayPal: a second and third real
  gateway", and "Stripe: the fourth gateway, now live too" above.
  Paystack, Flutterwave, and PayPal all process real deposits and
  payouts, each verified live against its own real API (Paystack's own
  account-activation block has since resolved — see "Rechecked later
  the same session" above — and the payout is now blocked one step
  later, on this specific test account's own ₦0 Paystack balance rather
  than activation; Flutterwave and PayPal both verified further,
  including a real payout attempt). Stripe is deposit-only by design, not by omission — see
  StripeService's own comment for why a payout path would need Stripe
  Connect, a materially different product, rather than being something
  this file could "complete in advance" — but its deposit side is fully
  live and was verified furthest of all four: an actual test-card
  checkout completed end to end, not just a session created. The
  licensing/compliance workstream the blueprint says to run alongside
  all of this (Section 15) is still entirely open — that was never code
  this pass could close.
- **Real identity verification (Sumsub, swapped from Dojah) is now
  fully live-verified, short of submitting an actual ID document.** See
  "Real identity (KYC) verification — Sumsub" above — real sandbox
  credentials created a genuine Sumsub applicant, minted a real WebSDK
  access token, and launched Sumsub's actual onboarding widget in the
  browser; `GET /identity/me`/`POST /identity/refresh` both correctly
  reflected the result against the real API. Only stopped short of
  clicking through actual document upload (nothing legitimate to test
  with). The Dojah-specific caveat this bullet used to carry
  (exact-token, not fuzzy, name-matching) no longer applies — that code
  doesn't exist anymore, and Sumsub's own document-review matching isn't
  something this integration controls or can characterize the same way.
- **Dispute arbitration's evidence gap is closed on both sides now, and
  the two-party path is no longer just coexisting alongside it
  unrelated.** See "Extending the neutral reviewer to dispute
  arbitration", "An evidence-request step for dispute arbitration", and
  "Submitting evidence on a dispute" above — `platform_reviewer` can
  arbitrate any open dispute platform-wide without ever having raised
  it, set it `under_review` with a note requesting more, and either
  party can now submit evidence in response through a real
  `DisputeEvidence` channel the arbitrator sees inline. See "Unifying
  two-party dispute resolution with arbitration" further below for the
  other half: once a reviewer sets a dispute `under_review`, the
  two-party resolve path is now actually locked out on it (a real gap
  found live — it previously wasn't, so either original party could
  silently overwrite an in-progress arbitration). Before arbitration
  ever touches a given dispute, the two-party path still works exactly
  as before — the account that raised a dispute still can't resolve it
  itself, and an open dispute still holds its milestone/payment.
- **Deeper AI (Priority 6)** — real AR/VR renovation visualization
  (needs real AR/VR infrastructure Module 23 itself doesn't add either —
  see "Module 23: AR/VR Property Viewing — Phase 1" above — deliberately
  not attempted) is the one item left on this list; a bounded 2D
  "AI-edited before/after photo" version of it is no longer on it
  either, and neither is a bounded 360°-tour/virtual-staging version —
  see the same section. Natural-language
  project summaries, valuation/ROI dashboards, and listing summaries
  beyond `assess_listing_risk` are no longer on it — see "A project
  summary skill, and a real Reports dashboard", "An ROI & valuation
  dashboard", and "A seller-facing listing summary skill" above.
- **The rest of the web app.** Several passes now built the app shell, the
  reusable `AskAiPanel`, and screens for portfolio + projects + vendor
  marketplace + payments/escrow + property/materials marketplace +
  documents + reviews + a payments rollup + a portfolio reports dashboard
  (see "Web app" above). Document
  verification is no longer on this list — see "Document verification"
  above — though it's still an account's own admin doing the verifying,
  not an independent reviewer.
- **Reviews now have moderation.** See "Review moderation — flagging and
  the neutral reviewer (Module 6)" above for the report/flag mechanism and
  the `platform_reviewer` role's hide/dismiss/restore actions this closed.
  `compare_vendor_quotes` and `boq_to_order` now read reviews (see "AI
  skills read reviews" below) — `assess_listing_risk` still doesn't, but
  that's because listings have no vendor/supplier relationship to read in
  the first place, not because it was skipped.
- **Auth hardening — down to one real tradeoff, explicitly accepted
  rather than deferred.** Rate limiting and refresh-token revocation are
  no longer on this list — see "Auth hardening: rate limiting,
  refresh-token revocation, refunds" above — and neither is client-side
  validation (see "Real client-side validation" above — password-
  confirmation is real now; email format and required fields still lean
  on native HTML plus the backend's own validation, deliberately, see
  that section), the password-reset email (now actually sent — see "A
  real email provider — Resend" above), or the access token living in
  `localStorage` (see "Moving auth off localStorage: httpOnly cookies +
  CSRF" above — it's in an httpOnly cookie now, with real CSRF
  protection alongside it). What that pass's own comment flags as the
  cost, not a gap: a `curl` request or a future mobile app can no longer
  authenticate with a bearer header, only a browser holding the httpOnly
  cookies can — a production system serving non-browser clients too would
  need a second auth mechanism (API keys) alongside this one.
- **Both halves of "Search and vector layers" now wired, neither one a
  literal match for what the Technical Architecture section named; object
  storage exists, but only for one narrow purpose.** The search half —
  see "Fuzzy free-text search for all three marketplaces" above — uses
  Postgres `pg_trgm`, not a real Elasticsearch/OpenSearch cluster: no
  fielded queries, no relevance tuning, no distributed index, but it does
  close the actual "can't search by name/keyword" gap for listings,
  vendors, and materials. The vector half — see "Semantic property search
  — pgvector + OpenAI embeddings" above — uses `pgvector` on the same
  Postgres instance rather than a dedicated vector DB service, and is
  fully wired for `Property` only, and now fully verified live with a
  real embedding end to end too — a real natural-language query
  correctly ranked a genuinely matching property first among four real
  candidates (see "Semantic property search" above for the exact query
  and result). Neither pass stood up new infrastructure to run or pay
  for — that was the explicit tradeoff made when choosing them.
  S3-compatible object storage is no
  longer narrow, either — see "A general file-upload pipeline" above:
  `StorageService` (Cloudflare R2) moved out of the visualizations
  module into its own, and a real `POST /uploads` endpoint feeds a real
  URL into `Document.fileUrl` and every evidence `fileUrl` field, not
  just AI-generated visualization images.
- **Payment/escrow licensing, market-specific verification mechanisms,
  and data residency remain real regulatory work, not something code
  solves — but there's now a real place to track it.** See "A platform
  compliance tracker" above: a checklist the platform's own trust &
  safety function uses to record which items exist, per market, and
  where each stands. It doesn't obtain a license, verify a jurisdiction's
  actual requirements, or enforce data residency — no code could — it
  just replaces "nothing" with an honest, live-verified tracking surface
  for the humans who do that work.
- **Invite/accept is fully closed out now.** See "Real invite/accept
  flow", "Revoking and resending pending invites", "A real email
  provider — Resend", and "Finding out you've been invited" above —
  invites are emailed, revocable, resendable, and now discoverable from
  both the account switcher and a fresh registration, not just the
  inviting account's own Members page. Nothing left on this list from the
  original invite/accept gap.
- **Chaining an AI Accept into its drafted action — down to one skill
  left, and it's advisory by design.** See "Accepting a status-update
  draft now posts it" and "Accepting a listing-description draft now
  saves it" above for the two skills this closed. Every other skill's
  Accept still only records the decision — and for the ones left that's
  not a shortcut, it's the design: `compare_vendor_quotes` and
  `boq_to_order` are explicitly advisory (see their own code comments),
  and `flag_payment_anomaly` reports anomalies that already happened in
  the ledger, not a pending action there's anything to "hold" — the
  milestone-release-hold example this bullet used to give doesn't
  actually correspond to any flag that skill raises.
