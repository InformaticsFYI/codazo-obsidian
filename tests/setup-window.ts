// Shared modules use window-scoped timers, as Obsidian's plugin guidelines require for popout
// windows. Obsidian always provides `window`; Node-environment tests get the same global.
if (typeof window === 'undefined') Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
