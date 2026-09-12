import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Mirrors Section 8's Permission Areas, narrowed to what this scaffold's
// modules actually check. Extend this list as later modules (projects,
// vendors, payments, inspections, ...) get built.
const PERMISSIONS = [
  { key: 'property:read', label: 'View properties' },
  { key: 'property:write', label: 'Add or edit properties' },
  { key: 'inspection:read', label: 'View property inspections' },
  { key: 'inspection:write', label: 'Schedule, complete, or cancel a property inspection' },
  { key: 'lease:read', label: 'View property leases and rent history' },
  { key: 'lease:write', label: 'Create a lease, record rent, or end a lease' },
  { key: 'maintenance:read', label: 'View property maintenance requests' },
  { key: 'maintenance:write', label: 'Report, start, resolve, or cancel a maintenance request' },
  { key: 'document:read', label: 'View documents' },
  { key: 'document:write', label: 'Upload documents' },
  { key: 'document:verify', label: "Approve or reject an uploaded document's verification status" },
  { key: 'document:arbitrate', label: 'Verify or reject any document platform-wide (neutral reviewer only — never granted to document:write roles)' },
  { key: 'account:manage_members', label: 'Manage account members' },
  { key: 'ai:act', label: 'Use the AI copilot' },
  // Admin operations (Modules 16-24 bucket) — platform_admin only, never
  // granted alongside account:manage_members: that permission only ever
  // reaches the caller's own account (see PermissionsGuard's :accountId
  // check), this reaches every account platform-wide.
  { key: 'account:read_all', label: 'View every account platform-wide (platform admin only)' },
  { key: 'account:suspend', label: 'Suspend or reinstate any account platform-wide (platform admin only)' },
  // Modules 7 & 9 — Vendor Marketplace & Project Tracking (Priority 3).
  { key: 'vendor:read', label: 'Browse vendor profiles' },
  { key: 'vendor:write', label: 'Create or edit a vendor profile' },
  { key: 'vendor:verify', label: "Set a vendor's platform verification status (neutral reviewer only — never granted to the vendor role itself)" },
  { key: 'project:read', label: 'View projects' },
  { key: 'project:write', label: 'Create or edit projects' },
  // Deliberately narrower than project:write — advancing a project stage
  // or posting a progress update, not creating/completing the project or
  // touching its money. Granted to every owner-tier role AND the vendor
  // role, so an account genuinely hired onto a project (via
  // ProjectVendorAssignment, checked by @AllowAssignedVendor() alongside
  // this) can track its own work without gaining project:write.
  { key: 'project:update_progress', label: 'Update a project stage or post a progress update' },
  { key: 'milestone:write', label: 'Add project milestones' },
  { key: 'quote:read', label: 'View vendor quotes' },
  { key: 'quote:write', label: 'Request, submit, or accept vendor quotes' },
  // Module 11 — Payments and Escrow (Priority 4).
  { key: 'payment:read', label: 'View payments, escrow activity, and receipts' },
  { key: 'payment:write', label: 'Deposit funds into a project escrow account' },
  { key: 'payment:approve', label: 'Release escrow funds for an approved milestone' },
  { key: 'payout:read', label: 'View vendor payouts' },
  { key: 'dispute:read', label: 'View disputes' },
  { key: 'dispute:write', label: 'Raise or resolve disputes' },
  { key: 'dispute:arbitrate', label: 'Arbitrate any open dispute platform-wide (neutral reviewer only — never granted to dispute:write roles)' },
  // Modules 5 & 10 — Property Marketplace & Materials Marketplace (Priority 5).
  { key: 'listing:read', label: 'Browse and search property listings' },
  { key: 'listing:write', label: 'Create, publish, and manage a property listing' },
  { key: 'listing:verify', label: "Set a property listing's platform verification status (neutral reviewer only — never granted to the listing:write role itself)" },
  { key: 'offer:read', label: 'View offers on a listing' },
  { key: 'offer:write', label: 'Submit or respond to an offer' },
  { key: 'supplier:read', label: 'Browse supplier profiles' },
  { key: 'supplier:write', label: 'Create or edit a supplier profile' },
  { key: 'supplier:verify', label: "Set a supplier's platform verification status (neutral reviewer only — never granted to the supplier role itself)" },
  { key: 'product:read', label: 'Browse the materials/tools/equipment catalog' },
  { key: 'product:write', label: "Manage a supplier's own product catalog" },
  { key: 'order:read', label: 'View orders' },
  { key: 'order:write', label: 'Place an order, or update its status/delivery as the supplier' },
  // Module 10's rental calendar — its own pair, same reasoning
  // inspection:read/write and lease:read/write both give: renting a tool
  // is a distinct action from buying materials, not folded into order:*.
  { key: 'rental:read', label: 'View rental bookings' },
  { key: 'rental:write', label: 'Request, confirm, return, or cancel a rental booking' },
  // Reviews — leaving one, on a completed project (vendor) or a delivered
  // order (supplier). Reading a review needs no permission of its own: it
  // rides along with vendor:read/supplier:read since findOne/findSupplier
  // already include it.
  { key: 'review:write', label: 'Leave a review after a completed project or delivered order' },
  { key: 'review:respond', label: "Reply to a review left on your own vendor/supplier profile" },
  { key: 'review:flag', label: 'Flag a review left on your own vendor/supplier profile for moderation' },
  { key: 'review:moderate', label: 'Hide or restore any flagged review platform-wide (neutral reviewer only — never granted to review:write/respond/flag roles)' },
  // Platform-wide compliance tracker (this pass) — see the ComplianceItem
  // schema comment. Neutral-reviewer-only, same isolation as vendor:verify/
  // dispute:arbitrate/document:arbitrate/review:moderate above: no
  // tenant-facing role in this file ever carries either key.
  { key: 'compliance:read', label: 'View the platform compliance tracker (neutral reviewer only)' },
  { key: 'compliance:write', label: 'Edit the platform compliance tracker (neutral reviewer only)' },
  // Module 17 — Estate and Community Management (real scope supplied
  // this pass — see communities.module.ts's own comment). One
  // account-owned resource (Community) with its own residents and
  // announcements, same read/write pair every other owned resource in
  // this file already uses — not split further since, unlike documents/
  // disputes/reviews, nothing about this Phase 1 slice needs a neutral-
  // reviewer-only verb.
  { key: 'community:read', label: 'View communities, their residents, and announcements' },
  { key: 'community:write', label: 'Create a community, manage its residents, and post announcements' },
  // Visibility packages (this pass, not from the numbered blueprint) —
  // see packages.module.ts's own comment. package:read covers browsing
  // the catalog and viewing an account's own subscription history;
  // package:write is the one action that spends money (subscribing), so
  // it's withheld from viewer the same way payment:write is.
  { key: 'package:read', label: 'Browse visibility packages and view your own subscription history' },
  { key: 'package:write', label: 'Subscribe your account to a visibility package' },
  // Module 24's "Branch property report"/"Facility cost report" (this
  // pass) — see branches.module.ts's own comment. Same read/write pair
  // every other account-owned resource in this file already uses.
  { key: 'branch:read', label: 'View branches and which properties are assigned to each' },
  { key: 'branch:write', label: 'Create, edit, or remove a branch, and assign properties to one' },
];

