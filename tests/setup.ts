import "fake-indexeddb/auto";

if (!globalThis.CSS) {
  Object.defineProperty(globalThis, "CSS", {
    value: {
      escape(value: string) {
        return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
      }
    },
    configurable: true
  });
}

if (!navigator.storage) {
  Object.defineProperty(navigator, "storage", {
    value: {
      persisted: async () => false,
      persist: async () => false,
      estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 })
    },
    configurable: true
  });
}
