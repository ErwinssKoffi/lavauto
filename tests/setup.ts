// JSDOM ne fournit pas Web Locks. Ce verrou FIFO simule uniquement le contrat
// nécessaire aux tests unitaires ; les courses entre onglets sont testées dans Chromium.
if (typeof window !== 'undefined' && !navigator.locks) {
  let queue: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, _options: unknown, action: () => unknown) => {
        const pending = queue.then(action);
        queue = pending.catch(() => undefined);
        return pending;
      },
    },
  });
}
