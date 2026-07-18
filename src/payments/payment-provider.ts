export interface initializeDepositInput {
  amount: number;
  currency: string;
  email: string;
  reference: string;
  callbackUrl: string;
}

export interface initializedDeposit {
  reference: string;
  checkoutUrl: string;
  accessCode: string;
}

export interface withdrawalRecipientInput {
  accountName: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
}

export interface initiateWithdrawalInput {
  amount: number;
  currency: string;
  recipientCode: string;
  reference: string;
  reason?: string;
}

export interface initiatedWithdrawal {
  reference: string;
  transferCode?: string;
  status: string;
}

export type providerWebhookType =
  'depositSucceeded' | 'withdrawalSucceeded' | 'withdrawalFailed' | 'ignored';

export interface providerWebhookEvent {
  eventId: string;
  type: providerWebhookType;
  providerEventType: string;
  reference?: string;
  amount?: number;
  currency?: string;
}

export interface paymentProvider {
  readonly name: string;
  initializeDeposit(input: initializeDepositInput): Promise<initializedDeposit>;
  createWithdrawalRecipient(input: withdrawalRecipientInput): Promise<string>;
  initiateWithdrawal(input: initiateWithdrawalInput): Promise<initiatedWithdrawal>;
  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): providerWebhookEvent;
}
