import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({warm:vi.fn()}));
vi.mock('@/components/ui/resilient-image',()=>({warmResilientImageCandidates:mocks.warm,hasLoadedResilientImageCandidates:()=>false}));
beforeEach(()=>{vi.resetModules();mocks.warm.mockReset();});
it('collects one render before prioritizing visible and nearest upcoming images', async () => {
  mocks.warm.mockImplementation((_candidates, { signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve(null));
  }));
  const { subscribeMaterialPreview } = await import('@/lib/client/material-preview-queue');
  const cleanups = [
    subscribeMaterialPreview(['/far.jpg'], 45000, () => {}),
    subscribeMaterialPreview(['/near.jpg'], 49500, () => {}),
    subscribeMaterialPreview(['/visible.jpg'], 100000, () => {}),
  ];
  expect(mocks.warm).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(mocks.warm.mock.calls.map(([urls]) => urls[0])).toEqual(['/visible.jpg', '/near.jpg', '/far.jpg']);
  expect(mocks.warm.mock.calls.map(([, options]) => options.priority)).toEqual(['visible', 'prefetch', 'prefetch']);
  cleanups.forEach(cleanup => cleanup());
  await new Promise(resolve => setTimeout(resolve, 0));
});
it('bounds image concurrency and starts visible cards ahead of queued previews',async()=>{
  const pending:Array<()=>void>=[];
  mocks.warm.mockImplementation(()=>new Promise(resolve=>pending.push(()=>resolve('blob:image'))));
  const {subscribeMaterialPreview}=await import('@/lib/client/material-preview-queue');
  const cleanups=Array.from({length:10},(_,i)=>subscribeMaterialPreview([`/${i}.jpg`],0,()=>{}));
  await Promise.resolve();
  expect(mocks.warm).toHaveBeenCalledTimes(6);
  cleanups.push(subscribeMaterialPreview(['/visible.jpg'],1000,()=>{}));
  pending[0]();await new Promise(resolve=>setTimeout(resolve,0));
  expect(mocks.warm.mock.calls[6][0]).toEqual(['/visible.jpg']);
  cleanups.forEach(cleanup=>cleanup());
});
it('aborts media that left the buffer and never updates its unmounted card',async()=>{
  let signal:AbortSignal|undefined;let finish:((value:string)=>void)|undefined;
  mocks.warm.mockImplementation((_candidates,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});});
  const {subscribeMaterialPreview}=await import('@/lib/client/material-preview-queue');
  const ready=vi.fn();const unsubscribe=subscribeMaterialPreview(['/gone.jpg'],1000,ready);
  await Promise.resolve();
  unsubscribe();expect(signal?.aborted).toBe(true);
  finish!('blob:image');await new Promise(resolve=>setTimeout(resolve,0));
  expect(ready).not.toHaveBeenCalled();
});
it('preempts a background download when newly visible media would otherwise wait',async()=>{
  const signals:AbortSignal[]=[];
  mocks.warm.mockImplementation((_candidates,{signal})=>new Promise(resolve=>{signals.push(signal);signal.addEventListener('abort',()=>resolve(null));}));
  const {subscribeMaterialPreview}=await import('@/lib/client/material-preview-queue');
  const cleanups=Array.from({length:6},(_,i)=>subscribeMaterialPreview([`/prefetch-${i}.jpg`],100,()=>{}));
  await Promise.resolve();
  cleanups.push(subscribeMaterialPreview(['/current.jpg'],100000,()=>{}));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(signals.some(signal=>signal.aborted)).toBe(true);
  expect(mocks.warm.mock.calls.some(([c])=>c[0]==='/current.jpg')).toBe(true);
  cleanups.forEach(cleanup=>cleanup());
});
