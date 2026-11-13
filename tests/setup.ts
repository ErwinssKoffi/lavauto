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

// JSDOM ne fournit pas non plus ResizeObserver, dont ResponsiveContainer
// (Recharts) a besoin. Sans lui, le montage du tableau de bord lève une
// ReferenceError. Le stub annonce une taille fixe, comme scripts/check.cjs.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class TestResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      const entry = {
        target,
        contentRect: { width: 800, height: 400 },
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { ResizeObserver: TestResizeObserver });
  Object.assign(window, { ResizeObserver: TestResizeObserver });
}

