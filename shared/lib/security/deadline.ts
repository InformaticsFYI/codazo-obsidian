export class BoundaryError extends Error {
  constructor(public readonly code: 'TIMEOUT' | 'CANCELLED') { super(code); }
}

/** Each wait is bounded even when an adapter ignores AbortSignal. */
export function createDeadline(milliseconds: number, parent?: AbortSignal) {
  const controller = new AbortController();
  let code: 'TIMEOUT' | 'CANCELLED' = 'TIMEOUT';
  const cancel = () => { code = parent?.reason instanceof BoundaryError ? parent.reason.code : 'CANCELLED'; controller.abort(new BoundaryError(code)); };
  if (parent?.aborted) cancel();
  else parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new BoundaryError('TIMEOUT')), milliseconds);
  return {
    signal: controller.signal,
    async wait<T>(operation: () => Promise<T>): Promise<T> {
      if (controller.signal.aborted) throw new BoundaryError(code);
      let rejectAbort: () => void = () => {};
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new BoundaryError(code));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });
      try {
        const value = await Promise.race([aborted, Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new BoundaryError(code);
          return operation();
        })]);
        if (controller.signal.aborted) throw new BoundaryError(code);
        return value;
      } finally { controller.signal.removeEventListener('abort', rejectAbort); }
    },
    close() { clearTimeout(timer); parent?.removeEventListener('abort', cancel); },
  };
}
