import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Sign in with Google (docs/plans/beta.md, step 1). The client gets an ID token (a JWT signed
 * by Google) from Google Identity Services; the server checks it and keeps only the subject ID.
 */

/** Our OAuth client ID. Public by design: it ships in every page that signs in. */
export const DEFAULT_GOOGLE_CLIENT_ID =
  "23838499371-sbubdm1sbekttk7r63g9j9e0qhd3l298.apps.googleusercontent.com";

/** Checks a Google ID token and returns its subject (the stable Google account ID). */
export type GoogleVerifier = (credential: string) => Promise<string>;

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function googleVerifier(clientId: string = DEFAULT_GOOGLE_CLIENT_ID): GoogleVerifier {
  // Google's signing keys, fetched once and refreshed as they rotate.
  const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return async (credential) => {
    const { payload } = await jwtVerify(credential, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) throw new Error("no subject");
    return payload.sub;
  };
}
