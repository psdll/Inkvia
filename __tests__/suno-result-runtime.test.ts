// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasReplaceMediaButton } from "@/components/canvas/CanvasReplaceMediaButton";
import { CanvasSunoResult } from "@/components/canvas/CanvasSunoResult";
import { CanvasAudioPlaybackProvider } from "@/components/canvas/CanvasAudioPlayback";
import type { CanvasNodeData } from "@/lib/canvas/document";
let root:Root,host:HTMLDivElement;
beforeEach(()=>{ vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{}); vi.spyOn(HTMLMediaElement.prototype,"load").mockImplementation(()=>{}); host=document.createElement("div");document.body.append(host);root=createRoot(host); });
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("switches all returned songs and shows the selected lyrics without generating again",async()=>{
 const expand=vi.fn(), history=vi.fn();
 const initial:Extract<CanvasNodeData,{kind:"audioTask"}>={kind:"audioTask",model:"suno-v6-apimart",prompt:"",voiceId:"",speed:1,pitch:0,volume:1,modifyPitch:0,modifyIntensity:0,modifyTimbre:0,soundEffect:"",status:"success",audioOutputs:[1,2,3].map(i=>({audioIndex:i,url:`/uploads/${i}.mp3`,title:`歌曲${i}`,lyrics:`歌词${i}`,durationSeconds:i*10})),selectedAudioIndex:0};
 function Harness(){const[data,setData]=React.useState(initial);return React.createElement(CanvasAudioPlaybackProvider,{nodeIds:["music"],children:React.createElement(CanvasSunoResult,{id:"music",data,headerActions:React.createElement(CanvasReplaceMediaButton,{kind:"audio",placement:"inline",onUpload:async()=>{},onHistory:history}),onSelect:i=>setData({...data,selectedAudioIndex:i}),onExpand:expand,onWaveformReady:()=>{}})});}
 await act(async()=>root.render(React.createElement(Harness)));
 const replace=host.querySelector<HTMLButtonElement>('[aria-label="替换素材"]');
 expect(replace).not.toBeNull();
 await act(async()=>replace!.click());
 await act(async()=>{Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="选择生成历史")!.click();});
 expect(history).toHaveBeenCalledTimes(1);expect(expand).not.toHaveBeenCalled();
 const select=host.querySelector('select')!;expect(select.options).toHaveLength(3);
 expect(host.textContent).toContain("00:10");
 await act(async()=>{select.value="2";select.dispatchEvent(new Event("change",{bubbles:true}));});
 expect(host.textContent).toContain("3/3");expect(host.textContent).toContain("00:30");
 await act(async()=>{Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="歌词")!.click();});
 expect(host.textContent).toContain("歌词3");expect(host.textContent).not.toContain("歌词1");
 await act(async()=>{Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="展开")!.click();});expect(expand).toHaveBeenCalledTimes(1);
});
