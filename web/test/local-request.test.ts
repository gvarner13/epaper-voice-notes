import { describe, expect, it } from "vitest";
import { isLocalRequest } from "../src/lib/local-request";

describe("local reader boundary", () => {
  it.each([
    "http://127.0.0.1:3000/",
    "http://localhost:3000/",
    "http://[::1]:3000/",
  ])("accepts loopback %s", (url) => {
    expect(isLocalRequest(new Request(url))).toBe(true);
    expect(
      isLocalRequest(
        new Request(url, {
          headers: {
            origin: new URL(url).origin,
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).toBe(true);
  });
  it.each([
    "http://192.168.1.3:3000/",
    "http://example.test:3000/",
    "http://127.0.0.1.attacker.test:3000/",
  ])("rejects non-local and rebound hosts %s", (url) => {
    expect(isLocalRequest(new Request(url))).toBe(false);
  });
  const foreignHeaders: Record<string, string>[] = [
    { origin: "https://attacker.test" },
    { origin: "null" },
    { referer: "https://attacker.test/page" },
    { referer: "not a URL" },
    { "sec-fetch-site": "cross-site" },
    { origin: "http://127.0.0.1:9000" },
  ];
  it.each(foreignHeaders)("rejects foreign browser requests %j", (headers) => {
    expect(
      isLocalRequest(new Request("http://127.0.0.1:3000/", { headers })),
    ).toBe(false);
  });
});
