import {
  Controller,
  MessageEvent,
  Param,
  Query,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable, from, interval, map, merge } from 'rxjs';
import { MeetingsService } from './meetings.service';

/**
 * Server-Sent Events stream of governed lines for ONE meeting.
 *
 * This controller deliberately has NO class-level JwtAuthGuard: EventSource (the
 * browser SSE client) cannot set an Authorization header, so auth is done via a
 * ?token=<jwt> query param instead. We verify the token with JwtService, then
 * confirm the caller owns the meeting via MeetingsService.get(sub, id).
 *
 * The dashboard backfills history with GET /meetings/:id/lines, then keeps this
 * stream open for new lines in real time (no polling).
 */
@Controller('meetings')
export class StreamController {
  constructor(
    private meetings: MeetingsService,
    private jwt: JwtService,
  ) {}

  @Sse(':id/stream')
  async stream(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    if (!token) throw new UnauthorizedException();
    let sub: string;
    try {
      ({ sub } = await this.jwt.verifyAsync<{ sub: string }>(token));
    } catch {
      throw new UnauthorizedException();
    }
    // Ownership check (throws NotFound/Forbidden -> closes the connection).
    await this.meetings.get(sub, id);

    // Each published governed line becomes a `data: <json>` event.
    const lines = this.meetings
      .getStream(id)
      .pipe(map((line): MessageEvent => ({ data: line })));

    // Heartbeat every 25s so the ALB (60s idle timeout) keeps the connection
    // open during quiet stretches. NestJS serializes a `type`-only event as a
    // bare event line, which clients ignore - effectively a keep-alive ping.
    const heartbeat = interval(25_000).pipe(
      map((): MessageEvent => ({ type: 'ping', data: '' })),
    );

    // Emit one ping immediately so proxies see traffic right away.
    const initial = from([{ type: 'ping', data: '' } as MessageEvent]);

    return merge(initial, lines, heartbeat);
  }
}
