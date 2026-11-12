import webpush from "web-push";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  gameId: string;
}

/** Sends Web Push notifications (SPEC §9.4). Injectable so tests can record instead of send. */
export interface PushSender {
  readonly publicKey: string | null;
  send(target: PushTarget, payload: PushPayload): Promise<"sent" | "gone" | "failed">;
}

/** VAPID keys come from the environment; without them push is disabled and sends are no-ops. */
export function webPushFromEnv(env: NodeJS.ProcessEnv): PushSender {
  const publicKey = env["VAPID_PUBLIC_KEY"] ?? null;
  const privateKey = env["VAPID_PRIVATE_KEY"] ?? null;
  const subject = env["VAPID_SUBJECT"] ?? "mailto:admin@localhost";
  if (!publicKey || !privateKey) {
    return { publicKey: null, send: async () => "failed" };
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return {
    publicKey,
    async send(target, payload) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          { TTL: 3600 },
        );
        return "sent";
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? "gone" : "failed";
      }
    },
  };
}
