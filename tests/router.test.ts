import { describe, expect, it, vi } from "vitest";
import { createListener, type Handlers } from "../src/background/router";

const sender = {};

function call(listener: ReturnType<typeof createListener>, message: unknown) {
  return new Promise<{ handled: boolean; reply: unknown }>((resolve) => {
    let handled = false;
    handled = listener(message, sender, (reply) => resolve({ handled, reply }));
    if (!handled) resolve({ handled, reply: undefined });
  });
}

describe("createListener", () => {
  it("replies with the handler's value", async () => {
    const listener = createListener({ ping: () => ({ ok: true }) });
    expect(await call(listener, { type: "ping", payload: {} })).toEqual({
      handled: true,
      reply: { ok: true, value: { ok: true } },
    });
  });

  it("passes the payload and sender to the handler", async () => {
    const ping = vi.fn(() => ({ ok: true as const }));
    await call(createListener({ ping }), { type: "ping", payload: {} });
    expect(ping).toHaveBeenCalledWith({}, sender);
  });

  it("turns a thrown error into an error reply", async () => {
    const handlers: Partial<Handlers> = {
      ping: async () => {
        throw new Error("boom");
      },
    };
    expect((await call(createListener(handlers), { type: "ping", payload: {} })).reply).toEqual({
      ok: false,
      error: "boom",
    });
  });

  it("ignores messages it has no handler for", async () => {
    const listener = createListener({ ping: () => ({ ok: true }) });
    expect((await call(listener, { type: "nope", payload: {} })).handled).toBe(false);
    expect((await call(listener, { type: "toString", payload: {} })).handled).toBe(false);
    expect((await call(listener, "ping")).handled).toBe(false);
    expect((await call(listener, null)).handled).toBe(false);
  });
});
