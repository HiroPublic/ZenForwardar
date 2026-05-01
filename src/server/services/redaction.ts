const creditCardPattern = /\b(?:\d[ -]*?){13,19}\b/g;
const creditCardLabelPattern = /(card|credit card|visa|mastercard|amex|クレジットカード|カード)/i;
const memberPattern = /(membership|member|会員番号|会員|認証コード|verification code|pin)\s*[:：]?\s*[A-Z0-9-]+/gi;

export function redactPersonalInformation(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const withoutMemberIds = line.replace(memberPattern, "$1: [Redacted]");
      if (!creditCardLabelPattern.test(withoutMemberIds)) return withoutMemberIds;
      return withoutMemberIds.replace(creditCardPattern, "[Redacted]");
    })
    .join("\n");
}
