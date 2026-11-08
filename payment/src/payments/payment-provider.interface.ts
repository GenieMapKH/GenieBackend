/** How the user pays, as the app names it. The adapter maps it to its own option. */
export const PAYMENT_METHODS = ['aba_pay', 'aba_khqr'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What a checkout is for, sent to the provider. */
export interface CheckoutRequest {
  /** Our PaymentTransaction id; the provider's `tran_id` must be derived from it. */
  transactionId: string;
  /** US dollars, tax included. */
  amount: number;
  currency: string;
  method: PaymentMethod;
}

/** Where the user goes to pay a checkout the provider has accepted. */
export interface ProviderCheckout {
  /** The provider's hosted payment page (works without the banking app). */
  checkoutUrl?: string;
  /** Opens the banking app straight on the payment, when the provider gives one. */
  abapayDeeplink?: string;
  /** The raw KHQR payload, for drawing the QR in the app. */
  qrString?: string;
}

/** A transaction as the provider reports it when asked directly. */
export type ProviderTransactionState = 'PAID' | 'PENDING' | 'FAILED';

export interface ProviderTransaction {
  state: ProviderTransactionState;
  transactionId: string;
  amount: number;
  currency: string;
}

/** The webhook fields every provider adapter must be able to authenticate. */
export interface ProviderWebhook {
  transactionId: string;
  status: string;
}

/**
 * What the payment module needs from an external payment provider (ABA
 * PayWay, ...). See docs/ABA_PAYWAY_INTEGRATION.md for the PayWay mapping.
 */
export abstract class PaymentProvider {
  abstract readonly name: string;
  /** Starts a payment and says where the user should go to pay it. */
  abstract initiateCheckout(
    request: CheckoutRequest,
  ): Promise<ProviderCheckout>;

  /**
   * Asks the provider itself how a transaction stands. A webhook only says a
   * payment *may* be done: it is settled after this answers PAID.
   */
  abstract checkTransaction(
    request: CheckoutRequest,
  ): Promise<ProviderTransaction>;

  /** True only when the webhook really came from the provider. Must fail closed. */
  abstract verifyWebhook(webhook: ProviderWebhook, signature: string): boolean;
}
