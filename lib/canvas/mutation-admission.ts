type MutationPermit = { release(): void };

export function createCanvasMutationAdmission(options: { maxConcurrent: number }) {
  const maxConcurrent = Math.min(Math.max(Math.floor(options.maxConcurrent), 1), 256);
  let activeCount = 0;
  return {
    tryAcquire(): MutationPermit | null {
      if (activeCount >= maxConcurrent) return null;
      activeCount += 1;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          activeCount = Math.max(0, activeCount - 1);
        },
      };
    },
    active() {
      return activeCount;
    },
  };
}

type CanvasMutationAdmission = ReturnType<typeof createCanvasMutationAdmission>;

const shared = globalThis as typeof globalThis & { __canvasMutationAdmission?: CanvasMutationAdmission };
const configuredLimit = Number(process.env.CANVAS_MUTATION_MAX_CONCURRENT || 48);
const admission = shared.__canvasMutationAdmission ?? createCanvasMutationAdmission({
  maxConcurrent: Number.isFinite(configuredLimit) ? configuredLimit : 48,
});
shared.__canvasMutationAdmission = admission;

export function tryAcquireCanvasMutation() {
  return admission.tryAcquire();
}
