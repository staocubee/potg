import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { VendorsService } from './vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { SubmitQuoteDto } from './dto/submit-quote.dto';

type AccountMemberCtx = { accountId: string };

@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

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

  @RequirePermissions('vendor:read')
  @Get(':vendorId')
  findOne(@Param('vendorId') vendorId: string) {
    return this.vendors.findOne(vendorId);
  }
}
