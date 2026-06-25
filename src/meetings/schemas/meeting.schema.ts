import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MeetingDocument = HydratedDocument<Meeting>;

@Schema({ timestamps: true })
export class Meeting {
  @Prop({ required: true, index: true })
  owner: string; // user id

  @Prop({ required: true })
  title: string;

  @Prop({ default: 'created' })
  status: string; // created | live | ended

  @Prop()
  meetingUrl?: string; // the Zoom/Meet/Teams URL the bot was sent to

  @Prop()
  recallBotId?: string; // id of the Recall bot launched for this meeting

  @Prop({ default: 'idle' })
  botStatus?: string; // idle | joining | stopped (and whatever Recall reports)
}

export const MeetingSchema = SchemaFactory.createForClass(Meeting);
