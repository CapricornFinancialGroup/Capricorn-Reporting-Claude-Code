// Resolve the authenticated CSM from App Service Easy Auth.
//
// When Easy Auth (Entra) is enabled, App Service injects these headers on every request
// that reaches the app (the platform has already enforced auth):
//   X-MS-CLIENT-PRINCIPAL-NAME : the user's principal name (usually their email)
//   X-MS-CLIENT-PRINCIPAL      : base64-encoded JSON of all claims
//
// Locally there is no Easy Auth, so we fall back to the DEV_USER_EMAIL config value.

import type { IncomingHttpHeaders } from "node:http";
import { logger } from "./logger.js";

export interface CsmIdentity {
  email: string;
  isDevOverride: boolean;
}

const PRINCIPAL_NAME_HEADER = "x-ms-client-principal-name";
const PRINCIPAL_HEADER = "x-ms-client-principal";

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const raw = headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Email-bearing claim types Entra may use in the encoded principal. */
const EMAIL_CLAIM_TYPES = new Set([
  "preferred_username",
  "emails",
  "email",
  "upn",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
]);

interface EncodedPrincipal {
  claims?: Array<{ typ?: string; val?: string }>;
}

/** Decode the base64 X-MS-CLIENT-PRINCIPAL header and pull out an email-like claim. */
function emailFromEncodedPrincipal(encoded: string): string | null {
  try {
    const json = Buffer.from(encoded, "base64").toString("utf8");
    const principal = JSON.parse(json) as EncodedPrincipal;
    const match = principal.claims?.find(
      (c) => c.typ && EMAIL_CLAIM_TYPES.has(c.typ) && c.val,
    );
    return match?.val ?? null;
  } catch (err) {
    logger.warn("Failed to decode X-MS-CLIENT-PRINCIPAL header", { err: String(err) });
    return null;
  }
}

/**
 * Resolve the CSM identity for a request.
 *
 * @param headers   incoming request headers
 * @param devUserEmail  DEV_USER_EMAIL from config (null in production)
 * @returns the identity, or null if no authenticated user could be resolved
 */
export function resolveCsm(
  headers: IncomingHttpHeaders,
  devUserEmail: string | null,
): CsmIdentity | null {
  const principalName = headerValue(headers, PRINCIPAL_NAME_HEADER);
  if (principalName) {
    return { email: principalName, isDevOverride: false };
  }

  const encoded = headerValue(headers, PRINCIPAL_HEADER);
  if (encoded) {
    const email = emailFromEncodedPrincipal(encoded);
    if (email) return { email, isDevOverride: false };
  }

  if (devUserEmail) {
    return { email: devUserEmail, isDevOverride: true };
  }

  return null;
}

/** Whether a user may see the OPERATIONS group/datasets. Empty allowlist = open to all (default). */
export function isOpsUser(email: string | null | undefined, opsUsers: string[]): boolean {
  if (opsUsers.length === 0) return true;
  return Boolean(email) && opsUsers.includes(email!.toLowerCase());
}

/** Whether a user may upload/mutate the weekly targets. Empty allowlist = DISABLED (fails
 *  CLOSED) — deliberately the opposite default from isOpsUser above: that shape is fine for gating
 *  a read view, but wrong for a route that mutates live targets with no confirmed admin list yet. */
export function isTargetsAdmin(email: string | null | undefined, adminEmails: string[]): boolean {
  if (adminEmails.length === 0) return false;
  return Boolean(email) && adminEmails.includes(email!.toLowerCase());
}
