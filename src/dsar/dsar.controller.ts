import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MeetingsService } from '../meetings/meetings.service';
import { DsarEraseDto } from './dto';

interface AuthedRequest {
  user: { sub: string };
}

// Self-service DSAR (Data Subject Access Request). Owner-scoped: a caller can look up /
// erase identities only within their OWN meetings. Real org-wide DSAR needs cross-owner
// identity resolution (Okta/Workspace SCIM) - future. identity = email || name.
@Controller('dsar')
@UseGuards(JwtAuthGuard)
export class DsarController {
  constructor(private meetings: MeetingsService) {}

  // GET /dsar?identity=<x> -> everything we hold for that person across the caller's meetings.
  @Get()
  lookup(@Req() req: AuthedRequest, @Query('identity') identity: string) {
    if (!identity) throw new BadRequestException('identity is required');
    return this.meetings.dsarLookup(req.user.sub, identity);
  }

  // POST /dsar/erase {identity} -> crypto-shred each of the caller's meetings containing them.
  @Post('erase')
  erase(@Req() req: AuthedRequest, @Body() dto: DsarEraseDto) {
    return this.meetings.dsarErase(req.user.sub, dto.identity);
  }
}
