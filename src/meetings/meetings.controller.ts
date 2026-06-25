import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConsentDto, CreateMeetingDto, DecisionDto, JoinDto } from './dto';
import { MeetingsService } from './meetings.service';

// The JwtAuthGuard attaches the decoded token as `req.user`.
interface AuthedRequest {
  user: { sub: string };
  headers: Record<string, string | undefined>;
}

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private meetings: MeetingsService) {}

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(req.user.sub, dto.title);
  }

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.meetings.list(req.user.sub);
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.meetings.get(req.user.sub, id);
  }

  @Get(':id/lines')
  async lines(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.meetings.get(req.user.sub, id); // ownership check
    return this.meetings.getLines(id);
  }

  @Post(':id/lines')
  addLine(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.meetings.addDecision(req.user.sub, id, dto);
  }

  // Crypto-shred: destroy the meeting's key so all stored text becomes unreadable.
  @Delete(':id/key')
  shred(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.meetings.shred(req.user.sub, id);
  }

  // Participants + their consent state (multi-party dashboard).
  @Get(':id/participants')
  async participants(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.meetings.get(req.user.sub, id); // ownership check
    return this.meetings.listParticipants(id);
  }

  // In-meeting consent opt-in/out (reported by the bot).
  @Post(':id/consent')
  consent(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: ConsentDto) {
    return this.meetings.setConsent(req.user.sub, id, dto.participant, dto.granted);
  }

  // Send a Recall bot into a live call (proxied through the Python engine).
  // We forward the caller's raw token so the engine can post decisions back here.
  @Post(':id/join')
  join(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: JoinDto) {
    const token = this.bearerToken(req);
    return this.meetings.join(req.user.sub, id, dto.meetingUrl, token, dto.separate ?? true);
  }

  // Remove the bot from the call.
  @Post(':id/stop')
  stop(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.meetings.stop(req.user.sub, id);
  }

  // Pull the raw bearer token off the request so we can forward it to the engine.
  private bearerToken(req: AuthedRequest): string {
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new BadRequestException('Missing or malformed Authorization header');
    }
    return header.slice(7);
  }
}
