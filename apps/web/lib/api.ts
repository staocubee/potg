// Typed client for the NestJS API (apps/api). One file, one shape per
// endpoint, so every screen and the Ask AI panel share the exact same
// request/response contracts instead of each hand-rolling fetch calls.
//
// Auth pattern (mirrors apps/api/src/common/guards): the actual access
// token lives in an httpOnly cookie this JS can never read — every fetch
// below just sends `credentials: "include"` and the browser attaches it
// automatically. `ApiClient`'s own `token` field is NOT a credential
// anymore; it's a non-secret "does the caller believe a session is
// active" marker (see lib/auth.tsx's AuthProvider), kept only so the
// 401-triggers-a-refresh-then-retry logic below still has something to
// gate on. A separate `X-Account-Id` header says which account the user
// is currently acting as (Module 1 — one user can belong to several
// accounts) — that one really is just plumbed straight through, since
// it's not a secret.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  // NOT sent anywhere — the real credential lives in an httpOnly cookie
  // the browser attaches on its own. This only gates whether request()
  // believes the call was meant to be authenticated, i.e. whether a 401
  // is worth retrying after a silent refresh. See the module comment.
  token?: string | null;
  accountId?: string | null;
  // Internal — set when request() re-issues a call after a successful
  // silent refresh, so a second 401 (refresh token also expired/invalid,
  // or the server rejects the retry for some other reason) fails instead
  // of looping forever.
  _isRetry?: boolean;
};

// ---- Access-token refresh -------------------------------------------------
//
// AuthService issues a short-lived (1h) access token plus a long-lived
// (30d) refresh token (see apps/api/src/auth/auth.service.ts), both now
// httpOnly cookies (see AuthController) — this module never sees either
// token's actual value. Rather than making every screen notice a 401 and
// handle it, request() below does it once, centrally: on a 401 from an
// authenticated call, it transparently asks POST /auth/refresh to mint a
// new pair (the browser sends the existing refresh_token cookie
// automatically; the response Set-Cookie headers replace both cookies,
// invisibly to this code), retries the original call, and only surfaces
// an error to the caller if that retry also fails (refresh token expired
// too, or this account was otherwise signed out — either way, the right
// response is a real logout).
//
// lib/auth.tsx's AuthProvider is the only caller of configureAuthSession —
// it's the one place that knows how to force a logout and redirect, so
// this module never touches storage or routing itself.
type AuthSessionHooks = {
  onRefreshFailed: () => void;
};

let authSessionHooks: AuthSessionHooks | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function configureAuthSession(hooks: AuthSessionHooks | null) {
  authSessionHooks = hooks;
}

// Endpoints that either don't need a session or ARE the refresh flow
// itself — a 401 from any of these must never trigger another refresh
// attempt.
const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh"];

function performRefresh(): Promise<boolean> {
  // Concurrent 401s (several requests firing around the same time, all
  // hitting the same expired access token) share one in-flight refresh
  // call instead of each racing their own — the check-and-set here is
  // synchronous, so it's safe without a lock.
  if (!refreshInFlight) {
    refreshInFlight = request<unknown>("/auth/refresh", { method: "POST" })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Reads the CSRF double-submit cookie (see apps/api/src/common/guards/
// csrf.guard.ts) so it can be echoed back as a header on mutating
// requests — this cookie is deliberately NOT httpOnly, it carries no
// authority on its own, only proof that this same-site page could read
// it. SSR-safe: `document` doesn't exist server-side, and there's no
// session to protect there either.
function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.accountId) headers["X-Account-Id"] = opts.accountId;
  if (method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    // Sends the httpOnly auth cookies (and the readable CSRF one) on
    // every request, including cross-origin ones to the API's own port —
    // see main.ts's CORS config for the other half of making that work.
    credentials: "include",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // A 2xx with no application/json content-type is what every
  // "not found"/"no profile yet" endpoint in this API produces when its
  // handler returns null (see e.g. GET /vendors/me, GET /tenant/lease) —
  // Nest sends an empty body with no content-type at all for that, not
  // the literal JSON string "null". Reading it back as `null` (not
  // `undefined`) matters: several pages use `undefined` as their own
  // "still loading" sentinel (e.g. VendorDashboardPage's `vendor` state),
  // so returning `undefined` here made a real "no profile yet" result
  // indistinguishable from "hasn't resolved yet" and left those pages
  // stuck on their loading state forever. Draining the body either way
  // (even though it's empty in the null case) also avoids the browser
  // reporting the response as an aborted/unconsumed stream.
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => undefined) : await res.text().then(() => null).catch(() => null);

  if (!res.ok) {
    // getCsrfToken() !== null is a "was there ever a session to refresh"
    // check, not the actual credential — the csrf_token cookie is set and
    // cleared in lockstep with refresh_token (see cookie.util.ts), so its
    // absence is a reliable signal there's nothing to refresh, without
    // this code ever needing to see the real refresh token. Skips a
    // guaranteed-to-fail (and CSRF-guard-rejected, not even a clean 401)
    // round trip on every page load for a visitor who was never signed in.
    if (res.status === 401 && opts.token && !opts._isRetry && !NO_REFRESH_PATHS.includes(path) && getCsrfToken() !== null) {
      const refreshed = await performRefresh();
      if (refreshed) {
        return request<T>(path, { ...opts, _isRetry: true });
      }
      authSessionHooks?.onRefreshFailed();
    }
    // Nest's default HttpException body: { statusCode, message, error }
    // where `message` can be a string or a class-validator string[].
    const rawMessage = data?.message;
    const message = Array.isArray(rawMessage) ? rawMessage.join(", ") : rawMessage ?? res.statusText;
    throw new ApiError(res.status, message || `Request failed (${res.status})`);
  }

  return data as T;
}

// ---- Shapes -----------------------------------------------------------

export type CurrentUser = { id: string; email: string; emailVerified: boolean };

export type IdentityStatus = {
  identityVerificationStatus: "not_verified" | "pending" | "verified" | "failed" | string;
  identityVerificationNotes?: string | null;
  identityVerifiedAt?: string | null;
  // Set once startIdentityVerification has created a Sumsub applicant —
  // present even before a result comes back, since it's what
  // refreshIdentityStatus polls against.
  sumsubApplicantId?: string | null;
};

export type AccountSummary = {
  accountId: string;
  accountName: string;
  accountType: "INDIVIDUAL" | "FAMILY" | "COMPANY" | "VENDOR" | "SUPPLIER" | string;
  role: string;
  // The acting role's own granted permission keys — lets the UI hide or
  // disable an action before the user clicks it, rather than only ever
  // finding out via a 403. Not itself a security boundary — the real
  // check is still PermissionsGuard on every request.
  permissions: string[];
};

export type AccountMemberSummary = {
  id: string;
  status: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
  role: { key: string; name: string };
};

export type AccountInviteSummary = {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  role: { key: string; name: string };
};

// GET /invites/mine — every pending invite sent to the signed-in user's
// own email, across every account, not just the one Members page they
// happen to be looking at. See AccountsService.findMyInvites.
export type AccountInviteMine = {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  account: { id: string; name: string; accountType: string };
  role: { key: string; name: string };
};

// A user-requested feature (not from the numbered blueprint): a public,
// no-login "one page website" per account — GET /public/accounts/:id,
// the first genuinely public (no auth) data endpoint in this API beyond
// the two token-gated invite previews. See
// PublicProfilesService's own comment on why its return shape is a
// hand-picked whitelist, not a reused authenticated-view shape.
// A currently-active visibility-package boost — see boost.util.ts.
// Deliberately not named/worded "verified": that's the platform's own
// separate KYC-style verificationStatus concept on Vendor/Supplier/
// PropertyListing, shown as its own distinct badge wherever it appears.
export type PackageBadge = { packageTitle: string; boostWeight: number } | null;

export type PublicProfile = {
  accountId: string;
  accountName: string;
  accountType: string;
  memberSince: string;
  packageBadge: PackageBadge;
  vendor?: {
    businessName: string;
    serviceCategory: string;
    locationCoverage?: string | null;
    verificationStatus: string;
    ratingAverage?: string | null;
    trustScore: { score: number; band: string };
    reviews: { rating: number; comment?: string | null; response?: string | null; createdAt: string }[];
  } | null;
  supplier?: {
    businessName: string;
    category: string;
    locationCoverage?: string | null;
    verificationStatus: string;
    ratingAverage?: string | null;
    trustScore: { score: number; band: string };
    reviews: { rating: number; comment?: string | null; response?: string | null; createdAt: string }[];
    products: {
      id: string;
      name: string;
      category: string;
      unit: string;
      unitPrice: string;
      currency: string;
      description?: string | null;
      isRentable: boolean;
      rentalPricePerDay?: string | null;
    }[];
  } | null;
  listings?: {
    id: string;
    listingType: string;
    askingPrice: string;
    currency: string;
    title: string;
    description?: string | null;
    photoUrls: string[];
    propertyType: string;
    city?: string | null;
    country: string;
  }[];
};

// The landing page's own public data — a small, real cross-section of
// the marketplace. See PublicProfilesService.getMarketplaceHighlights.
export type MarketplaceHighlights = {
  listings: {
    id: string;
    accountId: string;
    listingType: string;
    askingPrice: string;
    currency: string;
    title: string;
    photoUrls: string[];
    propertyType: string;
    city?: string | null;
    country: string;
    packageBadge: PackageBadge;
  }[];
  vendors: {
    accountId: string;
    businessName: string;
    serviceCategory: string;
    locationCoverage?: string | null;
    ratingAverage?: string | null;
    trustScore: { score: number; band: string };
    packageBadge: PackageBadge;
  }[];
  suppliers: {
    accountId: string;
    businessName: string;
    category: string;
    locationCoverage?: string | null;
    ratingAverage?: string | null;
    trustScore: { score: number; band: string };
    packageBadge: PackageBadge;
  }[];
};

// The visibility-package catalog and an account's own purchase history —
// see PackagesService/PackageSubscription's own schema comment. `status`
// here is exactly what's stored ("pending" | "active" | "failed"); the
// web app computes "expired" itself from expiresAt, same live check the
// API's own boost.util.ts uses, rather than trusting a stored value that
// never actually flips.
export type VisibilityPackage = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  price: string;
  currency: string;
  billingPeriod: "monthly" | "annual" | string;
  boostWeight: number;
  active: boolean;
};

export type PackageSubscription = {
  id: string;
  accountId: string;
  packageId: string;
  status: "pending" | "active" | "failed" | string;
  amount: string;
  currency: string;
  provider: string;
  providerReference?: string | null;
  startedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  // Phase 2 — real auto-renewal, Paystack only. authorizationCode is
  // never sent to the frontend as a value to act on (it's an internal
  // charge token) but its presence/absence isn't sensitive — the API
  // includes it as-is; the web app only ever checks it via
  // canAutoRenew below, never displays it.
  autoRenew: boolean;
  authorizationCode?: string | null;
  payerEmail?: string | null;
  renewedFromId?: string | null;
  package: VisibilityPackage;
};

export type InvitePreview = {
  accountName: string;
  accountType: string;
  roleName: string;
  email: string;
  expiresAt: string;
  hasAccount: boolean;
};

// A user-requested feature (not from the numbered blueprint): a property
// owner invites a developer to build on their property under a real
// deal — either a time-boxed fractional ownership stake, or a share of
// the eventual sale proceeds. See PropertyDevelopmentAgreement's own
// schema comment for the full reasoning, including why proceeds_share is
// recorded but not automatically paid out.
export type DevelopmentAgreement = {
  id: string;
  propertyId: string;
  accountId: string;
  developerEmail: string;
  developerAccountId?: string | null;
  agreementType: "temporary_ownership" | "proceeds_share" | string;
  ownershipPercentage?: string | null;
  termMonths?: number | null;
  proceedsSharePercentage?: string | null;
  terms: string;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired" | string;
  expiresAt: string;
  respondedAt?: string | null;
  createdAt: string;
};

