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
  key: string; // base64: raw AES-256 key (wrapped:false) OR KMS ciphertext blob (wrapped:true)

  // envelope encryption flag - see crypto.util.ts. Default false = raw key (today's behavior).
  @Prop({ default: false })
  wrapped?: boolean;
}

export const MeetingKeySchema = SchemaFactory.createForClass(MeetingKey);
