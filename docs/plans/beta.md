# Beta readiness (plan)

**Goal:** open the game to players we don't know. That needs four things:

1. **Identity that survives:** a new phone or cleared site data must not erase anyone's rating, games, progress or purchases.
2. **A server that can be trusted with strangers.**
3. **A way to hear what goes wrong.**
4. **A first, honest way to pay for the game,** built so that a later full-game unlock reuses it.

## Decisions (2026-11-15)

- **Sign in with Google links identity.**
  - Guests keep working exactly as today, and signing in is optional.
  - Signing in links the current guest to a Google account. On another device, signing in brings everything back.
- **Paddle for payments.** Paddle is the merchant of record, so it handles sales tax and VAT.
- **Stage one is a Supporter Pack, not a donation.**
  - **Why:** Paddle does not process donations, crowdfunding or sponsorship ([what you can't sell on Paddle](https://www.paddle.com/help/start/account-verification/what-am-i-not-allowed-to-sell-on-paddle)).
  - **What it is:** a one-time purchase that delivers something real: supporter cosmetics and a thank-you in Dr. Purr's Journal.
- **Stage two, later:** a one-time **$4.99 unlock** for more of the campaign and Skirmish. It reuses the same pipeline. What stays free is decided then.
- **Purchases belong to a signed-in account,** never to a guest that can vanish. Buying asks you to sign in first.

## Where things stand

- **Accounts are anonymous guests.**
  - The server issues a random bearer token. The client keeps it in `localStorage`, and the server stores only its hash (`accounts.token_hash`).
  - The name is generated (`engine.createGuest`, e.g. "Amber Spore 417") and can't be changed.
- **Nothing can recover a lost token.** Clearing site data, a new phone, or Safari's storage eviction (about 7 days unused, for sites not installed to the home screen) loses the account for good.
- **The server is on Render's free tier.** It sleeps when idle; the first online request after a quiet spell takes 30–60 s and looks like "server unreachable".
- **No rate limiting, no client error reporting, no feedback route, no privacy page.**

## Steps (one PR each, tested on phones between)

### 1. Identity: Google sign-in, names, account deletion

- **Server:**
  - Verify Google ID tokens: signature, audience (our client ID) and expiry.
  - Store the Google subject ID on `accounts` (new nullable unique column). Store no email unless a later need appears.
  - `POST /api/auth/google`:
    - **Google ID not linked yet:** link it to the calling guest.
    - **Google ID already linked:** return that account's token. This is the "restore on a new device" path.
  - **Conflict:** this device's guest has progress, and the Google account already has another. Progress merges by union, as it already does. The ranked rating and active games stay with the Google account; the guest's are listed so nothing vanishes silently. Recorded in DECISIONS when built.
  - `DELETE /api/me`: deletes the account, its push subscriptions and its ladder entries. Finished games keep a "deleted player" seat so replays still play.
- **Client:**
  - **Settings, "Account" section:** shows the name; Sign in with Google, or "Signed in as …"; Sign out; Delete account (with confirmation).
  - **Online hub:** a gentle prompt to sign in, so your rating survives a new phone.
- **Names:**
  - Players choose from the existing word lists: a first word, a second word, and a number.
  - Choosing from lists means there is nothing to moderate. Free-text names stay out of the beta.
- **Your setup (Google Cloud):** an OAuth client ID for the web app, authorised origins (the Render site, the Pages site, the future domain), and a consent screen that links the privacy page from step 3.
- **Test on devices:** Google's pop-up in an installed iPhone home-screen app, with the redirect mode as a fallback.

### 2. Beta hygiene: rate limits, waking server, error reports, feedback

- **Rate limits** (`@fastify/rate-limit`):
  - Tight on guest creation and sign-in.
  - Moderate on the rest of `/api`.
  - A limit on WebSocket messages per connection.
- **The waking server:**
  - **In the client:** the Online hub says "Waking the server…" with progress and keeps retrying, instead of "unreachable".
  - **Your decision:** stay on the free tier for beta with that message, or move to a paid instance (about $7 a month) so it never sleeps.
- **Client error reports:**
  - **What's sent:** uncaught errors and failed renders go to `POST /api/errors`, with the message, stack, build, screen and device class.
  - **What's not:** no token and no personal data.
  - **Limits:** rate-limited, and capped per device per day.
  - **Where they go:** stored in a table, with a small script to read them.
- **"Send feedback"** in Settings: a GitHub issue form or an email link, with the build and device class pre-filled.

### 3. Legal pages and domain

- **Pages:** Privacy, Terms and Refunds, served by the client as public pages with no login wall.
  - **Privacy** says what is stored: the token hash, the chosen name, the Google subject ID if linked, games, ratings, push subscriptions and error reports. It says how to delete it all (step 1).
  - **Terms** and **Refunds** name Paddle as merchant of record. Refunds allow 14–90 days and never "all sales final" ([Paddle go-live requirements](https://developer.paddle.com/partners/embed-billing/seller-go-live/prepare-for-go-live)).
- **A domain you own,** pointed at Render, with HTTPS. Paddle approves a domain, and an `onrender.com` subdomain is a risk there ([domain approval](https://www.paddle.com/help/start/account-verification/what-is-domain-approval)).
- **Your part:**
  - The legal entity name, which must match the Paddle account exactly.
  - The domain.
  - A review of the page text.
- **Then apply to Paddle.** Allow 1–2 weeks for review, during step 4.

### 4. The Supporter Pack (Paddle)

- **Contents (to settle with you):**
  - A supporter palette, vein and trail.
  - A supporter mark by your name online.
  - A Journal page from Dr. Purr thanking the patron of the survey.
- **Price:** to settle. A one-time purchase, open to signed-in players.
- **Flow:**
  - **Checkout:** Paddle's embedded checkout opens in the client.
  - **Fulfilment:** Paddle's payment webhook reaches the server. Its signature is verified, it is idempotent per transaction, and it records an **entitlement** on the account.
  - **Delivery:** the client reads its entitlements with its progress, caches them for offline play, and unlocks the cosmetics.
  - **Refunds:** a refund webhook removes the entitlement.
- **Sandbox first:** the whole flow runs against Paddle's sandbox in e2e before going live.

### Later: the $4.99 unlock

- **Same entitlement system,** with a new product.
- **What it gates** (to decide then): more campaign systems, and Skirmish beyond a free set of options.
- **Honest limits:**
  - **Offline:** the client is a PWA and its source is public, so offline gating is honour-based. That's normal for a $4.99 indie game.
  - **Online and ranked** can be checked by the server.
  - The paywall should feel like a fair deal, not a lock.
- **Fees:** Paddle takes 5% + $0.50, about $0.75 of $4.99. The fixed part is why the price shouldn't go lower.
- **App stores:** if the game is ever wrapped for the App Store or Google Play, their in-app purchase rules apply there instead of Paddle.

## Also before beta (decisions and tests, not code)

- **Decisions:**
  - The difficulty jump at campaign systems 4 and 8.
  - Emotes in v1.
  - Where the notifications toggle lives.
  - Reviews of DECISIONS #71, #82 and #83.
  - Your read of the Journal text.
- **Tests:**
  - Firefox and Samsung Internet.
  - Three- and four-player balance with people.
  - The body-switching freeze stays gone on the new build (DECISIONS #141).
- **Can wait:** splitting `view.ts`, and screenshot-diff rendering tests.

## What I need from you, by step

| Step | From you                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------- |
| 1    | A Google Cloud OAuth client ID, and the consent screen (needs the privacy page URL from step 3; a draft URL works to start) |
| 2    | Free tier with the "waking" message, or a paid instance                                                                     |
| 3    | Legal entity name, a domain, review of the pages                                                                            |
| 4    | Paddle account (sandbox, then live), Supporter Pack contents and price                                                      |

## Progress

**Step 1 is built** (DECISIONS #143).

- **Server:**
  - `POST /api/auth/google`, `GET /api/me`, `PUT /api/me/name` and `DELETE /api/me`.
  - An `account_tokens` table, and `google_sub` and `deleted_at` on accounts (migration 0002).
  - ID tokens are verified with `jose` against Google's keys.
- **Client:**
  - **Settings → Account:** name, Sign in with Google, change name, sign out, delete account.
  - **Online hub:** the ranked section prompts players to sign in.
- **Tests:** server tests (with a fake Google verifier) and an e2e test for names and deletion.
- **Still to do on devices:** sign in for real, including in an installed iPhone home-screen app.
- **Your part:** the OAuth client's **authorised JavaScript origins** must list every address the game is served from: the Render site, the GitHub Pages site, and later the custom domain.
- **Confirmed on the user's phones (2026-11-15):** sign-in and Check for updates both work.

**Step 2 is built** (DECISIONS #144). Hosting stays on Render's free tier for now.

- **Rate limits:** budgets on `/api` and a WebSocket flood guard. Behind Render's proxy, the client's real address is used.
- **Waking server:** "Waking the server… N s" in the Online hub, which retries for up to 90 seconds.
- **Error reports:** `POST /api/errors`, kept 30 days. `pnpm --filter @swarm/server errors` prints them.
- **Feedback:** "Send feedback" in Settings, as a GitHub issue with the build filled in.
- **Tests:** server tests for limits, the trusted proxy, the flood guard and reports; client tests for the device class and waking; e2e for the waking hub and the feedback link.
