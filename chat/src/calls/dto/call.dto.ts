import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** A session description is a few kilobytes; this leaves room without accepting junk. */
const MAX_SDP_LENGTH = 20_000;
const MAX_CANDIDATE_LENGTH = 2_000;

/** `call:invite`: ring `calleeId`. The id is chosen by the caller's app. */
export class CallInviteDto {
  @IsUUID()
  callId: string;

  @IsUUID()
  calleeId: string;
}

/** `call:accept`, `call:decline`, `call:hangup`. */
export class CallRefDto {
  @IsUUID()
  callId: string;
}

/**
 * `call:signal`: what the two phones tell each other to connect (WebRTC
 * offer, answer and network candidates). Passed on as it is.
 */
export class CallSignalDto {
  @IsUUID()
  callId: string;

  @IsIn(['offer', 'answer', 'candidate'])
  type: 'offer' | 'answer' | 'candidate';

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SDP_LENGTH)
  sdp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CANDIDATE_LENGTH)
  candidate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sdpMid?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sdpMLineIndex?: number;
}

/** `GET /chat/calls/history`: the calls with one person. */
export class CallHistoryQuery {
  /** The other person. */
  @IsUUID()
  with: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
