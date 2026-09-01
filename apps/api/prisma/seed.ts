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
  { key: 'document:read', label: 'View documents' },
  { key: 'document:write', label: 'Upload documents' },
  { key: 'account:manage_members', label: 'Manage account members' },
  { key: 'ai:act', label: 'Use the AI copilot' },
  // Modules 7 & 9 — Vendor Marketplace & Project Tracking (Priority 3).
  { key: 'vendor:read', label: 'Browse vendor profiles' },
  { key: 'vendor:write', label: 'Create or edit a vendor profile' },
  { key: 'project:read', label: 'View projects' },
  { key: 'project:write', label: 'Create or edit projects' },
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
  // Modules 5 & 10 — Property Marketplace & Materials Marketplace (Priority 5).
  { key: 'listing:read', label: 'Browse and search property listings' },
  { key: 'listing:write', label: 'Create, publish, and manage a property listing' },
  { key: 'offer:read', label: 'View offers on a listing' },
  { key: 'offer:write', label: 'Submit or respond to an offer' },
  { key: 'supplier:read', label: 'Browse supplier profiles' },
  { key: 'supplier:write', label: 'Create or edit a supplier profile' },
  { key: 'product:read', label: 'Browse the materials/tools/equipment catalog' },
  { key: 'product:write', label: "Manage a supplier's own product catalog" },
  { key: 'order:read', label: 'View orders' },
  { key: 'order:write', label: 'Place an order, or update its status/delivery as the supplier' },
  // Reviews — leaving one, on a completed project (vendor) or a delivered
  // order (supplier). Reading a review needs no permission of its own: it
  // rides along with vendor:read/supplier:read since findOne/findSupplier
  // already include it.
  { key: 'review:write', label: 'Leave a review after a completed project or delivered order' },
];

// Section 8's core roles, narrowed to the ones DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE
// (accounts.service.ts) and the demo data below need.
const ROLES: Record<string, string[]> = {
  property_owner: [
    'property:read',
    'property:write',
    'document:read',
    'document:write',
    'account:manage_members',
    'ai:act',
    'vendor:read',
    'project:read',
    'project:write',
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
    'review:write',
  ],
  family_admin: [
    'property:read',
    'property:write',
    'document:read',
    'document:write',
    'account:manage_members',
    'ai:act',
    'vendor:read',
    'project:read',
    'project:write',
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
    'review:write',
  ],
  company_admin: [
    'property:read',
    'property:write',
    'document:read',
    'document:write',
    'account:manage_members',
    'ai:act',
    'vendor:read',
    'project:read',
    'project:write',
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
    'review:write',
  ],
  // A vendor account browses/edits its own marketplace profile, sees the
  // projects it's been invited to or hired for, quotes on them, and can
  // see what it's been paid — it never gets project:write, milestone:write,
  // or payment:approve, those stay the property owner's own actions (a
  // vendor releasing its own escrow funds would defeat the point of escrow).
  vendor: [
    'document:read',
    'ai:act',
    'vendor:read',
    'vendor:write',
    'project:read',
    'quote:read',
    'quote:write',
    'payout:read',
    'dispute:read',
    'dispute:write',
    // Browsing materials while assessing or pricing a job — never
    // supplier:write/product:write, a vendor isn't a supplier.
    'supplier:read',
    'product:read',
  ],
  // A supplier account manages its own marketplace profile and product
  // catalog, and fulfills the orders placed against it — it never gets
  // listing/offer/vendor/project permissions, those belong to the other
  // two marketplaces.
  supplier: ['ai:act', 'supplier:read', 'supplier:write', 'product:read', 'product:write', 'order:read', 'order:write'],
  // Section 8's own example role: "a family member can view documents but
  // not approve payments" — a read-only member of a family/company account.
  // Notably excludes payment:approve and dispute:write for the same reason.
  viewer: [
    'property:read',
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
  ],
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
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
