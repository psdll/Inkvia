import { expect, it } from 'vitest';
import { initialVideoCrop, adjustVideoCrop } from '@/lib/canvas/video-crop';
it('starts at the centered 80 percent region in source pixels', () => {
  expect(initialVideoCrop(1920,1080)).toEqual({left:192,top:108,width:1536,height:864,sourceWidth:1920,sourceHeight:1080});
});
it('moves without resizing and clamps all edges', () => {
  const crop=initialVideoCrop(1920,1080);
  expect(adjustVideoCrop(crop,'move',3000,-3000)).toMatchObject({left:384,top:0,width:1536,height:864});
});
it('resizes all eight handles without crossing the opposite edge', () => {
  const crop=initialVideoCrop(1920,1080);
  for(const handle of ['n','s','e','w','ne','nw','se','sw'] as const) {
    const result=adjustVideoCrop(crop,handle,100,50);
    expect(result).not.toEqual(crop);
    expect(result.width%2).toBe(0);expect(result.height%2).toBe(0);
    expect(result.left+result.width).toBeLessThanOrEqual(1920);
    expect(result.top+result.height).toBeLessThanOrEqual(1080);
  }
  expect(adjustVideoCrop(crop,'nw',3000,3000)).toMatchObject({left:1726,top:970,width:2,height:2});
});
