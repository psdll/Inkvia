import { hash, type Run, type Decision, type DecisionBinding } from './store-types';
import { validateQuestionAnswer } from './questions';
import { maskCanonicalCreativeSkillCommand } from './skill-command';
import { explicitMediaOutputQuantity } from './matching-contracts';

export type DirectMediaAuthorization = {
 version: 1; runId: string; messageId: string; runRevision: number;
 mediaType: 'image' | 'video'; requirementsRevision: number;
 sourceHash: string; bindingHash: string;
};

/** Preserve UTF-16 offsets while excluding quoted instructions and code examples. */
function instructionText(text: string) {
 const blank = (value: string) => value.replace(/[^\n]/g, ' ');
 let result = maskCanonicalCreativeSkillCommand(text).replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, blank).replace(/^[ \t]*>[^\n]*$/gm, blank);
 const pairs: Record<string,string> = {'“':'”','‘':'’','「':'」','『':'』','"':'"',"'":"'"};
 for(let index=0;index<result.length;index++) {
  const open=result[index],close=pairs[open];if(!close)continue;
  if((open==="'"||open==='‘')&&/[a-z0-9]/i.test(result[index-1]??'')&&/[a-z0-9]/i.test(result[index+1]??''))continue;
  const end=result.indexOf(close,index+1);
  const stop=end<0?result.length:end+1;
  result=result.slice(0,index)+blank(result.slice(index,stop))+result.slice(stop);index=stop-1;
 }
 return result;
}
const imageObject=/(?:图片|图像|照片|海报|插画|封面|主图|[张幅][一-龥]{0,40}图|[个份][一-龥]{0,40}(?:背景|场景)(?=[，,.。！？?;；\s]|$)|images?\b|photos?\b|posters?\b|illustrations?\b)/i;
const videoObject=/(?:视频|影片|短片|动画|videos?\b|films?\b|clips?\b)/i;
const action=/(?:生成|升成|变成|转换为|制作|创建|产出|需要|想要|我要|画(?!面|质|风)|做(?!法)|generate\b|create\b|render\b|draw\b|make\b)/ig;
const hypothetical=/(?:如果|假如|假设|要是|设想|例如|示例|比如|举例|解释|讨论|分析|讲解|如何|怎么|怎样|会怎样|(?:客户|用户|他|她|对方)(?:说|需要|想要|要求|希望)|\b(?:if|example|explain|discuss|how to|what if)\b)/i;
/** Negation may govern a request through pronouns, benefactives and polite auxiliaries. */
export function isNegatedMediaInstruction(before: string, after = '') {
 // Negation scopes over the following creative verb, regardless of the words
 // between them. An explicit transition from not asking to executing is separate.
 const negative=/(?:[不没未]|别|勿|禁止|无需|\b(?:not|never|no|don't|doesn't|can't|cannot|won't)\b)/i.exec(before);
 const executeInstead=negative && /(?:再)?(?:问|询问|确认|解释|说明)(?:了)?(?:请)?(?:直接|现在|立即|马上)(?:开始)?\s*$/.test(before.slice(negative.index+negative[0].length));
 return !!negative && !executeInstead || /^(?:是)?(?:不允许|不可以|禁止|不需要)/.test(after);
}
/** Interrogative content asks about creation; polite can-you requests do not. */
function asksForInformation(clause: string, verbEnd: number) {
 const content=clause.replace(/(?:什么|哪个|哪种)都(?:可以|行)/g,'');
 if(/(?:什么|哪(?:个|些|种|里|儿)?|怎样|怎么|如何|为何|为什么|多少|多久|多长|何时)|\b(?:what|which|how|why|when|where)\b/i.test(content))return true;
 const target=imageObject.exec(clause.slice(verbEnd))??videoObject.exec(clause.slice(verbEnd));
 if(!target || !/[吗呢?？]\s*$/.test(clause))return false;
 const predicate=clause.slice(verbEnd+target.index+target[0].length).trim();
 return /^(?:支持|允许|需要|必须|使用|有|是|会|能|can|does|supports?|requires?)/i.test(predicate);
}
/** A target/visual attribute noun phrase, usable only after resolving one real prior result.
 * A short declarative sentence is not a request simply because a result exists.
 */
