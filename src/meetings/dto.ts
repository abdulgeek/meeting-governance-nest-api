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

  @IsIn(['COMMIT', 'DROP', 'REDACT', 'FLAG', 'DECLINE'])
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
}

export class ConsentDto {
  @IsString()
  participant: string;

  @IsBoolean()
  granted: boolean;
}

export class JoinDto {
  @IsString()
  @MinLength(1)
  meetingUrl: string;
}
