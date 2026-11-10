import { IsIn } from 'class-validator';

/** How a buyer reached a listing's owner from its page. */
export const LEAD_CHANNELS = ['call', 'chat'] as const;

export type LeadChannel = (typeof LEAD_CHANNELS)[number];

/** `POST /properties/:id/lead`: the buyer tapped Call or Chat. */
export class LeadDto {
  @IsIn(LEAD_CHANNELS)
  channel: LeadChannel;
}
