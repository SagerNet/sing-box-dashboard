import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadServersState, normalizeServerUrl, saveServersState, serverDisplayName } from "./config";

class MemoryStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }

  removeItem(key: string) {
    this.map.delete(key);
  }
}

const STORAGE_KEY = "sing-box-dashboard.servers";
const LEGACY_STORAGE_KEY = "sing-box-dashboard.server";

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

describe("loadServersState", () => {
  it("returns an empty state when nothing is stored", () => {
    expect(loadServersState()).toEqual({ servers: [], activeId: null });
  });

  it("round-trips through saveServersState", () => {
    const state = {
      servers: [{ id: "a", name: "Home", url: "http://10.0.0.1:9090", secret: "s" }],
      activeId: "a",
    };
    saveServersState(state);
    expect(loadServersState()).toEqual(state);
  });

  it("survives malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadServersState()).toEqual({ servers: [], activeId: null });
  });

  it("drops entries without an id or url and fixes a dangling activeId", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        servers: [
          { id: "a", url: "http://10.0.0.1:9090" },
          { id: "b", url: "" },
          { url: "http://no-id.example" },
          null,
        ],
        activeId: "gone",
      }),
    );
    const state = loadServersState();
    expect(state.servers.map((server) => server.id)).toEqual(["a"]);
    expect(state.activeId).toBe("a");
    // Missing optional fields are normalized to empty strings.
    expect(state.servers[0]).toEqual({ id: "a", name: "", secret: "", url: "http://10.0.0.1:9090" });
  });

  it("migrates the legacy single-server entry and removes it", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ url: "http://old.example", secret: "s" }));
    const state = loadServersState();
    expect(state.servers).toHaveLength(1);
    expect(state.servers[0].url).toBe("http://old.example");
    expect(state.servers[0].secret).toBe("s");
    expect(state.activeId).toBe(state.servers[0].id);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    // The migration is persisted under the new key.
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

describe("normalizeServerUrl", () => {
  it("adds the scheme and strips trailing slashes", () => {
    expect(normalizeServerUrl(" 10.0.0.1:9090/ ")).toBe("http://10.0.0.1:9090");
    expect(normalizeServerUrl("https://example.com//")).toBe("https://example.com");
    expect(normalizeServerUrl("")).toBe("");
  });
});

describe("serverDisplayName", () => {
  it("prefers the name, then the URL host, then the raw URL", () => {
    expect(serverDisplayName({ id: "a", name: "Home", url: "http://x", secret: "" })).toBe("Home");
    expect(serverDisplayName({ id: "a", name: "", url: "http://h:9090", secret: "" })).toBe("h:9090");
    expect(serverDisplayName({ id: "a", name: "", url: "not a url", secret: "" })).toBe("not a url");
  });
});
