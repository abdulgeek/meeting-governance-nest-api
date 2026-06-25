import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { MeetingsModule } from './meetings/meetings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        uri: c.get<string>('MONGO_URI') ?? 'mongodb://127.0.0.1:27017/governance',
      }),
    }),
    AuthModule,
    MeetingsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