// No new permission keys needed for the inspector role below — it's built
// entirely from a narrower slice of permissions that already exist.

// Section 8's core roles, narrowed to the ones DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE
// (accounts.service.ts) and the demo data below need.
const ROLES: Record<string, string[]> = {
  property_owner: [
    'property:read',
    'property:write',
    'inspection:read',
    'inspection:write',
    'lease:read',
    'lease:write',
    'maintenance:read',
    'maintenance:write',
    'document:read',
    'document:write',
    'document:verify',
    'account:manage_members',
    'ai:act',
    'community:read',
    'community:write',
    'vendor:read',
    'project:read',
    'project:write',
    'project:update_progress',
    'milestone:write',
    'quote:read',
    'quote:write',
    'payment:read',
    'payment:write',
    'payment:approve',
    'payout:read',
    'dispute:read',
    'dispute:write',
    'listing:read',
    'listing:write',
    'offer:read',
    'offer:write',
    'supplier:read',
    'product:read',
    'order:read',
    'order:write',
    'rental:read',
    'rental:write',
    'review:write',
    'package:read',
    'package:write',
    'branch:read',
    'branch:write',
  ],
  family_admin: [
    'property:read',
    'property:write',
    'inspection:read',
    'inspection:write',
    'lease:read',
    'lease:write',
    'maintenance:read',
    'maintenance:write',
    'document:read',
    'document:write',
    'document:verify',
    'account:manage_members',
    'ai:act',
    'community:read',
    'community:write',
    'vendor:read',
    'project:read',
    'project:write',
    'project:update_progress',
    'milestone:write',
    'quote:read',
    'quote:write',
    'payment:read',
    'payment:write',
    'payment:approve',
    'payout:read',
    'dispute:read',
    'dispute:write',
    'listing:read',
    'listing:write',
    'offer:read',
    'offer:write',
    'supplier:read',
    'product:read',
    'order:read',
    'order:write',
    'rental:read',
    'rental:write',
    'review:write',
    'package:read',
    'package:write',
    'branch:read',
    'branch:write',
  ],
  company_admin: [
    'property:read',
    'property:write',
    'inspection:read',
    'inspection:write',
    'lease:read',
    'lease:write',
    'maintenance:read',
    'maintenance:write',
    'document:read',
    'document:write',
    'document:verify',
    'account:manage_members',
    'ai:act',
    'community:read',
    'community:write',
    'vendor:read',
    'project:read',
    'project:write',
    'project:update_progress',
    'milestone:write',
    'quote:read',
    'quote:write',
    'payment:read',
    'payment:write',
    'payment:approve',
    'payout:read',
    'dispute:read',
    'dispute:write',
    'listing:read',
    'listing:write',
    'offer:read',
    'offer:write',
    'supplier:read',
    'product:read',
    'order:read',
    'order:write',
    'rental:read',
    'rental:write',
    'review:write',
    'package:read',
    'package:write',
    'branch:read',
    'branch:write',
  ],
  // A vendor account browses/edits its own marketplace profile, sees the
  // projects it's been invited to or hired for, quotes on them, and can
  // see what it's been paid — it never gets project:write, milestone:write,
  // or payment:approve, those stay the property owner's own actions (a
  // vendor releasing its own escrow funds would defeat the point of escrow).
  // project:update_progress IS granted — see that permission's own
  // comment — but only ever reaches a project this vendor is actually
  // assigned to, via PermissionsGuard's @AllowAssignedVendor() ABAC check,
  // not RBAC alone.
  vendor: [
    'document:read',
    'ai:act',
    'vendor:read',
    'vendor:write',
    'project:read',
    'project:update_progress',
    'quote:read',
    'quote:write',
    'payout:read',
    'dispute:read',
    'dispute:write',
    'review:respond',
    'review:flag',
    // Browsing materials while assessing or pricing a job — never
    // supplier:write/product:write, a vendor isn't a supplier.
    'supplier:read',
    'product:read',
    // A contractor renting equipment for a job it's working — the renter
    // side of Module 10's rental calendar.
    'rental:read',
    'rental:write',
    'package:read',
    'package:write',
  ],
  // A distinct, narrower role for a VENDOR-type account whose whole
  // business is being picked as an inspector (Module 8) — not bidding on
  // renovation/construction projects, disputing project payments, or
  // renting equipment. Chosen at account-creation time instead of the
  // default "vendor" role — see CreateAccountDto.vendorRole and
  // AccountsService.create. Deliberately doesn't gate who can actually be
  // picked as PropertyInspection.inspectorVendorId/MaintenanceRequest.
  // assignedVendorId — that stays serviceCategory + license (see
  // PropertiesService.requireVendor), same as any "vendor"-role account —
  // this only narrows what the account itself can *do*, not who a
  // property owner can *choose*. No new permission keys: every one of
  // these already exists, just a smaller slice of the "vendor" role's own
  // set — vendor:read/write to manage its own profile and license,
  // document:read for inspection-related documents, ai:act for the
  // copilot. No quote:*/dispute:*/rental:*/product:read — an inspector
  // isn't bidding on projects, disputing payments, or renting/browsing
  // marketplace materials.
  inspector: ['vendor:read', 'vendor:write', 'document:read', 'ai:act'],
  // A supplier account manages its own marketplace profile and product
  // catalog, and fulfills the orders placed against it — it never gets
  // listing/offer/vendor/project permissions, those belong to the other
  // two marketplaces.
  supplier: [
    'ai:act',
    'supplier:read',
    'supplier:write',
    'product:read',
    'product:write',
    'order:read',
    'order:write',
    // The fulfillment side of Module 10's rental calendar — confirming,
    // returning, or cancelling a booking against its own catalog.
    'rental:read',
    'rental:write',
    'review:respond',
    'review:flag',
    // Module 18 Phase 1 — a supplier had no dispute permissions at all
    // before this: an order gone wrong (a real dispute type this pass
    // adds — "material delivery issue," "refund request") had no path
    // for the supplier's own side, unlike a vendor's identical project-
    // dispute permissions, which already existed.
    'dispute:read',
    'dispute:write',
    'package:read',
    'package:write',
  ],
  // A renter's own account — the other half of the "no separate Tenant
  // identity" gap Lease.tenantName's own schema comment used to flag.
  // Deliberately minimal, same "only what its own screen needs" reasoning
  // platform_reviewer's own comment gives: a tenant reads its own lease,
  // rent history, and any documents the landlord tagged to it
  // (Document.leaseId), can report a maintenance issue, and can ask
  // summarize_my_tenancy about its own lease — never lease:write (rent/
  // dates/deposit stay landlord-controlled), never document:write
  // (uploading stays the landlord's own action), never property:read/
  // write (no general access to the property record itself, only what
  // TenantService's own routes expose).
  tenant: ['lease:read', 'maintenance:read', 'maintenance:write', 'document:read', 'ai:act'],
  // Section 8's own example role: "a family member can view documents but
  // not approve payments" — a read-only member of a family/company account.
  // Notably excludes payment:approve and dispute:write for the same reason.
  viewer: [
    'property:read',
    'inspection:read',
    'lease:read',
    'maintenance:read',
    'document:read',
    'ai:act',
    'vendor:read',
    'project:read',
    'quote:read',
    'payment:read',
    'payout:read',
    'dispute:read',
    'listing:read',
    'offer:read',
    'supplier:read',
    'product:read',
    'order:read',
    'rental:read',
    'package:read',
    'branch:read',
  ],
  // Section 7's three named operational roles this scaffold didn't have
  // yet — each a narrower, job-scoped slice of the owner-tier roles above
  // rather than full account control. None gets account:manage_members,
  // payment:write/approve, or branch:write — those stay the owner/admin's
  // own actions. Invitable the same way viewer/family_admin/company_admin
  // are (see apps/web/pages/accounts/members.tsx's INVITABLE_ROLES).
  //
  // Day-to-day operation of the property record itself: inspections,
  // leases, maintenance, documents — everything a property_owner/
  // family_admin/company_admin can do to a property except manage members,
  // touch project money, or administer branches.
  property_manager: [
    'property:read',
    'property:write',
    'inspection:read',
    'inspection:write',
    'lease:read',
    'lease:write',
    'maintenance:read',
    'maintenance:write',
    'document:read',
    'document:write',
    'vendor:read',
    'project:read',
    'ai:act',
    'branch:read',
  ],
  // Narrower still than property_manager — the upkeep/vendor-coordination
  // slice of the job (maintenance, inspections, which vendor is doing the
  // work) without the lease or property-record editing rights a full
  // property manager has.
  facility_manager: [
    'property:read',
    'maintenance:read',
    'maintenance:write',
    'inspection:read',
    'inspection:write',
    'vendor:read',
    'document:read',
    'branch:read',
    'ai:act',
  ],
  // Runs renovation/construction projects day-to-day — quoting, hiring,
  // tracking progress, disputing a vendor's work — but never
  // payment:write/approve (releasing this account's own escrow money stays
  // the owner/admin's own action) and never account:manage_members.
  project_manager: [
    'property:read',
    'project:read',
    'project:write',
    'project:update_progress',
    'milestone:write',
    'quote:read',
    'quote:write',
    'vendor:read',
    'document:read',
    'payment:read',
    'dispute:read',
    'dispute:write',
    'ai:act',
  ],
  // Section 7's fourth named role — the money-release gate itself, split
  // out from project_manager above the same way PaymentsService.
  // releaseMilestone already treats "run the project" and "release its
  // escrow funds" as two different questions (that method's own OR check
  // against a PropertyAccessGrant is the other way into the same gate).
  // Can approve a milestone's evidence (milestone:write — the actual
  // permission PaymentsController.approveMilestone checks) and release
  // its funds (payment:approve), but never payment:write (can't deposit
  // into escrow) and never project:write (can't create, edit, or
  // complete a project) — a finance approver reviews and releases money
  // on projects someone else runs, nothing else.
  finance_approver: [
    'property:read',
    'project:read',
    'milestone:write',
    'payment:read',
    'payment:approve',
    'payout:read',
    'dispute:read',
    'ai:act',
  ],
  // Module 6's actual "neutral reviewer" — a role deliberately never
  // granted to the vendor or supplier roles above, so a vendor/supplier
  // can never move its own verificationStatus off "not_verified"; never
  // granted dispute:write, so it can never be the account that raised a
  // dispute it goes on to arbitrate; and never granted document:write, so
  // it never uploads — let alone owns — a document it might later verify.
  // Same shape extends to review:moderate: never granted review:write/
  // respond/flag, so it can never be the reviewer, the reviewed party, or
  // the one who flagged a review it goes on to moderate; and to
  // listing:verify, never granted listing:write, so it can never be the
  // account that listed a property it goes on to verify. Reads only what
  // it needs to review (vendor:read/supplier:read/listing:read) plus
  // :verify/:arbitrate/:moderate — nothing else, not even ai:act, since
  // this role's whole job is a handful of mechanical actions on other
  // accounts' data.
  platform_reviewer: [
    'vendor:read',
    'vendor:verify',
    'supplier:read',
    'supplier:verify',
    'listing:read',
    'listing:verify',
    'dispute:arbitrate',
    'document:arbitrate',
    'review:moderate',
    'compliance:read',
    'compliance:write',
  ],
  // Admin operations — a distinct job from platform_reviewer's own trust
  // & safety work (reviewing one vendor/supplier/dispute/document/review
  // at a time): this operates on accounts themselves, platform-wide.
  // Deliberately just these two permissions, nothing else — same
  // "a handful of mechanical actions on other accounts' data" reasoning
  // platform_reviewer's own comment gives, not even ai:act.
  platform_admin: ['account:read_all', 'account:suspend'],
};

