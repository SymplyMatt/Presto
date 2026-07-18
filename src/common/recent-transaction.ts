export const recentTransactionWindowMs = 2 * 60 * 1000;

export const recentTransactionCutoff = (): Date => new Date(Date.now() - recentTransactionWindowMs);

export const recentTransactionMessage =
  'a similar transaction was attempted within the last two minutes';
