/** Output guardrails: never claim orders placed/payment taken, never ask for OTP/card. */
const FORBIDDEN = [
  { re: /\b(order (is )?placed|order confirmed|payment (is )?(successful|received|done)|paid successfully)\b/i, reason: 'claims-order-or-payment' },
  { re: /\b(cvv|card number|otp|upi pin|expiry date)\b/i, reason: 'asks-sensitive' },
];

export interface PolicyResult { ok: boolean; reason?: string }

export function checkOutput(text: string): PolicyResult {
  for (const f of FORBIDDEN) if (f.re.test(text)) return { ok: false, reason: f.reason };
  return { ok: true };
}

const SAFE: Record<string, Record<string, string>> = {
  'claims-order-or-payment': {
    en: "I've set up your order for review — you'll complete payment securely on the link, and it's confirmed once that's done.",
    hi: 'मैंने आपका ऑर्डर समीक्षा के लिए तैयार कर दिया है — भुगतान आप लिंक पर सुरक्षित रूप से पूरा करेंगे, और वही होने पर यह पक्का होगा।',
    gu: 'મેં તમારો ઓર્ડર સમીક્ષા માટે તૈયાર કર્યો છે — ચુકવણી તમે લિંક પર સુરક્ષિત રીતે પૂરી કરશો, અને તે થતાં જ તે પાકું થશે.',
  },
  'asks-sensitive': {
    en: "For your safety I never ask for card, OTP or PIN details — you'll enter those only on the secure payment page.",
    hi: 'आपकी सुरक्षा के लिए मैं कभी कार्ड, ओटीपी या पिन नहीं मांगता — वे आप केवल सुरक्षित भुगतान पेज पर डालेंगे।',
    gu: 'તમારી સલામતી માટે હું ક્યારેય કાર્ડ, OTP કે PIN માંગતો નથી — તે તમે ફક્ત સુરક્ષિત ચુકવણી પેજ પર દાખલ કરશો.',
  },
};

export function safeDeflection(reason: string, language: string): string {
  return (SAFE[reason] ?? SAFE['claims-order-or-payment'])[language] ?? SAFE['claims-order-or-payment'].en;
}
