// App-event stub (v3 hook): structured logs today; subscribers replace the
// logger in v3 without touching call sites.

export function emitAppEvent(name: string, payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: name, at: Date.now(), ...payload }));
}
