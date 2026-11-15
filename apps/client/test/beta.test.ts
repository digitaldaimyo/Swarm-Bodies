import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceClass } from "../src/net/errors";
import { wakeServer } from "../src/net/wake";

// Beta hygiene (docs/plans/beta.md, step 2).
describe("deviceClass", () => {
  it("names the platform and browser, nothing finer", () => {
    expect(
      deviceClass(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone Safari");
    expect(
      deviceClass(
        "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
      ),
    ).toBe("Android Chrome");
    expect(
      deviceClass(
        "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36",
      ),
    ).toBe("Android Samsung Internet");
    expect(
      deviceClass("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"),
    ).toBe("Desktop Firefox");
  });
});

describe("wakeServer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is up at once when the server answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const waits: number[] = [];
    expect(await wakeServer((s) => waits.push(s))).toBe("up");
    expect(waits).toEqual([]);
  });

  it("is offline when the connection is refused at once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await wakeServer(() => undefined)).toBe("offline");
  });

  it("keeps trying through 503s while the server wakes, then is up", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: ++calls < 2 ? 503 : 200 })),
    );
    expect(await wakeServer(() => undefined)).toBe("up");
    expect(calls).toBe(2);
  });

  it("gives up after its time limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    expect(await wakeServer(() => undefined, 100)).toBe("down");
  });
});