export function isShortContinuationDirective(text: string) {
 const original=text.trim().replace(/[。.!！]+$/,'').trim();
 const visible=instructionText(text).trim().replace(/[。.!！]+$/,'').trim();
 return visible===original && /^[一-龥a-z0-9\s]{2,30}$/i.test(visible)
  && /(?:背景|场景|环境|构图|配色|色调|光线|灯光|风格|材质|视角|角度|景别|图|画|海报|照片|视频)$/.test(visible)
  && !/[我你您他她它这那是很了吗呢吧]/.test(visible) && !hypothetical.test(visible)
  && !/(?:不|别|勿|先|仅|只|取消|停止|暂停|模型|参数|提示词|方案|脚本|文案|文字|生成|制作|需要|想要|修改|调整|编辑)/.test(visible);
}
/** The creative verb must be the requested action, not embedded in another topic. */
function isRequestPrefix(prefix: string, editTarget: boolean) {
 const value=prefix.trim();
 return !value
  || /^(?:(?:请|麻烦|劳驾|帮|给|替|为|让|我|我们|你|您|现在|本次|这次|再|继续|立即|马上|直接|开始|希望|能否|可以|能|可不可以|只|仅)|\s)+$/.test(value)
  || /^(?:(?:please|can|could|would|will|you|i|we|want|need|to|help|me|us|now)\b\s*)+$/i.test(value)
  || /^(?:请)?(?:用(?!于)|把|将|基于).+/.test(value)
  || /^(?:请)?(?:不要|不用|无需)(?:再)?(?:问|询问|确认|解释|说明)(?:了)?(?:请)?(?:直接|现在|立即|马上)(?:开始)?$/.test(value)
  || editTarget && isShortContinuationDirective(value);
}
/** A complete counted media noun phrase is a delivery request, not arbitrary prose. */
function isCountedMediaRequest(text:string,mediaType:'image'|'video') {
 const value=text.trim();
 const phrase=/^[0-9零〇一二两三四五六七八九十百]+\s*[张幅个条段]([一-龥\s]{0,48}?)(图片|图像|照片|海报|插画|封面|主图|图|视频|影片|短片|动画)$/.exec(value);
 if(!phrase)return false;
 // Bare delivery permits flat visual/object compounds, not relative clauses.
 // Pronouns, aspect/modal/purpose markers or predicates require the explicit
 // request path. Inspect the modifier separately so noun heads such as 插画
 // are not mistaken for a creative verb.
 const modifier=phrase[1];
 if(/[的我你您他她它已曾刚将待需供再会要让给在过着了]/.test(modifier)
  || /画|做|拍摄|绘制|修改|调整|编辑/.test(modifier) || hypothetical.test(modifier))return false;
 if(/已有|现有|已上传|已保存|已生成|上传|下载|存在|描述|解释|讨论|引用|代码|参数|提示词|方案|脚本|生成|制作|创建|产出/.test(value)||isNegatedMediaInstruction(value))return false;
 return explicitMediaOutputQuantity(value,mediaType)!==undefined;
}
function hasDirective(text:string,mediaType:'image'|'video',context:string,editTarget:boolean,preferenceTarget:boolean) {
 const visible=instructionText(text),visibleContext=instructionText(context);
 // Waiting for a later confirmation is a condition, not present permission.
 if(/(?:等|待|先让我|经我).{0,24}(?:确认|批准|同意)|(?:确认|批准|同意)后|\b(?:wait for|after my approval)\b/i.test(visible))return false;
 if(/(?:^|[，,。;；])\s*(?:如果|假如|假设|要是|if\b)/i.test(visible))return false;
 const contextImage=imageObject.test(visibleContext),contextVideo=videoObject.test(visibleContext);
 const countedClauses=visible.trim().replace(/[，,、。.!！]+$/,'').split(/[，,、]/).map(value=>value.trim());
 const countedScope=isCountedMediaRequest(countedClauses[0],mediaType) && countedClauses.slice(1).every(value=>/^(?:\d+\s*:\s*\d+|[1-9]\d*K|(?:不要|不含|无)(?:文字|水印|字幕|logo|标志))$/i.test(value));
 let allowed=false;
 for(const rawClause of visible.match(/[^，,。.!！？?;；\n]+[，,。.!！？?;；\n]?/g)??[]) {
  const question=/[?？]\s*$/.test(rawClause);
  const clause=rawClause.replace(/[，,。.!！？?;；\n]\s*$/,'');
  const image=imageObject.test(clause),video=videoObject.test(clause);
  const scoped=image||video ? mediaType==='image'?image:video : editTarget || preferenceTarget || (mediaType==='image'?contextImage&&!contextVideo:contextVideo&&!contextImage);
  if(!scoped)continue;
  const countedRequest=countedScope && isCountedMediaRequest(clause,mediaType);
  const firstAction=countedRequest?null:/(?:生成|升成|变成|转换为|制作|创建|产出|需要|想要|我要|画(?!面|质|风)|做(?!法)|改为|改成|换成|调整|修改|编辑|generate|create|render|draw|make|edit|change)/i.exec(clause);
  if(!firstAction && (image||video) && isNegatedMediaInstruction(clause)){allowed=false;continue;}
  if(firstAction && isNegatedMediaInstruction(clause.slice(0,firstAction.index),clause.slice(firstAction.index+firstAction[0].length))) {allowed=false;continue;}
  if(firstAction&&hypothetical.test(clause.slice(0,firstAction.index))) {allowed=false;continue;}
  const writingOnly=/(?:只|仅|先)(?:要|需|做|写|输出|提供|准备|展示|讨论).{0,24}(?:提示词|方案|脚本|分镜|文案|文字)|(?:写|编写|整理|提供|输出|给出).{0,24}(?:提示词|方案|脚本|分镜|文案)|(?:提示词|方案|脚本|分镜)\s*$|\b(?:prompt|plan|script)\s+only\b/i.test(clause);
  if(writingOnly){allowed=false;continue;}
  if(firstAction && (asksForInformation(rawClause,firstAction.index+firstAction[0].length) || !isRequestPrefix(clause.slice(0,firstAction.index),editTarget)))continue;
  for(const match of countedRequest?[]:clause.matchAll(action)) {
   const before=clause.slice(0,match.index),after=clause.slice(match.index!+match[0].length);
   if(image && video && !(mediaType==='image'?imageObject:videoObject).test(after)) continue;
   const denied=isNegatedMediaInstruction(before,after);
   allowed=!denied;
  }
  if(!firstAction && !/[?？]|(?:吗|呢)\s*$/.test(visible) && countedRequest) allowed=true;
  if(editTarget && !question && !firstAction && isShortContinuationDirective(clause)) allowed=true;
  if(editTarget) for(const match of clause.matchAll(/(?:改为|改成|换成|调整|修改|编辑|\b(?:edit|change|replace)\b)/ig)) {
   allowed=!isNegatedMediaInstruction(clause.slice(0,match.index),clause.slice(match.index!+match[0].length));
  }
 }
 return allowed;
}

