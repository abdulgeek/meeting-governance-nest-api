import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GovernedLineDocument = HydratedDocument<GovernedLine>;

/**
 * One persisted governance decision. The `text` field is only ever populated for
 * COMMIT / REDACT / FLAG. For DROP / DECLINE it stays undefined, so the database
 * never holds suppressed content - the ephemerality promise, enforced at the DB edge.
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

  @Prop()
  text?: string; // present ONLY for COMMIT/REDACT/FLAG

  @Prop()
  flagged?: boolean;
}

export const GovernedLineSchema = SchemaFactory.createForClass(GovernedLine);
