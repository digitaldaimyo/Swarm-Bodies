import { lt, sql } from "drizzle-orm";
import type { ClientErrorReport } from "@swarm/protocol";
import type { Db } from "./db";
import { clientErrors } from "./schema";

/** How long client error reports are kept, and the most kept at once. */
export const ERROR_RETENTION_DAYS = 30;
export const ERROR_MAX_ROWS = 5000;

/**
 * Client error reports (docs/plans/beta.md, step 2): stored for a month so a tester's "it broke"
 * comes with the message. `pnpm --filter @swarm/server errors` prints the recent ones.
 */
export class ErrorLog {
  private inserts = 0;
  constructor(
    private readonly db: Db,
    private readonly clock: { now(): number },
  ) {}

  async record(r: ClientErrorReport): Promise<void> {
    await this.db.insert(clientErrors).values({
      message: r.message,
      stack: r.stack ?? null,
      build: r.build,
      screen: r.screen,
      device: r.device,
      createdAt: new Date(this.clock.now()),
    });
    // Prune now and then, not on every report.
    if (this.inserts++ % 50 === 0) await this.prune();
  }

  async prune(): Promise<void> {
    const cutoff = new Date(this.clock.now() - ERROR_RETENTION_DAYS * 86_400_000);
    await this.db.delete(clientErrors).where(lt(clientErrors.createdAt, cutoff));
    await this.db.execute(sql`
      delete from client_errors where id in (
        select id from client_errors order by created_at desc offset ${ERROR_MAX_ROWS}
      )`);
  }
}