/** Restrict incomplete new plans; never converts text into spending authority. */
export function requestedMediaOutputMinimum(text: string, mediaType: 'image' | 'video') {
 const visible=instructionText(text);
 if(!hasDirective(visible,mediaType,visible,false,false))return undefined;
 const quantities=(visible.match(/[^，,。.!！？?;；\n]+[，,。.!！？?;；\n]?/g)??[])
  .filter(clause=>hasDirective(clause,mediaType,clause,false,false))
  .map(clause=>explicitMediaOutputQuantity(clause,mediaType)).filter((value):value is number=>value!==undefined);
 return quantities.length?Math.max(...quantities):undefined;
}

/** Only server-owned current message/answer evidence can mint this proof.
 * The intent enum is deliberately not accepted as execution authority.
 */
export function directMediaAuthorization(run: Pick<Run, 'id' | 'input'>, kind: string, binding: DecisionBinding, decisions: readonly Decision[] = []): DirectMediaAuthorization | undefined {
 const mediaType=kind==='image.generate'?'image':kind==='video.generate'?'video':undefined;
 if(!mediaType||run.input.mediaAuthorizationVersion!==1||run.input.matchingPolicyVersion!==2||binding.version!==2||binding.kind!==kind||!binding.planId||!binding.stepId||!binding.receiptId||!binding.requestHash||!binding.limits||!binding.expiresAt)return undefined;
 if(decisions.some(decision=>decision.actionId && decision.binding && decision.binding.kind===kind && decision.binding.receiptId===binding.receiptId))return undefined;
 const requirements=run.input.requirements;
 if(requirements?.conflicts.length)return undefined;
 const step=run.input.generationPlans?.[binding.planId]?.plan.steps.find(item=>item.id===binding.stepId);
 if(!step||step.mediaType!==mediaType||step.receipt?.id!==binding.receiptId)return undefined;
 const continuation=requirements?.continuation;
 const editTarget=!!continuation?.targets.some(target=>target.mediaType===mediaType);
 let text=run.input.text;
 const sources:unknown[]=[{kind:'message',id:run.input.messageId,text}];
 for(const decision of decisions) {
  if(decision.runId!==run.id||decision.binding||decision.state!=='answered')continue;
  for(const field of decision.fields??[]) {
   if(field.semantic?.requirement!=='intent')continue;
   const answer=validateQuestionAnswer(decision.fields??[],decision.answer);
   if('skipped' in answer||answer.skippedFields?.includes(field.id))return undefined;
   const value=answer.notes?.[field.id]??answer.values[field.id];
   if(typeof value!=='string')return undefined;
   text=answer.notes?.[field.id]??field.options?.find(option=>option.value===value)?.label??value;
   sources.push({kind:'answer',id:decision.id,fieldId:field.id,text});
  }
 }
 const preferences=requirements?.effectivePreferences??run.input.effectivePreferences??run.input.preferences;
 const preferenceTarget=preferences?.[mediaType]?.mode==='explicit' && preferences?.[mediaType==='image'?'video':'image']?.mode!=='explicit';
 if(!hasDirective(text,mediaType,run.input.text,editTarget,preferenceTarget))return undefined;
 // A quoted number in a title or example is not a direct execution allowance.
 const visible=instructionText(run.input.text);
 for(const fact of requirements?.facts??[]) {
  if(!(fact.field.endsWith('.quantity')||fact.field.startsWith('generation.'))||fact.source.kind!=='message')continue;
  if(fact.source.sourceId!==run.input.messageId)return undefined;
  const offset=fact.source.valueStart??fact.source.start;
  if(offset===undefined||visible[offset]!==run.input.text[offset])return undefined;
  const prefix=visible.slice(0,offset).split(/[，,。;；\n]/).at(-1)??'';
  const inputMention=[...prefix.matchAll(/上传|提供|已有|现有|附上|参考/g)].at(-1)?.index??-1;
  const directive=[...prefix.matchAll(action)].at(-1)?.index??-1;
  if(inputMention>=directive && inputMention>=0)return undefined;
 }
 return {version:1,runId:run.id,messageId:run.input.messageId,runRevision:run.input.revision??0,mediaType,requirementsRevision:requirements?.revision??0,sourceHash:hash(sources),bindingHash:hash(binding)};
}
