/// <reference lib="webworker" />
import { chooseOrders } from "@swarm/bot";
import type { BotRequest, BotResponse } from "../game/bot-client";

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, state, player, difficulty, seed, personality } = e.data;
  const orders = chooseOrders(state, player, difficulty, seed, personality ? { personality } : {});
  (self as unknown as Worker).postMessage({ id, orders } satisfies BotResponse);
};
