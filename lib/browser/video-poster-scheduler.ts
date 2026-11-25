export function createVideoPosterScheduler(concurrency: number) {
  const limit = Math.max(1, Math.floor(concurrency));
  const waiting: Array<() => void> = [];
  let active = 0;

  const drain = () => {
    while (active < limit && waiting.length > 0) {
      waiting.shift()?.();
    }
  };

  return function schedule<T>(task: () => Promise<T> | T) {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        active += 1;
        let pending: Promise<T>;
        try {
          pending = Promise.resolve(task());
        } catch (error) {
          active -= 1;
          reject(error);
          drain();
          return;
        }
        pending.then(
          (value) => {
            active -= 1;
            resolve(value);
            drain();
          },
          (error) => {
            active -= 1;
            reject(error);
            drain();
          },
        );
      });
      drain();
    });
  };
}