const DEMO_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_PROPERTY_ID = '00000000-0000-0000-0000-000000000002';
const DEMO_USER_EMAIL = 'demo-owner@propertyonthego.test';
const DEMO_USER_PASSWORD = 'demo-password';
const DEMO_PROJECT_ID = '00000000-0000-0000-0000-000000000003';
const DEMO_VENDOR_ACCOUNT_ID = '00000000-0000-0000-0000-000000000004';
const DEMO_VENDOR_ID = '00000000-0000-0000-0000-000000000005';
const DEMO_LISTING_ID = '00000000-0000-0000-0000-000000000006';
const DEMO_SUPPLIER_ACCOUNT_ID = '00000000-0000-0000-0000-000000000007';
const DEMO_SUPPLIER_ID = '00000000-0000-0000-0000-000000000008';
const DEMO_PRODUCT_CABINET_ID = '00000000-0000-0000-0000-000000000009';
const DEMO_PRODUCT_TILE_ID = '00000000-0000-0000-0000-00000000000a';
const DEMO_PRODUCT_PAINT_ID = '00000000-0000-0000-0000-00000000000b';
const DEMO_ORDER_ID = '00000000-0000-0000-0000-00000000000c';
const DEMO_VALUATION_ID = '00000000-0000-0000-0000-00000000000d';
const DEMO_CONVERSATION_ID = '00000000-0000-0000-0000-00000000000e';
const DEMO_PLATFORM_ACCOUNT_ID = '00000000-0000-0000-0000-00000000000f';
const DEMO_TENANT_ACCOUNT_ID = '00000000-0000-0000-0000-000000000010';
const DEMO_LEASE_ID = '00000000-0000-0000-0000-000000000011';
const DEMO_PLATFORM_ADMIN_ACCOUNT_ID = '00000000-0000-0000-0000-000000000012';
// Matches ProjectsService.create's default stage sequence — kept in sync by
// hand since the seed script doesn't call the service directly.
const DEFAULT_STAGES = ['Scope', 'Quote', 'Materials', 'Work', 'Handover'];

