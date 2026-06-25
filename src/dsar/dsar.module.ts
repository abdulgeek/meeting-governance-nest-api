import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { DsarController } from './dsar.controller';

@Module({
  imports: [
    AuthModule, // JwtAuthGuard
    MeetingsModule, // MeetingsService (exported) does the owner-scoped lookup/erase
  ],
  controllers: [DsarController],
})
export class DsarModule {}