export type DevelopmentAgreementPreview = {
  propertyName: string;
  propertyAddress: string;
  developerEmail: string;
  agreementType: string;
  ownershipPercentage?: string | null;
  termMonths?: number | null;
  proceedsSharePercentage?: string | null;
  terms: string;
  expiresAt: string;
  hasAccount: boolean;
};

export type DevelopmentAgreementMine = DevelopmentAgreement & {
  property: { id: string; name: string };
};

// Module 17, Phase 1 — Communities, Residents, and Community
// Announcements. See apps/api/src/communities and schema.prisma's own
// "Module 17" comment for the full scoping reasoning.
export type Resident = {
  id: string;
  communityId: string;
  name: string;
  unitNumber: string;
  email?: string | null;
  phone?: string | null;
  residentType: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunityAnnouncement = {
  id: string;
  communityId: string;
  title: string;
  body: string;
  createdByUserId: string;
  createdAt: string;
};

export type Community = {
  id: string;
  accountId: string;
  name: string;
  addressLine: string;
  city?: string | null;
  state?: string | null;
  country: string;
  communityType: string;
  createdAt: string;
  updatedAt: string;
  residents?: Resident[];
  announcements?: CommunityAnnouncement[];
};

// Module 24's "Branch property report"/"Facility cost report" — see
// Branch's own schema comment. `_count` only present on GET /branches
// (the list view); `properties` only present on GET /branches/:id.
export type Branch = {
  id: string;
  accountId: string;
  name: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { properties: number };
  properties?: { id: string; name: string; propertyType: string; status: string; estimatedValue?: string | null }[];
};

export type Property = {
  id: string;
  accountId: string;
  propertyType: string;
  name: string;
  addressLine: string;
  city?: string | null;
  state?: string | null;
  country: string;
  // Geocoded automatically from the address above when
  // GOOGLE_MAPS_API_KEY is configured on the API (see
  // GoogleGeocodingService) — null until then, or if it's not
  // configured at all. Powers the property page's Live View card.
  latitude?: number | null;
  longitude?: number | null;
  status: string;
  currentUse?: string | null;
  estimatedValue?: string | null;
  // Module 3: Property Details
  bedrooms?: number | null;
  bathrooms?: number | null;
  squareFootage?: number | null;
  yearBuilt?: number | null;
  amenities: string[];
  photoUrls: string[];
  // Module 24's Branch feature — null means unassigned, a real, expected
  // state (see Branch's own schema comment).
  branchId?: string | null;
  createdAt: string;
  updatedAt: string;
  owners?: unknown[];
  documents?: PropertyDocument[];
  timelineEvents?: PropertyTimelineEvent[];
};

// Module 21 Phase 1 — "Family representative access." Wires up
// PropertyAccessGrant, a model that has existed since Module 1 and was
// never read or written anywhere until now.
export type AccessGrant = {
  id: string;
  propertyId: string;
  accountMemberId: string;
  canView: boolean;
  canEdit: boolean;
  canApprovePayments: boolean;
  createdAt: string;
  accountMember?: { user: { name: string; email: string }; role: { key: string } };
};

// Module 22 Phase 1 — the device registry. `status` is always
// "not_connected" this pass — see PropertyDevice's own schema comment.
export type PropertyDevice = {
  id: string;
  propertyId: string;
  deviceType: string;
  name: string;
  provider?: string | null;
  status: string;
  createdAt: string;
};

// Module 23 Phase 1 — 360°/tour media metadata.
export type PropertyTourAsset = {
  id: string;
  propertyId: string;
  mediaUrl: string;
  mediaType: string;
  label?: string | null;
  sortOrder: number;
  createdAt: string;
};

export type Announcement = {
  id: string;
  accountId: string;
  propertyId?: string | null;
  title: string;
  body: string;
  createdByUserId: string;
  createdAt: string;
  property?: { id: string; name: string } | null;
};

// Module 19 Phase 1's own in-app channel — see the schema's own
// "Module 19" comment for the fixed set of types Phase 1 actually
// creates (project_update, maintenance_resolved, dispute_raised,
// listing_inquiry, document_expiring).
export type Notification = {
  id: string;
  accountId: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
};

export type PropertyDocument = {
  id: string;
  documentType: string;
  fileUrl: string;
  verificationStatus: string;
  expiryDate?: string | null;
  createdAt: string;
};

// The account-wide shape GET /documents and GET /documents/property/:id
// return — a superset of PropertyDocument (which is what GET
// /properties/:id embeds inline instead).
export type AppDocument = {
  id: string;
  accountId: string;
  propertyId?: string | null;
  // Tags this document as belonging to a specific tenancy — see the
  // schema comment on Document.leaseId. Set via createDocument's own
  // leaseId input; `lease` is only populated by GET /documents and GET
  // /documents/property/:id (the landlord's own views), not returned by
  // GET /tenant/documents which already knows whose tenancy it's asking
  // about.
  leaseId?: string | null;
  lease?: { tenantName: string } | null;
  documentType: string;
  fileUrl: string;
  verificationStatus: "not_verified" | "submitted" | "verified" | "rejected" | string;
  verificationNotes?: string | null;
  expiryDate?: string | null;
  uploadedByUserId: string;
  createdAt: string;
  // Only present on GET /documents/pending (the neutral-reviewer queue) —
  // the account-scoped /documents routes already know whose document it is.
  account?: { id: string; name: string };
  property?: { id: string; name: string } | null;
  // Also only present on GET /documents/pending — the account's own view
  // fetches this separately via findDocumentEvidence.
  evidence?: DocumentEvidence[];
};

export type DocumentEvidence = {
  id: string;
  documentId: string;
  accountId: string;
  submittedByUserId: string;
  note: string;
  fileUrl?: string | null;
  createdAt: string;
};

export type VendorVerificationEvidence = {
  id: string;
  vendorId: string;
  submittedByUserId: string;
  note: string;
  fileUrl?: string | null;
  createdAt: string;
};

export type SupplierVerificationEvidence = {
  id: string;
  supplierId: string;
  submittedByUserId: string;
  note: string;
  fileUrl?: string | null;
  createdAt: string;
};

export type PropertyTimelineEvent = {
  id: string;
  eventType: string;
  label: string;
  occurredAt: string;
};

export type PropertyValuation = {
  id: string;
  propertyId: string;
  estimatedValue: string;
  currency: string;
  source: string;
  notes?: string | null;
  valuedAt: string;
};

// The 2D "AI-generated renovation visualization" slice — see the schema
// comment on RenovationVisualization for why real AR/VR (Module 23)
// isn't what this is. `kind` also covers Module 23's "Virtual staging" —
// same pipeline, a different prompt.
export type RenovationVisualization = {
  id: string;
  propertyId: string;
  projectId?: string | null;
  requestedByUserId: string;
  kind: "renovation" | "staging" | string;
  prompt: string;
  beforeImageUrl: string;
  afterImageUrl?: string | null;
  status: "pending" | "completed" | "failed" | string;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export type RoiSummary = {
  currency: string;
  currentValue: number;
  acquisitionValue: number;
  totalProjectSpend: number;
  invested: number;
  simpleRoiPercent: number;
  totalAnnualRent: number;
  grossYieldPercent: number;
  valuationHistory: { id: string; estimatedValue: number; currency: string; source: string; valuedAt: string }[];
};

export type ComparableValuation = {
  city: string | null;
  propertyType: string;
  minComparablesRequired: number;
  estimates: {
    currency: string;
    comparableCount: number;
    estimatedValue: number | null;
    minAskingPrice: number;
    maxAskingPrice: number;
    comparables: { listingId: string; title: string; askingPrice: number }[];
  }[];
};

export type InspectionFinding = {
  id: string;
  inspectionId: string;
  area: string;
  description: string;
  severity: "minor" | "moderate" | "major" | string;
  // Real remote-verification evidence — uploaded via uploadFile()
  // (POST /uploads, Cloudflare R2), not a pasted URL.
  photoUrls: string[];
  createdAt: string;
};

export type AssignedVendor = { id: string; businessName: string; serviceCategory: string; verificationStatus: string };

export type PropertyInspection = {
  id: string;
  propertyId: string;
  projectId?: string | null;
  inspectionType: "general" | "pre_purchase" | "move_in" | "move_out" | "safety" | "post_renovation" | string;
  status: "scheduled" | "completed" | "cancelled" | string;
  scheduledFor: string;
  inspectorVendorId?: string | null;
  inspectorVendor?: AssignedVendor | null;
  inspectorName?: string | null;
  overallResult?: "pass" | "needs_attention" | "fail" | string | null;
  summary?: string | null;
  // General walkthrough/overview photos, set alongside overallResult on
  // completion — see InspectionFinding.photoUrls for per-finding evidence.
  photoUrls: string[];
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  findings?: InspectionFinding[];
};

export type LeaseRentPayment = {
  id: string;
  leaseId: string;
  amount: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  method: string;
  notes?: string | null;
  paidAt: string;
};

export type Lease = {
  id: string;
  propertyId: string;
  tenantName: string;
  tenantEmail?: string | null;
  tenantPhone?: string | null;
  // Set once the tenant has their own AccountType.TENANT account and a
  // landlord has linked it — see POST .../leases/:leaseId/link-tenant.
  tenantAccountId?: string | null;
  tenantAccount?: { id: string; name: string } | null;
  rentAmount: string;
  currency: string;
  rentFrequency: "weekly" | "monthly" | "annually" | string;
  depositAmount?: string | null;
  startDate: string;
  endDate?: string | null;
  status: "active" | "ended" | "terminated" | string;
  notes?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  rentPayments?: LeaseRentPayment[];
  property?: { id: string; name: string; addressLine: string; city?: string | null; country: string };
};

export type MaintenanceRequest = {
  id: string;
  propertyId: string;
  leaseId?: string | null;
  title: string;
  description: string;
  priority: "low" | "normal" | "high" | "urgent" | string;
  status: "open" | "in_progress" | "resolved" | "cancelled" | string;
  reportedBy?: string | null;
  assignedVendorId?: string | null;
  assignedVendor?: AssignedVendor | null;
  assignedTo?: string | null;
  resolutionNotes?: string | null;
  // Module 24's "Maintenance report" (cost) — set alongside
  // resolutionNotes at resolution time, null otherwise.
  cost?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiSkillInputField = {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: string | number | boolean;
};

export type AiSkillInputSchema = {
  type: "object";
  properties: Record<string, AiSkillInputField>;
  required?: string[];
};

export type AiSkill = {
  key: string;
  label: string;
  requiredPermission: string;
  moduleContextPrefix: string;
  inputSchema: AiSkillInputSchema;
};

export type AiActionResult = {
  requestId: string;
  outputId: string;
  draftLabel: string;
  items: string[];
  warn: boolean;
};

export type AiUsageSummary = {
  total: number;
  last30Days: number;
  undecided: number;
  byActionType: { actionType: string; count: number }[];
  byDecision: { decision: string; count: number }[];
};

export type AiMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  toolName?: string | null;
  aiOutputId?: string | null;
  createdAt: string;
};

export type AiConversation = {
  id: string;
  accountId: string;
  moduleContext?: string | null;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: AiMessage[];
};

export type AiActionApproval = {
  id: string;
  aiOutputId: string;
  decision: "accepted" | "edited" | "discarded";
  decidedAt: string;
  notes?: string | null;
};

// --- Projects & vendor marketplace (Priority 3) -------------------------

export type ProjectStage = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  status: "not_started" | "in_progress" | "completed" | string;
};

export type ProjectMilestone = {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  paymentAmount?: string | null;
  dueDate?: string | null;
  status: "pending" | "in_progress" | "completed" | string;
  approvalStatus: "not_requested" | "requested" | "approved" | "rejected" | string;
  createdAt: string;
};

export type ProjectUpdate = {
  id: string;
  projectId: string;
  milestoneId?: string | null;
  submittedByUserId: string;
  description: string;
  mediaUrls: string[];
  createdAt: string;
};

export type TrustAuditFactor = { rating: string; notes: string; createdAt: string } | null;

export type VendorTrustScore = {
  score: number;
  band: "excellent" | "good" | "fair" | "caution" | string;
  factors: {
    verificationStatus: string;
    ratingAverage: number | null;
    reviewCount: number;
    completedProjects: number;
    disputeCount: number;
    latestAudit: TrustAuditFactor;
    identityVerifiedOperator: boolean;
    licenseExpired: boolean;
  };
};

export type VendorTrustAudit = {
  id: string;
  vendorId: string;
  reviewedByUserId: string;
  rating: "clean" | "minor_concerns" | "major_concerns" | string;
  notes: string;
  createdAt: string;
};

export type Vendor = {
  id: string;
  accountId: string;
  businessName: string;
  serviceCategory: string;
  locationCoverage?: string | null;
  verificationStatus: string;
  verificationNotes?: string | null;
  ratingAverage?: string | null;
  bankAccountNumber?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  // Which real payout gateway bankAccountNumber/bankCode/bankAccountName
  // (or paypalPayoutEmail) are currently set up for — "paystack" |
  // "flutterwave" | "paypal" | null. Null falls back to a simulated
  // payout, same as no bank details on file at all.
  payoutProvider?: string | null;
  paypalPayoutEmail?: string | null;
  // Self-reported, unverified — see the schema comment on
  // Vendor.licenseNumber. Set together via setVendorLicense.
  licenseNumber?: string | null;
  licenseIssuingBody?: string | null;
  licenseExpiresAt?: string | null;
  createdAt: string;
  reviews?: VendorReview[];
  trustScore?: VendorTrustScore;
  // Only present on GET /vendors (the directory browse) — see
  // VendorsService.findAll's own boost.util.ts wiring.
  packageBadge?: PackageBadge;
};

export type PaystackBank = { name: string; code: string; currency: string };

export type VendorReview = {
  id: string;
  vendorId: string;
  projectId: string;
  accountId: string;
  rating: number;
  comment?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  moderationStatus: "published" | "flagged" | "hidden" | string;
  flagReason?: string | null;
  flaggedAt?: string | null;
  moderationNotes?: string | null;
  moderatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // Only present on GET /vendors/reviews/flagged
  vendor?: { id: string; businessName: string };
};

export type VendorQuote = {
  id: string;
  projectId: string;
  vendorId: string;
  amount: string;
  currency: string;
  notes?: string | null;
  status: "requested" | "submitted" | "accepted" | "declined" | "withdrawn" | string;
  createdAt: string;
  vendor?: Vendor;
  project?: { id: string; title: string; status: string };
};

export type ProjectVendorAssignment = {
  id: string;
  projectId: string;
  vendorId: string;
  role: string;
  vendor?: Vendor;
  // Only populated by GET /vendors/me/projects — the reverse direction
  // from the project page's own use of this type (which populates
  // `vendor` instead, for a project's own assignments list).
  project?: {
    id: string;
    title: string;
    status: string;
    currency: string;
    property: { name: string } | null;
    stages: { name: string; status: string; sortOrder: number }[];
  };
};

export type Project = {
  id: string;
  accountId: string;
  propertyId: string;
  projectType: string;
  title: string;
  scopeDescription?: string | null;
  budget?: string | null;
  currency: string;
  status: "planning" | "in_progress" | "on_hold" | "completed" | "cancelled" | string;
  startDate?: string | null;
  expectedEndDate?: string | null;
  createdAt: string;
  updatedAt: string;
  stages?: ProjectStage[];
  milestones?: ProjectMilestone[];
  updates?: ProjectUpdate[];
  quotes?: VendorQuote[];
  assignments?: ProjectVendorAssignment[];
  reviews?: VendorReview[];
};

export type Payout = {
  id: string;
  vendorId: string;
  projectId: string;
  milestoneId?: string | null;
  // Net — what the vendor actually receives. grossAmount is the
  // milestone's own full value (what left escrow); platformFeeAmount is
  // the difference, the platform's own real fee cut — see
  // PaymentsService.releaseMilestone's own comment on the model.
  amount: string;
  grossAmount: string;
  platformFeeAmount: string;
  currency: string;
  status: "pending" | "processing" | "paid" | "failed" | string;
  payoutMethod: string;
  provider: "manual" | "paystack" | "flutterwave" | "paypal" | string;
  providerReference?: string | null;
  createdAt: string;
  paidAt?: string | null;
  project?: { id: string; title: string };
};

// --- Payments & escrow (Priority 4) --------------------------------------

export type Payment = {
  id: string;
  accountId: string;
  projectId: string;
  escrowAccountId: string;
  amount: string;
  currency: string;
  provider: string;
  providerReference?: string | null;
  status: "pending" | "completed" | "failed" | "refunded" | string;
  createdAt: string;
};

export type EscrowLedgerEntry = {
  id: string;
  escrowAccountId: string;
  entryType: "deposit" | "release" | "refund" | "adjustment" | string;
  amount: string;
  balanceAfter: string;
  relatedPaymentId?: string | null;
  relatedMilestoneId?: string | null;
  relatedPayoutId?: string | null;
  notes?: string | null;
  createdAt: string;
};

// GET /projects/:id/escrow returns this shape even for a project that's
// never been funded (no EscrowAccount row exists yet) — id/createdAt/
// updatedAt are absent in that case, which is why they're optional here
// rather than just using Prisma's real EscrowAccount shape.
export type EscrowAccount = {
  id?: string;
  projectId: string;
  balance: string | number;
  currency: string | null;
  status: "active" | "closed" | "not_funded" | string;
  createdAt?: string;
  updatedAt?: string;
  ledgerEntries: EscrowLedgerEntry[];
};

export type Receipt = {
  id: string;
  accountId: string;
  receiptNumber: string;
  paymentId?: string | null;
  payoutId?: string | null;
  amount: string;
  currency: string;
  issuedAt: string;
};

// Module 18's own "Dispute Types" list — shared across every
// dispute-raising form (project owner-side, vendor-side, order-side)
// rather than duplicated per form, since it's the exact same fixed
// vocabulary everywhere on the frontend (unlike the backend's own DTOs,
// which do duplicate small enums like this — see CreatePropertyDto/
// UpdatePropertyDto's own PROPERTY_TYPES for that convention).
export const DISPUTE_TYPES = [
  { value: "poor_workmanship", label: "Poor workmanship" },
  { value: "delayed_project", label: "Delayed project" },
  { value: "material_delivery_issue", label: "Material delivery issue" },
  { value: "payment_disagreement", label: "Payment disagreement" },
  { value: "property_listing_dispute", label: "Property listing dispute" },
  { value: "tenant_complaint", label: "Tenant complaint" },
  { value: "vendor_misconduct", label: "Vendor misconduct" },
  { value: "refund_request", label: "Refund request" },
  { value: "other", label: "Other" },
];

export type Dispute = {
  id: string;
  // Module 18 Phase 1 — projectId is now optional: exactly one of
  // projectId/orderId is ever set on a real dispute (see the schema's
  // own comment), never both, never neither.
  projectId?: string | null;
  orderId?: string | null;
  raisedByAccountId: string;
  milestoneId?: string | null;
  paymentId?: string | null;
  payoutId?: string | null;
  disputeType: string;
  reason: string;
  status: "open" | "under_review" | "resolved" | "rejected" | string;
  resolutionNotes?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  // Only present on GET /vendors/me/disputes and GET /payments/disputes/
  // open — the owner-side /projects/:projectId/disputes routes already
  // know the project.
  project?: { id: string; title: string; accountId?: string };
  // Only present on GET /payments/disputes/open — an order dispute has
  // no project at all, so the arbitrator's queue includes this instead.
  order?: { id: string; accountId: string; supplier: { businessName: string } };
  // Only present on GET /payments/disputes/open — the neutral reviewer's
  // queue includes it directly so arbitrating isn't done blind; the
  // owner/vendor-side dispute lists fetch it separately via
  // findDisputeEvidence/findDisputeEvidenceAsVendor (see DisputeEvidence
  // below) once a specific dispute is opened.
  evidence?: DisputeEvidence[];
};

// The structured "submit more evidence" channel for a dispute under
// arbitration — see PaymentsService.submitDisputeEvidence.
export type DisputeEvidence = {
  id: string;
  disputeId: string;
  accountId: string;
  submittedByUserId: string;
  note: string;
  fileUrl?: string | null;
  createdAt: string;
};

// GET /payments/overview — the account-wide rollup that finally backs the
// sidebar's "Payments" screen (previously every route lived only inside a
// single project's page). Money is grouped by currency rather than summed
// across currencies, same caution the portfolio-report AI skill takes.
export type PaymentsOverview = {
  projectCount: number;
  escrowByCurrency: { currency: string; balance: number }[];
  depositedByCurrency: { currency: string; total: number }[];
  releasedByCurrency: { currency: string; total: number }[];
  openDisputeCount: number;
  projects: {
    projectId: string;
    title: string;
    propertyName: string | null;
    status: string;
    currency: string;
    escrowBalance: number;
    escrowCurrency: string;
    escrowStatus: string;
    openDisputeCount: number;
  }[];
};

export type PortfolioOverview = {
  currency: string;
  // The account's own standing subscription (Account.reportDigestFrequency)
  // — surfaced here rather than a separate fetch since this page already
  // loads the account's report context. Set via setDigestSubscription.
  digestFrequency: "off" | "weekly" | "monthly" | string;
  properties: { total: number; byStatus: { status: string; count: number }[]; totalEstimatedValue: number };
  projects: { total: number; byStatus: { status: string; count: number }[] };
  maintenance: { total: number; open: number; resolved: number };
  inspections: { total: number; scheduled: number; pass: number; needsAttention: number; fail: number };
  vendorSpendByCurrency: { currency: string; total: number }[];
  topVendors: { vendorId: string; businessName: string; currency: string; total: number }[];
};

export type AtRiskOverview = {
  projects: { total: number; atRisk: { id: string; label: string; flags: string[] }[] };
  leases: { total: number; atRisk: { id: string; label: string; flags: string[] }[] };
  vendors: { total: number; atRisk: { id: string; label: string; flags: string[] }[] };
  suppliers: { total: number; atRisk: { id: string; label: string; flags: string[] }[] };
};

export type ReportDefinition = {
  id: string;
  accountId: string;
  name: string;
  metrics: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlatformAccountSummary = {
  id: string;
  name: string;
  accountType: string;
  status: string;
  memberCount: number;
  createdAt: string;
};

export type PlatformAdminActionEntry = {
  id: string;
  targetAccountId: string;
  targetAccountName: string;
  action: "suspend" | "reinstate" | string;
  reason: string;
  performedByUserId: string;
  createdAt: string;
};

// Module 24's "Platform Admin Reports" — see
// PlatformAdminService.getPlatformReports's own comment for what each
// figure does and doesn't count.
export type PlatformReports = {
  generatedAt: string;
  activeUsers: number;
  activeProperties: number;
  marketplaceGmvByCurrency: { currency: string; total: number }[];
  escrowVolume: {
    totalDepositedByCurrency: { currency: string; total: number }[];
    currentBalanceByCurrency: { currency: string; total: number }[];
  };
  vendorPerformance: {
    totalAssigned: number;
    totalCompleted: number;
    completionRate: number;
    avgRating: number | null;
    topVendors: { vendorId: string; businessName: string; assigned: number; completed: number; avgRating: number | null }[];
  };
  disputeRate: {
    rate: number;
    totalDisputes: number;
    disputableCount: number;
    byStatus: { status: string; count: number }[];
  };
  verificationBacklog: {
    vendors: number;
    suppliers: number;
    listings: number;
    documents: number;
    identity: number;
    total: number;
  };
};

export type ComplianceItem = {
  id: string;
  jurisdiction: string;
  category: string;
  title: string;
  status: "not_started" | "in_progress" | "done" | string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Listing = {
  id: string;
  propertyId: string;
  accountId: string;
  listingType: "sale" | "rent" | "short_let" | string;
  askingPrice: string;
  currency: string;
  title: string;
  description?: string | null;
  photoUrls: string[];
  status: "draft" | "active" | "under_offer" | "sold" | "rented" | "withdrawn" | string;
  verificationStatus: "not_verified" | "submitted" | "verified" | "rejected" | string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  property?: Property | { propertyType: string; city?: string | null; country: string };
  // Only present on GET /listings/:listingId — whether the calling
  // account has favorited this listing.
  isFavorited?: boolean;
  // Only present on GET /listings (the marketplace browse) — see
  // ListingsService.findAll's own boost.util.ts wiring.
  packageBadge?: PackageBadge;
};

export type ListingInquiry = {
  id: string;
  listingId: string;
  accountId: string;
  message: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status: "new" | "responded" | "closed" | string;
  createdAt: string;
};

export type ListingOffer = {
  id: string;
  listingId: string;
  accountId: string;
  amount: string;
  currency: string;
  message?: string | null;
  status: "submitted" | "countered" | "accepted" | "rejected" | "withdrawn" | string;
  createdAt: string;
  updatedAt: string;
  listing?: { id: string; title: string; status: string };
};

// The real gap the workflow audit found: an accepted ListingOffer never
// led anywhere. Created the moment an offer is accepted
// (ListingsService.respondToOffer) — `checklist` is computed live from
// the property's own real documents, never stored, so it's always
// current.
export type ListingSale = {
  id: string;
  listingId: string;
  offerId: string;
  buyerAccountId: string;
  sellerAccountId: string;
  amount: string;
  currency: string;
  depositRecordedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  listingTitle: string;
  checklist: { documentType: string; label: string; status: string }[];
};

export type ListingFavorite = {
  listingId: string;
  accountId: string;
  createdAt: string;
  listing?: { id: string; title: string; askingPrice: string; currency: string; status: string };
};

export type SupplierTrustScore = {
  score: number;
  band: "excellent" | "good" | "fair" | "caution" | string;
  factors: {
    verificationStatus: string;
    ratingAverage: number | null;
    reviewCount: number;
    deliveredOrders: number;
    cancelledOrders: number;
    latestAudit: TrustAuditFactor;
    identityVerifiedOperator: boolean;
  };
};

export type SupplierTrustAudit = {
  id: string;
  supplierId: string;
  reviewedByUserId: string;
  rating: "clean" | "minor_concerns" | "major_concerns" | string;
  notes: string;
  createdAt: string;
};

export type Supplier = {
  id: string;
  accountId: string;
  businessName: string;
  category: "materials" | "tools" | "equipment" | string;
  locationCoverage?: string | null;
  verificationStatus: "not_verified" | "pending" | "verified" | string;
  verificationNotes?: string | null;
  ratingAverage?: string | null;
  createdAt: string;
  updatedAt: string;
  products?: Product[];
  reviews?: SupplierReview[];
  trustScore?: SupplierTrustScore;
  // Only present on GET /suppliers (the directory browse) — see
  // MaterialsService.findSuppliers's own boost.util.ts wiring.
  packageBadge?: PackageBadge;
};

export type SupplierReview = {
  id: string;
  supplierId: string;
  orderId: string;
  accountId: string;
  rating: number;
  comment?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  moderationStatus: "published" | "flagged" | "hidden" | string;
  flagReason?: string | null;
  flaggedAt?: string | null;
  moderationNotes?: string | null;
  moderatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  // Only present on GET /suppliers/reviews/flagged
  supplier?: { id: string; businessName: string };
};

export type Product = {
  id: string;
  supplierId: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: string;
  currency: string;
  stockQuantity: number;
  description?: string | null;
  status: "active" | "out_of_stock" | "discontinued" | string;
  isRentable: boolean;
  rentalPricePerDay?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: Supplier | { id: string; businessName: string; ratingAverage?: string | null };
};

export type RentalBooking = {
  id: string;
  productId: string;
  accountId: string;
  quantity: number;
  startDate: string;
  endDate: string;
  status: "requested" | "confirmed" | "returned" | "cancelled" | string;
  totalPrice: string;
  currency: string;
  notes?: string | null;
  returnedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; name: string; supplierId?: string };
};

export type CartItem = {
  id: string;
  accountId: string;
  productId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
  product?: Product & { supplier?: { id: string; businessName: string } };
};

export type OrderItem = {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  product?: Product;
};

export type Delivery = {
  id: string;
  orderId: string;
  status: "pending" | "in_transit" | "delivered" | "failed" | string;
  trackingReference?: string | null;
  estimatedDeliveryDate?: string | null;
  deliveredAt?: string | null;
};

export type MaterialOrder = {
  id: string;
  accountId: string;
  supplierId: string;
  projectId?: string | null;
  status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" | string;
  totalAmount: string;
  currency: string;
  deliveryAddress?: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  delivery?: Delivery | null;
  supplier?: Supplier;
  review?: SupplierReview | null;
};

// ---- Client -------------------------------------------------------------

// A thin class rather than loose functions so lib/auth.tsx can hand every
// screen one `api` instance that already knows the current token + account.
export class ApiClient {
  constructor(
    private token: string | null,
    private accountId: string | null,
  ) {}

  // --- Auth (no account context needed) ---
  // register/login set the session as httpOnly cookies server-side (see
  // AuthController) and hand back nothing sensitive — call me() right
  // after to find out who's actually signed in. logout() clears them the
  // same way; there's no client-side refresh() wrapper since the only
  // caller is request()'s own silent-refresh retry, which calls the
  // endpoint directly (see performRefresh above).
  register(input: { name: string; email: string; phone?: string; password: string; inviteToken?: string }) {
    return request<Record<string, never>>("/auth/register", { method: "POST", body: input });
  }
  login(email: string, password: string) {
    return request<Record<string, never>>("/auth/login", { method: "POST", body: { email, password } });
  }
  // One endpoint for both register and login via Google — see
  // AuthService.googleAuth's own comment. isNewUser tells the caller
  // whether to route to /accounts/new (brand new) or wherever a normal
  // sign-in goes (returning), same as register()/login()'s own post-auth
  // routing already differs.
  googleAuth(idToken: string, inviteToken?: string) {
    return request<{ isNewUser: boolean }>("/auth/google", { method: "POST", body: { idToken, inviteToken } });
  }
  logout() {
    return request<{ message: string }>("/auth/logout", { method: "POST" });
  }
  // token: "pending" here (rather than this.token, which the caller — see
  // AuthProvider's hydrate effect — genuinely doesn't have yet) is what
  // tells request() a 401 is worth a silent-refresh retry instead of just
  // meaning "not signed in": the access-token cookie can be stale while
  // the longer-lived refresh_token cookie is still good.
  me() {
    return request<CurrentUser>("/auth/me", { token: "pending" });
  }
  getIdentityStatus() {
    return request<IdentityStatus>("/identity/me", { token: this.token, accountId: this.accountId });
  }
  // Creates (or reuses) a Sumsub applicant and mints a fresh short-lived
  // WebSDK access token — the frontend hands this straight to Sumsub's
  // own widget, which talks to Sumsub directly. No document/selfie image
  // ever passes through this backend.
  startIdentityVerification() {
    return request<{ applicantId: string; accessToken: string }>("/identity/start", {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Pull-based — Sumsub's own review happens asynchronously on their
  // side, so this re-reads their current answer rather than waiting on
  // a webhook (this scaffold has nowhere to receive one in local dev).
  refreshIdentityStatus() {
    return request<IdentityStatus>("/identity/refresh", {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  forgotPassword(email: string) {
    return request<{ message: string; resetToken?: string }>("/auth/forgot-password", { method: "POST", body: { email } });
  }
  resetPassword(token: string, newPassword: string) {
    return request<{ message: string }>("/auth/reset-password", { method: "POST", body: { token, newPassword } });
  }
  verifyEmail(token: string) {
    return request<{ message: string }>("/auth/verify-email", { method: "POST", body: { token } });
  }
  resendVerificationEmail() {
    return request<{ message: string; alreadyVerified: boolean; verificationToken?: string }>(
      "/auth/resend-verification",
      { method: "POST", token: this.token },
    );
  }
  listMyAccounts() {
    return request<AccountSummary[]>("/auth/accounts", { token: this.token });
  }

  // --- Accounts ---
  createAccount(input: { accountType: string; name: string; country: string; currency: string; timezone: string; vendorRole?: "vendor" | "inspector" }) {
    return request<{ id: string }>("/accounts", { method: "POST", body: input, token: this.token });
  }
  listAccountMembers(accountId: string) {
    return request<{ members: AccountMemberSummary[]; invites: AccountInviteSummary[] }>(
      `/accounts/${accountId}/members`,
      { token: this.token, accountId: this.accountId },
    );
  }
  // Existing email -> added immediately ({type:"member"}); new email ->
  // a pending invite is created ({type:"invite", inviteToken}) — see
  // AccountsService.addMember. inviteToken is only present when
  // EmailService couldn't actually deliver the invite (no RESEND_API_KEY
  // configured, same fallback shape as forgotPassword's resetToken) —
  // once a real send succeeds, the raw token is dropped from the response.
  addAccountMember(accountId: string, input: { email: string; roleKey: string }) {
    return request<
      | { type: "member"; member: AccountMemberSummary }
      | { type: "invite"; invite: AccountInviteSummary; inviteToken?: string }
    >(`/accounts/${accountId}/members`, { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  // Kills a pending invite without replacing it — see
  // AccountsService.revokeInvite.
  revokeInvite(accountId: string, inviteId: string) {
    return request<AccountInviteSummary>(`/accounts/${accountId}/invites/${inviteId}/revoke`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Rotates a pending invite's token/expiry — see AccountsService.resendInvite.
  // Same inviteToken-only-on-fallback shape as addAccountMember above.
  resendInvite(accountId: string, inviteId: string) {
    return request<{ invite: AccountInviteSummary; inviteToken?: string }>(
      `/accounts/${accountId}/invites/${inviteId}/resend`,
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }

  // --- Public profiles (no auth at all — see PublicProfilesController) ---
  getPublicProfile(accountId: string) {
    return request<PublicProfile>(`/public/accounts/${accountId}`);
  }
  // The landing page's own data — see
  // PublicProfilesService.getMarketplaceHighlights.
  getMarketplaceHighlights() {
    return request<MarketplaceHighlights>("/public/marketplace/highlights");
  }

  // --- Invites (no account context — the recipient isn't a member yet) ---
  getInvite(token: string) {
    return request<InvitePreview>(`/invites/${token}`);
  }
  acceptInvite(token: string) {
    return request<AccountMemberSummary>(`/invites/${token}/accept`, { method: "POST", token: this.token });
  }
  // Every invite sent to the signed-in user's own email, across every
  // account — see AccountsService.findMyInvites.
  listMyInvites() {
    return request<AccountInviteMine[]>("/invites/mine", { token: this.token });
  }
  acceptMyInvite(inviteId: string) {
    return request<AccountMemberSummary>(`/invites/mine/${inviteId}/accept`, { method: "POST", token: this.token });
  }

  // --- Property development agreements (owner side, property-scoped) ---
  listDevelopmentAgreements(propertyId: string) {
    return request<DevelopmentAgreement[]>(`/properties/${propertyId}/development-agreements`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  proposeDevelopmentAgreement(
    propertyId: string,
    input: {
      developerEmail: string;
      agreementType: "temporary_ownership" | "proceeds_share";
      ownershipPercentage?: number;
      termMonths?: number;
      proceedsSharePercentage?: number;
      terms: string;
    },
  ) {
    return request<{ agreement: DevelopmentAgreement; inviteToken?: string }>(
      `/properties/${propertyId}/development-agreements`,
      { method: "POST", body: input, token: this.token, accountId: this.accountId },
    );
  }
  cancelDevelopmentAgreement(propertyId: string, agreementId: string) {
    return request<DevelopmentAgreement>(`/properties/${propertyId}/development-agreements/${agreementId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Property development agreements (developer/recipient side) ---
  getDevelopmentAgreementByToken(token: string) {
    return request<DevelopmentAgreementPreview>(`/development-agreement-invites/${token}`);
  }
  // Accepting requires an account context — see
  // DevelopmentAgreementsService.acceptByToken's own comment on why.
  acceptDevelopmentAgreement(token: string) {
    return request<DevelopmentAgreement>(`/development-agreement-invites/${token}/accept`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  declineDevelopmentAgreement(token: string) {
    return request<DevelopmentAgreement>(`/development-agreement-invites/${token}/decline`, {
      method: "POST",
      token: this.token,
    });
  }
  listMyDevelopmentAgreementInvites() {
    return request<DevelopmentAgreementMine[]>("/development-agreement-invites/mine", { token: this.token });
  }
  acceptMyDevelopmentAgreementInvite(agreementId: string) {
    return request<DevelopmentAgreement>(`/development-agreement-invites/mine/${agreementId}/accept`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  declineMyDevelopmentAgreementInvite(agreementId: string) {
    return request<DevelopmentAgreement>(`/development-agreement-invites/mine/${agreementId}/decline`, {
      method: "POST",
      token: this.token,
    });
  }

  // --- Properties (account-scoped) ---
  listProperties() {
    return request<Property[]>("/properties", { token: this.token, accountId: this.accountId });
  }
  // Semantic search (pgvector + OpenAI embeddings) — a free-text query
  // like "flat under renovation in Lekki", not a field filter.
  searchProperties(q: string) {
    const params = new URLSearchParams({ q });
    return request<Property[]>(`/properties/search?${params.toString()}`, { token: this.token, accountId: this.accountId });
  }
  reindexPropertyEmbeddings() {
    return request<{ total: number; indexed: number; failed: number; failures: { propertyId: string; error: string }[] }>(
      "/properties/reindex-embeddings",
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }
  // Manual backfill for the Live View feature — see
  // PropertiesService.regeocodeProperties's own comment.
  regeocodeProperties() {
    return request<{ total: number; located: number; failed: number; failures: { propertyId: string; error: string }[] }>(
      "/properties/regeocode",
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }
  getProperty(propertyId: string) {
    return request<Property>(`/properties/${propertyId}`, { token: this.token, accountId: this.accountId });
  }
  createProperty(input: {
    propertyType: string;
    name: string;
    addressLine: string;
    city?: string;
    state?: string;
    country: string;
    currentUse?: string;
    estimatedValue?: number;
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
    yearBuilt?: number;
    amenities?: string[];
    photoUrls?: string[];
    branchId?: string;
  }) {
    return request<Property>("/properties", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  // Module 3: Property Details — the first update endpoint the base
  // property record has ever had.
  updateProperty(
    propertyId: string,
    input: Partial<{
      propertyType: string;
      name: string;
      addressLine: string;
      city: string;
      state: string;
      country: string;
      currentUse: string;
      estimatedValue: number;
      bedrooms: number;
      bathrooms: number;
      squareFootage: number;
      yearBuilt: number;
      amenities: string[];
      photoUrls: string[];
      // Empty string means "unassign" — see UpdatePropertyDto's own
      // comment on this convention.
      branchId: string;
    }>,
  ) {
    return request<Property>(`/properties/${propertyId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Module 21 Phase 1 — "Family representative access."
  listAccessGrants(propertyId: string) {
    return request<AccessGrant[]>(`/properties/${propertyId}/access-grants`, { token: this.token, accountId: this.accountId });
  }
  createAccessGrant(propertyId: string, input: { accountMemberId: string; canView?: boolean; canEdit?: boolean; canApprovePayments?: boolean }) {
    return request<AccessGrant>(`/properties/${propertyId}/access-grants`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  revokeAccessGrant(propertyId: string, grantId: string) {
    return request<{ deleted: boolean }>(`/properties/${propertyId}/access-grants/${grantId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // "Do I hold a grant on this property, and does it include
  // canApprovePayments" — the piece listAccessGrants above can't answer
  // for a non-property:write member asking about themselves. Returns
  // null (not a 404) when there's no grant.
  getMyAccessGrant(propertyId: string) {
    return request<AccessGrant | null>(`/properties/${propertyId}/access-grants/me`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Module 22 Phase 1 — the device registry.
  listDevices(propertyId: string) {
    return request<PropertyDevice[]>(`/properties/${propertyId}/devices`, { token: this.token, accountId: this.accountId });
  }
  createDevice(propertyId: string, input: { deviceType: string; name: string; provider?: string }) {
    return request<PropertyDevice>(`/properties/${propertyId}/devices`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  removeDevice(propertyId: string, deviceId: string) {
    return request<{ deleted: boolean }>(`/properties/${propertyId}/devices/${deviceId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Module 23 Phase 1 — 360°/tour media metadata.
  listTourAssets(propertyId: string) {
    return request<PropertyTourAsset[]>(`/properties/${propertyId}/tour-assets`, { token: this.token, accountId: this.accountId });
  }
  createTourAsset(propertyId: string, input: { mediaUrl: string; mediaType?: string; label?: string; sortOrder?: number }) {
    return request<PropertyTourAsset>(`/properties/${propertyId}/tour-assets`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  removeTourAsset(propertyId: string, assetId: string) {
    return request<{ deleted: boolean }>(`/properties/${propertyId}/tour-assets/${assetId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // "Community management" — account-wide (no propertyId means every
  // tenant across the portfolio, see PropertyAnnouncement's own schema
  // comment), not nested under one property's own routes.
  listAnnouncements() {
    return request<Announcement[]>("/properties/announcements", { token: this.token, accountId: this.accountId });
  }
  createAnnouncement(input: { title: string; body: string; propertyId?: string }) {
    return request<Announcement>("/properties/announcements", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteAnnouncement(announcementId: string) {
    return request<{ deleted: boolean }>(`/properties/announcements/${announcementId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // --- Module 19 Phase 1: in-app notifications (no permission gate — see
  // NotificationsController's own comment for why every role reads its
  // own inbox) ---
  listNotifications() {
    return request<Notification[]>("/notifications", { token: this.token, accountId: this.accountId });
  }
  markNotificationRead(notificationId: string) {
    return request<Notification>(`/notifications/${notificationId}/read`, {
      method: "PATCH",
      token: this.token,
      accountId: this.accountId,
    });
  }
  markAllNotificationsRead() {
    return request<{ updated: boolean }>("/notifications/read-all", {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  addValuation(propertyId: string, input: { estimatedValue: number; currency?: string; source?: string; notes?: string }) {
    return request<PropertyValuation>(`/properties/${propertyId}/valuations`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listValuations(propertyId: string) {
    return request<PropertyValuation[]>(`/properties/${propertyId}/valuations`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  createVisualization(propertyId: string, input: { beforeImageUrl: string; prompt: string; projectId?: string; kind?: "renovation" | "staging" }) {
    return request<RenovationVisualization>(`/visualizations/property/${propertyId}`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listVisualizations(propertyId: string) {
    return request<RenovationVisualization[]>(`/visualizations/property/${propertyId}`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  getRoiSummary(propertyId: string) {
    return request<RoiSummary>(`/properties/${propertyId}/roi-summary`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  getComparableValuation(propertyId: string) {
    return request<ComparableValuation>(`/properties/${propertyId}/comparable-valuation`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  scheduleInspection(
    propertyId: string,
    input: { inspectionType: string; scheduledFor: string; projectId?: string; inspectorName?: string; inspectorVendorId?: string },
  ) {
    return request<PropertyInspection>(`/properties/${propertyId}/inspections`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listInspections(propertyId: string) {
    return request<PropertyInspection[]>(`/properties/${propertyId}/inspections`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  updateInspection(
    propertyId: string,
    inspectionId: string,
    input: { inspectionType?: string; scheduledFor?: string; projectId?: string; inspectorName?: string; inspectorVendorId?: string },
  ) {
    return request<PropertyInspection>(`/properties/${propertyId}/inspections/${inspectionId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  completeInspection(
    propertyId: string,
    inspectionId: string,
    input: {
      overallResult: string;
      summary?: string;
      findings?: { area: string; description: string; severity?: string; photoUrls?: string[] }[];
      photoUrls?: string[];
    },
  ) {
    return request<PropertyInspection>(`/properties/${propertyId}/inspections/${inspectionId}/complete`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  cancelInspection(propertyId: string, inspectionId: string) {
    return request<PropertyInspection>(`/properties/${propertyId}/inspections/${inspectionId}/cancel`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  createLease(
    propertyId: string,
    input: {
      tenantName: string;
      tenantEmail?: string;
      tenantPhone?: string;
      rentAmount: number;
      currency?: string;
      rentFrequency: string;
      depositAmount?: number;
      startDate: string;
      endDate?: string;
      notes?: string;
    },
  ) {
    return request<Lease>(`/properties/${propertyId}/leases`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listLeases(propertyId: string) {
    return request<Lease[]>(`/properties/${propertyId}/leases`, { token: this.token, accountId: this.accountId });
  }
  updateLease(
    propertyId: string,
    leaseId: string,
    input: {
      tenantName?: string;
      tenantEmail?: string;
      tenantPhone?: string;
      rentAmount?: number;
      rentFrequency?: string;
      depositAmount?: number;
      startDate?: string;
      endDate?: string;
      notes?: string;
    },
  ) {
    return request<Lease>(`/properties/${propertyId}/leases/${leaseId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  recordRentPayment(
    propertyId: string,
    leaseId: string,
    input: { amount: number; currency?: string; periodStart: string; periodEnd: string; method?: string; notes?: string },
  ) {
    return request<LeaseRentPayment>(`/properties/${propertyId}/leases/${leaseId}/rent-payments`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  endLease(propertyId: string, leaseId: string, input: { status: "ended" | "terminated"; notes?: string }) {
    return request<Lease>(`/properties/${propertyId}/leases/${leaseId}/end`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  linkTenantAccount(propertyId: string, leaseId: string) {
    return request<Lease>(`/properties/${propertyId}/leases/${leaseId}/link-tenant`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  reportMaintenanceRequest(
    propertyId: string,
    input: {
      title: string;
      description: string;
      priority?: string;
      leaseId?: string;
      reportedBy?: string;
      assignedTo?: string;
      assignedVendorId?: string;
    },
  ) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listMaintenanceRequests(propertyId: string) {
    return request<MaintenanceRequest[]>(`/properties/${propertyId}/maintenance-requests`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Tenant-facing — see apps/api/src/tenant. Scoped to whichever lease
  // the acting TENANT-type account is linked to, never a client-supplied
  // property/lease id.
  myTenantLease() {
    return request<Lease | null>("/tenant/lease", { token: this.token, accountId: this.accountId });
  }
  myTenantMaintenanceRequests() {
    return request<MaintenanceRequest[]>("/tenant/maintenance-requests", { token: this.token, accountId: this.accountId });
  }
  reportTenantMaintenanceRequest(input: { title: string; description: string; priority?: string }) {
    return request<MaintenanceRequest>("/tenant/maintenance-requests", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  myTenantDocuments() {
    return request<AppDocument[]>("/tenant/documents", { token: this.token, accountId: this.accountId });
  }
  myTenantAnnouncements() {
    return request<Announcement[]>("/tenant/announcements", { token: this.token, accountId: this.accountId });
  }
  updateMaintenanceRequest(propertyId: string, requestId: string, input: { title?: string; description?: string; priority?: string }) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests/${requestId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  startMaintenanceRequest(propertyId: string, requestId: string, input: { assignedTo?: string; assignedVendorId?: string }) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests/${requestId}/start`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  resolveMaintenanceRequest(propertyId: string, requestId: string, input: { resolutionNotes?: string; cost?: number }) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests/${requestId}/resolve`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  cancelMaintenanceRequest(propertyId: string, requestId: string) {
    return request<MaintenanceRequest>(`/properties/${propertyId}/maintenance-requests/${requestId}/cancel`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- AI Copilot Layer (account-scoped) ---
  listAiSkills() {
    return request<AiSkill[]>("/ai/skills", { token: this.token, accountId: this.accountId });
  }
  // Module 20 Phase 1 — "ai_usage_logs," a real surface on data that
  // already existed (every AiRequest ever written).
  getAiUsageSummary() {
    return request<AiUsageSummary>("/ai/usage", { token: this.token, accountId: this.accountId });
  }
  runAiAction(moduleContext: string, actionType: string, input?: Record<string, unknown>) {
    return request<AiActionResult>("/ai/actions", {
      method: "POST",
      body: { moduleContext, actionType, input },
      token: this.token,
      accountId: this.accountId,
    });
  }
  decideAiOutput(outputId: string, decision: "accepted" | "edited" | "discarded", notes?: string) {
    return request<AiActionApproval>(`/ai/outputs/${outputId}/decision`, {
      method: "POST",
      body: { decision, notes },
      token: this.token,
      accountId: this.accountId,
    });
  }
  sendChatMessage(input: { conversationId?: string; moduleContext?: string; message: string }) {
    return request<{ conversationId: string; messages: AiMessage[] }>("/ai/chat", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listConversations() {
    return request<AiConversation[]>("/ai/conversations", { token: this.token, accountId: this.accountId });
  }
  getConversation(conversationId: string) {
    return request<AiConversation>(`/ai/conversations/${conversationId}`, {
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Projects (account-scoped) ---
  listProjects() {
    return request<Project[]>("/projects", { token: this.token, accountId: this.accountId });
  }
  getProject(projectId: string) {
    return request<Project>(`/projects/${projectId}`, { token: this.token, accountId: this.accountId });
  }
  createProject(input: {
    propertyId: string;
    projectType: string;
    title: string;
    scopeDescription?: string;
    budget?: number;
    currency?: string;
    startDate?: string;
    expectedEndDate?: string;
  }) {
    return request<Project>("/projects", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  addMilestone(projectId: string, input: { title: string; description?: string; paymentAmount?: number; dueDate?: string }) {
    return request<ProjectMilestone>(`/projects/${projectId}/milestones`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  addProjectUpdate(projectId: string, input: { description: string; milestoneId?: string; mediaUrls?: string[] }) {
    return request<ProjectUpdate>(`/projects/${projectId}/updates`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  updateProjectStage(projectId: string, stageId: string, status: "not_started" | "in_progress" | "completed") {
    return request<ProjectStage>(`/projects/${projectId}/stages/${stageId}`, {
      method: "PATCH",
      body: { status },
      token: this.token,
      accountId: this.accountId,
    });
  }
  requestQuote(projectId: string, vendorId: string) {
    return request<VendorQuote>(`/projects/${projectId}/quotes/request`, {
      method: "POST",
      body: { vendorId },
      token: this.token,
      accountId: this.accountId,
    });
  }
  acceptQuote(projectId: string, quoteId: string) {
    return request<Project>(`/projects/${projectId}/quotes/${quoteId}/accept`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Vendors (marketplace browse is cross-account by design; "me" routes
  // are scoped to whichever account is currently active, which only makes
  // sense for a VENDOR-type account) ---
  listVendors(serviceCategory?: string, q?: string) {
    const params = new URLSearchParams();
    if (serviceCategory) params.set("serviceCategory", serviceCategory);
    if (q) params.set("q", q);
    const qs = params.toString();
    return request<Vendor[]>(`/vendors${qs ? `?${qs}` : ""}`, { token: this.token, accountId: this.accountId });
  }
  getVendor(vendorId: string) {
    return request<Vendor>(`/vendors/${vendorId}`, { token: this.token, accountId: this.accountId });
  }
  setVendorVerification(vendorId: string, status: string, notes?: string) {
    return request<Vendor>(`/vendors/${vendorId}/verification`, {
      method: "PATCH",
      body: { status, notes },
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitVendorTrustAudit(vendorId: string, input: { rating: string; notes: string }) {
    return request<VendorTrustAudit>(`/vendors/${vendorId}/trust-audits`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listVendorTrustAudits(vendorId: string) {
    return request<VendorTrustAudit[]>(`/vendors/${vendorId}/trust-audits`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  createVendor(input: { businessName: string; serviceCategory: string; locationCoverage?: string }) {
    return request<Vendor>("/vendors", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  myVendorProfile() {
    return request<Vendor | null>("/vendors/me", { token: this.token, accountId: this.accountId });
  }
  myQuotes() {
    return request<VendorQuote[]>("/vendors/me/quotes", { token: this.token, accountId: this.accountId });
  }
  myPayouts() {
    return request<Payout[]>("/vendors/me/payouts", { token: this.token, accountId: this.accountId });
  }
  myProjects() {
    return request<ProjectVendorAssignment[]>("/vendors/me/projects", { token: this.token, accountId: this.accountId });
  }
  listBanks(provider?: string) {
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
    return request<PaystackBank[]>(`/vendors/banks${qs}`, { token: this.token, accountId: this.accountId });
  }
  setVendorBankDetails(input: { bankAccountNumber: string; bankCode: string; provider?: string }) {
    return request<Vendor>("/vendors/me/bank-details", {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  setPaypalPayoutEmail(input: { email: string }) {
    return request<Vendor>("/vendors/me/paypal-payout-email", {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  setVendorLicense(input: { licenseNumber: string; licenseIssuingBody: string; licenseExpiresAt: string }) {
    return request<Vendor>("/vendors/me/license", {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitVendorQuote(input: { projectId: string; amount: number; currency?: string; notes?: string }) {
    return request<VendorQuote>("/vendors/me/quotes", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  myDisputes() {
    return request<Dispute[]>("/vendors/me/disputes", { token: this.token, accountId: this.accountId });
  }
  raiseDisputeAsVendor(input: { projectId: string; disputeType: string; reason: string; milestoneId?: string; paymentId?: string; payoutId?: string }) {
    return request<Dispute>("/vendors/me/disputes", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  resolveDisputeAsVendor(disputeId: string, input: { status: "resolved" | "rejected"; resolutionNotes?: string }) {
    return request<Dispute>(`/vendors/me/disputes/${disputeId}/resolve`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitDisputeEvidenceAsVendor(disputeId: string, input: { note: string; fileUrl?: string }) {
    return request<DisputeEvidence>(`/vendors/me/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findDisputeEvidenceAsVendor(disputeId: string) {
    return request<DisputeEvidence[]>(`/vendors/me/disputes/${disputeId}/evidence`, {
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Payments & escrow (per-project routes below; the account-wide
  // rollup is getPaymentsOverview() further down) ---
  // Two shapes back, depending on provider: "manual" (the default)
  // credits escrow instantly and returns a receipt, same as before.
  // "paystack" returns an authorizationUrl instead — nothing is credited
  // until the buyer completes checkout there and the caller calls
  // verifyDeposit with the returned payment's id.
  deposit(projectId: string, input: { amount: number; currency?: string; provider?: string; providerReference?: string }) {
    return request<{ payment: Payment; receipt: Receipt } | { payment: Payment; authorizationUrl: string }>(
      `/projects/${projectId}/payments`,
      { method: "POST", body: input, token: this.token, accountId: this.accountId },
    );
  }
  verifyDeposit(projectId: string, paymentId: string) {
    return request<{ payment: Payment; receipt: Receipt | null; alreadyVerified: boolean }>(
      `/projects/${projectId}/payments/${paymentId}/verify`,
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }
  findPayments(projectId: string) {
    return request<Payment[]>(`/projects/${projectId}/payments`, { token: this.token, accountId: this.accountId });
  }
  getEscrow(projectId: string) {
    return request<EscrowAccount>(`/projects/${projectId}/escrow`, { token: this.token, accountId: this.accountId });
  }
  approveMilestone(projectId: string, milestoneId: string) {
    return request<ProjectMilestone>(`/projects/${projectId}/milestones/${milestoneId}/approve`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  releaseMilestone(projectId: string, milestoneId: string) {
    // receipt is null while a real Paystack transfer is still
    // "processing" — see verifyPayout below.
    return request<{ payout: Payout; receipt: Receipt | null }>(`/projects/${projectId}/milestones/${milestoneId}/release`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  verifyPayout(projectId: string, payoutId: string) {
    return request<{ payout: Payout; receipt: Receipt | null; alreadyVerified: boolean }>(
      `/projects/${projectId}/payouts/${payoutId}/verify`,
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }
  finalizePayoutOtp(projectId: string, payoutId: string, otp: string) {
    return request<{ payout: Payout; receipt: Receipt | null; alreadyVerified: boolean }>(
      `/projects/${projectId}/payouts/${payoutId}/finalize`,
      { method: "POST", body: { otp }, token: this.token, accountId: this.accountId },
    );
  }
  findProjectPayouts(projectId: string) {
    return request<Payout[]>(`/projects/${projectId}/payouts`, { token: this.token, accountId: this.accountId });
  }
  findReceipts(projectId: string) {
    return request<Receipt[]>(`/projects/${projectId}/receipts`, { token: this.token, accountId: this.accountId });
  }
  raiseDispute(projectId: string, input: { disputeType: string; reason: string; milestoneId?: string; paymentId?: string; payoutId?: string }) {
    return request<Dispute>(`/projects/${projectId}/disputes`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findDisputes(projectId: string) {
    return request<Dispute[]>(`/projects/${projectId}/disputes`, { token: this.token, accountId: this.accountId });
  }
  resolveDispute(projectId: string, disputeId: string, input: { status: "resolved" | "rejected"; resolutionNotes?: string }) {
    return request<Dispute>(`/projects/${projectId}/disputes/${disputeId}/resolve`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitDisputeEvidence(projectId: string, disputeId: string, input: { note: string; fileUrl?: string }) {
    return request<DisputeEvidence>(`/projects/${projectId}/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findDisputeEvidence(projectId: string, disputeId: string) {
    return request<DisputeEvidence[]>(`/projects/${projectId}/disputes/${disputeId}/evidence`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Module 18 Phase 1 — order disputes. One unified route both the buyer
  // and the supplier call (see PaymentsService.requireOrderParty's own
  // comment for why), unlike the owner/vendor pair above.
  raiseOrderDispute(orderId: string, input: { disputeType: string; reason: string }) {
    return request<Dispute>(`/orders/${orderId}/disputes`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findOrderDisputes(orderId: string) {
    return request<Dispute[]>(`/orders/${orderId}/disputes`, { token: this.token, accountId: this.accountId });
  }
  resolveOrderDispute(orderId: string, disputeId: string, input: { status: "resolved" | "rejected"; resolutionNotes?: string }) {
    return request<Dispute>(`/orders/${orderId}/disputes/${disputeId}/resolve`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitOrderDisputeEvidence(orderId: string, disputeId: string, input: { note: string; fileUrl?: string }) {
    return request<DisputeEvidence>(`/orders/${orderId}/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findOrderDisputeEvidence(orderId: string, disputeId: string) {
    return request<DisputeEvidence[]>(`/orders/${orderId}/disputes/${disputeId}/evidence`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  getPaymentsOverview() {
    return request<PaymentsOverview>("/payments/overview", { token: this.token, accountId: this.accountId });
  }
  // --- Visibility packages (account-wide, not per-project — see
  // PackagesController) ---
  getPackageCatalog() {
    return request<VisibilityPackage[]>("/packages", { token: this.token, accountId: this.accountId });
  }
  getMyPackageSubscriptions() {
    return request<PackageSubscription[]>("/packages/me", { token: this.token, accountId: this.accountId });
  }
  getMyActiveBoost() {
    return request<PackageSubscription | null>("/packages/me/active", { token: this.token, accountId: this.accountId });
  }
  subscribeToPackage(input: { packageId: string; provider?: string; autoRenew?: boolean }) {
    return request<{ subscription: PackageSubscription; authorizationUrl?: string }>("/packages/subscribe", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  verifyPackageSubscription(subscriptionId: string) {
    return request<{ subscription: PackageSubscription; alreadyVerified: boolean }>(
      `/packages/subscriptions/${subscriptionId}/verify`,
      { method: "POST", token: this.token, accountId: this.accountId },
    );
  }
  // Phase 2 — real auto-renewal (Paystack only). setPackageAutoRenew is
  // the "cancel my subscription" action (see PackagesService.setAutoRenew);
  // renewPackageNow charges the same real saved card the daily cron would,
  // on demand.
  setPackageAutoRenew(subscriptionId: string, autoRenew: boolean) {
    return request<PackageSubscription>(`/packages/subscriptions/${subscriptionId}/auto-renew`, {
      method: "PATCH",
      body: { autoRenew },
      token: this.token,
      accountId: this.accountId,
    });
  }
  renewPackageNow(subscriptionId: string) {
    return request<PackageSubscription>(`/packages/subscriptions/${subscriptionId}/renew-now`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  getPortfolioOverview() {
    return request<PortfolioOverview>("/reports/portfolio-overview", { token: this.token, accountId: this.accountId });
  }
  getAtRiskOverview() {
    return request<AtRiskOverview>("/reports/at-risk-overview", { token: this.token, accountId: this.accountId });
  }
  // Not routed through request<T>() — that helper only ever parses JSON
  // responses (see its own isJson check), and this one is a real CSV
  // file. Mirrors request()'s own credentials/header shape by hand.
  async exportPortfolioOverviewCsv(): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.accountId) headers["X-Account-Id"] = this.accountId;
    const res = await fetch(`${API_URL}/reports/portfolio-overview/export`, { headers, credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => undefined);
      throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
    }
    return res.text();
  }
  setDigestSubscription(frequency: "off" | "weekly" | "monthly") {
    return request<{ id: string; reportDigestFrequency: string }>("/reports/digest-subscription", {
      method: "PATCH",
      body: { frequency },
      token: this.token,
      accountId: this.accountId,
    });
  }
  sendDigestNow() {
    return request<{ sent: boolean; recipients: number }>("/reports/digest-subscription/send-now", {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // --- Report builder ---
  listReportMetrics() {
    return request<{ key: string; label: string }[]>("/reports/metrics", { token: this.token, accountId: this.accountId });
  }
  listReportDefinitions() {
    return request<ReportDefinition[]>("/reports/definitions", { token: this.token, accountId: this.accountId });
  }
  createReportDefinition(input: { name: string; metrics: string[] }) {
    return request<ReportDefinition>("/reports/definitions", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteReportDefinition(id: string) {
    return request<{ deleted: boolean }>(`/reports/definitions/${id}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  runReportDefinition(id: string) {
    return request<{ name: string; generatedAt: string; rows: { label: string; value: string | number }[] }>(
      `/reports/definitions/${id}/run`,
      { token: this.token, accountId: this.accountId },
    );
  }
  async exportReportDefinitionCsv(id: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.accountId) headers["X-Account-Id"] = this.accountId;
    const res = await fetch(`${API_URL}/reports/definitions/${id}/export`, { headers, credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => undefined);
      throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
    }
    return res.text();
  }
  // --- Module 17, Phase 1: Communities, Residents, Announcements (community:read/write) ---
  listCommunities() {
    return request<Community[]>("/communities", { token: this.token, accountId: this.accountId });
  }
  createCommunity(input: { name: string; addressLine: string; city?: string; state?: string; country: string; communityType: string }) {
    return request<Community>("/communities", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  getCommunity(communityId: string) {
    return request<Community>(`/communities/${communityId}`, { token: this.token, accountId: this.accountId });
  }
  addResident(communityId: string, input: { name: string; unitNumber: string; email?: string; phone?: string; residentType?: string }) {
    return request<Resident>(`/communities/${communityId}/residents`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  removeResident(communityId: string, residentId: string) {
    return request<{ deleted: boolean }>(`/communities/${communityId}/residents/${residentId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  createCommunityAnnouncement(communityId: string, input: { title: string; body: string }) {
    return request<CommunityAnnouncement>(`/communities/${communityId}/announcements`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteCommunityAnnouncement(communityId: string, announcementId: string) {
    return request<{ deleted: boolean }>(`/communities/${communityId}/announcements/${announcementId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // --- Module 24: Branches (branch:read/write) ---
  listBranches() {
    return request<Branch[]>("/branches", { token: this.token, accountId: this.accountId });
  }
  createBranch(input: { name: string; city?: string; state?: string; country?: string }) {
    return request<Branch>("/branches", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  getBranch(branchId: string) {
    return request<Branch>(`/branches/${branchId}`, { token: this.token, accountId: this.accountId });
  }
  updateBranch(branchId: string, input: { name?: string; city?: string; state?: string; country?: string }) {
    return request<Branch>(`/branches/${branchId}`, { method: "PATCH", body: input, token: this.token, accountId: this.accountId });
  }
  deleteBranch(branchId: string) {
    return request<{ message: string }>(`/branches/${branchId}`, { method: "DELETE", token: this.token, accountId: this.accountId });
  }
  // --- Platform compliance tracker (compliance:read/write — platform_reviewer only) ---
  listComplianceItems() {
    return request<ComplianceItem[]>("/compliance/items", { token: this.token, accountId: this.accountId });
  }
  createComplianceItem(input: { jurisdiction: string; category: string; title: string; notes?: string }) {
    return request<ComplianceItem>("/compliance/items", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  updateComplianceItem(
    id: string,
    input: Partial<{ jurisdiction: string; category: string; title: string; status: "not_started" | "in_progress" | "done"; notes: string }>,
  ) {
    return request<ComplianceItem>(`/compliance/items/${id}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteComplianceItem(id: string) {
    return request<{ deleted: boolean }>(`/compliance/items/${id}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  // --- Admin operations (account:read_all/account:suspend — platform_admin only) ---
  listPlatformAccounts() {
    return request<PlatformAccountSummary[]>("/platform-admin/accounts", { token: this.token, accountId: this.accountId });
  }
  suspendPlatformAccount(targetAccountId: string, reason: string) {
    return request<PlatformAccountSummary>(`/platform-admin/accounts/${targetAccountId}/suspend`, {
      method: "POST",
      body: { reason },
      token: this.token,
      accountId: this.accountId,
    });
  }
  reinstatePlatformAccount(targetAccountId: string, reason: string) {
    return request<PlatformAccountSummary>(`/platform-admin/accounts/${targetAccountId}/reinstate`, {
      method: "POST",
      body: { reason },
      token: this.token,
      accountId: this.accountId,
    });
  }
  getPlatformAdminAuditLog() {
    return request<PlatformAdminActionEntry[]>("/platform-admin/audit-log", { token: this.token, accountId: this.accountId });
  }
  getPlatformReports() {
    return request<PlatformReports>("/platform-admin/reports", { token: this.token, accountId: this.accountId });
  }
  findOpenDisputesForArbitration() {
    return request<Dispute[]>("/payments/disputes/open", { token: this.token, accountId: this.accountId });
  }
  arbitrateDispute(disputeId: string, input: { status: "resolved" | "rejected" | "under_review"; resolutionNotes?: string }) {
    return request<Dispute>(`/payments/disputes/${disputeId}/arbitrate`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  completeProject(projectId: string) {
    return request<Project>(`/projects/${projectId}/complete`, { method: "POST", token: this.token, accountId: this.accountId });
  }
  reviewVendor(projectId: string, input: { vendorId: string; rating: number; comment?: string }) {
    return request<VendorReview>(`/projects/${projectId}/reviews`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  updateVendorReview(projectId: string, reviewId: string, input: { rating?: number; comment?: string }) {
    return request<VendorReview>(`/projects/${projectId}/reviews/${reviewId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteVendorReview(projectId: string, reviewId: string) {
    return request<{ deleted: boolean }>(`/projects/${projectId}/reviews/${reviewId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  replyToVendorReview(reviewId: string, input: { response: string }) {
    return request<VendorReview>(`/vendors/me/reviews/${reviewId}/reply`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // The report side of review moderation — see VendorsService.flagReview.
  flagVendorReview(reviewId: string, input: { reason: string }) {
    return request<VendorReview>(`/vendors/me/reviews/${reviewId}/flag`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Module 6's neutral-reviewer queue for flagged vendor reviews.
  listFlaggedVendorReviews() {
    return request<VendorReview[]>("/vendors/reviews/flagged", { token: this.token, accountId: this.accountId });
  }
  moderateVendorReview(reviewId: string, input: { status: "hidden" | "published"; moderationNotes?: string }) {
    return request<VendorReview>(`/vendors/reviews/${reviewId}/moderate`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Property marketplace (listings) ---
  createListing(input: { propertyId: string; listingType: string; askingPrice: number; currency?: string; title: string; description?: string; photoUrls?: string[] }) {
    return request<Listing>("/listings", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  searchListings(query: { listingType?: string; city?: string; propertyType?: string; minPrice?: string; maxPrice?: string; q?: string }) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return request<Listing[]>(`/listings${qs ? `?${qs}` : ""}`, { token: this.token, accountId: this.accountId });
  }
  myListings() {
    return request<Listing[]>("/listings/me", { token: this.token, accountId: this.accountId });
  }
  myOffers() {
    return request<ListingOffer[]>("/listings/me/offers", { token: this.token, accountId: this.accountId });
  }
  myFavorites() {
    return request<ListingFavorite[]>("/listings/me/favorites", { token: this.token, accountId: this.accountId });
  }
  getListing(listingId: string) {
    return request<Listing>(`/listings/${listingId}`, { token: this.token, accountId: this.accountId });
  }
  publishListing(listingId: string) {
    return request<Listing>(`/listings/${listingId}/publish`, { method: "POST", token: this.token, accountId: this.accountId });
  }
  createInquiry(listingId: string, input: { message: string; contactEmail?: string; contactPhone?: string }) {
    return request<ListingInquiry>(`/listings/${listingId}/inquiries`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findInquiries(listingId: string) {
    return request<ListingInquiry[]>(`/listings/${listingId}/inquiries`, { token: this.token, accountId: this.accountId });
  }
  createOffer(listingId: string, input: { amount: number; currency?: string; message?: string }) {
    return request<ListingOffer>(`/listings/${listingId}/offers`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findOffers(listingId: string) {
    return request<ListingOffer[]>(`/listings/${listingId}/offers`, { token: this.token, accountId: this.accountId });
  }
  respondToOffer(listingId: string, offerId: string, input: { status: "countered" | "accepted" | "rejected"; counterAmount?: number }) {
    return request<ListingOffer>(`/listings/${listingId}/offers/${offerId}/respond`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  getSale(listingId: string) {
    return request<ListingSale>(`/listings/${listingId}/sale`, { token: this.token, accountId: this.accountId });
  }
  recordSaleDeposit(listingId: string) {
    return request<ListingSale>(`/listings/${listingId}/sale/deposit`, { method: "POST", token: this.token, accountId: this.accountId });
  }
  completeSale(listingId: string) {
    return request<Property>(`/listings/${listingId}/sale/complete`, { method: "POST", token: this.token, accountId: this.accountId });
  }
  favoriteListing(listingId: string) {
    return request<ListingFavorite>(`/listings/${listingId}/favorites`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  unfavoriteListing(listingId: string) {
    return request<{ removed?: boolean }>(`/listings/${listingId}/favorites`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Materials marketplace (suppliers, products, orders) ---
  createSupplierProfile(input: { businessName: string; category: string; locationCoverage?: string }) {
    return request<Supplier>("/suppliers", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  listSuppliers(category?: string) {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    return request<Supplier[]>(`/suppliers${qs}`, { token: this.token, accountId: this.accountId });
  }
  mySupplierProfile() {
    return request<Supplier | null>("/suppliers/me", { token: this.token, accountId: this.accountId });
  }
  findOrdersForSupplier() {
    return request<MaterialOrder[]>("/suppliers/me/orders", { token: this.token, accountId: this.accountId });
  }
  createProduct(input: {
    name: string;
    category: string;
    unit: string;
    unitPrice: number;
    currency?: string;
    stockQuantity?: number;
    description?: string;
    isRentable?: boolean;
    rentalPricePerDay?: number;
  }) {
    return request<Product>("/suppliers/me/products", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  updateProduct(
    productId: string,
    input: {
      unitPrice?: number;
      stockQuantity?: number;
      status?: string;
      description?: string;
      isRentable?: boolean;
      rentalPricePerDay?: number;
    },
  ) {
    return request<Product>(`/suppliers/me/products/${productId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  getSupplier(supplierId: string) {
    return request<Supplier>(`/suppliers/${supplierId}`, { token: this.token, accountId: this.accountId });
  }
  setSupplierVerification(supplierId: string, status: string, notes?: string) {
    return request<Supplier>(`/suppliers/${supplierId}/verification`, {
      method: "PATCH",
      body: { status, notes },
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitSupplierTrustAudit(supplierId: string, input: { rating: string; notes: string }) {
    return request<SupplierTrustAudit>(`/suppliers/${supplierId}/trust-audits`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  listSupplierTrustAudits(supplierId: string) {
    return request<SupplierTrustAudit[]>(`/suppliers/${supplierId}/trust-audits`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  findProducts(category?: string, supplierId?: string, q?: string) {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (supplierId) params.set("supplierId", supplierId);
    if (q) params.set("q", q);
    const qs = params.toString();
    return request<Product[]>(`/products${qs ? `?${qs}` : ""}`, { token: this.token, accountId: this.accountId });
  }
  getProduct(productId: string) {
    return request<Product>(`/products/${productId}`, { token: this.token, accountId: this.accountId });
  }
  createOrder(input: { supplierId: string; projectId?: string; items: { productId: string; quantity: number }[]; deliveryAddress?: string }) {
    return request<MaterialOrder>("/orders", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  getCart() {
    return request<CartItem[]>("/cart", { token: this.token, accountId: this.accountId });
  }
  upsertCartItem(productId: string, quantity: number) {
    return request<CartItem | { removed: true }>("/cart/items", {
      method: "POST",
      body: { productId, quantity },
      token: this.token,
      accountId: this.accountId,
    });
  }
  removeCartItem(productId: string) {
    return request<{ removed: true }>(`/cart/items/${productId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  checkoutCart(input: { supplierId: string; projectId?: string; deliveryAddress?: string }) {
    return request<MaterialOrder>("/cart/checkout", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  createRentalBooking(productId: string, input: { startDate: string; endDate: string; quantity?: number; notes?: string }) {
    return request<RentalBooking>(`/products/${productId}/rental-bookings`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  myRentalBookings() {
    return request<RentalBooking[]>("/rental-bookings/me", { token: this.token, accountId: this.accountId });
  }
  supplierRentalBookings() {
    return request<RentalBooking[]>("/suppliers/me/rental-bookings", { token: this.token, accountId: this.accountId });
  }
  confirmRentalBooking(bookingId: string) {
    return request<RentalBooking>(`/rental-bookings/${bookingId}/confirm`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  returnRentalBooking(bookingId: string) {
    return request<RentalBooking>(`/rental-bookings/${bookingId}/return`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  cancelRentalBooking(bookingId: string) {
    return request<RentalBooking>(`/rental-bookings/${bookingId}/cancel`, {
      method: "POST",
      token: this.token,
      accountId: this.accountId,
    });
  }
  findOrdersForBuyer() {
    return request<MaterialOrder[]>("/orders", { token: this.token, accountId: this.accountId });
  }
  getOrder(orderId: string) {
    return request<MaterialOrder>(`/orders/${orderId}`, { token: this.token, accountId: this.accountId });
  }
  updateOrderStatus(orderId: string, status: "confirmed" | "shipped" | "delivered" | "cancelled") {
    return request<MaterialOrder>(`/orders/${orderId}/status`, {
      method: "PATCH",
      body: { status },
      token: this.token,
      accountId: this.accountId,
    });
  }
  upsertDelivery(orderId: string, input: { status: string; trackingReference?: string; estimatedDeliveryDate?: string }) {
    return request<Delivery>(`/orders/${orderId}/delivery`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  reviewOrder(orderId: string, input: { rating: number; comment?: string }) {
    return request<SupplierReview>(`/orders/${orderId}/reviews`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  updateOrderReview(orderId: string, reviewId: string, input: { rating?: number; comment?: string }) {
    return request<SupplierReview>(`/orders/${orderId}/reviews/${reviewId}`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  deleteOrderReview(orderId: string, reviewId: string) {
    return request<{ deleted: boolean }>(`/orders/${orderId}/reviews/${reviewId}`, {
      method: "DELETE",
      token: this.token,
      accountId: this.accountId,
    });
  }
  replyToOrderReview(reviewId: string, input: { response: string }) {
    return request<SupplierReview>(`/suppliers/me/reviews/${reviewId}/reply`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // The report side of review moderation — see MaterialsService.flagOrderReview.
  flagOrderReview(reviewId: string, input: { reason: string }) {
    return request<SupplierReview>(`/suppliers/me/reviews/${reviewId}/flag`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // Module 6's neutral-reviewer queue for flagged supplier reviews.
  listFlaggedOrderReviews() {
    return request<SupplierReview[]>("/suppliers/reviews/flagged", { token: this.token, accountId: this.accountId });
  }
  moderateOrderReview(reviewId: string, input: { status: "hidden" | "published"; moderationNotes?: string }) {
    return request<SupplierReview>(`/suppliers/reviews/${reviewId}/moderate`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }

  // --- Document vault ---
  // The general upload pipeline (Cloudflare R2 via the API's own
  // StorageService) — not routed through request<T>() since this sends
  // multipart/form-data, not JSON. Any field that used to want a
  // pasted-URL (Document.fileUrl, evidence fileUrls) can call this first
  // and use the returned url exactly as before — no other shape changed.
  async uploadFile(file: File): Promise<{ url: string }> {
    const headers: Record<string, string> = {};
    if (this.accountId) headers["X-Account-Id"] = this.accountId;
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/uploads`, { method: "POST", headers, body: form, credentials: "include" });
    const data = await res.json().catch(() => undefined);
    if (!res.ok) {
      throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`);
    }
    return data;
  }
  createDocument(input: { documentType: string; fileUrl: string; propertyId?: string; leaseId?: string; expiryDate?: string }) {
    return request<AppDocument>("/documents", { method: "POST", body: input, token: this.token, accountId: this.accountId });
  }
  listDocuments() {
    return request<AppDocument[]>("/documents", { token: this.token, accountId: this.accountId });
  }
  findDocumentsForProperty(propertyId: string) {
    return request<AppDocument[]>(`/documents/property/${propertyId}`, { token: this.token, accountId: this.accountId });
  }
  verifyDocument(documentId: string, input: { status: "verified" | "rejected"; notes?: string }) {
    return request<AppDocument>(`/documents/${documentId}/verify`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findPendingDocumentsForArbitration() {
    return request<AppDocument[]>("/documents/pending", { token: this.token, accountId: this.accountId });
  }
  arbitrateDocumentVerification(documentId: string, input: { status: "verified" | "rejected" | "submitted"; notes?: string }) {
    return request<AppDocument>(`/documents/${documentId}/arbitrate`, {
      method: "PATCH",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  // The structured "submit more evidence" channel — see the API's own
  // DocumentsService.submitEvidence comment.
  submitDocumentEvidence(documentId: string, input: { note: string; fileUrl?: string }) {
    return request<DocumentEvidence>(`/documents/${documentId}/evidence`, {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findDocumentEvidence(documentId: string) {
    return request<DocumentEvidence[]>(`/documents/${documentId}/evidence`, { token: this.token, accountId: this.accountId });
  }
  // --- Vendor/supplier verification evidence ---
  submitVendorVerificationEvidence(input: { note: string; fileUrl?: string }) {
    return request<VendorVerificationEvidence>("/vendors/me/verification-evidence", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findMyVendorVerificationEvidence() {
    return request<VendorVerificationEvidence[]>("/vendors/me/verification-evidence", { token: this.token, accountId: this.accountId });
  }
  findVendorVerificationEvidence(vendorId: string) {
    return request<VendorVerificationEvidence[]>(`/vendors/${vendorId}/verification-evidence`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
  submitSupplierVerificationEvidence(input: { note: string; fileUrl?: string }) {
    return request<SupplierVerificationEvidence>("/suppliers/me/verification-evidence", {
      method: "POST",
      body: input,
      token: this.token,
      accountId: this.accountId,
    });
  }
  findMySupplierVerificationEvidence() {
    return request<SupplierVerificationEvidence[]>("/suppliers/me/verification-evidence", { token: this.token, accountId: this.accountId });
  }
  findSupplierVerificationEvidence(supplierId: string) {
    return request<SupplierVerificationEvidence[]>(`/suppliers/${supplierId}/verification-evidence`, {
      token: this.token,
      accountId: this.accountId,
    });
  }
}
