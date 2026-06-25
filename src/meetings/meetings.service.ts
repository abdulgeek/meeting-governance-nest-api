import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { decrypt, encrypt, genKey } from '../crypto/crypto.util';
import { DecisionDto } from './dto';
import { GovernedLine, GovernedLineDocument } from './schemas/governed-line.schema';
import { MeetingKey, MeetingKeyDocument } from './schemas/meeting-key.schema';
import { Meeting, MeetingDocument } from './schemas/meeting.schema';

// Only these actions may have their text persisted at all. DROP/DECLINE never do.
const KEEP_TEXT = new Set(['COMMIT', 'REDACT', 'FLAG']);

@Injectable()
export class MeetingsService {
  constructor(
    @InjectModel(Meeting.name) private meetings: Model<MeetingDocument>,
    @InjectModel(GovernedLine.name) private lines: Model<GovernedLineDocument>,
    @InjectModel(MeetingKey.name) private keys: Model<MeetingKeyDocument>,
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
    return this.lines.create({
      meeting: meetingId,
      idx: d.idx,
      speaker: d.speaker,
      action: d.action,
      policyId: d.policyId,
      confidence: d.confidence,
      enc,
      flagged: d.action === 'FLAG',
    });
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
}
