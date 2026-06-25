import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { GovernedLine, GovernedLineSchema } from './schemas/governed-line.schema';
import { MeetingKey, MeetingKeySchema } from './schemas/meeting-key.schema';
import { Meeting, MeetingSchema } from './schemas/meeting.schema';
import { Participant, ParticipantSchema } from './schemas/participant.schema';

@Module({
  imports: [
    AuthModule, // provides JwtAuthGuard + JwtModule for the guard
    MongooseModule.forFeature([
      { name: Meeting.name, schema: MeetingSchema },
      { name: GovernedLine.name, schema: GovernedLineSchema },
      { name: MeetingKey.name, schema: MeetingKeySchema },
      { name: Participant.name, schema: ParticipantSchema },
    ]),
  ],
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
