/** A call is ringing until the callee answers, then active until either hangs up. */
export type CallStatus = 'ringing' | 'active';

/** Why a call ended. `missed` and `cancelled` mean the callee never answered. */
export type CallEndReason =
  'ended' | 'declined' | 'missed' | 'cancelled' | 'disconnected';

/**
 * A call in progress, shared by every instance of the chat service. Each
 * party is bound to the one connection (socket) taking part, so call
 * signals go to that device only.
 */
export interface LiveCall {
  id: string;
  callerId: string;
  calleeId: string;
  callerName: string;
  callerSocketId: string;
  /** The device that answered; null while ringing. */
  calleeSocketId: string | null;
  status: CallStatus;
  createdAt: string;
  answeredAt: string | null;
}
