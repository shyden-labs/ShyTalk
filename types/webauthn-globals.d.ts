// The passkey plugin's declarations (@better-auth/passkey 1.7.17) name one DOM
// global that Node's own types do not have (plan 7, shyden-labs/ShyTalk#134).
// `skipLibCheck` stays false, so it is declared here with the shape the
// WebAuthn Level 3 recommendation gives it (and @simplewebauthn/server's own
// copy, esm/types/dom.d.ts).
export {};

declare global {
  interface AuthenticatorSelectionCriteria {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    requireResidentKey?: boolean;
    residentKey?: 'discouraged' | 'preferred' | 'required';
    userVerification?: 'discouraged' | 'preferred' | 'required';
  }
}
