import type { Runtime } from "webextension-polyfill";
import type { Message, Reply, RequestOf, RequestType, ResponseOf } from "../shared/messages";

export type Handlers = {
  [T in RequestType]: (payload: RequestOf<T>, sender: Runtime.MessageSender) => Promise<ResponseOf<T>> | ResponseOf<T>;
};

function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && typeof (value as Message).type === "string";
}

// Uses `sendResponse` + `return true` rather than returning a promise, since Chromium
// doesn't support promise-returning onMessage listeners. Takes a partial map so tests can
// register one handler; the background declares its map as the full `Handlers`.
export function createListener(handlers: Partial<Handlers>) {
  return (message: unknown, sender: Runtime.MessageSender, sendResponse: (reply: Reply<RequestType>) => void): boolean => {
    if (!isMessage(message) || !Object.hasOwn(handlers, message.type)) return false;
    const handler = handlers[message.type] as (payload: unknown, sender: Runtime.MessageSender) => unknown;
    Promise.resolve()
      .then(() => handler(message.payload, sender))
      .then(
        (value) => sendResponse({ ok: true, value } as Reply<RequestType>),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  };
}
