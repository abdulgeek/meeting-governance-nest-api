import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ParticipantDocument = HydratedDocument<Participant>;

// One attendee of a meeting + their current consent state (multi-party governance).
// Consent is dynamic: it reflects the in-meeting opt-in (or the action taken on their
// speech). A participant who never opts in stays consent=false and is declined.
@Schema({ timestamps: true })
export class Participant {
  @Prop({ required: true, index: true })
  meeting: string;

  @Prop({ required: true })
  name: string; // participant identity / speaker id (display name)

  // Identity (lite): the participant's email when the Recall participant exposes one.
  // identity = email || name is what DSAR matches on. Full Okta/Workspace SCIM is future.
  @Prop()
  email?: string;

  @Prop({ default: false })
  consent: boolean;
}

export const ParticipantSchema = SchemaFactory.createForClass(Participant);
ParticipantSchema.index({ meeting: 1, name: 1 }, { unique: true });
