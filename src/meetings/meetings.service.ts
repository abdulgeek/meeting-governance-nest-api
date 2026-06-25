import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { decrypt, encrypt, genKey } from '../crypto/crypto.util';
import { DecisionDto } from './dto';
import { GovernedLine, GovernedLineDocument } from './schemas/governed-line.schema';
import { MeetingKey, MeetingKeyDocument } from './schemas/meeting-key.schema';
import { Meeting, MeetingDocument } from './schemas/meeting.schema';
import { Participant, ParticipantDocument } from './schemas/participant.schema';

// Only these actions may have their text persisted at all. DROP/DECLINE never do.
const KEEP_TEXT = new Set(['COMMIT', 'REDACT', 'FLAG']);

@Injectable()
export class MeetingsService {
  constructor(
    @InjectModel(Meeting.name) private meetings: Model<MeetingDocument>,
    @InjectModel(GovernedLine.name) private lines: Model<GovernedLineDocument>,
    @InjectModel(MeetingKey.name) private keys: Model<MeetingKeyDocument>,
    @InjectModel(Participant.name) private participants: Model<ParticipantDocument>,
    private config: ConfigService,
  ) {}

  async create(owner: string, title: string) {
    const meeting = await this.meetings.create({ owner, title });
    // give the meeting its own data key up front (used to encrypt every kept line)
    await this.keys.create({ meeting: String(meeting._id), key: genKey() });
    return meeting;
  }

  list(owner: string) {
    return this.meetings.find({ owner }).sort({ createdAt: -1 });
  }

  async get(owner: string, id: string) {
    const m = await this.meetings.findById(id);
    if (!m) throw new NotFoundException();
    if (m.owner !== owner) throw new ForbiddenException();
    return m;
  }

  /**
   * Persist one decision. Two layers of protection:
   *  - ephemerality boundary: only keep-actions carry text; DROP/DECLINE store nothing.
   *  - crypto-shredding: kept text is encrypted with the meeting's key before it's stored.
   */
  async addDecision(owner: string, meetingId: string, d: DecisionDto) {
    await this.get(owner, meetingId);
    let enc;
    if (KEEP_TEXT.has(d.action) && d.shown) {
      const k = await this.keys.findOne({ meeting: meetingId });
      if (k) enc = encrypt(d.shown, k.key);
    }
    const line = await this.lines.create({
      meeting: meetingId,
      idx: d.idx,
      speaker: d.speaker,
      action: d.action,
      policyId: d.policyId,
      confidence: d.confidence,
      enc,
      flagged: d.action === 'FLAG',
    });
    // track this participant + their consent (DECLINE => not consented)
    await this.participants.updateOne(
      { meeting: meetingId, name: d.speaker },
      { $set: { consent: d.action !== 'DECLINE' } },
      { upsert: true },
    );
    return line;
  }

  async getLines(meetingId: string) {
    const [lines, k] = await Promise.all([
      this.lines.find({ meeting: meetingId }).sort({ idx: 1 }),
      this.keys.findOne({ meeting: meetingId }),
    ]);
    return lines.map((l) => {
      let text: string | null = null;
      let shredded = false;
      if (l.enc) {
        if (k) text = decrypt(l.enc, k.key);
        else shredded = true; // key destroyed -> unrecoverable
      }
      return {
        idx: l.idx, speaker: l.speaker, action: l.action,
        policyId: l.policyId, confidence: l.confidence, text, shredded,
      };
    });
  }

  /** Crypto-shred: destroy the meeting's key. All kept text becomes permanently unreadable. */
  async shred(owner: string, meetingId: string) {
    await this.get(owner, meetingId);
    await this.keys.deleteOne({ meeting: meetingId });
    return { meeting: meetingId, shredded: true };
  }

  /** In-meeting consent opt-in/out for a participant (the bot reports these live). */
  async setConsent(owner: string, meetingId: string, name: string, granted: boolean) {
    await this.get(owner, meetingId);
    await this.participants.updateOne(
      { meeting: meetingId, name },
      { $set: { consent: granted } },
      { upsert: true },
    );
    return { meeting: meetingId, name, consent: granted };
  }

  listParticipants(meetingId: string) {
    return this.participants.find({ meeting: meetingId }).sort({ name: 1 });
  }

  /**
   * Send a Recall bot into a live call. We don't talk to Recall directly: the Python
   * engine owns that (and the audio websocket). We proxy through it and pass the
   * caller's JWT so the engine can post decisions back to us for this meeting.
   */
  async join(owner: string, meetingId: string, meetingUrl: string, token: string, separate = true) {
    await this.get(owner, meetingId);
    const engine = this.config.get<string>('PYTHON_ENGINE_URL') ?? 'http://localhost:8000';
    const res = await fetch(`${engine}/bots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meeting_url: meetingUrl, meeting_id: meetingId, token, separate }),
    });
    if (!res.ok) throw new BadGatewayException(await res.text());
    const { bot_id, status } = await res.json();
    await this.meetings.updateOne(
      { _id: meetingId },
      { $set: { recallBotId: bot_id, botStatus: 'joining', meetingUrl } },
    );
    return { botId: bot_id, status };
  }

  /** Pull the bot out of the call (also via the Python engine). */
  async stop(owner: string, meetingId: string) {
    const m = await this.get(owner, meetingId);
    const engine = this.config.get<string>('PYTHON_ENGINE_URL') ?? 'http://localhost:8000';
    if (m.recallBotId) {
      await fetch(`${engine}/bots/${m.recallBotId}`, { method: 'DELETE' });
    }
    await this.meetings.updateOne({ _id: meetingId }, { $set: { botStatus: 'stopped' } });
    return { ok: true };
  }
}
