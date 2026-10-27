import { env } from '../env';

export async function sendSms(to: string, message: string): Promise<void> {
  if (env.SMS_PROVIDER === 'console') {
    console.log(`[sms] to=${to} message="${message}"`);
    return;
  }

  // Africa's Talking bulk SMS API: https://developers.africastalking.com/docs/sms/sending
  const host = env.AT_USERNAME === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
  const body = new URLSearchParams({ username: env.AT_USERNAME!, to, message });
  if (env.AT_SENDER_ID) body.set('from', env.AT_SENDER_ID);

  const res = await fetch(`https://${host}/version1/messaging`, {
    method: 'POST',
    headers: {
      apiKey: env.AT_API_KEY!,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`SMS provider returned ${res.status}`);
  }
}
