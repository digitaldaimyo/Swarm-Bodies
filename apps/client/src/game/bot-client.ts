import type { Difficulty, Personality } from "@swarm/bot";
import type { GameState, OrderSet, PlayerId } from "@swarm/sim";

export interface BotRequest {
  id: number;
  state: GameState;
  player: PlayerId;
  difficulty: Difficulty;
  seed: string;
  personality?: Personality;
}
export interface BotResponse {
  id: number;
  orders: OrderSet;
}

export interface BotRunner {
  choose(
    state: GameState,
    player: PlayerId,
    difficulty: Difficulty,
    seed: string,
    personality?: Personality,
  ): Promise<OrderSet>;
  dispose(): void;
}

/** Runs the bot in a Web Worker (SPEC §9.5) so planning never blocks the UI thread. */
export function workerBot(): BotRunner {
  const worker = new Worker(new URL("../worker/bot.worker.ts", import.meta.url), {
    type: "module",
  });
  const waiting = new Map<number, (orders: OrderSet) => void>();
  let next = 1;
  worker.onmessage = (e: MessageEvent<BotResponse>) => {
    waiting.get(e.data.id)?.(e.data.orders);
    waiting.delete(e.data.id);
  };
  return {
    choose(state, player, difficulty, seed, personality) {
      const id = next++;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        worker.postMessage({
          id,
          state,
          player,
          difficulty,
          seed,
          ...(personality ? { personality } : {}),
        } satisfies BotRequest);
      });
    },
    dispose: () => worker.terminate(),
  };
}

/** Same contract on the calling thread: used by unit tests and as a fallback. */
export async function inlineBot(): Promise<BotRunner> {
  const { chooseOrders } = await import("@swarm/bot");
  return {
    choose: async (state, player, difficulty, seed, personality) =>
      chooseOrders(state, player, difficulty, seed, personality ? { personality } : {}),
    dispose: () => undefined,
  };
}
