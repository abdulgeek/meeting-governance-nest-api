import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DecisionDto } from './dto';
import { GovernedLine, GovernedLineDocument } from './schemas/governed-line.schema';
import { Meeting, MeetingDocument } from './schemas/meeting.schema';

// Only these actions may have their TEXT persisted. DROP/DECLINE never do.
const KEEP_TEXT = new Set(['COMMIT', 'REDACT', 'FLAG']);

@Injectable()
export class MeetingsService {
  constructor(
    @InjectModel(Meeting.name) private meetings: Model<MeetingDocument>,
    @InjectModel(GovernedLine.name) private lines: Model<GovernedLineDocument>,
  ) {}

  create(owner: string, title: string) {
    return this.meetings.create({ owner, title });
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
   * Persist one decision. The ephemerality boundary lives here: text is stored only
   * for keep-actions; DROP/DECLINE land as content-free records (action + metadata).
   */
  async addDecision(owner: string, meetingId: string, d: DecisionDto) {
    await this.get(owner, meetingId); // ownership check
    return this.lines.create({
      meeting: meetingId,
      idx: d.idx,
      speaker: d.speaker,
      action: d.action,
      policyId: d.policyId,
      confidence: d.confidence,
      text: KEEP_TEXT.has(d.action) ? d.shown : undefined,
      flagged: d.action === 'FLAG',
    });
  }

  getLines(meetingId: string) {
    return this.lines.find({ meeting: meetingId }).sort({ idx: 1 });
  }
}
