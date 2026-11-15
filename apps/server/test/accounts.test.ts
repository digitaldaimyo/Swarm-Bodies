import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { googleVerifier } from "../src/google";
import { gamePlayers } from "../src/schema";
import { twoPlayerGame } from "./fixtures";
import {
  api,
  databaseAvailable,
  freshDatabaseUrl,
  guest,
  startServer,
  type Harness,
} from "./support";

// Accounts (docs/plans/beta.md, step 1). Google is faked: a credential "google:<sub>" verifies
// as that subject, anything else is rejected, as a bad signature would be.
const fakeGoogle = async (credential: string) => {
  if (!credential.startsWith("google:")) throw new Error("bad token");
  return credential.slice("google:".length);
};
const cred = (sub: string) => ({ credential: `google:${sub}-padding-to-length` });

type SignIn = { token: string; accountId: string; name: string; google: true; switched: boolean };
type Me = { accountId: string; name: string; google: boolean };

let h: Harness;
let drop: () => Promise<void>;
beforeAll(async () => {
  if (!databaseAvailable) return;
  const db = await freshDatabaseUrl();
  drop = db.drop;
  h = await startServer(db.url, undefined, { googleVerify: fakeGoogle });
});
afterAll(async () => {
  if (!databaseAvailable) return;
  await h.close();
  await drop();
});

describe.skipIf(!databaseAvailable)("accounts: Google sign-in, names, deletion", () => {
  it("links a guest to Google, keeping its token; another device gets the same account", async () => {
    const g = await guest(h);
    const linked = await api<SignIn>(h, "POST", "/api/auth/google", g.token, cred("alice"));
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ accountId: g.accountId, token: g.token, switched: false });
    expect((await api<Me>(h, "GET", "/api/me", g.token)).body.google).toBe(true);

    // A new phone, no guest yet: signing in returns the same account with its own token.
    const phone = await api<SignIn>(h, "POST", "/api/auth/google", undefined, cred("alice"));
    expect(phone.body.accountId).toBe(g.accountId);
    expect(phone.body.token).not.toBe(g.token);
    expect((await api<Me>(h, "GET", "/api/me", phone.body.token)).body.accountId).toBe(g.accountId);
    // The first device is still signed in.
    expect((await api<Me>(h, "GET", "/api/me", g.token)).status).toBe(200);
  });

  it("a device's own guest signing in to an existing account brings its progress along", async () => {
    const home = await guest(h);
    await api(h, "POST", "/api/auth/google", home.token, cred("bob"));
    await api(h, "PUT", "/api/progress", home.token, {
      progress: { ...emptyJson(), completedNodes: ["c01"] },
    });
    const away = await guest(h);
    await api(h, "PUT", "/api/progress", away.token, {
      progress: { ...emptyJson(), completedLessons: ["l1"] },
    });
    const r = await api<SignIn>(h, "POST", "/api/auth/google", away.token, cred("bob"));
    expect(r.body).toMatchObject({ accountId: home.accountId, switched: true });
    const p = await api<{ progress: { completedNodes: string[]; completedLessons: string[] } }>(
      h,
      "GET",
      "/api/progress",
      r.body.token,
    );
    expect(p.body.progress.completedNodes).toEqual(["c01"]);
    expect(p.body.progress.completedLessons).toEqual(["l1"]);
  });

  it("a device signed in to one Google account does not move it to another", async () => {
    const g = await guest(h);
    await api(h, "POST", "/api/auth/google", g.token, cred("carol"));
    const other = await api<SignIn>(h, "POST", "/api/auth/google", g.token, cred("dave"));
    expect(other.body.accountId).not.toBe(g.accountId);
    // Carol is still Carol.
    const again = await api<SignIn>(h, "POST", "/api/auth/google", undefined, cred("carol"));
    expect(again.body.accountId).toBe(g.accountId);
  });

  it("rejects a credential Google did not sign", async () => {
    const g = await guest(h);
    const bad = await api(h, "POST", "/api/auth/google", g.token, {
      credential: "not-a-google-token-at-all",
    });
    expect(bad.status).toBe(401);
    expect((await api<Me>(h, "GET", "/api/me", g.token)).body.google).toBe(false);
  });

  it("renames only from the word lists", async () => {
    const g = await guest(h);
    const ok = await api<Me>(h, "PUT", "/api/me/name", g.token, {
      first: "Jade",
      second: "Bloom",
      number: 512,
    });
    expect(ok.body.name).toBe("Jade Bloom 512");
    expect((await api<Me>(h, "GET", "/api/me", g.token)).body.name).toBe("Jade Bloom 512");
    const free = await api(h, "PUT", "/api/me/name", g.token, {
      first: "Anything",
      second: "Bloom",
      number: 512,
    });
    expect(free.status).toBe(400);
  });

  it("deleting an account signs it out everywhere, frees the Google ID, and hands seats to the bot", async () => {
    const game = await twoPlayerGame(h);
    const a = game.a.token;
    await api(h, "POST", "/api/auth/google", a, cred("erin"));
    expect((await api(h, "DELETE", "/api/me", a)).status).toBe(200);
    expect((await api(h, "GET", "/api/me", a)).status).toBe(401);
    const seat = await h.database.db.query.gamePlayers.findFirst({
      where: and(eq(gamePlayers.gameId, game.gameId), eq(gamePlayers.seat, 0)),
    });
    expect(seat?.botControlled).toBe(true);
    // Erin may sign up again, as a new account.
    const again = await api<SignIn>(h, "POST", "/api/auth/google", undefined, cred("erin"));
    expect(again.status).toBe(200);
    expect((await api<Me>(h, "GET", "/api/me", again.body.token)).body.google).toBe(true);
    game.a.client.close();
    game.b.client.close();
  });
});

describe("the real Google verifier", () => {
  it("rejects a malformed token without reaching Google", async () => {
    await expect(googleVerifier("client-id")("not.a.jwt")).rejects.toThrow();
  });
});

function emptyJson() {
  return {
    version: 1 as const,
    completedNodes: [] as string[],
    completedLessons: [] as string[],
    drafted: [],
    met: [],
    achievements: [],
    rewards: [],
    selected: { palette: "default", vein: "default", trail: "default" },
  };
}
