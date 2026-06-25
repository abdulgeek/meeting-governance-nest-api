import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMeetingDto, DecisionDto } from './dto';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private meetings: MeetingsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(req.user.sub, dto.title);
  }

  @Get()
  list(@Req() req: any) {
    return this.meetings.list(req.user.sub);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.meetings.get(req.user.sub, id);
  }

  @Get(':id/lines')
  async lines(@Req() req: any, @Param('id') id: string) {
    await this.meetings.get(req.user.sub, id); // ownership check
    return this.meetings.getLines(id);
  }

  @Post(':id/lines')
  addLine(@Req() req: any, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.meetings.addDecision(req.user.sub, id, dto);
  }
}
