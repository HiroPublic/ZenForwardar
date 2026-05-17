import { beforeEach, describe, expect, it, vi } from "vitest";

const launchPersistentContext = vi.fn();
const launch = vi.fn();
const existsSync = vi.fn(() => true);
const mkdirSync = vi.fn();
const readFileSync = vi.fn();
const writeFileSync = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext,
    launch
  }
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
  }
}));

function createMockContext(options: { finalUrl: string; bodyText: string }) {
  let currentUrl = "about:blank";
  const page = {
    goto: vi.fn(async (url: string) => {
      currentUrl = url === "https://www.hotelslash.com/Trips" ? options.finalUrl : url;
    }),
    waitForLoadState: vi.fn(async () => undefined),
    locator: vi.fn(() => ({
      innerText: vi.fn(async () => options.bodyText)
    })),
    url: vi.fn(() => currentUrl),
    title: vi.fn(async () => (options.finalUrl.includes("/Trips") ? "Your Trips | HotelSlash | Hotel Price Tracker" : "Sign In | HotelSlash | Hotel Price Tracker")),
    evaluate: vi.fn(async () => ({ auth: "session-token" }))
  };

  const context = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
    once: vi.fn(),
    storageState: vi.fn(async () => ({
      cookies: [{ name: "session", value: "cookie", domain: "www.hotelslash.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
      origins: [{ origin: "https://www.hotelslash.com", localStorage: [{ name: "user", value: "{\"email\":\"traveler@example.com\"}" }] }]
    }))
  };

  return { context, page };
}

describe("HotelSlash login session", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existsSync.mockImplementation((target?: string) => (typeof target === "string" ? !target.endsWith(".hotelslash-auth.json") : true));
  });

  it("captures a live authenticated session before reporting login completion", async () => {
    const { context } = createMockContext({
      finalUrl: "https://www.hotelslash.com/Trips",
      bodyText: "Hello, traveler! Your saved trips"
    });
    launchPersistentContext.mockResolvedValue(context);

    const { startHotelSlashLoginSession, finishHotelSlashLoginSession } = await import("../hotelslash");

    await startHotelSlashLoginSession();
    await expect(finishHotelSlashLoginSession()).resolves.toMatchObject({
      loginWindowOpen: false,
      profileExists: true
    });
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("fails login completion when the live session still lands on the sign-in page", async () => {
    const { context } = createMockContext({
      finalUrl: "https://www.hotelslash.com/Account/LogIn?returnUrl=%2FTrips",
      bodyText: "Sign in to your account"
    });
    launchPersistentContext.mockResolvedValue(context);

    const { startHotelSlashLoginSession, finishHotelSlashLoginSession } = await import("../hotelslash");

    await startHotelSlashLoginSession();
    await expect(finishHotelSlashLoginSession()).rejects.toThrow(
      "HotelSlash login is not saved in the browser session yet."
    );
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
