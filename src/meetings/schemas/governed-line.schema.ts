import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GovernedLineDocument = HydratedDocument<GovernedLine>;

/**
 * One persisted governance decision. Text only exists for COMMIT / REDACT / FLAG, and
 * even then it's stored ENCRYPTED in `enc` (per-meeting key). For DROP / DECLINE there's
 * no text at all. So: the DB never holds suppressed content (ephemerality boundary), and
 * kept content is unreadable once the meeting's key is shredded (Phase 4).
 */
@Schema({ timestamps: true })
export class GovernedLine {
  @Prop({ required: true, index: true })
  meeting: string;

  @Prop({ required: true })
  idx: number;

  @Prop({ required: true })
  speaker: string;

  @Prop({ required: true })
  action: string; // COMMIT | REDACT | FLAG | DROP | DECLINE

  @Prop()
  policyId?: string;

  @Prop()
  confidence?: number;

  @Prop({ type: Object })
  enc?: { ct: string; iv: string; tag: string }; // encrypted text; present only for keep-actions

  @Prop()
  flagged?: boolean;
}

export const GovernedLineSchema = SchemaFactory.createForClass(GovernedLine);
