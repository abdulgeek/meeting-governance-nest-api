import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { Subject } from 'rxjs';
import { decrypt, encrypt, genKey } from '../crypto/crypto.util';
import { DecisionDto } from './dto';
import { GovernedLine, GovernedLineDocument } from './schemas/governed-line.schema';
import { MeetingKey, MeetingKeyDocument } from './schemas/meeting-key.schema';
import { Meeting, MeetingDocument } from './schemas/meeting.schema';
import { Participant, ParticipantDocument } from './schemas/participant.schema';

// Only these actions may have their text persisted at all. DROP/DECLINE never do.
// These are also the "kept" actions that feed the governed summary and DSAR exports.
const KEEP_TEXT = new Set(['COMMIT', 'REDACT', 'FLAG']);

// The shape getLines returns for one row (and the shape we publish over SSE).
export interface GovernedLineView {
  idx: number;
  speaker: string;
  action: string;
  policyId?: string | null;
  confidence?: number | null;
  text: string | null;
  shredded: boolean;
}

// All decision actions, in a fixed order - used for content-free audit counts/CSV.
const ACTIONS = ['COMMIT', 'REDACT', 'FLAG', 'DROP', 'DECLINE'] as const;
type ActionCounts = Record<(typeof ACTIONS)[number], number>;
const zeroCounts = (): ActionCounts =>
  ACTIONS.reduce((a, k) => ({ ...a, [k]: 0 }), {} as ActionCounts);

@Injectable()
export class MeetingsService {
  constructor(
    @InjectModel(Meeting.name) private meetings: Model<MeetingDocument>,
    @InjectModel(GovernedLine.name) private lines: Model<GovernedLineDocument>,
    @InjectModel(MeetingKey.name) private keys: Model<MeetingKeyDocument>,
    @InjectModel(Participant.name) private participants: Model<ParticipantDocument>,
    private config: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Real-time pub/sub: one in-memory Subject per meeting. addDecision publishes
  // each governed line here; the SSE stream subscribes to push it to the dashboard.
  // In-memory only (single instance) - fine for the demo; multi-instance would
  // need a shared bus (Redis pub/sub) instead.
  // -------------------------------------------------------------------------
  private streams = new Map<string, Subject<GovernedLineView>>();

  /** Get (or lazily create) the Subject that carries one meeting's live lines. */
  getStream(meetingId: string): Subject<GovernedLineView> {
    let s = this.streams.get(meetingId);
    if (!s) {
      s = new Subject<GovernedLineView>();
      this.streams.set(meetingId, s);
    }
    return s;
  }

  /** Publish one governed line to a meeting's subscribers (no-op if none yet). */
  publishLine(meetingId: string, line: GovernedLineView) {
    this.getStream(meetingId).next(line);
  }

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
    // UPSERT by {meeting, idx}: the engine first posts a PENDING placeholder, then the
    // FINAL decision with the SAME idx. Upserting (not always creating) lets the final
    // decision replace the placeholder in place - no duplicate rows.
    await this.lines.updateOne(
      { meeting: meetingId, idx: d.idx },
      {
        $set: {
          speaker: d.speaker,
          action: d.action,
          policyId: d.policyId,
          confidence: d.confidence,
          enc, // undefined for PENDING / non-keep actions -> no text persisted
          flagged: d.action === 'FLAG',
        },
      },
      { upsert: true },
    );
    const line = await this.lines.findOne({ meeting: meetingId, idx: d.idx });
    // track this participant. For PENDING (a pre-governance placeholder) just ensure the
    // participant exists and record name/email WITHOUT touching consent. For real actions
    // set consent (DECLINE => not consented).
    // Identity (lite): store email when the engine provides one.
    if (d.action === 'PENDING') {
      await this.participants.updateOne(
        { meeting: meetingId, name: d.speaker },
        { $set: { ...(d.email ? { email: d.email } : {}) } },
        { upsert: true },
      );
    } else {
      await this.participants.updateOne(
        { meeting: meetingId, name: d.speaker },
        {
          $set: {
            consent: d.action !== 'DECLINE',
            ...(d.email ? { email: d.email } : {}),
          },
        },
        { upsert: true },
      );
    }

    // Publish to live subscribers in the SAME shape getLines returns for one row:
    // text decrypted for kept actions, null for PENDING / DROP / DECLINE.
    if (line) {
      let text: string | null = null;
      let shredded = false;
      if (line.enc) {
        const k = await this.keys.findOne({ meeting: meetingId });
        if (k) text = decrypt(line.enc, k.key);
        else shredded = true; // key destroyed -> unrecoverable
      }
      this.publishLine(meetingId, {
        idx: line.idx,
        speaker: line.speaker,
        action: line.action,
        policyId: line.policyId,
        confidence: line.confidence,
        text,
        shredded,
      });
    }
    return line;
  }

