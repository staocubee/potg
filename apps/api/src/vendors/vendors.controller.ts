import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { VendorsService } from './vendors.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { RaiseDisputeAsVendorDto } from './dto/raise-dispute-as-vendor.dto';
import { ResolveDisputeDto } from '../payments/dto/resolve-dispute.dto';

type AccountMemberCtx = { accountId: string };

@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly payments: PaymentsService,
  ) {}

  @RequirePermissions('vendor:write')
  @Post()
  create(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateVendorDto) {
    return this.vendors.create(member.accountId, dto);
  }

  // Marketplace browse (Module 7): ?serviceCategory=plumbing
  @RequirePermissions('vendor:read')
  @Get()
  findAll(@Query('serviceCategory') serviceCategory?: string) {
    return this.vendors.findAll(serviceCategory);
  }

  @RequirePermissions('vendor:read')
  @Get('me')
  findMine(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.findForAccount(member.accountId);
  }

  @RequirePermissions('quote:read')
  @Get('me/quotes')
  myQuotes(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.myQuotes(member.accountId);
  }

  @RequirePermissions('payout:read')
  @Get('me/payouts')
  myPayouts(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.myPayouts(member.accountId);
  }

  // Vendor-initiated: submit or revise a quote on a project that isn't this
  // account's own — deliberately not /projects/:projectId/... so it never
  // hits PermissionsGuard's project-ownership ABAC check.
  @RequirePermissions('quote:write')
  @Post('me/quotes')
  submitQuote(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SubmitQuoteDto) {
    return this.vendors.submitQuote(member.accountId, dto);
  }

  // Vendor-side dispute access — same reasoning as submitQuote above:
  // these routes never key off :projectId, so PermissionsGuard's ABAC
  // never blocks a vendor acting on a project it doesn't own. Before this
  // pass a vendor had dispute:read/dispute:write in its role but no route
  // to use it on — the /projects/:projectId/disputes routes 404 for any
  // account that isn't the project's owner.
  @RequirePermissions('dispute:read')
  @Get('me/disputes')
  myDisputes(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.payments.findDisputesForVendor(member.accountId);
  }

  @RequirePermissions('dispute:write')
  @Post('me/disputes')
  raiseDispute(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: RaiseDisputeAsVendorDto) {
    return this.payments.raiseDisputeAsVendor(member.accountId, dto);
  }

  @RequirePermissions('dispute:write')
  @Post('me/disputes/:disputeId/resolve')
  resolveDispute(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('disputeId') disputeId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.payments.resolveDisputeAsVendor(member.accountId, disputeId, dto);
  }

  @RequirePermissions('vendor:read')
  @Get(':vendorId')
  findOne(@Param('vendorId') vendorId: string) {
    return this.vendors.findOne(vendorId);
  }
}
