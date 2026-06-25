import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MeetingKeyDocument = HydratedDocument<MeetingKey>;

// The per-meeting data key. Deleting this document = crypto-shredding the whole meeting:
// every GovernedLine encrypted under it becomes permanently unreadable.
@Schema({ timestamps: true })
export class MeetingKey {
  @Prop({ required: true, unique: true, index: true })
  meeting: string;

  @Prop({ required: true })
  key: string; // base64 AES-256 key
}

export const MeetingKeySchema = SchemaFactory.createForClass(MeetingKey);