  async getLines(meetingId: string) {
    const [lines, k] = await Promise.all([
      this.lines.find({ meeting: meetingId }).sort({ idx: 1 }),
      this.keys.findOne({ meeting: meetingId }),
    ]);
    const dataKey = k ? k.key : null; // null if the key was shredded
    return lines.map((l) => {
      let text: string | null = null;
      let shredded = false;
      if (l.enc) {
        if (dataKey) text = decrypt(l.enc, dataKey);
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
  async setConsent(
    owner: string,
    meetingId: string,
    name: string,
    granted: boolean,
    email?: string,
  ) {
    await this.get(owner, meetingId);
    await this.participants.updateOne(
      { meeting: meetingId, name },
      { $set: { consent: granted, ...(email ? { email } : {}) } }, // identity (lite)
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
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(`${engine}/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meeting_url: meetingUrl, meeting_id: meetingId, token, separate }),
        signal: ctrl.signal,
      });
    } catch {
      throw new BadGatewayException('Could not reach the meeting engine');
    } finally {
      clearTimeout(timeout);
    }
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
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 5000);
      try {
        await fetch(`${engine}/bots/${m.recallBotId}`, { method: 'DELETE', signal: ctrl.signal });
      } catch {
        throw new BadGatewayException('Could not reach the meeting engine');
      } finally {
        clearTimeout(timeout);
      }
    }
    await this.meetings.updateOne({ _id: meetingId }, { $set: { botStatus: 'stopped' } });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // (1) Governed summary - ONLY kept lines feed it (keep-only guarantee).
  // -------------------------------------------------------------------------

  /**
   * Build a summary from this meeting's KEPT lines (COMMIT/REDACT/FLAG, decrypted, in
   * idx order) and store it ENCRYPTED under the meeting key. DROP/DECLINE never reach
   * the engine - the prompt only ever sees content we were allowed to keep. Returns the
   * plaintext summary to the caller (it's persisted encrypted; crypto-shred wipes it too).
   */
  async generateSummary(owner: string, meetingId: string, style?: string) {
    await this.get(owner, meetingId);
    const k = await this.keys.findOne({ meeting: meetingId });
    if (!k) return { summary: '' }; // shredded -> nothing to summarize
    const dataKey = k.key;

    const lines = await this.lines.find({ meeting: meetingId }).sort({ idx: 1 });
    const kept = lines
      .filter((l) => KEEP_TEXT.has(l.action) && l.enc)
      .map((l) => ({ speaker: l.speaker, text: decrypt(l.enc!, dataKey) }));
    if (kept.length === 0) return { summary: '' };

    const engine = this.config.get<string>('PYTHON_ENGINE_URL') ?? 'http://localhost:8000';
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(`${engine}/summarize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines: kept, style }),
        signal: ctrl.signal,
      });
    } catch {
      throw new BadGatewayException('Could not reach the meeting engine');
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new BadGatewayException(await res.text());
    const { summary } = (await res.json()) as { summary: string };

    // persist encrypted under the same meeting key (shred wipes it with everything else)
    const summaryAt = new Date();
    await this.meetings.updateOne(
      { _id: meetingId },
      { $set: { summaryEnc: encrypt(summary, dataKey), summaryAt } },
    );
    return { summary };
  }

  /** Read back the stored summary; decrypt it. If the key is gone -> shredded. */
  async getSummary(owner: string, meetingId: string) {
    const m = await this.get(owner, meetingId);
    if (!m.summaryEnc) return { summary: null, shredded: false, generatedAt: null };
    const k = await this.keys.findOne({ meeting: meetingId });
    if (!k) return { summary: null, shredded: true, generatedAt: m.summaryAt ?? null };
    const dataKey = k.key;
    return {
      summary: decrypt(m.summaryEnc, dataKey),
      shredded: false,
      generatedAt: m.summaryAt ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // (2) Audit / consent receipts / export - CONTENT-FREE (counts only, never words).
  // -------------------------------------------------------------------------

  /**
   * Content-free audit: per-participant action counts, consent + opt-in timestamp, grand
   * totals, and an integrity hash over the canonical decision log. No text anywhere.
   */
  async getAudit(owner: string, meetingId: string) {
    const m = await this.get(owner, meetingId);
    const [lines, participants] = await Promise.all([
      this.lines.find({ meeting: meetingId }).sort({ idx: 1 }),
      this.participants.find({ meeting: meetingId }).sort({ name: 1 }),
    ]);

    // per-speaker counts
    const bySpeaker = new Map<string, ActionCounts>();
    const totals = zeroCounts();
    for (const l of lines) {
      const c = bySpeaker.get(l.speaker) ?? zeroCounts();
      if ((ACTIONS as readonly string[]).includes(l.action)) {
        c[l.action as keyof ActionCounts] += 1;
        totals[l.action as keyof ActionCounts] += 1;
      }
      bySpeaker.set(l.speaker, c);
    }

    const participantRows = participants.map((p) => {
      const counts = bySpeaker.get(p.name) ?? zeroCounts();
      return {
        name: p.name,
        email: p.email,
        consent: p.consent,
        optedInAt: (p as unknown as { updatedAt?: Date }).updatedAt ?? null,
        counts,
        total: ACTIONS.reduce((s, a) => s + counts[a], 0),
      };
    });

    // integrity hash over canonical decision log: lines sorted by idx, each
    // "idx|speaker|action|policyId|confidence" joined by "\n". No text - tamper-evidence only.
    const canonical = lines
      .map(
        (l) =>
          `${l.idx}|${l.speaker}|${l.action}|${l.policyId ?? ''}|${
            l.confidence ?? ''
          }`,
      )
      .join('\n');
    const hash = createHash('sha256').update(canonical).digest('hex');

    return {
      meeting: { id: String(m._id), title: m.title },
      participants: participantRows,
      totals,
      integrity: { algo: 'sha256' as const, hash },
    };
  }

  /** CSV view of the audit: one row per participant, content-free. */
  async getAuditCsv(owner: string, meetingId: string): Promise<string> {
    const audit = await this.getAudit(owner, meetingId);
    const header = ['name', 'email', 'consent', ...ACTIONS, 'total'].join(',');
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = audit.participants.map((p) =>
      [
        esc(p.name),
        esc(p.email ?? ''),
        p.consent,
        ...ACTIONS.map((a) => p.counts[a]),
        p.total,
      ].join(','),
    );
    return [header, ...rows].join('\n') + '\n';
  }

  // -------------------------------------------------------------------------
  // (5) Self-service DSAR - owner-scoped. identity = email || name.
  // -------------------------------------------------------------------------

  /**
   * Look up everything we hold for an identity across the CALLER'S meetings. Matches a
   * Participant by name OR email; returns the person's KEPT decrypted lines per meeting.
   * Owner-scoped (per-user meetings) - org-wide DSAR needs identity resolution (future).
   */
  async dsarLookup(owner: string, identity: string) {
    const myMeetings = await this.meetings.find({ owner });
    const meetingsOut: Array<{
      meetingId: string;
      title: string;
      consent: boolean;
      lines: Array<{ idx: number; action: string; text: string | null }>;
    }> = [];
    let lineCount = 0;

    for (const m of myMeetings) {
      const meetingId = String(m._id);
      const participant = await this.participants.findOne({
        meeting: meetingId,
        $or: [{ name: identity }, { email: identity }],
      });
      if (!participant) continue;

      const [lines, k] = await Promise.all([
        this.lines.find({ meeting: meetingId, speaker: participant.name }).sort({ idx: 1 }),
        this.keys.findOne({ meeting: meetingId }),
      ]);
      const dataKey = k ? k.key : null;
      const kept = lines
        .filter((l) => KEEP_TEXT.has(l.action) && l.enc)
        .map((l) => ({
          idx: l.idx,
          action: l.action,
          text: dataKey ? decrypt(l.enc!, dataKey) : null, // null when shredded
        }));
      lineCount += kept.length;
      meetingsOut.push({
        meetingId,
        title: m.title,
        consent: participant.consent,
        lines: kept,
      });
    }

    return {
      identity,
      meetings: meetingsOut,
      counts: { meetings: meetingsOut.length, lines: lineCount },
    };
  }

  /**
   * Erase by crypto-shredding every CALLER'S meeting that contains this identity.
   * HONEST MVP BOUNDARY: erasure is per-MEETING - we shred the WHOLE meeting's key, not
   * just this person's lines. True per-line/per-person erasure needs per-participant keys
   * (future). Irreversible.
   */
  async dsarErase(owner: string, identity: string) {
    const myMeetings = await this.meetings.find({ owner });
    const erased: string[] = [];
    for (const m of myMeetings) {
      const meetingId = String(m._id);
      const hit = await this.participants.findOne({
        meeting: meetingId,
        $or: [{ name: identity }, { email: identity }],
      });
      if (!hit) continue;
      await this.keys.deleteOne({ meeting: meetingId }); // crypto-shred
      erased.push(meetingId);
    }
    return {
      erased,
      note: 'per-meeting erasure: whole meetings containing this person were crypto-shredded',
    };
  }
}
