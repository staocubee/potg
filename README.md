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
- **What's still open**: the JWT (now the short-lived access token) still
  lives in `localStorage`, not an httpOnly cookie — moving to cookies
  would mean the API setting them itself (CORS + `credentials: 'include'`
  + CSRF protection, none of which exists here) and stops working cleanly
  for non-browser API callers (curl, the eventual mobile app) the way a
  bearer header does. That tradeoff is deliberate for this pass, not an
  oversight, but it's still the reason `localStorage` XSS exposure is
  listed under "Not built yet" rather than closed.

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
  `PropertyListing.verificationStatus` is a plain field with no dedicated
  review endpoint — the same simplification `Vendor.verificationStatus`
  took in Priority 3; Module 6's full verification workflow (a separate
  reviewer, risk flags, trust scores) isn't built.
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
  bypass around them. It's deliberately one tool call per turn, reported
  straight back to the user rather than looped into a second model call —
  an explicit scope boundary, not a full agent loop.

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
  disputes into one plain-language report, Module 23's "natural-language
  report generation on top of every report type."

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
- **No separate Inspector identity.** `inspectorName` is freeform text,
  not a relation — this scaffold has no licensed-inspector account type
  (Modules 1-24 stop at what's actually implemented here; see the
  "Not built yet" list below). A real deployment doing this for real
  would need one, the same way document verification's own "not a real
  neutral reviewer" limitation would.
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
- **No separate Contractor/Vendor-assignment identity.** `assignedTo` is
  freeform text, not a relation to `Vendor` — this module doesn't reuse
  Module 9's vendor marketplace at all, the same "record what's true, no
  forced workflow" tradeoff `Lease.tenantName` and
  `PropertyInspection.inspectorName` already document. A real deployment
  routing maintenance work through vendors would tie `assignedTo` to
  `Vendor` instead.
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
- **Closes Module 6's neutral-reviewer scope for this session.** All
  three fields that had either no verification path (`Vendor`/`Supplier.
  verificationStatus`) or only a self-service one (`Document.
  verificationStatus`, `Dispute.status`) now have a genuinely separate
  reviewer path. What's still open: the reviewer can't request more
  evidence before deciding on any of the three, and the score/self-serve
  paths still exist alongside the neutral ones rather than being
  replaced by them — see the "Not built yet" bullets below for exactly
  what that leaves on the table.

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

## Not built yet

Deliberately out of scope for this pass — beyond Priority 6 in the
blueprint, or explicitly cut from it:

- **Modules 6, 14, 16-24** (the full property-verification/trust
  workflow — the rest of risk flags/trust scores beyond listings and
  vendors/suppliers, an evidence-request step for the neutral reviewer;
  the rest of valuation beyond `PropertyValuation`, compliance, community
  management, AR/VR, the full fixed-dashboard side of reports, admin
  operations, ...) — this scaffold now proves the pattern for Modules 1,
  2, 4, 5, 7, 9, 10, 11, and a slice of 6, 8, 12, 13, 15, and 23, not the
  full 24. Modules 8, 12, and 13 are slices, not the full modules,
  because there's no separate Inspector, Contractor, or Tenant identity —
  see "Property inspections", "Maintenance requests", and "Leases" above.
  Module 6 is a slice because the `platform_reviewer` role's actions are
  still all one-shot status decisions with no way to request more
  evidence first — see "Extending the neutral reviewer to document
  verification" above for where that scope finished landing.
- **Property inspections — one gap left in the new module.** No separate
  Inspector identity (see "Property inspections" above — `inspectorName`
  is freeform text, not an account relation). Editing a scheduled
  inspection's date/type/project/inspector is now possible — see "Edit
  endpoints for Inspections, Leases, and Maintenance requests" below.
- **Leases — one gap left in the new module.** No separate Tenant
  identity (see "Leases" above). Editing a lease's rent/dates/deposit,
  and overdue-rent detection, are now possible — see "Edit endpoints"
  and "Overdue-rent detection" below.
- **Maintenance requests — one gap left in the new module.** No separate
  Contractor identity or link to Module 9's vendor marketplace (see
  "Maintenance requests" above — `assignedTo` is freeform text). Editing
  a request's title/description/priority is now possible — see "Edit
  endpoints" below.
- **Vendor and supplier trust scores are still the platform's own
  arithmetic.** See "Vendor trust score" and "Supplier trust score"
  above: the *score* is computed from data the vendor/supplier's own
  marketplace activity produced (reviews, completed work), not an
  independent audit — a real reviewer setting `verificationStatus` (see
  "A real neutral reviewer" above) only ever feeds one input into that
  formula, it doesn't audit the rest.