async function main() {
  console.log('Seeding permissions...');
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { label: permission.label },
      create: permission,
    });
  }

  console.log('Seeding roles...');
  for (const [roleKey, permissionKeys] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: {},
      create: { key: roleKey, name: roleKey.replace(/_/g, ' ') },
    });
    for (const permissionKey of permissionKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log('Seeding demo owner, account, and property...');
  const passwordHash = await bcrypt.hash(DEMO_USER_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: { name: 'Demo Owner', email: DEMO_USER_EMAIL, passwordHash },
  });

  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'property_owner' } });
  const account = await prisma.account.upsert({
    where: { id: DEMO_ACCOUNT_ID },
    update: {},
    create: {
      id: DEMO_ACCOUNT_ID,
      accountType: 'INDIVIDUAL',
      name: 'Demo Owner (Individual)',
      country: 'NG',
      currency: 'NGN',
      timezone: 'Africa/Lagos',
    },
  });

  await prisma.accountMember.upsert({
    where: { accountId_userId: { accountId: account.id, userId: user.id } },
    update: {},
    create: { accountId: account.id, userId: user.id, roleId: ownerRole.id },
  });

  const property = await prisma.property.upsert({
    where: { id: DEMO_PROPERTY_ID },
    update: {},
    create: {
      id: DEMO_PROPERTY_ID,
      accountId: account.id,
      propertyType: 'residential_house',
      name: '14 Ocean Drive',
      addressLine: '14 Ocean Drive',
      city: 'Lekki',
      country: 'NG',
      estimatedValue: 185000000,
    },
  });

  // Only seed documents/timeline once — Property/Account/User upserts are
  // safe to re-run, these children aren't (no natural unique key).
  const alreadySeeded = await prisma.document.count({ where: { propertyId: property.id } });
  if (alreadySeeded === 0) {
    await prisma.propertyTimelineEvent.create({
      data: { propertyId: property.id, eventType: 'created', label: 'Property added to portfolio' },
    });
    await prisma.document.create({
      data: {
        accountId: account.id,
        propertyId: property.id,
        documentType: 'title_document',
        fileUrl: 'https://example.com/docs/title-document.pdf',
        verificationStatus: 'verified',
        uploadedByUserId: user.id,
      },
    });
    await prisma.document.create({
      data: {
        accountId: account.id,
        propertyId: property.id,
        documentType: 'survey_plan',
        fileUrl: 'https://example.com/docs/survey-plan.pdf',
        verificationStatus: 'verified',
        uploadedByUserId: user.id,
      },
    });
    await prisma.propertyTimelineEvent.create({
      data: { propertyId: property.id, eventType: 'document_uploaded', label: 'Document uploaded: title_document' },
    });
    // certificate_of_occupancy and building_approval deliberately left
    // missing, so verify_property_documents has something real to flag.
  }

  console.log('Seeding demo vendor account and profile...');
  // Same demo user, a second membership — proves the "one user, several
  // accounts" model (Module 1) and lets the demo login exercise both the
  // owner side and the vendor side of Priority 3 without a second signup.
  const vendorRole = await prisma.role.findUniqueOrThrow({ where: { key: 'vendor' } });
  const vendorAccount = await prisma.account.upsert({
    where: { id: DEMO_VENDOR_ACCOUNT_ID },
    update: {},
    create: {
      id: DEMO_VENDOR_ACCOUNT_ID,
      accountType: 'VENDOR',
      name: 'Lekki Renovations Co.',
      country: 'NG',
      currency: 'NGN',
      timezone: 'Africa/Lagos',
    },
  });
  await prisma.accountMember.upsert({
    where: { accountId_userId: { accountId: vendorAccount.id, userId: user.id } },
    update: {},
    create: { accountId: vendorAccount.id, userId: user.id, roleId: vendorRole.id },
  });
  const vendor = await prisma.vendor.upsert({
    where: { id: DEMO_VENDOR_ID },
    update: {},
    create: {
      id: DEMO_VENDOR_ID,
      accountId: vendorAccount.id,
      businessName: 'Lekki Renovations Co.',
      serviceCategory: 'renovation',
      locationCoverage: 'Lagos, Nigeria',
      verificationStatus: 'verified',
      ratingAverage: 4.6,
    },
  });

  console.log('Seeding demo project...');
  const project = await prisma.project.upsert({
    where: { id: DEMO_PROJECT_ID },
    update: {},
    create: {
      id: DEMO_PROJECT_ID,
      accountId: account.id,
      propertyId: property.id,
      projectType: 'renovation',
      title: 'Kitchen Renovation',
      scopeDescription:
        'Full kitchen renovation: new cabinets, countertop, tiling, painting, plumbing, and electrical rework.',
      budget: 2500000,
      currency: 'NGN',
      status: 'planning',
    },
  });

  const stagesAlreadySeeded = await prisma.projectStage.count({ where: { projectId: project.id } });
  if (stagesAlreadySeeded === 0) {
    await prisma.projectStage.createMany({
      data: DEFAULT_STAGES.map((name, i) => ({
        projectId: project.id,
        name,
        sortOrder: i,
        status: i === 0 ? 'in_progress' : 'not_started',
      })),
    });
    await prisma.propertyTimelineEvent.create({
      data: { propertyId: property.id, eventType: 'project_started', label: `Project started: ${project.title}` },
    });
    // A submitted quote from the demo vendor — gives compare_vendor_quotes
    // and the marketplace "my quotes" view something real to show even
    // before anyone drives the app by hand.
    const quote = await prisma.vendorQuote.create({
      data: {
        projectId: project.id,
        vendorId: vendor.id,
        amount: 2350000,
        currency: 'NGN',
        notes: 'Includes materials and labor, 6-week timeline.',
        status: 'submitted',
      },
    });

    console.log('Seeding demo escrow, milestone, and a released payout...');
    // Mirrors ProjectsService.acceptQuote — hire the vendor that quoted.
    await prisma.vendorQuote.update({ where: { id: quote.id }, data: { status: 'accepted' } });
    await prisma.projectVendorAssignment.create({
      data: { projectId: project.id, vendorId: vendor.id, role: 'primary_contractor' },
    });
    await prisma.project.update({ where: { id: project.id }, data: { status: 'in_progress' } });

    const milestone = await prisma.projectMilestone.create({
      data: {
        projectId: project.id,
        title: 'Demolition & prep',
        description: 'Strip old cabinetry and tiling, prep surfaces for the new install.',
        paymentAmount: 800000,
        status: 'in_progress',
      },
    });

    // Mirrors PaymentsService.deposit — fund the escrow account.
    const escrowAccount = await prisma.escrowAccount.create({
      data: { projectId: project.id, currency: 'NGN', balance: 1500000 },
    });
    const deposit = await prisma.payment.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        escrowAccountId: escrowAccount.id,
        amount: 1500000,
        currency: 'NGN',
        provider: 'manual',
        status: 'completed',
      },
    });
    await prisma.escrowLedgerEntry.create({
      data: {
        escrowAccountId: escrowAccount.id,
        entryType: 'deposit',
        amount: 1500000,
        balanceAfter: 1500000,
        relatedPaymentId: deposit.id,
        notes: 'Initial escrow funding',
      },
    });
    await prisma.receipt.create({
      data: { accountId: account.id, receiptNumber: 'RCT-DEMO-DEPOSIT-0001', paymentId: deposit.id, amount: 1500000, currency: 'NGN' },
    });

    // Mirrors PaymentsService.approveMilestone + releaseMilestone — the
    // owner approved the demolition milestone's evidence and released it.
    await prisma.projectMilestone.update({ where: { id: milestone.id }, data: { approvalStatus: 'approved' } });
    const payout = await prisma.payout.create({
      data: {
        vendorId: vendor.id,
        projectId: project.id,
        milestoneId: milestone.id,
        amount: 800000,
        currency: 'NGN',
        status: 'paid',
        paidAt: new Date(),
      },
    });
    await prisma.escrowAccount.update({ where: { id: escrowAccount.id }, data: { balance: 700000 } });
    await prisma.projectMilestone.update({ where: { id: milestone.id }, data: { status: 'completed' } });
    await prisma.escrowLedgerEntry.create({
      data: {
        escrowAccountId: escrowAccount.id,
        entryType: 'release',
        amount: 800000,
        balanceAfter: 700000,
        relatedMilestoneId: milestone.id,
        relatedPayoutId: payout.id,
        notes: `Milestone released: ${milestone.title}`,
      },
    });
    await prisma.receipt.create({
      data: {
        accountId: vendorAccount.id,
        receiptNumber: 'RCT-DEMO-PAYOUT-0001',
        payoutId: payout.id,
        amount: 800000,
        currency: 'NGN',
      },
    });

    // Illustrative only — VendorsService.createReview would refuse this
    // (the demo project is deliberately left "in_progress" above, mid
    // money-lifecycle, so there's something live to demo). Seed data
    // writes straight to Prisma, so it can skip that gate to give the
    // vendor's profile page a real review to show on first login; the gate
    // itself is exercised for real once a user marks their own project
    // complete and reviews it through the UI.
    await prisma.vendorReview.create({
      data: {
        vendorId: vendor.id,
        projectId: project.id,
        accountId: account.id,
        rating: 5,
        comment: 'Fast, tidy demolition work — showed up on time every day and left the site clean.',
      },
    });
  }

  console.log('Seeding demo listing (property marketplace)...');
  const listing = await prisma.propertyListing.upsert({
    where: { id: DEMO_LISTING_ID },
    update: {},
    create: {
      id: DEMO_LISTING_ID,
      propertyId: property.id,
      accountId: account.id,
      listingType: 'sale',
      askingPrice: 210000000,
      currency: 'NGN',
      title: '14 Ocean Drive — Renovated 4-Bed Family Home',
      description: 'A well-maintained family home in Lekki, mid-renovation with verified title documents.',
      photoUrls: ['https://example.com/photos/ocean-drive-1.jpg', 'https://example.com/photos/ocean-drive-2.jpg'],
      status: 'active',
      verificationStatus: 'verified',
    },
  });

  console.log('Seeding demo supplier, catalog, and order (materials marketplace)...');
  // A third membership on the same demo login — individual, vendor, and now
  // supplier — the multi-account model carries all the way through every
  // marketplace this scaffold has built.
  const supplierRole = await prisma.role.findUniqueOrThrow({ where: { key: 'supplier' } });
  const supplierAccount = await prisma.account.upsert({
    where: { id: DEMO_SUPPLIER_ACCOUNT_ID },
    update: {},
    create: {
      id: DEMO_SUPPLIER_ACCOUNT_ID,
      accountType: 'SUPPLIER',
      name: 'Lagos BuildMart',
      country: 'NG',
      currency: 'NGN',
      timezone: 'Africa/Lagos',
    },
  });
  await prisma.accountMember.upsert({
    where: { accountId_userId: { accountId: supplierAccount.id, userId: user.id } },
    update: {},
    create: { accountId: supplierAccount.id, userId: user.id, roleId: supplierRole.id },
  });
  const supplier = await prisma.supplier.upsert({
    where: { id: DEMO_SUPPLIER_ID },
    update: {},
    create: {
      id: DEMO_SUPPLIER_ID,
      accountId: supplierAccount.id,
      businessName: 'Lagos BuildMart',
      category: 'materials',
      locationCoverage: 'Lagos, Nigeria',
      verificationStatus: 'verified',
      ratingAverage: 4.4,
    },
  });

  // Categories deliberately only cover 3 of the 6 items in the demo
  // project's scope (cabinet, tile, paint) — countertop/plumbing/electrical
  // are left unmatched on purpose, the same way two document types were
  // left missing for verify_property_documents, so boq_to_order has both a
  // real match and a real gap to show.
  await prisma.product.upsert({
    where: { id: DEMO_PRODUCT_CABINET_ID },
    update: {},
    create: {
      id: DEMO_PRODUCT_CABINET_ID,
      supplierId: supplier.id,
      name: 'Modern Kitchen Cabinet Set',
      category: 'cabinet',
      unit: 'set',
      unitPrice: 380000,
      currency: 'NGN',
      stockQuantity: 15,
    },
  });
  const tileProduct = await prisma.product.upsert({
    where: { id: DEMO_PRODUCT_TILE_ID },
    update: {},
    create: {
      id: DEMO_PRODUCT_TILE_ID,
      supplierId: supplier.id,
      name: 'Ceramic Floor Tile (60x60)',
      category: 'tile',
      unit: 'sqm',
      unitPrice: 8500,
      currency: 'NGN',
      stockQuantity: 500,
    },
  });
  await prisma.product.upsert({
    where: { id: DEMO_PRODUCT_PAINT_ID },
    update: {},
    create: {
      id: DEMO_PRODUCT_PAINT_ID,
      supplierId: supplier.id,
      name: 'Interior Emulsion Paint (20L)',
      category: 'paint',
      unit: 'drum',
      unitPrice: 45000,
      currency: 'NGN',
      stockQuantity: 60,
    },
  });

  const orderAlreadySeeded = await prisma.order.count({ where: { id: DEMO_ORDER_ID } });
  if (orderAlreadySeeded === 0) {
    const tileQuantity = 40;
    const lineTotal = tileQuantity * Number(tileProduct.unitPrice);
    await prisma.order.create({
      data: {
        id: DEMO_ORDER_ID,
        accountId: account.id,
        supplierId: supplier.id,
        projectId: project.id,
        status: 'confirmed',
        totalAmount: lineTotal,
        currency: 'NGN',
        deliveryAddress: '14 Ocean Drive, Lekki, Lagos',
        items: {
          create: [{ productId: tileProduct.id, quantity: tileQuantity, unitPrice: tileProduct.unitPrice, lineTotal }],
        },
        delivery: {
          create: {
            status: 'in_transit',
            trackingReference: 'BM-000123',
            estimatedDeliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          },
        },
      },
    });
    await prisma.product.update({
      where: { id: tileProduct.id },
      data: { stockQuantity: { decrement: tileQuantity } },
    });

    // Same rationale as the VendorReview above — the demo order is
    // deliberately left "in_transit" so there's a live delivery to demo,
    // and MaterialsService.createOrderReview would refuse a review on
    // anything short of "delivered". Seed data bypasses that gate directly
    // so the supplier's storefront has a real review on first login.
    await prisma.supplierReview.create({
      data: {
        supplierId: supplier.id,
        orderId: DEMO_ORDER_ID,
        accountId: account.id,
        rating: 4,
        comment: 'Good tile quality, arrived well packaged. Delivery took a couple of days longer than quoted.',
      },
    });
  }

  console.log('Seeding demo valuation and chat conversation (Priority 6)...');
  await prisma.propertyValuation.upsert({
    where: { id: DEMO_VALUATION_ID },
    update: {},
    create: {
      id: DEMO_VALUATION_ID,
      propertyId: property.id,
      estimatedValue: 235000000,
      currency: 'NGN',
      source: 'manual',
      notes: 'Post-renovation walk-through estimate by the owner.',
    },
  });

  // A short conversation demonstrating the tool-calling path itself —
  // written directly rather than through ChatService, so seeding doesn't
  // depend on a live or stub LLM call completing. Mirrors what
  // StubLlmProvider's keyword router would actually do for this message.
  const conversationAlreadySeeded = await prisma.aiConversation.count({ where: { id: DEMO_CONVERSATION_ID } });
  if (conversationAlreadySeeded === 0) {
    const ownerMember = await prisma.accountMember.findUniqueOrThrow({
      where: { accountId_userId: { accountId: account.id, userId: user.id } },
    });
    const conversation = await prisma.aiConversation.create({
      data: {
        id: DEMO_CONVERSATION_ID,
        accountId: account.id,
        accountMemberId: ownerMember.id,
        moduleContext: `property:${property.id}`,
        title: 'What is my ROI on 14 Ocean Drive so far?',
      },
    });
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: 'What is my ROI on 14 Ocean Drive so far?',
      },
    });
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content:
          'Financial scenario — draft\n\n' +
          '- Current estimated value: 235,000,000 NGN\n' +
          '- Total invested (acquisition + project spend): 185,800,000 NGN\n' +
          '- Simple ROI: 26.5%\n' +
          '- This is a simplified, undiscounted estimate (no financing, selling, or tax costs) — not professional financial or valuation advice.\n\n' +
          "(This is a draft — accept, edit, or discard it with POST /ai/outputs/<outputId>/decision before it's final.)",
        toolName: 'model_roi_scenario',
      },
    });
  }

  console.log('Seeding demo platform reviewer account...');
  // Same demo user, a third membership — same "one user, several accounts"
  // pattern the vendor/supplier accounts above already use. accountType is
  // COMPANY (not a new enum value) purely to avoid a schema migration for
  // what's really just a role distinction — the neutral-reviewer property
  // comes entirely from platform_reviewer being a role no vendor/supplier
  // account is ever granted, not from any account-level flag.
  const platformReviewerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'platform_reviewer' } });
  const platformAccount = await prisma.account.upsert({
    where: { id: DEMO_PLATFORM_ACCOUNT_ID },
    update: {},
    create: {
      id: DEMO_PLATFORM_ACCOUNT_ID,
      accountType: 'COMPANY',
      name: 'PropertyOnTheGo Trust & Safety',
      country: 'NG',
      currency: 'NGN',
      timezone: 'Africa/Lagos',
    },
  });
  await prisma.accountMember.upsert({
    where: { accountId_userId: { accountId: platformAccount.id, userId: user.id } },
    update: {},
    create: { accountId: platformAccount.id, userId: user.id, roleId: platformReviewerRole.id },
  });

  console.log('Seeding demo platform-admin account (admin operations)...');
  // A separate account from platformAccount above, not a second role on
  // the same one — AccountMember's own @@unique([accountId, userId]) only
  // allows one role per user per account, and trust & safety review
  // (platform_reviewer) and admin operations (platform_admin) are
  // genuinely distinct jobs a real platform would likely staff
  // separately, same "one user, several accounts" pattern every other
  // demo membership above already uses.
  const platformAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'platform_admin' } });
  const platformAdminAccount = await prisma.account.upsert({
    where: { id: DEMO_PLATFORM_ADMIN_ACCOUNT_ID },
    update: {},
    create: {
      id: DEMO_PLATFORM_ADMIN_ACCOUNT_ID,
      accountType: 'COMPANY',
      name: 'PropertyOnTheGo Operations',
      country: 'NG',
      currency: 'NGN',
      timezone: 'Africa/Lagos',
    },
  });
  await prisma.accountMember.upsert({
    where: { accountId_userId: { accountId: platformAdminAccount.id, userId: user.id } },
    update: {},
    create: { accountId: platformAdminAccount.id, userId: user.id, roleId: platformAdminRole.id },
  });

  console.log('Seeding demo tenant account and lease (Module 13)...');
  // A fifth membership on the same demo user — same "one user, several
  // accounts" pattern the vendor/supplier/platform-reviewer accounts
  // above already use. A real deployment has a genuinely different
  // person renting from the landlord; this scaffold's single demo login
  // only needs to demonstrate the account type and the link-tenant flow
  // itself, not model a second real user.
  const tenantRole = await prisma.role.findUniqueOrThrow({ where: { key: 'tenant' } });
  const tenantAccount = await prisma.account.upsert({
    where: { id: DEMO_TENANT_ACCOUNT_ID },
    update: {},
    create: {
      id: DEMO_TENANT_ACCOUNT_ID,
      accountType: 'TENANT',
      name: 'Demo Tenant',
      country: 'NG',
      currency: 'NGN',
      timezone: 'Africa/Lagos',
    },
  });
  await prisma.accountMember.upsert({
    where: { accountId_userId: { accountId: tenantAccount.id, userId: user.id } },
    update: {},
    create: { accountId: tenantAccount.id, userId: user.id, roleId: tenantRole.id },
  });
  // tenantEmail matches the same demo user on purpose — so
  // PropertiesService.linkTenantAccount (POST .../leases/:leaseId/
  // link-tenant) has a real Tenant account it can actually find and
  // link, the same live-verifiable flow a real landlord/tenant pair
  // would go through. Left unlinked here (tenantAccountId stays null)
  // so that action is something to actually call, not a fact baked into
  // seed data.
  const lease = await prisma.lease.upsert({
    where: { id: DEMO_LEASE_ID },
    update: {},
    create: {
      id: DEMO_LEASE_ID,
      propertyId: property.id,
      tenantName: 'Demo Tenant',
      tenantEmail: DEMO_USER_EMAIL,
      tenantPhone: '+2348000000000',
      rentAmount: 2400000,
      currency: 'NGN',
      rentFrequency: 'annually',
      depositAmount: 200000,
      startDate: new Date('2026-06-01'),
      status: 'active',
    },
  });

  // Visibility-package catalog — real, admin-defined SKUs (see
  // VisibilityPackage's own schema comment), upserted on `code` the same
  // idempotent way PERMISSIONS/ROLES above are, not demo-only data tied to
  // any of the accounts above. boostWeight ordering: featured < premium,
  // regardless of monthly vs. annual — the period only changes price and
  // how long a single purchase lasts, never how strongly it boosts.
  const PACKAGES = [
    { code: 'featured_monthly', title: 'Featured', description: 'Your listings, vendor profile, or supplier profile shown with a Featured badge and moved ahead of unboosted results for 30 days.', price: 15000, currency: 'NGN', billingPeriod: 'monthly', boostWeight: 1 },
    { code: 'featured_annual', title: 'Featured (Annual)', description: 'The Featured boost, billed once a year at a discount to the monthly price.', price: 150000, currency: 'NGN', billingPeriod: 'annual', boostWeight: 1 },
    { code: 'premium_monthly', title: 'Premium', description: 'The Featured boost plus top priority over every other boosted account when more than one is competing for the same spot, for 30 days.', price: 35000, currency: 'NGN', billingPeriod: 'monthly', boostWeight: 2 },
    { code: 'premium_annual', title: 'Premium (Annual)', description: 'The Premium boost, billed once a year at a discount to the monthly price.', price: 350000, currency: 'NGN', billingPeriod: 'annual', boostWeight: 2 },
  ];
  for (const pkg of PACKAGES) {
    await prisma.visibilityPackage.upsert({
      where: { code: pkg.code },
      update: { title: pkg.title, description: pkg.description, price: pkg.price, currency: pkg.currency, billingPeriod: pkg.billingPeriod, boostWeight: pkg.boostWeight },
      create: pkg,
    });
  }

  console.log('\nDone. Demo login:');
  console.log(`  email:           ${DEMO_USER_EMAIL}`);
  console.log(`  password:        ${DEMO_USER_PASSWORD}`);
  console.log(`  owner account:   ${account.id} (send this as X-Account-Id)`);
  console.log(`  property:        ${property.id}`);
  console.log(`  project:         ${project.id}`);
  console.log(`  vendor account:  ${vendorAccount.id} (switch X-Account-Id to this to act as the vendor)`);
  console.log(`  vendor:          ${vendor.id}`);
  console.log(
    '  escrow:          funded with 1,500,000 NGN, 800,000 NGN already released on the "Demolition & prep" milestone (700,000 NGN balance left)',
  );
  console.log(`  listing:          ${listing.id} (active, on the property marketplace)`);
  console.log(`  supplier account: ${supplierAccount.id} (switch X-Account-Id to this to act as the supplier)`);
  console.log(`  supplier:         ${supplier.id} — 3 products seeded, 1 order already placed and in transit`);
  console.log(`  conversation:     ${DEMO_CONVERSATION_ID} — GET /ai/conversations/${DEMO_CONVERSATION_ID} to see the tool-call pattern`);
  console.log(
    `  platform account: ${platformAccount.id} (switch X-Account-Id to this to act as the neutral platform reviewer — vendor:verify/supplier:verify/listing:verify only)`,
  );
  console.log(
    `  platform-admin account: ${platformAdminAccount.id} (switch X-Account-Id to this to act as platform_admin — GET /platform-admin/accounts)`,
  );
  console.log(
    `  tenant account:   ${tenantAccount.id} (switch X-Account-Id to this to act as the tenant — GET /tenant/lease once it's linked)`,
  );
  console.log(
    `  lease:            ${lease.id} on property ${property.id}, tenantEmail matches the demo login — POST /properties/${property.id}/leases/${lease.id}/link-tenant (as the owner account) links it to the tenant account above`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
