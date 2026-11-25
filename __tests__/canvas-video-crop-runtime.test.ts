import * as React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CanvasVideoCropProvider, CanvasVideoCropMenuItem, CanvasVideoCropOverlay } from '@/components/canvas/CanvasVideoCrop';
import { CanvasVideoFrameContext } from '@/components/canvas/CanvasVideoFrameControls';
import { cropCanvasVideo } from '@/lib/canvas/video-clip';
vi.mock('@xyflow/react', () => ({ NodeToolbar: ({ children }: any) => children, Position: { Bottom: 'bottom' } }));
vi.mock('@/lib/canvas/video-clip', () => ({ cropCanvasVideo: vi.fn(async () => ({blob:new Blob(['crop']),width:1536,height:864,durationSeconds:25})) }));
let root: Root, host: HTMLDivElement, tick: FrameRequestCallback;
const save=vi.fn();
const frame={videoRef:{current:{readyState:2,videoWidth:1920,videoHeight:1080,pause:vi.fn()}}};
beforeEach(()=>{ vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); vi.stubGlobal('requestAnimationFrame',vi.fn(callback=>{tick=callback;return 1;}));vi.stubGlobal('cancelAnimationFrame',vi.fn());vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});host=document.createElement('div');document.body.append(host);root=createRoot(host);save.mockReset().mockResolvedValue(undefined);vi.mocked(cropCanvasVideo).mockClear(); });
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const button=(name:string)=>host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
async function open(){await act(async()=>root.render(React.createElement(CanvasVideoFrameContext.Provider, {value:frame as any}, React.createElement(CanvasVideoCropProvider, {nodeId:"v",src:"/original.mp4",selected:true,onExport:save,children:React.createElement(React.Fragment,null,React.createElement(CanvasVideoCropMenuItem,{onSelect:()=>{}}),React.createElement(CanvasVideoCropOverlay))}))));await act(async()=>host.querySelector('button')!.click());act(()=>tick(0));}
it('shows centered dimensions and eight handles, drags crop in source pixels, exports once',async()=>{
 await open(); expect(button('确认视频裁切')).toBeTruthy();expect(host.textContent).toContain('1536 × 864');expect(host.querySelectorAll('.canvas-video-crop-handle')).toHaveLength(8);
 const bounds=host.querySelector<HTMLElement>('.canvas-video-crop-bounds')!; bounds.getBoundingClientRect=()=>({width:960,height:540} as DOMRect);
 const handle=button('裁切右下边界');handle.setPointerCapture=vi.fn();const event={pointerId:1,clientX:0,clientY:0};
 act(()=>Simulate.pointerDown(handle,event));act(()=>Simulate.pointerMove(host.querySelector('.canvas-video-crop-overlay')!,{...event,clientX:-100,clientY:-50}));
 expect(host.textContent).toContain('1336 × 764');
 await act(async()=>{button('确认视频裁切').click();button('确认视频裁切').click();});
 expect(cropCanvasVideo).toHaveBeenCalledTimes(1);expect(vi.mocked(cropCanvasVideo).mock.calls[0][1]).toMatchObject({left:192,top:108,width:1336,height:764});expect(save).toHaveBeenCalledTimes(1);expect(button('确认视频裁切')).toBeNull();
});
it('cancels without modifying the original and keeps the crop on export failure',async()=>{
 await open(); await act(async()=>button('取消视频裁切').click());expect(save).not.toHaveBeenCalled();
 await act(async()=>host.querySelector('button')!.click());act(()=>tick(0));save.mockRejectedValueOnce(new Error('上传失败'));
 await act(async()=>button('确认视频裁切').click());expect(host.querySelector('[role="alert"]')?.textContent).toBe('上传失败');expect(button('确认视频裁切')).toBeTruthy();
});