- **The neutral reviewer's decisions are all still one-shot, no evidence
  request.** `platform_reviewer` now covers `Vendor`/`Supplier.
  verificationStatus`, dispute arbitration, and `Document.
  verificationStatus` (see "A real neutral reviewer", "Extending the
  neutral reviewer to dispute arbitration", and "Extending the neutral
  reviewer to document verification" above) — on all three, the reviewer
  either decides now with what's already on file or doesn't decide at
  all. There's no way to ask the account being reviewed for more
  evidence and come back to it later; that stays a real deployment's
  workflow to build, not this scaffold's.
- **AI-generated renovation visualizations.** Explicitly deferred by
  Priority 6 itself, pending Module 22 (AR/VR) existing at all.
- **Multi-turn tool use in one chat turn.** `ChatService` calls at most one
  tool per message and reports the result directly — no agent loop where
  the model chains several tool calls before replying.
- **The stub LLM provider doesn't extract structured arguments from free
  text.** Every skill now declares a real `inputSchema` (see "Per-skill AI
  input schemas" above) and `AnthropicLlmProvider` passes it to the model,
  but `StubLlmProvider`'s keyword router only ever calls a matched tool with
  `{}` — a real model reads the sentence and the schema together to fill in
  arguments (e.g. "model a 10% rent increase" → `{ scenario:
  "rent_increase", rentIncreasePercent: 10 }`); the no-API-key stub doesn't
  attempt that.
- **Payouts are real too now, code-complete but not fully verified
  end-to-end.** See "A real payout gateway — Paystack Transfers" above —
  a payout now goes through Paystack's actual Transfer API rather than
  being simulated, verified live up to the account-holder OTP step,
  which is currently blocked on external Paystack account activation.
  Flutterwave/Stripe/PayPal integration (Section 16 named all four) and
  the licensing/compliance workstream the blueprint says to run
  alongside it (Section 15) are both still open — this pass only covers
  Paystack.
- **Dispute arbitration has no evidence-request step.** See "Extending
  the neutral reviewer to dispute arbitration" above for the actual
  neutral-reviewer path this pass added — `platform_reviewer` can now
  arbitrate any open dispute platform-wide without ever having raised it.
  What's still missing: no way for the reviewer to request more evidence
  from either party before deciding, and the two-party path ("Two-party
  dispute resolution" above — the account that raised a dispute can't
  resolve it, an open dispute holds its milestone/payment) still exists
  alongside arbitration rather than being replaced by it.
- **Deeper AI (Priority 6)** — natural-language project summaries beyond
  what `summarize_property`/`draft_project_status_update` already do,
  financial modeling chat, listing/risk summaries, valuation/ROI
  dashboards, AI-generated renovation visualizations (needs AR/VR first).
- **The rest of the web app.** Several passes now built the app shell, the
  reusable `AskAiPanel`, and screens for portfolio + projects + vendor
  marketplace + payments/escrow + property/materials marketplace +
  documents + reviews + a payments rollup (see "Web app" above). Document
  verification is no longer on this list — see "Document verification"
  above — though it's still an account's own admin doing the verifying,
  not an independent reviewer.
- **Reviews still have no moderation.** See "Review editing, replies, and
  the 'me' dashboards" above for what changed — the reviewer can now edit
  or delete their own review and the vendor/supplier can reply, but
  there's still no admin/moderator who can act on a review that isn't
  theirs, and no report/flag mechanism. `compare_vendor_quotes` and
  `boq_to_order` now read reviews (see "AI skills read reviews" below) —
  `assess_listing_risk` still doesn't, but that's because listings have no
  vendor/supplier relationship to read in the first place, not because it
  was skipped.
- **Auth hardening that's still open.** The access token lives in
  `localStorage` (XSS-exposed) rather than an httpOnly cookie — a
  deliberate tradeoff, see "Web app auth hardening" above, not an
  oversight. The password-reset email is logged/returned instead of
  actually emailed (no provider wired up). No client-side validation
  beyond native HTML `required`/`minLength`/`type="email"`. Rate limiting
  and refresh-token revocation are no longer on this list — see "Auth
  hardening: rate limiting, refresh-token revocation, refunds" above.
- **Search, media, and vector layers** (Elasticsearch/OpenSearch, S3-
  compatible object storage, a vector DB for AI context retrieval) — the
  Technical Architecture section calls these out, none are wired up here.
  `Document.fileUrl` currently expects a URL you provide yourself.
- **Payment/escrow licensing, market-specific verification mechanisms,
  and data residency** — the compliance work the blueprint review flagged
  needs to run in parallel with engineering, not be solved by this code.
- **Invite/accept exists now, with real gaps left in it.** See "Real
  invite/accept flow" and "Revoking and resending pending invites" above
  for what's there. Still open: no invite listing beyond the account's
  own Members page, and email delivery is the same "logged + returned
  raw" scaffold-depth tradeoff as password reset — a real deployment must
  drop `inviteToken` from the response and actually send it.
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
