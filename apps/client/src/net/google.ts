/**
 * Sign in with Google in the browser (docs/plans/beta.md, step 1): Google Identity Services,
 * loaded only when the Account section is shown, never in e2e runs.
 */

/** Our OAuth client ID. Public by design; VITE_GOOGLE_CLIENT_ID overrides it for other hosts. */
export const GOOGLE_CLIENT_ID =
  (import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined) ||
  "23838499371-sbubdm1sbekttk7r63g9j9e0qhd3l298.apps.googleusercontent.com";

interface GoogleId {
  initialize(o: { client_id: string; callback(r: { credential: string }): void }): void;
  renderButton(el: HTMLElement, o: Record<string, string | number>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let loading: Promise<GoogleId> | null = null;

/** Loads Google's script once. Rejects offline or when blocked. */
export function loadGoogle(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  loading ??= new Promise<GoogleId>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () =>
      window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("gsi"));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("offline"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Draws Google's own button into `el`; `onCredential` gets the ID token. */
export async function renderGoogleButton(
  el: HTMLElement,
  onCredential: (credential: string) => void,
): Promise<void> {
  const id = await loadGoogle();
  id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => onCredential(r.credential) });
  id.renderButton(el, {
    theme: "filled_black",
    size: "large",
    shape: "pill",
    text: "signin_with",
    width: Math.min(320, el.clientWidth || 320),
  });
}
