import { useEffect, useRef, useState } from "preact/hooks";
import { NAME_FIRST, NAME_SECOND, type NameChange } from "@swarm/protocol";
import {
  ApiError,
  currentGuest,
  deleteAccount,
  forgetGuest,
  renameAccount,
  signInWithGoogle,
} from "../net/api";
import { renderGoogleButton } from "../net/google";
import { syncProgress } from "./progress";
import { audio } from "../audio/sfx";

const e2e = typeof location !== "undefined" && new URLSearchParams(location.search).has("e2e");

/** Splits "Jade Bloom 512" back into its parts, when it came from the lists. */
function parts(name: string): NameChange {
  const [first, second, num] = name.split(" ");
  return {
    first: (NAME_FIRST as readonly string[]).includes(first ?? "")
      ? (first as NameChange["first"])
      : NAME_FIRST[0],
    second: (NAME_SECOND as readonly string[]).includes(second ?? "")
      ? (second as NameChange["second"])
      : NAME_SECOND[0],
    number: Math.min(999, Math.max(100, Number(num) || 100)),
  };
}

/**
 * Settings → Account (docs/plans/beta.md, step 1): your name, Sign in with Google so the account
 * survives a new phone, sign out, and delete the account.
 */
export function AccountSection() {
  const [guest, setGuest] = useState(currentGuest);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<NameChange | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const button = useRef<HTMLDivElement>(null);

  const linked = !!guest?.google;
  useEffect(() => {
    if (linked || e2e || !button.current) return;
    let live = true;
    renderGoogleButton(button.current, (credential) => {
      setStatus("Signing in…");
      void signInWithGoogle(credential)
        .then(({ switched }) => {
          if (switched) {
            // This device now belongs to an existing account: start fresh with it.
            location.reload();
            return;
          }
          setGuest(currentGuest());
          setStatus("Signed in. Your progress and rating now follow your Google account.");
          void syncProgress();
        })
        .catch((e: unknown) =>
          setStatus(e instanceof ApiError ? e.message : "Sign-in failed. Try again."),
        );
    }).catch(() => {
      if (live) setGoogleError("Google sign-in needs a connection.");
    });
    return () => {
      live = false;
    };
  }, [linked]);

  return (
    <section class="card account" aria-labelledby="account-title">
      <h3 id="account-title">Account</h3>
      {guest ? (
        <p>
          Playing as <strong>{guest.name}</strong>
          {linked ? " · signed in with Google" : ""}
        </p>
      ) : (
        <p class="muted">You haven't played online yet. Your progress is on this device only.</p>
      )}
      {!linked && (
        <>
          <p class="hint">
            Sign in with Google to keep your progress and rating on a new phone, or if this
            browser's data is cleared.
          </p>
          <div ref={button} class="google-button" />
          {e2e && <p class="hint">Google sign-in is off in tests.</p>}
          {googleError && <p class="hint">{googleError}</p>}
        </>
      )}
      {guest && !editing && (
        <button
          class="btn"
          onClick={() => {
            audio.click();
            setEditing(parts(guest.name));
          }}
        >
          Change name
        </button>
      )}
      {editing && (
        <form
          class="name-picker"
          onSubmit={(ev) => {
            ev.preventDefault();
            setStatus("Saving…");
            void renameAccount(editing)
              .then(() => {
                setGuest(currentGuest());
                setEditing(null);
                setStatus("Name changed.");
              })
              .catch(() => setStatus("Couldn't change the name. Check your connection."));
          }}
        >
          <label class="field">
            <span>First word</span>
            <select
              value={editing.first}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  first: (e.target as HTMLSelectElement).value as NameChange["first"],
                })
              }
            >
              {NAME_FIRST.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Second word</span>
            <select
              value={editing.second}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  second: (e.target as HTMLSelectElement).value as NameChange["second"],
                })
              }
            >
              {NAME_SECOND.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Number</span>
            <input
              type="number"
              inputMode="numeric"
              min={100}
              max={999}
              value={editing.number}
              onInput={(e) =>
                setEditing({
                  ...editing,
                  number: Math.min(
                    999,
                    Math.max(100, Number((e.target as HTMLInputElement).value) || 100),
                  ),
                })
              }
            />
          </label>
          <p class="muted">
            {editing.first} {editing.second} {editing.number}
          </p>
          <div class="row-buttons">
            <button class="btn btn-primary" type="submit">
              Save name
            </button>
            <button class="btn btn-ghost" type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {linked && (
        <button
          class="btn btn-ghost"
          onClick={() => {
            forgetGuest();
            location.reload();
          }}
        >
          Sign out on this device
        </button>
      )}
      {guest && !confirmDelete && (
        <button class="btn btn-ghost danger" onClick={() => setConfirmDelete(true)}>
          Delete account
        </button>
      )}
      {confirmDelete && (
        <div class="confirm" role="alertdialog" aria-labelledby="delete-title">
          <p id="delete-title">
            <strong>Delete your online account?</strong> Your name, rating, synced progress and
            notifications are removed from the server, on every device. Running online games pass to
            a bot. Progress saved on this device stays. This can't be undone.
          </p>
          <div class="row-buttons">
            <button
              class="btn danger"
              onClick={() => {
                setStatus("Deleting…");
                void deleteAccount()
                  .then(() => {
                    setConfirmDelete(false);
                    setGuest(null);
                    setStatus("Your account was deleted.");
                  })
                  .catch(() => setStatus("Couldn't delete the account. Check your connection."));
              }}
            >
              Delete
            </button>
            <button class="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {status && (
        <p class="hint" role="status">
          {status}
        </p>
      )}
    </section>
  );
}
