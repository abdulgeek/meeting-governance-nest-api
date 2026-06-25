import { IsString, MinLength } from 'class-validator';

// Self-service DSAR. `identity` matches a participant by email OR display name across
// the CALLER'S meetings (owner-scoped: our model is per-user meetings). Real org-wide
// DSAR would need cross-owner identity resolution (Okta/Workspace) - future.
export class DsarEraseDto {
  @IsString()
  @MinLength(1)
  identity: string;
}
