import type { AgentTool } from './state';
export type AgentActivityGroup = { tools: AgentTool[]; skillCount: number; label?: string };
/** Group adjacent skill reads only; callers split on messages and other visible activities. */
export function groupAgentActivities(tools: AgentTool[]): AgentActivityGroup[] {
 const groups: AgentActivityGroup[]=[];
 for (const tool of tools) {
  const skill=tool.activity?.category==='skill' && tool.activity.operation!=='catalog' && Boolean(tool.activity.skillId);
  const last=groups.at(-1);
  if(skill && last?.skillCount && last.tools[0].runId===tool.runId)last.tools.push(tool);
  else groups.push({tools:[tool],skillCount:skill?1:0});
 }
 for(const group of groups)if(group.skillCount) {
  group.skillCount=new Set(group.tools.map(tool=>tool.activity!.skillId)).size;
  group.label=group.tools.some(tool=>tool.status==='running')?'进行中':group.tools.some(tool=>['结果待核实','状态未确认'].includes(tool.outcomeLabel??''))?'结果待核实':group.tools.some(tool=>tool.status==='failed')?'部分未完成':'已读取';
 }
 return groups;
}
