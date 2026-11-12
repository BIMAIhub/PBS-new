import { badRequest, field, integer } from './http';
import { externalUrl } from './video';

export function httpsLink(value: unknown, label: string, required = true) {
  const link = field(value, label, 2048, required);
  if (!link) return '';
  try {
    return externalUrl(link).href;
  } catch {
    throw badRequest(`Enter a valid HTTPS ${label}.`);
  }
}

export function paymentReference(value: unknown) {
  const reference = field(value, 'payment reference', 80).replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9._/-]{4,80}$/.test(reference)) throw badRequest('Enter a bank UTR or cash receipt reference of at least four characters.');
  return reference;
}

export function paymentClaim(body: Record<string, unknown>, balance: number) {
  const amount = integer(body?.amount ?? 0, 'payment amount', 0, balance);
  return { amount, reference: amount ? paymentReference(body?.reference) : '' };
}

export function phoneNumber(value: unknown) {
  const phone = field(value, 'phone number', 32, false);
  if (phone && !/^\+?[\d ()-]{7,32}$/.test(phone)) throw badRequest('Enter a valid phone number.');
  return phone;
}
