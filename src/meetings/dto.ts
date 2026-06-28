import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  @MinLength(1)
  title: string;
}

export class DecisionDto {
  @IsNumber()
  idx: number;

  @IsString()
  speaker: string;

  @IsIn(['COMMIT', 'DROP', 'REDACT', 'FLAG', 'DECLINE', 'PENDING'])
  action: string;

  @IsOptional()
  @IsString()
  policyId?: string;

  @IsOptional()
  @IsNumber()
  confidence?: number;

  @IsOptional()
  @IsString()
  shown?: string; // the engine's display text; only stored for keep-actions

  // Identity (lite): email when the Recall participant has one. Optional so existing
  // payloads (and the /ws browser path, which has no email) keep working unchanged.
  @IsOptional()
  @IsString()
  email?: string;
}

export class ConsentDto {
  @IsString()
  participant: string;

  @IsBoolean()
  granted: boolean;

  // Identity (lite): email when known. Optional - existing payloads unaffected.
  @IsOptional()
  @IsString()
  email?: string;
}

// Governed summary style hint (optional, free-form). Engine summarizes only what it's given.
export class SummaryDto {
  @IsOptional()
  @IsString()
  style?: string;
}

export class JoinDto {
  @IsString()
  @MinLength(1)
  meetingUrl: string;

  // per-speaker: record each participant on their own stream + consent. Default on.
  @IsOptional()
  @IsBoolean()
  separate?: boolean;
}
