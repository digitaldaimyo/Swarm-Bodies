import { DEFAULT_SETTINGS, type GameSettings } from "@swarm/protocol";
import type { GameState } from "@swarm/sim";
import { api, guest, TestClient, type Harness } from "./support";

export interface TwoPlayerGame {
  gameId: string;
  code: string;
  a: { token: string; client: TestClient };
  b: { token: string; client: TestClient };
  state: GameState;
}

/** Host A (Swarmer) creates, B (Biofilm) joins by code, both subscribe, A starts. */
export async function twoPlayerGame(
  h: Harness,
  settings: GameSettings = DEFAULT_SETTINGS.live,
): Promise<TwoPlayerGame> {
  const ga = await guest(h);
  const gb = await guest(h);
  const created = await api<{ gameId: string; code: string }>(h, "POST", "/api/games", ga.token, {
    settings,
    strain: "swarmer",
  });
  if (created.status !== 200) throw new Error(JSON.stringify(created.body));
  const { gameId, code } = created.body;
  await api(h, "POST", `/api/games/${code}/join`, gb.token, { strain: "biofilm" });
  const ca = await TestClient.open(h, ga.token);
  const cb = await TestClient.open(h, gb.token);
  ca.send({ type: "subscribe", gameId });
  cb.send({ type: "subscribe", gameId });
  await ca.type("lobby");
  await cb.type("lobby");
  const started = await api(h, "POST", `/api/games/${gameId}/start`, ga.token);
  if (started.status !== 200) throw new Error(JSON.stringify(started.body));
  const sa = await ca.type("gameState");
  await cb.type("gameState");
  return {
    gameId,
    code,
    a: { token: ga.token, client: ca },
    b: { token: gb.token, client: cb },
    state: sa.state as GameState,
  };
}
