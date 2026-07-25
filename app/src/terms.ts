/**
 * MidPay Terms & Conditions — shown at signup and linked from the app.
 *
 * DRAFT (v1) built from the product/economics facts in
 * project_brief_pay_per_view_uganda.md. This is NOT legal advice — have it
 * reviewed by a Ugandan lawyer before launch, and bump TERMS_VERSION whenever
 * the wording changes so acceptance can be re-collected.
 */

export const TERMS_VERSION = "2026-07-v1";

export interface TermsSection {
  heading: string;
  body: string;
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: "1. Who can use MidPay",
    body:
      "You must be of legal age in Uganda and authorised to use the mobile-money number you register with. Your registration number is also the number your earnings are paid to.",
  },
  {
    heading: "2. Earnings — how much you keep",
    body:
      "When someone buys your content, a payment-processing fee of 3% is taken from the sale first. The remaining amount (the “net pool”) is then split:\n\n• Recorded videos & photos: you keep 70%, MidPay keeps 30%.\n• Live streams: you keep 60–70% depending on audience size (60% up to 200 viewers, 65% up to 500, 70% above 500).\n\nA higher price does not change these percentages — it simply grows the amount they apply to.",
  },
  {
    heading: "3. Pricing",
    body:
      "The minimum price for any paid content or live ticket is 5,000 UGX. This is a floor, not a fixed price — you may set any price at or above it. Live tickets must also meet a duration-based minimum (at least 5,000 UGX per declared hour).",
  },
  {
    heading: "4. Payouts & charges",
    body:
      "Earnings accumulate in your MidPay wallet and are paid out on a weekly schedule (“Payout Fridays”) to your registered mobile-money number. A mobile-money withdrawal duty of 0.5% applies to each payout. You are responsible for any taxes on your earnings.",
  },
  {
    heading: "5. Recording of your content by others",
    body:
      "For paid content, MidPay blocks screen recording inside the app where the device allows it. However, MidPay CANNOT prevent someone from filming their screen with another phone or camera, or otherwise copying what they can see. You accept this risk. Do not post anything — especially private or sensitive content — that you are not comfortable being seen or possibly copied. You are solely responsible for the content you upload and share.",
  },
  {
    heading: "6. Free content & sharing",
    body:
      "Free content may be watermarked with the MidPay logo and your @handle, and may be downloaded and shared publicly (for example on WhatsApp) to help you reach new viewers. Free content earns nothing directly.",
  },
  {
    heading: "7. Your conduct",
    body:
      "You may not post content that is illegal, non-consensual, that you do not own the rights to, or that harasses or endangers others. You are responsible for everything you post and for having the consent of anyone who appears in it.",
  },
  {
    heading: "8. Moderation & enforcement",
    body:
      "Anyone can sign up and post — there is no approval gate — but MidPay may review reported content and, where necessary, hide (quarantine), remove content, or suspend or ban accounts that break these terms. Financial records are always retained even when content is removed, and buyers keep access to content they have already paid for where possible.",
  },
  {
    heading: "9. Payments are handled by a provider",
    body:
      "Payments and payouts are processed by a third-party mobile-money/payment provider. Their processing is subject to their own terms and availability, and MidPay is not liable for delays or failures caused by the provider or the mobile networks.",
  },
  {
    heading: "10. Changes to these terms",
    body:
      "MidPay may update these terms. When the terms change materially, you may be asked to accept the new version to keep using the app.",
  },
];
