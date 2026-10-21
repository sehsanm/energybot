// App-event bus (v3 hook): every emit is still logged as one structured line,
// and registered subscribers receive the same payload after it. Subscriber
// errors are contained per handler (logged, never propagated) so one bad
// listener cannot break an emitter — award writes commit before anyone runs.

type AppEventHandler = (payload: Record<string, unknown>) => void;

const subscribers = new Map<string, Set<AppEventHandler>>();

/** Register `handler` for `name`; returns an idempotent unsubscribe function. */
export function subscribeAppEvent(name: string, handler: AppEventHandler): () => void {
  let handlers = subscribers.get(name);
  if (!handlers) {
    handlers = new Set();
    subscribers.set(name, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function emitAppEvent(name: string, payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: name, at: Date.now(), ...payload }));
  const handlers = subscribers.get(name);
  if (!handlers) return;
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[events] subscriber for "${name}" threw`, err);
    }
  }
}
