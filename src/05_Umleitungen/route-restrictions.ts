/** A via-way turn restriction requires remembering how the vehicle arrived.
 * Pairwise junction restrictions alone CANNOT model these relations.
 */
import type {RouteRestriction} from '../model.js';
function suffixMatches(path:readonly string[],suffix:readonly string[]):boolean {
  if(suffix.length>path.length)return false;
  for(let i=0;i<suffix.length;i++)
    if(path[path.length-suffix.length+i]!==suffix[i])return false;
  return true;
}
export function permittedAfterHistory(
  history:readonly string[],nextEdgeId:string,rules:readonly RouteRestriction[]
):boolean {
  if(!history.length)return true;
  const candidate=[...history,nextEdgeId];
  for(const r of rules)if(r.kind==='no'&&suffixMatches(candidate,r.edgeIds))
    return false;
  const mandatoryNext=new Map<string,Set<string>>();
  for(const r of rules)if(r.kind==='only'){
    for(let length=1;length<r.edgeIds.length;length++) {
      if(!suffixMatches(history,r.edgeIds.slice(0,length)))continue;
      const prefix=r.edgeIds.slice(0,length).join('|');
      const choices=mandatoryNext.get(prefix)??new Set<string>();
      choices.add(r.edgeIds[length]!);
      mandatoryNext.set(prefix,choices);
    }
  }
  // Each independently active only_* obligation must be satisfied. If one
  // relation offers several valid via-way variants, their next edges form
  // a union for the SAME matched prefix.
  for(const choices of mandatoryNext.values())
    if(!choices.has(nextEdgeId))return false;
  return true;
}
