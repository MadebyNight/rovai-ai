import {runMissionAcceptance} from './acceptance'
import React from 'react'
import {createRoot} from 'react-dom/client'
import {BusinessApp} from '../../../apps/desktop/src/renderer/src/BusinessApp'
import {CampClientProvider} from '../../../apps/desktop/src/renderer/src/camp-client'
import {CurrentUserProfileContext} from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import {createReviewModel} from '../../../scripts/fixtures/host-web-parity/model'
import {initial, initialDraft, agents, installations, now} from '../../../scripts/fixtures/host-web-parity/data'
import {DEFAULT_GENERAL_PREFERENCES} from '../../../apps/desktop/src/shared/general-preferences-model'
import {DEFAULT_APPEARANCE} from '../../../apps/desktop/src/shared/appearance'
import {applyAppearanceSnapshot} from '../../../apps/desktop/src/renderer/src/theme'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'
import type {MissionRecord, CampOpenProjection} from '@contracts'

// UI-only acceptance: production BusinessApp/components, deterministic memory adapter.
const query=new URLSearchParams(location.search), theme=query.get('theme')==='night'?'night':'day'
const appearance={...DEFAULT_APPEARANCE,preference:theme,resolvedTheme:theme} as const
applyAppearanceSnapshot(document.documentElement,appearance)
const model=createReviewModel('web','camp')
const profiles=[...agents, ...agents.map((agent,i)=>({...agent,agentId:`extra-${i}`,displayName:i?'奥黛丽':'雾切响子'}))]
const items:MissionRecord[]=[
 ['需要核对窄窗口的目录布局','needs_you',['交互','体验优化']],['补齐使命工作区恢复路径','in_progress',['Core']],['更新首次使用引导文案','not_started',['文案']],['使命累计变更回归测试','completed',['测试']]
].map(([title,status,tags],i)=>({missionId:`mission-${i}`,campId:`rvcamp_01h47kvsy5fk1shh6w1g60eec${i}`,title:title as string,description:'让使命从保存、开始、恢复到交付都有清晰的状态。复用现有会话组件，并验证工作目录、草稿和文件预览。\n这段描述用于验证完整描述展开后的布局。',status:status as any,tags:tags as string[],projectPath:'/workspace/rovai-ai',projectBindingKind:'directory',detailsVersion:1,sourceMessageId:null,createdAt:now,updatedAt:new Date(Date.now()-86400000).toISOString(),memberAgentIds:profiles.map(a=>a.agentId),defaultLeadAgentId:profiles[0].agentId,runningAgentIds:[],hasUnread:i===0}))
const events=new Set<(e:any)=>void>(),calls:any[]=[]
const snapshots=new Map(),drafts=new Map()
function snapshot(m:MissionRecord):CampOpenProjection {
 if(snapshots.has(m.campId)) return snapshots.get(m.campId)
 const s=JSON.parse(JSON.stringify(initial).replaceAll(initial.camp.id,m.campId))
 s.camp={...s.camp,id:m.campId,missionId:m.missionId,title:m.title,activationState:'active',projectPath:m.projectPath}
 s.schemaVersion=7
 const collection=(n:number)=>({totalCount:n,loadedCount:n,omittedCount:0,complete:true})
 s.coverage={tasks:collection(s.tasks.length),messages:{...collection(s.messages.length),hasEarlier:false,oldestLoadedSequence:s.messages[0]?.sequence??null,newestLoadedSequence:s.messages.at(-1)?.sequence??null},turns:collection(s.turns.length),agentRuns:collection(s.agentRuns.length),executionEvidence:collection(s.executionEvidence.length),approvals:collection(s.approvals.length)}
 snapshots.set(m.campId,s);return s
}
const projects=[{projectKey:'directory:/workspace/rovai-ai',projectPath:'/workspace/rovai-ai',name:'rovai-ai',lastActivityAt:now,lastActivityGlobalSequence:0,totalCount:0,recentCamps:[]}]
const nav={schemaVersion:3,throughGlobalSequence:10,quickChat:{totalCount:0,recentCamps:[]},projects}
const prefs={...DEFAULT_GENERAL_PREFERENCES,newConversationDefaults:{memberAgentIds:profiles.map(a=>a.agentId),defaultLeadAgentId:profiles[0].agentId}}
const navigationPrefs={schemaVersion:4,pins:[],removedProjects:[],projectOrder:projects.map(p=>p.projectKey),projectNames:{}}
const changed=()=>events.forEach(fn=>fn({method:'navigation.invalidated',params:{}}))
const applied=(payload:any={})=>({status:'applied',code:'ok',payload})
const client={...model.client,onInvalidated:undefined,onEvent:(fn:any)=>{events.add(fn);return()=>events.delete(fn)},request:async(method:string,p:any={})=>{
 calls.push({method,p});const c=p.command??p,m=items.find(m=>m.missionId===c.missionId||m.campId===c.campId)
 if(method==='missions.list')return structuredClone(items)
 if(method==='missions.cleanup.list')return []
 if(method==='members.list')return profiles
 if(method==='runtime.installations.list')return installations
 if(method==='memory.hearthReviewItems.list')return []
 if(method==='navigation.snapshot')return nav
 if(method==='navigation.findCamp')return items.find(m=>m.campId===p.campId)?{...snapshot(items.find(m=>m.campId===p.campId)!).camp}:null
 if(method==='camps.exists')return !!m
 if(method==='camps.open'||method==='camps.enter')return structuredClone(snapshot(m!))
 if(method==='navigation.campViewed')return {campId:c.campId,lastSeenGlobalSequence:c.throughGlobalSequence}
 if(method==='camp.composerDraft.get'){if(!drafts.has(c.campId))drafts.set(c.campId,{...structuredClone(initialDraft),campId:c.campId,body:'',content:{schemaVersion:1,segments:[]},attachments:[]});return structuredClone(drafts.get(c.campId))}
 if(method==='camp.composerDraft.save'){const d=drafts.get(c.campId);Object.assign(d,{content:c.content,body:c.content.segments.map((s:any)=>s.text??'').join(''),revision:d.revision+1});return structuredClone(d)}
 if(method==='camp.pendingInputs.get')return {campId:c.campId,executionActive:false,items:[],editSession:null,submissionOutcomes:[]}
 if(method==='notifications.inbox')return {schemaVersion:7,episodes:[],unreadCount:0,throughGlobalSequence:10,hasMore:false,nextCursor:null}
 if(method==='notifications.preference.get')return {schemaVersion:1,version:1,enabled:false,headsUpEnabled:false,soundEnabled:false,kinds:{}}
 if(method==='notifications.changesSince')return {schemaVersion:7,episodes:[],throughGlobalSequence:10,hasMore:false}
 if(method==='notifications.acknowledgeVisibleSources')return applied()
 if(method==='events.subscribe')return {schemaVersion:1,events:[],throughGlobalSequence:10}
 if(method==='workspaces.inspect')return {name:'rovai-ai',projectPath:p.path,gitObservation:{state:'git_valid',branch:'main',head:'a'.repeat(40),repositoryRoot:p.path,objectFormat:'sha1',dirty:false,reason:null}}
 if(method==='missions.update'){
  if((c.title!==undefined||c.description!==undefined)&&c.expectedDetailsVersion!==m!.detailsVersion)return {...applied({missionId:m!.missionId,currentTitle:m!.title,currentDescription:m!.description,currentDetailsVersion:m!.detailsVersion}),status:'rejected',code:'mission.details_version_conflict'}
  const detailsChanged=(c.title!==undefined&&c.title!==m!.title)||(c.description!==undefined&&c.description!==m!.description)
  Object.assign(m!,c,{detailsVersion:m!.detailsVersion+(detailsChanged?1:0),updatedAt:new Date().toISOString()});delete (m! as any).expectedDetailsVersion;changed();return applied({missionId:m!.missionId,changed:detailsChanged||c.tags!==undefined})
 }
 if(method==='missions.status'){m!.status=c.status;changed();return applied({missionId:m!.missionId,changed:true})}
 if(method==='missions.start'){m!.status='in_progress';changed();return applied({missionId:m!.missionId,campId:m!.campId})}
 if(method==='missions.activity')return [{id:1,kind:'created',actorType:'user',actorId:'user',changes:{},createdAt:now}]
 if(method==='missions.delivery' && query.has('nonGit'))return {campId:m!.campId,workingDirectory:'/workspace/plain',git:false,workspace:null,pullRequests:[],files:[]}
 if(method==='missions.delivery')return {campId:m!.campId,workingDirectory:'/workspace/rovai-ai-mission-'+m!.missionId,git:true,workspace:{id:'workspace',missionId:m!.missionId,campId:m!.campId,executionHostId:'host',sourceDirectory:'/workspace/rovai-ai',repositoryRoot:'/workspace/rovai-ai',gitCommonDir:'/workspace/rovai-ai/.git',workingDirectory:'/workspace/rovai-ai-mission-'+m!.missionId,worktreePath:'/workspace/rovai-ai-mission-'+m!.missionId,baseBranch:'main',branch:'rovai/mission/'+m!.missionId,baseSha:'a'.repeat(40),state:'ready',diagnostic:null},pullRequests:[],files:[{attachmentId:'review-attachment',displayName:'interaction-review.md',kind:'file',fileCount:1,mediaType:'text/markdown',byteSize:1024,previewKind:'none',messageId:snapshot(m!).messages[1].id,agentId:profiles[0].agentId,createdAt:now}]}
 if(method==='missions.changes')return [{id:'file',path:'src/mission.ts',oldPath:null,kind:'modified',additions:2,deletions:1,binary:false,oldMode:'100644',newMode:'100644'}]
 if(method==='missions.fileDiff')return {file:{id:'file',path:'src/mission.ts',kind:'modified',oldMode:'100644',newMode:'100644'},hunks:[{oldStart:1,newStart:1,lines:[{kind:'deletion',text:'old',oldLine:1,newLine:null},{kind:'addition',text:'new',oldLine:null,newLine:1}]}],patch:''}
 if(method==='missions.create'){const m={...items[0],...c,missionId:'created-'+items.length,campId:'rvcamp_01h47kvsy5fk1shh6w1g60eed'+items.length,status:'not_started',hasUnread:false};items.unshift(m);changed();return applied({campId:m.campId,missionId:m.missionId})}
 if(method==='camps.changeDefaultLead'){m!.defaultLeadAgentId=c.successorAgentId;snapshot(m!).camp.defaultLeadAgentId=c.successorAgentId;changed();return applied()}
 if(method==='camps.delete'){items.splice(items.indexOf(m!),1);changed();return applied()}
 return model.client.request(method as any,p)
}}
const preferences:any={appearance:{get:async()=>appearance,onChanged:()=>()=>{}},generalPreferences:new Proxy({}, {get:(_,key)=>async(...args:any[])=>{if(key==='setNewConversationDefaults')prefs.newConversationDefaults=args[0];return prefs}}),navigationPreferences:new Proxy({}, {get:()=>async()=>navigationPrefs})}
const environment:any={client,files:{...model.fileApi,open:async(req:any)=>{calls.push({method:"fixture.file.open",p:req});return model.fileApi.open({...req,...(req.campId?{campId:initial.camp.id}:{})} as any)}},preferences,selectWorkspaceDirectory:async()=>({name:'rovai-ai',projectPath:'/workspace/rovai-ai'})}
;(window as any).missionQA={items,calls,errors:[],run:runMissionAcceptance}
window.addEventListener('error',e=>(window as any).missionQA.errors.push(String(e.error?.stack??e.message)))
window.addEventListener('unhandledrejection',e=>(window as any).missionQA.errors.push(String(e.reason)))
createRoot(document.getElementById('root')!).render(<CampClientProvider client={client as any}><CurrentUserProfileContext.Provider value={{profile:{displayName:'维护者',avatarDataUrl:null},update:async()=>{}} as any}><BusinessApp environment={environment}/></CurrentUserProfileContext.Provider></CampClientProvider>)
