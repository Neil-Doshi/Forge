const canvas=document.getElementById('canvas'),wrap=document.getElementById('canvasWrap'),work=document.getElementById('work'),rulerTop=document.getElementById('rulerTop'),rulerLeft=document.getElementById('rulerLeft'),ctx=document.getElementById('ctx'),marquee=document.getElementById('marquee'),toastEl=document.getElementById('toast');
const DEFAULT_FONT_FAMILY='Inter, Segoe UI, sans-serif';
const MAX_ASSET_BYTES=1.5*1024*1024;
const SHADOW_PRESETS=new Set(['','0 1px 3px rgba(0,0,0,0.12)','0 4px 16px rgba(0,0,0,0.15)','0 12px 40px rgba(0,0,0,0.25)','0 24px 80px rgba(0,0,0,0.45)']);
const state={project:{name:'Untitled FORGE Project',description:'',tags:[],category:'productivity',created:new Date().toISOString(),modified:new Date().toISOString()},pages:[{id:'page_home',name:'Home',width:1200,height:800,background:'#ffffff',elements:[]}],current:'page_home',selected:[],id:1,zoom:1,grid:true,snap:true,gridSize:20,history:[],future:[],drag:null,clipboard:[],preview:false,marquee:null,templates:[],assets:[],guides:{x:[],y:[]},tool:'select',inspectorTab:'style'};
const defs={
 container:{w:240,h:150,text:'Container',fill:'#f8fafc',color:'#111827',radius:8,font:16,weight:700},text:{w:220,h:50,text:'Text label',fill:'transparent',color:'#111827',radius:0,font:26,weight:800},button:{w:150,h:44,text:'Button',fill:'#ff9800',color:'#111827',radius:9,font:14,weight:800},
 image:{w:220,h:140,text:'Image',fill:'#e5e7eb',color:'#374151',radius:8,font:16,weight:700},icon:{w:64,h:64,text:'☆',fill:'#f8fafc',color:'#111827',radius:12,font:30,weight:800},shape:{w:120,h:120,text:'',fill:'#20d8ff',color:'#111827',radius:999,font:16,weight:700},
 line:{w:220,h:6,text:'',fill:'#111827',color:'#111827',radius:0,font:1,weight:400},input:{w:240,h:44,text:'Input placeholder',fill:'#ffffff',color:'#6b7280',radius:8,font:14,weight:500},textarea:{w:260,h:100,text:'Textarea',fill:'#ffffff',color:'#6b7280',radius:8,font:14,weight:500},
 dropdown:{w:220,h:44,text:'Dropdown ▼',fill:'#ffffff',color:'#111827',radius:8,font:14,weight:700},checkbox:{w:170,h:36,text:'☑ Checkbox',fill:'transparent',color:'#111827',radius:0,font:16,weight:700},radio:{w:150,h:36,text:'○ Radio',fill:'transparent',color:'#111827',radius:0,font:16,weight:700},
 toggle:{w:90,h:40,text:'ON',fill:'#20d66b',color:'#06230f',radius:999,font:14,weight:900},tabs:{w:310,h:44,text:'Tab 1   Tab 2   Tab 3',fill:'#f1f5f9',color:'#111827',radius:8,font:14,weight:800},modal:{w:360,h:220,text:'Modal Title\\n\\nContent goes here',fill:'#ffffff',color:'#111827',radius:14,font:16,weight:700},
 alert:{w:320,h:70,text:'⚠ Alert message',fill:'#fff7ed',color:'#9a3412',radius:8,font:15,weight:800},progress:{w:260,h:32,text:'70%',fill:'#e5e7eb',color:'#111827',radius:999,font:13,weight:900},table:{w:340,h:180,text:'Table\\nHeader 1 | Header 2\\nRow item | Value',fill:'#ffffff',color:'#111827',radius:8,font:14,weight:600},
 header:{w:700,h:64,text:'Header / Topbar',fill:'#111827',color:'#f8fafc',radius:0,font:18,weight:900},navbar:{w:600,h:50,text:'Home   Projects   Files   Settings',fill:'#f8fafc',color:'#111827',radius:8,font:15,weight:800},sidebar:{w:220,h:500,text:'Sidebar\\n\\nHome\\nProjects\\nTasks',fill:'#111827',color:'#f8fafc',radius:0,font:15,weight:800},
 card:{w:260,h:150,text:'Card Title\\nSupporting details',fill:'#ffffff',color:'#111827',radius:14,font:16,weight:800},footer:{w:700,h:54,text:'Footer',fill:'#111827',color:'#f8fafc',radius:0,font:15,weight:800},grid:{w:360,h:220,text:'Grid Layout',fill:'#f8fafc',color:'#111827',radius:8,font:16,weight:800}
};
const page=()=>state.pages.find(p=>p.id===state.current), els=()=>page().elements, uid=()=>'cmp_'+state.id++;
const snap=v=>state.snap?Math.round(v/state.gridSize)*state.gridSize:Math.round(v);
const selected=()=>els().filter(e=>state.selected.includes(e.id)), by=id=>els().find(e=>e.id===id);
function toast(m){toastEl.textContent=m;toastEl.style.display='block';clearTimeout(toastEl._t);toastEl._t=setTimeout(()=>toastEl.style.display='none',1400);document.getElementById('statusText').textContent=m}
function saveHist(){pushHistory('change')}
function autosave(){state.project.modified=new Date().toISOString();try{localStorage.setItem('forge-v15-project',JSON.stringify(exportProjectObject()));document.getElementById('saveStatus').textContent='Auto-saved locally'}catch(err){document.getElementById('saveStatus').textContent='Autosave storage full';console.warn('FORGE autosave failed',err)}}
function restore(s){const o=JSON.parse(s);loadProjectObject(o);state.selected=[];render()}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function safeNumber(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}
function safeColor(v,fallback='#ffffff'){const s=String(v??'').trim();if(s==='transparent')return s;if(/^#[0-9a-f]{3,8}$/i.test(s))return s;if(/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(s))return s;return fallback}
function safeBorderStyle(v){return ['solid','dashed','dotted','none'].includes(v)?v:'solid'}
function safeShadow(v){return SHADOW_PRESETS.has(v)?v:''}
function safeFontFamily(v){const allowed=[DEFAULT_FONT_FAMILY,'Georgia, serif',"'Courier New', monospace",'system-ui, sans-serif',"'Arial Black', sans-serif",'Impact, sans-serif'];return allowed.includes(v)?v:DEFAULT_FONT_FAMILY}
function safeImageDataUrl(v){const s=String(v||'');return /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)?s:''}
function assetUrl(el){const asset=(state.assets||[]).find(a=>a.id===el.assetId);return safeImageDataUrl(asset?.data||el.assetData||'')}
function clonePagesForExport(includeElementAssetData=true){return state.pages.map(pg=>({...pg,elements:(pg.elements||[]).map(el=>{const copy={...el};if(!includeElementAssetData)delete copy.assetData;return copy})}))}
function exportProjectObject(opts={}){const includeAssets=opts.includeAssets??true,includeElementAssetData=opts.includeElementAssetData??true;return{version:'1.0.0',project:state.project,settings:{grid:state.grid,snap:state.snap,gridSize:state.gridSize},theme:{colors:{background:'#05080d',panel:'#101821',accent:'#ff9800',secondaryAccent:'#20d8ff',text:'#f8fafc',muted:'#a8b3c3'}},...(includeAssets?{assets:state.assets||[]}:{}),guides:state.guides||{x:[],y:[]},pages:clonePagesForExport(includeElementAssetData),templates:state.templates,current:state.current,id:state.id}}
function loadProjectObject(d){state.project=d.project||state.project;state.pages=d.pages||state.pages;state.templates=d.templates||[];if(Array.isArray(d.assets))state.assets=d.assets;state.guides=d.guides||state.guides||{x:[],y:[]};state.current=d.current||state.pages[0].id;state.id=d.id||state.id;state.grid=d.settings?.grid??state.grid;state.snap=d.settings?.snap??state.snap}
function add(type,x=40+els().length*12,y=40+els().length*12,extra={}){const d=defs[type]||defs.container;const el={id:uid(),type,name:type+' '+state.id,parent:null,children:[],x:snap(x),y:snap(y),w:d.w,h:d.h,rotation:0,text:d.text,fill:d.fill,color:d.color,border:'#cbd5e1',borderWidth:1,borderStyle:'solid',radius:d.radius,font:d.font,fontFamily:d.fontFamily||DEFAULT_FONT_FAMILY,weight:d.weight,shadow:'',opacity:100,locked:false,hidden:false,action:'',target:'',...extra};els().push(el);state.selected=[el.id];saveHist();render();return el}
function render(){const pg=page();canvas.style.width=pg.width+'px';canvas.style.height=pg.height+'px';canvas.style.background=safeColor(pg.background,'#ffffff');canvas.innerHTML='<div class="selection-box" id="selectionBox"></div><div class="group-frame" id="groupFrame"></div>';canvas.classList.toggle('grid',state.grid);wrap.style.transform=`scale(${state.zoom})`;rulerTop.style.width=canvas.offsetWidth+'px';rulerLeft.style.height=canvas.offsetHeight+'px';document.documentElement.style.setProperty('--canvasH',canvas.offsetHeight+'px');
 els().forEach((el,i)=>{if(el.hidden)return;const n=document.createElement('div');n.className='el'+(state.selected.includes(el.id)?' selected':'')+(state.selected.length>1&&state.selected.includes(el.id)?' multi':'')+(el.locked?' locked':'');n.dataset.id=el.id;n.style.left=safeNumber(el.x)+'px';n.style.top=safeNumber(el.y)+'px';n.style.width=Math.max(12,safeNumber(el.w,12))+'px';n.style.height=Math.max(12,safeNumber(el.h,12))+'px';n.style.zIndex=i+1;n.style.opacity=Math.max(0,Math.min(100,safeNumber(el.opacity,100)))/100;n.style.transform=el.rotation?`rotate(${safeNumber(el.rotation)}deg)`:'';const c=document.createElement('div');c.className='el-content';const img=assetUrl(el);if(img){c.style.background=`url(${img}) center/cover`;c.textContent=''}else{c.style.background=safeColor(el.fill,'transparent');c.textContent=el.text||''}c.style.color=safeColor(el.color,'#111827');const borderStyle=safeBorderStyle(el.borderStyle);c.style.border=(el.fill==='transparent'||borderStyle==='none')?'0':`${Math.max(0,safeNumber(el.borderWidth,1))}px ${borderStyle} ${safeColor(el.border,'#cbd5e1')}`;c.style.borderRadius=el.radius>=999?'999px':safeNumber(el.radius)+'px';c.style.fontSize=Math.max(1,safeNumber(el.font,14))+'px';c.style.fontWeight=String(el.weight||'600');c.style.fontFamily=safeFontFamily(el.fontFamily);c.style.boxShadow=safeShadow(el.shadow);c.style.padding=el.type==='text'||el.type==='line'?'0':'8px';if(el.type==='line'){c.style.height='100%';c.style.border=0}n.appendChild(c);n.addEventListener('mousedown',startMove);n.addEventListener('dblclick',()=>inlineEditElement(n));n.addEventListener('contextmenu',openCtx);n.addEventListener('click',previewClick);if(el.groupId){const gb=document.createElement('div');gb.className='group-badge';gb.textContent='G';n.appendChild(gb)}if(state.selected.length===1&&state.selected[0]===el.id&&!state.preview&&!el.locked)addHandles(n);canvas.appendChild(n)});syncInspector();rulers();counts();renderPages();renderLayers();renderTemplates();renderAssets();renderPageManager();updateGroupFrame();renderGuides()}
function addHandles(n){['nw','n','ne','e','se','s','sw','w'].forEach(p=>{const h=document.createElement('div');h.className='handle '+p;h.dataset.handle=p;h.addEventListener('mousedown',startResize);n.appendChild(h)})}
function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/state.zoom,y:(e.clientY-r.top)/state.zoom}}
function startMove(e){if(state.preview||state.tool==='hand')return;const id=e.currentTarget.dataset.id,el=by(id);if(!el)return;if(e.shiftKey||e.ctrlKey){state.selected.includes(id)?state.selected=state.selected.filter(x=>x!==id):state.selected.push(id)}else if(!state.selected.includes(id)){ if(!selectGroupIfNeeded(id,e)) state.selected=[id]; }render();if(el.locked)return;const p=point(e);state.drag={kind:'move',start:p,orig:selected().filter(x=>!x.locked).map(x=>({id:x.id,x:x.x,y:x.y}))};e.stopPropagation()}
function startResize(e){const el=selected()[0];if(!el||el.locked)return;state.drag={kind:'resize',id:el.id,handle:e.target.dataset.handle,start:point(e),orig:{...el},ratio:el.w/el.h};e.stopPropagation();e.preventDefault()}
window.addEventListener('mousemove',e=>{const p=point(e);document.getElementById('coordX').textContent='X: '+Math.round(p.x);document.getElementById('coordY').textContent='Y: '+Math.round(p.y);document.getElementById('xyStatus').textContent='X:'+Math.round(p.x)+' Y:'+Math.round(p.y);if(state.drag?.kind==='pan'){work.scrollLeft=state.drag.scrollLeft-(e.clientX-state.drag.clientX);work.scrollTop=state.drag.scrollTop-(e.clientY-state.drag.clientY);return}if(state.marquee){updateMarquee(e);return}if(!state.drag)return;if(state.drag.kind==='move'){const dx=p.x-state.drag.start.x,dy=p.y-state.drag.start.y;state.drag.orig.forEach(o=>{const el=by(o.id);if(el){el.x=smartSnapValue(o.x+dx,'x',state.drag.orig.map(m=>m.id));el.y=smartSnapValue(o.y+dy,'y',state.drag.orig.map(m=>m.id))}});render()}else{const el=by(state.drag.id),o=state.drag.orig,dx=p.x-state.drag.start.x,dy=p.y-state.drag.start.y;let x=o.x,y=o.y,w=o.w,h=o.h,ha=state.drag.handle;if(ha.includes('e'))w=o.w+dx;if(ha.includes('s'))h=o.h+dy;if(ha.includes('w')){x=o.x+dx;w=o.w-dx}if(ha.includes('n')){y=o.y+dy;h=o.h-dy}if(e.shiftKey&&state.drag.ratio){if(['n','s'].includes(ha))w=h*state.drag.ratio;else h=w/state.drag.ratio}el.x=snap(x);el.y=snap(y);el.w=Math.max(12,snap(w));el.h=Math.max(12,snap(h));render()}})
window.addEventListener('mouseup',()=>{if(state.drag){const shouldSave=state.drag.kind!=='pan';state.drag=null;work.classList.remove('panning');hideGuides();if(shouldSave)saveHist()}if(state.marquee){state.marquee=null;marquee.style.display='none';render()}})
canvas.addEventListener('mousedown',e=>{if(e.target!==canvas||state.preview||state.tool==='hand')return;const p=point(e);state.selected=[];state.marquee={start:p,end:p};marquee.style.display='block';updateMarquee(e)})
function updateMarquee(e){const p=point(e);state.marquee.end=p;const r=marq(),cr=canvas.getBoundingClientRect();marquee.style.left=cr.left+r.x*state.zoom+'px';marquee.style.top=cr.top+r.y*state.zoom+'px';marquee.style.width=r.w*state.zoom+'px';marquee.style.height=r.h*state.zoom+'px';state.selected=els().filter(el=>r.x<el.x+el.w&&r.x+r.w>el.x&&r.y<el.y+el.h&&r.y+r.h>el.y).map(el=>el.id);render()}
function marq(){const s=state.marquee.start,e=state.marquee.end;return{x:Math.min(s.x,e.x),y:Math.min(s.y,e.y),w:Math.abs(s.x-e.x),h:Math.abs(s.y-e.y)}}
function editText(e){if(state.preview)return;const el=by(e.currentTarget.dataset.id);const t=prompt('Edit text:',el.text);if(t!==null){el.text=t;saveHist();render()}}
function previewClick(e){if(!state.preview)return;const el=by(e.currentTarget.dataset.id);if(!el||!el.action)return;if(el.action==='page'){const pg=state.pages.find(p=>p.name===el.target||p.id===el.target);if(pg){state.current=pg.id;state.selected=[];render();toast('Page: '+pg.name)}}if(el.action==='toggle'||el.action==='modal'){const t=els().find(x=>x.name===el.target||x.id===el.target);if(t){t.hidden=!t.hidden;render()}}}
function openCtx(e){e.preventDefault();if(!state.selected.includes(e.currentTarget.dataset.id))state.selected=[e.currentTarget.dataset.id];render();ctx.style.display='block';const x=Math.min(e.clientX,window.innerWidth-ctx.offsetWidth-8),y=Math.min(e.clientY,window.innerHeight-ctx.offsetHeight-8);ctx.style.left=Math.max(8,x)+'px';ctx.style.top=Math.max(8,y)+'px'}
document.addEventListener('click',e=>{if(!ctx.contains(e.target))ctx.style.display='none'})
ctx.addEventListener('click',e=>{const a=e.target.dataset.action;if(!a)return;if(a==='duplicate')duplicate();if(a==='delete')del();if(a==='front')front();if(a==='back')back();if(a==='lock'){selected().forEach(el=>el.locked=!el.locked);saveHist();render()}if(a==='hide'){selected().forEach(el=>el.hidden=!el.hidden);saveHist();render()}if(a==='copyStyle')copyStyle();if(a==='pasteStyle')pasteStyle();if(a==='nest')nestSelection();if(a==='unnest')unnestSelection();if(a==='saveTemplate')saveTemplate();ctx.style.display='none'})
function duplicate(){const c=selected().map(el=>({...el,id:uid(),x:el.x+20,y:el.y+20,name:el.name+' copy'}));els().push(...c);state.selected=c.map(x=>x.id);saveHist();render()}
function del(){page().elements=els().filter(e=>!state.selected.includes(e.id));state.selected=[];saveHist();render()}
function front(){state.selected.forEach(id=>{const i=els().findIndex(e=>e.id===id);if(i>-1)els().push(els().splice(i,1)[0])});saveHist();render()}
function back(){[...state.selected].reverse().forEach(id=>{const i=els().findIndex(e=>e.id===id);if(i>-1)els().unshift(els().splice(i,1)[0])});saveHist();render()}
function saveTemplate(){const arr=selected();if(!arr.length)return;const name=prompt('Template name:','Saved Template');if(!name)return;const minX=Math.min(...arr.map(e=>e.x)),minY=Math.min(...arr.map(e=>e.y));state.templates.push({id:'tpl_'+Date.now(),name,items:arr.map(e=>({...e,x:e.x-minX,y:e.y-minY}))});saveHist();toast('Template saved locally')}
function iconFor(type){return{container:'▢',text:'T',button:'▭',image:'▧',icon:'☆',shape:'◇',line:'─',input:'▭',textarea:'▣',dropdown:'⌄',checkbox:'☑',radio:'○',toggle:'●',tabs:'▥',modal:'▣',alert:'!',progress:'▰',table:'▦',header:'▤',navbar:'▭',sidebar:'▥',card:'▣',footer:'▱',grid:'▦'}[type]||'▢'}
function sectionAllowed(name,el){const tabGroups={style:['position','text','style'],settings:['canvas','options'],actions:['behavior']};if(name==='always')return true;if(!tabGroups[state.inspectorTab]?.includes(name))return false;if(!el)return ['canvas','options'].includes(name);if(name==='text')return !['shape','line','image'].includes(el.type);if(name==='behavior')return true;return true}
function applyInspectorVisibility(el){document.querySelectorAll('[data-inspector-section]').forEach(section=>{const name=section.dataset.inspectorSection;section.classList.toggle('hidden',!sectionAllowed(name,el))})}
function syncInspector(){const el=selected()[0],single=state.selected.length===1;document.getElementById('selectedName').textContent=single?el.type:(state.selected.length?state.selected.length+' elements':'No element selected');document.getElementById('selectedHelp').textContent=single?'Edit properties below.':'Select an element to edit.';document.getElementById('selectedIcon').textContent=single?iconFor(el.type):'▢';Object.keys(map).forEach(id=>document.getElementById(id).disabled=!single);applyInspectorVisibility(single?el:null);if(!single)return;for(const [id,k] of Object.entries(map))setVal(id,(k==='fill'||k==='color'||k==='border')?norm(el[k]):el[k])}
function norm(c){return c==='transparent'?'#000000':c}function setVal(id,v){const n=document.getElementById(id);if(document.activeElement!==n)n.value=v??''}
const map={propX:'x',propY:'y',propW:'w',propH:'h',propRotation:'rotation',propText:'text',propFont:'font',propFontFamily:'fontFamily',propWeight:'weight',propFill:'fill',propColor:'color',propRadius:'radius',propOpacity:'opacity',propShadow:'shadow',propBorderStyle:'borderStyle',propBorderColor:'border',propBorderWidth:'borderWidth',propAction:'action',propTarget:'target'};
function applyProp(e,k){const el=selected()[0];if(!el||state.selected.length!==1)return;let v=e.target.value;if(['x','y','w','h','font','radius','opacity','rotation','borderWidth'].includes(k))v=Number(v);el[k]=v;render()}
Object.entries(map).forEach(([id,k])=>{const node=document.getElementById(id);const deferred=['x','y','w','h','font','radius','opacity','rotation','borderWidth'];if(deferred.includes(k)){node.addEventListener('change',e=>{applyProp(e,k);saveHist()})}else{node.addEventListener('input',e=>applyProp(e,k));node.addEventListener('change',saveHist)}})
function rulers(){rulerTop.innerHTML='';rulerLeft.innerHTML='';for(let i=0;i<=canvas.offsetWidth;i+=100){const t=document.createElement('div');t.className='tick x';t.style.left=i+'px';t.textContent=i;rulerTop.appendChild(t)}for(let i=0;i<=canvas.offsetHeight;i+=100){const t=document.createElement('div');t.className='tick y';t.style.top=i+'px';t.textContent=i;rulerLeft.appendChild(t)}}
function counts(){document.getElementById('pageStatus').textContent='Page: '+page().name;document.getElementById('countBottom').textContent='Elements: '+els().length;document.getElementById('countStatus').textContent='Elements: '+els().length;document.getElementById('whStatus').textContent='W:'+canvas.offsetWidth+' H:'+canvas.offsetHeight}
function renderPages(){const box=document.getElementById('pagesList');box.innerHTML='';state.pages.forEach(pg=>{const row=document.createElement('div');row.className='row-item '+(pg.id===state.current?'active':'');const icon=document.createElement('span');icon.textContent='▣';const input=document.createElement('input');input.value=pg.name;input.onchange=e=>{pg.name=e.target.value;saveHist();render()};const open=document.createElement('button');open.textContent='Open';open.onclick=()=>{state.current=pg.id;state.selected=[];render()};const up=document.createElement('button');up.textContent='↑';up.onclick=()=>movePage(pg.id,-1);const down=document.createElement('button');down.textContent='↓';down.onclick=()=>movePage(pg.id,1);row.append(icon,input,open,up,down);box.appendChild(row)})}
function renderLayers(){const box=document.getElementById('layersList');box.innerHTML='';[...els()].reverse().forEach(el=>{const row=document.createElement('div');row.className='row-item layer-row-drag '+(state.selected.includes(el.id)?'active':'');const visible=document.createElement('button');visible.textContent=el.hidden?'🙈':'👁';visible.onclick=()=>{el.hidden=!el.hidden;saveHist();render()};const input=document.createElement('input');input.value=el.name;input.onchange=e=>{el.name=e.target.value;saveHist();render()};const select=document.createElement('button');select.textContent=el.locked?'🔒':'↗';select.onclick=()=>{state.selected=[el.id];render()};const up=document.createElement('button');up.textContent='↑';up.onclick=()=>reorderElement(el.id,1);const down=document.createElement('button');down.textContent='↓';down.onclick=()=>reorderElement(el.id,-1);row.append(visible,input,select,up,down);box.appendChild(row)})}
function renderPageManager(){const box=document.getElementById('pageGrid');if(!box)return;box.innerHTML='';state.pages.forEach(pg=>{const tile=document.createElement('div');tile.className='page-tile '+(pg.id===state.current?'active':'');const thumb=document.createElement('div');thumb.className='page-thumb';pg.elements.slice(0,18).forEach(el=>{if(el.hidden)return;const m=document.createElement('div');m.className='thumb-el';m.style.left=(el.x/pg.width*100)+'%';m.style.top=(el.y/pg.height*100)+'%';m.style.width=Math.max(3,el.w/pg.width*100)+'%';m.style.height=Math.max(3,el.h/pg.height*100)+'%';m.style.background=safeColor(el.fill,'#f59e0b');thumb.appendChild(m)});const nameInput=document.createElement('input');nameInput.className='page-name-input';nameInput.value=pg.name;nameInput.onchange=e=>{pg.name=e.target.value;saveHist();render()};const actions=document.createElement('div');actions.className='page-action-row';const open=document.createElement('button');open.className='mini-btn';open.textContent='Open';open.onclick=()=>{state.current=pg.id;state.selected=[];document.getElementById('pageModal').style.display='none';render()};const dup=document.createElement('button');dup.className='mini-btn';dup.textContent='Duplicate';dup.onclick=()=>duplicatePageById(pg.id);const delBtn=document.createElement('button');delBtn.className='mini-btn';delBtn.textContent='Delete';delBtn.onclick=()=>{if(state.pages.length<2)return toast('Need one page');state.pages=state.pages.filter(p=>p.id!==pg.id);state.current=state.pages[0].id;saveHist();render()};actions.append(open,dup,delBtn);tile.append(thumb,nameInput,actions);box.appendChild(tile)})}
document.querySelectorAll('.comp').forEach(b=>b.onclick=()=>add(b.dataset.type));
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.side-panel').forEach(p=>p.classList.remove('active'));document.getElementById(btn.dataset.panel+'Panel').classList.add('active')})
document.querySelectorAll('[data-inspector-tab]').forEach(btn=>btn.onclick=()=>{state.inspectorTab=btn.dataset.inspectorTab;document.querySelectorAll('[data-inspector-tab]').forEach(b=>b.classList.toggle('active',b===btn));syncInspector()})
document.getElementById('search').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('.comp,.template-row').forEach(b=>b.style.display=b.textContent.toLowerCase().includes(q)?'':'none')}
document.getElementById('addPageBtn').onclick=()=>{state.pages.push({id:'page_'+Date.now(),name:'Page '+(state.pages.length+1),width:1200,height:800,background:'#ffffff',elements:[]});state.current=state.pages.at(-1).id;saveHist();render()}
document.querySelectorAll('[data-blueprint]').forEach(b=>b.onclick=()=>loadBlueprint(b.dataset.blueprint))
function clearPage(){page().elements=[];state.selected=[]}
function loadBlueprint(name){if(name!=='blank'&&!confirm('Replace current page with blueprint?'))return;clearPage();const addAt=(type,x,y,extra={})=>add(type,x,y,extra);if(name==='blank'){}if(name==='dashboard'){addAt('header',40,40,{w:1000,text:'Dashboard | Search | Profile'});addAt('sidebar',40,120);addAt('card',300,140,{text:'Projects\\n12'});addAt('card',590,140,{text:'Tasks\\n38'});addAt('card',880,140,{text:'Files\\n104'});addAt('table',300,340,{w:760,h:250})}if(name==='project'){addAt('header',40,40,{w:1000,text:'FOCUS | Project Home | + New'});addAt('sidebar',40,120);addAt('card',300,150,{w:260,text:'Current Project\\nFORGE Builder'});addAt('card',590,150,{w:260,text:'Active Projects\\n3'});addAt('card',880,150,{w:260,text:'Archived\\n12'});addAt('table',300,360,{w:840,h:250})}if(name==='task'){['Backlog','Active','Done'].forEach((t,i)=>{addAt('container',60+i*360,80,{w:320,h:560,text:t});addAt('card',85+i*360,160,{w:270,h:110,text:'Task card\\nShort description'});addAt('card',85+i*360,300,{w:270,h:110,text:'Task card\\nShort description'})})}if(name==='knowledge'){addAt('header',40,40,{w:1000,text:'Knowledge Base | Search'});addAt('input',300,130,{w:700,text:'Search documents'});addAt('sidebar',40,130,{text:'Categories\\n\\nPLC\\nHMI\\nProjects\\nNotes'});addAt('card',300,200,{w:740,h:400,text:'Document Viewer\\n\\nSelect a topic from the left.'})}if(name==='files'){addAt('header',40,40,{w:1000,text:'File Explorer | Add File'});addAt('sidebar',40,120,{text:'Folders\\n\\nProject A\\nProject B\\nArchive'});addAt('table',300,130,{w:520,h:420,text:'Files\\nName | Tag | Updated\\nFDS.pdf | WPU-001 | Today'});addAt('card',850,130,{w:260,h:420,text:'Preview Panel'})}if(name==='settings'){addAt('header',40,40,{w:1000,text:'Settings'});addAt('sidebar',40,120,{text:'Settings\\n\\nProfile\\nTheme\\nExport\\nShortcuts'});addAt('card',300,150,{w:680,h:120,text:'Profile Settings'});addAt('toggle',850,190);addAt('card',300,310,{w:680,h:120,text:'Autosave'});addAt('button',300,480,{text:'Save Settings'})}if(name==='form'){addAt('card',380,130,{w:420,h:420,text:'New Project Form'});addAt('tabs',430,200,{w:320,text:'1 Details   2 Files   3 Review'});addAt('input',430,260,{w:320,text:'Project name'});addAt('textarea',430,320,{w:320,text:'Description'});addAt('button',590,465,{text:'Next'})}state.selected=[];saveHist();render()}
function align(a){const arr=selected();if(arr.length<2)return;if(['distH','distV'].includes(a)&&arr.length<3){toast('Select 3+ elements to distribute');return}const minX=Math.min(...arr.map(e=>e.x)),maxX=Math.max(...arr.map(e=>e.x+e.w)),minY=Math.min(...arr.map(e=>e.y)),maxY=Math.max(...arr.map(e=>e.y+e.h));arr.forEach(e=>{if(a==='left')e.x=minX;if(a==='right')e.x=maxX-e.w;if(a==='center')e.x=minX+(maxX-minX-e.w)/2;if(a==='top')e.y=minY;if(a==='bottom')e.y=maxY-e.h;if(a==='middle')e.y=minY+(maxY-minY-e.h)/2});if(a==='distH'){const sorted=[...arr].sort((a,b)=>a.x-b.x),totalW=sorted.reduce((s,e)=>s+e.w,0),gap=(maxX-minX-totalW)/(sorted.length-1);let cursor=minX;sorted.forEach(e=>{e.x=Math.round(cursor);cursor+=e.w+gap})}if(a==='distV'){const sorted=[...arr].sort((a,b)=>a.y-b.y),totalH=sorted.reduce((s,e)=>s+e.h,0),gap=(maxY-minY-totalH)/(sorted.length-1);let cursor=minY;sorted.forEach(e=>{e.y=Math.round(cursor);cursor+=e.h+gap})}saveHist();render()}
document.querySelectorAll('[data-align]').forEach(b=>b.onclick=()=>align(b.dataset.align));
document.getElementById('gridBtn').onclick=()=>{state.grid=!state.grid;document.getElementById('gridBtn').classList.toggle('on',state.grid);document.getElementById('gridSwitch').classList.toggle('on',state.grid);render()}
document.getElementById('snapBtn').onclick=()=>{state.snap=!state.snap;document.getElementById('snapBtn').classList.toggle('on',state.snap);document.getElementById('snapSwitch').classList.toggle('on',state.snap)}
document.getElementById('previewBtn').onclick=()=>{state.preview=!state.preview;document.getElementById('previewBtn').classList.toggle('active',state.preview);state.selected=[];render();toast(state.preview?'Preview mode':'Editor mode')}
document.getElementById('zoomIn').onclick=()=>setZoom(state.zoom+.1);document.getElementById('zoomOut').onclick=()=>setZoom(state.zoom-.1);function setZoom(z){state.zoom=Math.max(.25,Math.min(2,z));document.getElementById('zoomLabel').textContent=Math.round(state.zoom*100)+'%';render()}
document.getElementById('fitBtn').onclick=()=>{const z=Math.min((work.clientWidth-120)/canvas.offsetWidth,(work.clientHeight-140)/canvas.offsetHeight);setZoom(z)}
function setTool(tool){state.tool=tool;document.querySelectorAll('.tool-square').forEach(btn=>btn.classList.remove('active'));document.getElementById(tool==='hand'?'toolHand':'toolSelect').classList.add('active');work.classList.toggle('pan-mode',tool==='hand')}
document.getElementById('toolSelect').onclick=()=>setTool('select');
document.getElementById('toolHand').onclick=()=>setTool('hand');
document.getElementById('toolFit').onclick=()=>document.getElementById('fitBtn').click();
document.getElementById('toolFrame').onclick=()=>add('container',80+els().length*10,80+els().length*10,{name:'Frame '+state.id,text:'Frame',fill:'transparent',border:'#20d8ff',borderStyle:'dashed',borderWidth:2,w:320,h:220});
work.addEventListener('mousedown',e=>{if(state.tool!=='hand'||state.preview||e.target.closest('.bottom-tools'))return;state.drag={kind:'pan',clientX:e.clientX,clientY:e.clientY,scrollLeft:work.scrollLeft,scrollTop:work.scrollTop};work.classList.add('panning');e.preventDefault()})
function setDevice(v){const pg=page();if(v==='free')return;if(v==='desktop'){pg.width=1200;pg.height=800}else if(v==='tablet'){pg.width=768;pg.height=900}else if(v==='mobile'){pg.width=375;pg.height=812}document.getElementById('canvasW').value=pg.width;document.getElementById('canvasH').value=pg.height;document.getElementById('device').value=v;document.getElementById('canvasSize').value=v;saveHist();render()}
document.getElementById('device').onchange=e=>setDevice(e.target.value);document.getElementById('canvasSize').onchange=e=>setDevice(e.target.value);
document.getElementById('canvasBg').oninput=e=>{page().background=e.target.value;autosave();render()};document.getElementById('canvasW').onchange=e=>{page().width=Number(e.target.value);saveHist();render()};document.getElementById('canvasH').onchange=e=>{page().height=Number(e.target.value);saveHist();render()}
document.getElementById('undoBtn').onclick=()=>{if(state.history.length){state.future.push(JSON.stringify(deepCloneProject()));restore(state.history.pop())}};document.getElementById('redoBtn').onclick=()=>{if(state.future.length){state.history.push(JSON.stringify(deepCloneProject()));restore(state.future.pop())}}
document.getElementById('clearBtn').onclick=()=>{if(confirm('Clear current page?')){clearPage();saveHist();render()}}
document.getElementById('pagesBtn').onclick=()=>{renderPageManager();document.getElementById('pageModal').style.display='flex'};document.getElementById('blueprintsBtn').onclick=()=>{document.querySelector('[data-panel="blueprints"]').click()}
document.getElementById('pmCloseBtn').onclick=()=>document.getElementById('pageModal').style.display='none';document.getElementById('pmDupBtn').onclick=duplicateCurrentPage;document.getElementById('pmDelBtn').onclick=deleteCurrentPage;document.getElementById('pmAddBtn').onclick=()=>{state.pages.push({id:'page_'+Date.now(),name:'Page '+(state.pages.length+1),width:1200,height:800,background:'#ffffff',elements:[]});state.current=state.pages.at(-1).id;saveHist();render()}
document.getElementById('homeBtn').onclick=()=>document.getElementById('homeModal').style.display='flex';document.getElementById('homeCloseBtn').onclick=()=>document.getElementById('homeModal').style.display='none';
document.getElementById('exportJsonBtn').onclick=()=>download('forge-project.forge.json',JSON.stringify(exportProjectObject(),null,2),'application/json')
document.getElementById('importBtn').onclick=()=>document.getElementById('fileInput').click();document.getElementById('fileInput').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{safeLoadProject(r.result)}catch(err){alert('Import failed: '+err.message)}};r.readAsText(f)}
document.getElementById('exportHtmlBtn').onclick=()=>download('forge-prototype.html',exportHtml(),'text/html');document.getElementById('codeBtn').onclick=()=>{document.getElementById('codeArea').value=exportHtml();document.getElementById('codeModal').style.display='flex'};document.getElementById('closeCodeBtn').onclick=()=>document.getElementById('codeModal').style.display='none';document.getElementById('copyCodeBtn').onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById('codeArea').value);toast('Code copied')}catch{}}
function exportHtml(){
  const css='html,body{margin:0;min-height:100%;background:#111827;font-family:Inter,Segoe UI,system-ui,sans-serif}.page{position:relative;margin:40px auto;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.28)}.proto-el{position:absolute;display:flex;align-items:center;justify-content:center;white-space:pre-wrap;word-break:break-word;box-sizing:border-box;overflow:hidden}.proto-el[data-action]{cursor:pointer}';
  const elHtml=el=>{
    const img=assetUrl(el);
    const borderStyle=safeBorderStyle(el.borderStyle);
    const bg=img?`url(${img}) center/cover`:safeColor(el.fill,'transparent');
    const border=(el.fill==='transparent'||borderStyle==='none')?'0':`${Math.max(0,safeNumber(el.borderWidth,1))}px ${borderStyle} ${safeColor(el.border,'#cbd5e1')}`;
    const style=[
      `left:${safeNumber(el.x)}px`,`top:${safeNumber(el.y)}px`,`width:${Math.max(1,safeNumber(el.w,1))}px`,`height:${Math.max(1,safeNumber(el.h,1))}px`,
      `background:${bg}`,`color:${safeColor(el.color,'#111827')}`,`border-radius:${el.radius>=999?'999px':safeNumber(el.radius)+'px'}`,
      `font-size:${Math.max(1,safeNumber(el.font,14))}px`,`font-weight:${String(el.weight||'600')}`,`font-family:${safeFontFamily(el.fontFamily)}`,
      `opacity:${Math.max(0,Math.min(100,safeNumber(el.opacity,100)))/100}`,`border:${border}`,`box-shadow:${safeShadow(el.shadow)}`,
      `transform:${el.rotation?`rotate(${safeNumber(el.rotation)}deg)`:''}`,'transform-origin:center center',`padding:${el.type==='text'||el.type==='line'?'0':'8px'}`
    ].join(';');
    return `<div class="proto-el" data-name="${esc(el.name)}" data-action="${esc(el.action||'')}" data-target="${esc(el.target||'')}" style="${style}">${img?'':esc(el.text)}</div>`;
  };
  const pages=state.pages.map(pg=>`<section class="page" data-page="${esc(pg.name)}" data-page-id="${esc(pg.id)}" style="display:${pg.id===state.current?'block':'none'};width:${safeNumber(pg.width,1200)}px;height:${safeNumber(pg.height,800)}px;background:${safeColor(pg.background,'#ffffff')}">${pg.elements.filter(e=>!e.hidden).map(elHtml).join('')}</section>`).join('');
  const js=`document.addEventListener('click',function(e){var el=e.target.closest('[data-action]');if(!el)return;var a=el.dataset.action,t=el.dataset.target;if(a==='page'){document.querySelectorAll('.page').forEach(function(p){p.style.display=(p.dataset.page===t||p.dataset.pageId===t)?'block':'none'})}if(a==='toggle'||a==='modal'){var target=Array.prototype.slice.call(document.querySelectorAll('[data-name]')).find(function(x){return x.dataset.name===t||x.textContent.indexOf(t)>-1});if(target)target.style.display=target.style.display==='none'?'flex':'none'}});`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(state.project.name||'FORGE Prototype')}</title><style>${css}</style></head><body>${pages}<script>${js}<\/script></body></html>`;
}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
window.addEventListener('keydown',e=>{if(e.key==='Escape'){state.selected=[];ctx.style.display='none';if(state.preview){state.preview=false;document.getElementById('previewBtn').classList.remove('active');toast('Editor mode')}render();return}if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if(e.key==='Delete')del();if(e.ctrlKey&&e.key.toLowerCase()==='a'){e.preventDefault();state.selected=els().map(e=>e.id);render()}if(e.ctrlKey&&e.key.toLowerCase()==='p'){e.preventDefault();document.getElementById('previewBtn').click();return}if(e.ctrlKey&&e.altKey&&e.key.toLowerCase()==='c'){e.preventDefault();copyStyle();return}if(e.ctrlKey&&e.key.toLowerCase()==='c'){state.clipboard=selected().map(el=>({...el}));try{localStorage.setItem('forge-v15-clipboard',JSON.stringify(state.clipboard))}catch(err){console.warn('Clipboard persistence failed',err)}}if(e.ctrlKey&&e.altKey&&e.key.toLowerCase()==='v'){e.preventDefault();pasteStyle();return}if(e.ctrlKey&&e.key.toLowerCase()==='v'&&state.clipboard.length){const c=state.clipboard.map(el=>({...el,id:uid(),x:el.x+20,y:el.y+20}));els().push(...c);state.selected=c.map(x=>x.id);saveHist();render()}if(e.ctrlKey&&e.key.toLowerCase()==='g'){e.preventDefault();groupSelection()}if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='g'){e.preventDefault();ungroupSelection()}if(e.ctrlKey&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate()}if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();document.getElementById('undoBtn').click()}if(e.ctrlKey&&e.key.toLowerCase()==='y'){e.preventDefault();document.getElementById('redoBtn').click()}if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){const arr=selected();if(!arr.length)return;const step=e.altKey?1:(e.shiftKey?10:(state.snap?state.gridSize:1));arr.forEach(el=>{if(el.locked)return;if(e.key==='ArrowUp')el.y-=step;if(e.key==='ArrowDown')el.y+=step;if(e.key==='ArrowLeft')el.x-=step;if(e.key==='ArrowRight')el.x+=step});render();clearTimeout(state.arrowHistoryTimer);state.arrowHistoryTimer=setTimeout(()=>saveHist(),180)}})
work.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();setZoom(state.zoom+(e.deltaY<0?.08:-.08))},{passive:false})
work.addEventListener('scroll',()=>renderGuides())



// ===== V13 hardening systems =====

function deepCloneProject(){
  return exportProjectObject({includeAssets:false,includeElementAssetData:false});
}
function pushHistory(reason='change'){
  state.project.modified = new Date().toISOString();
  state.history.push(JSON.stringify(deepCloneProject()));
  const latest=state.history[state.history.length-1];
  if(latest.length>500000) console.warn('FORGE history snapshot exceeds 500 KB:', reason);
  if(state.history.length>50) state.history.shift();
  state.future=[];
  autosave();
}
function migrateProject(){
  state.pages.forEach(pg=>{
    pg.width = Number(pg.width || 1200);
    pg.height = Number(pg.height || 800);
    pg.background = pg.background || '#ffffff';
    pg.elements = pg.elements || [];
    pg.elements.forEach(el=>{
      el.name = el.name || `${el.type || 'element'} ${el.id}`;
      el.children = el.children || [];
      el.parent = el.parent || null;
      el.x = Number(el.x ?? 0);
      el.y = Number(el.y ?? 0);
      el.w = Math.max(1,Number(el.w ?? 120));
      el.h = Math.max(1,Number(el.h ?? 40));
      el.fill = safeColor(el.fill || 'transparent','transparent');
      el.color = safeColor(el.color || '#111827','#111827');
      el.opacity = Number(el.opacity ?? 100);
      el.radius = Number(el.radius ?? 0);
      el.font = Number(el.font ?? 14);
      el.fontFamily = safeFontFamily(el.fontFamily);
      el.weight = String(el.weight ?? '600');
      el.rotation = Number(el.rotation ?? 0);
      el.shadow = safeShadow(el.shadow || '');
      el.border = safeColor(el.border || '#cbd5e1','#cbd5e1');
      el.borderWidth = Number(el.borderWidth ?? 1);
      el.borderStyle = safeBorderStyle(el.borderStyle || 'solid');
      el.locked = !!el.locked;
      el.hidden = !!el.hidden;
      el.action = el.action || '';
      el.target = el.target || '';
    });
  });
  state.guides = state.guides || {x:[],y:[]};
  state.guides.x = Array.isArray(state.guides.x) ? state.guides.x.map(v=>Math.round(Number(v))).filter(Number.isFinite) : [];
  state.guides.y = Array.isArray(state.guides.y) ? state.guides.y.map(v=>Math.round(Number(v))).filter(Number.isFinite) : [];
}
function validateImportObject(d){
  if(!d || typeof d !== 'object') throw new Error('Invalid JSON');
  if(!Array.isArray(d.pages)) throw new Error('Missing pages array');
  d.pages.forEach(pg=>{
    if(!pg.id || !pg.name) throw new Error('Invalid page object');
    if(!Array.isArray(pg.elements)) pg.elements=[];
  });
  return true;
}
function getGroupBounds(ids=state.selected){
  const arr=els().filter(el=>ids.includes(el.id));
  if(!arr.length) return null;
  const x=Math.min(...arr.map(e=>e.x));
  const y=Math.min(...arr.map(e=>e.y));
  const r=Math.max(...arr.map(e=>e.x+e.w));
  const b=Math.max(...arr.map(e=>e.y+e.h));
  return {x,y,w:r-x,h:b-y};
}
function updateGroupFrame(){
  if(!document.getElementById('groupFrame')) return;
  if(state.selected.length<2){ document.getElementById('groupFrame').style.display='none'; return; }
  const b=getGroupBounds();
  if(!b){ document.getElementById('groupFrame').style.display='none'; return; }
  document.getElementById('groupFrame').style.display='block';
  document.getElementById('groupFrame').style.left=b.x+'px';
  document.getElementById('groupFrame').style.top=b.y+'px';
  document.getElementById('groupFrame').style.width=b.w+'px';
  document.getElementById('groupFrame').style.height=b.h+'px';
}
function applyTheme(theme){
  const themes={
    forge:{bg:'#ffffff',fill:'#ffffff',accent:'#ff9800',text:'#111827'},
    slate:{bg:'#0f172a',fill:'#1e293b',accent:'#38bdf8',text:'#f8fafc'},
    light:{bg:'#f8fafc',fill:'#ffffff',accent:'#2563eb',text:'#0f172a'},
    terminal:{bg:'#020617',fill:'#052e16',accent:'#22c55e',text:'#dcfce7'}
  };
  const t=themes[theme]; if(!t) return;
  page().background=t.bg;
  selected().forEach(el=>{
    if(el.type==='button'||el.type==='toggle'||el.type==='chip') el.fill=t.accent;
    else if(el.fill !== 'transparent') el.fill=t.fill;
    el.color=t.text;
  });
  pushHistory('theme'); render(); toast('Theme applied');
}
document.querySelectorAll('[data-theme]').forEach(t=>t.onclick=()=>applyTheme(t.dataset.theme));

function duplicatePageById(id){
  const pg=state.pages.find(p=>p.id===id);
  if(!pg) return;
  const copy=JSON.parse(JSON.stringify(pg));
  copy.id='page_'+Date.now();
  copy.name=pg.name+' copy';
  copy.elements.forEach(el=>el.id=uid());
  state.pages.push(copy);
  state.current=copy.id;
  pushHistory('duplicate page'); render(); toast('Page duplicated');
}
function movePage(id, dir){
  const i=state.pages.findIndex(p=>p.id===id);
  const j=i+dir;
  if(i<0||j<0||j>=state.pages.length) return;
  [state.pages[i],state.pages[j]]=[state.pages[j],state.pages[i]];
  pushHistory('move page'); render();
}
function safeLoadProject(raw){
  const d=JSON.parse(raw);
  validateImportObject(d);
  loadProjectObject(d);
  migrateProject();
  state.selected=[];
  pushHistory('import');
  render();
  toast('Project imported');
}

function createNewProject(){
  if(!confirm('Start a new blank project? Export JSON first if needed.')) return;
  state.project={name:'Untitled FORGE Project',description:'',tags:[],category:'productivity',created:new Date().toISOString(),modified:new Date().toISOString()};
  state.pages=[{id:'page_home',name:'Home',width:1200,height:800,background:'#ffffff',elements:[]}];
  state.current='page_home';
  state.selected=[];
  state.templates=[];
  state.assets=[];
  state.guides={x:[],y:[]};
  state.id=1;
  pushHistory('new project'); render(); toast('New project');
}

// ===== V12 iteration systems =====
const guideV = document.getElementById('guideV');
const guideH = document.getElementById('guideH');

function showGuide(axis, clientPos){
  if(axis==='x'){ guideV.style.display='block'; guideV.style.left=clientPos+'px'; }
  if(axis==='y'){ guideH.style.display='block'; guideH.style.top=clientPos+'px'; }
}
function hideGuides(){ guideV.style.display='none'; guideH.style.display='none'; }
function renderGuides(){
  document.querySelectorAll('.pguide').forEach(g=>g.remove());
  const cr=canvas.getBoundingClientRect();
  (state.guides?.x||[]).forEach(x=>{
    const g=document.createElement('div');
    g.className='guide v pguide';
    g.style.left=(cr.left+x*state.zoom)+'px';
    g.style.display='block';
    g.addEventListener('dblclick',()=>{state.guides.x=state.guides.x.filter(v=>v!==x);renderGuides();saveHist()});
    document.body.appendChild(g);
  });
  (state.guides?.y||[]).forEach(y=>{
    const g=document.createElement('div');
    g.className='guide h pguide';
    g.style.top=(cr.top+y*state.zoom)+'px';
    g.style.display='block';
    g.addEventListener('dblclick',()=>{state.guides.y=state.guides.y.filter(v=>v!==y);renderGuides();saveHist()});
    document.body.appendChild(g);
  });
}
rulerTop.addEventListener('click',e=>{const rect=rulerTop.getBoundingClientRect();state.guides.x.push(Math.round((e.clientX-rect.left)/state.zoom));renderGuides();saveHist()});
rulerLeft.addEventListener('click',e=>{const rect=rulerLeft.getBoundingClientRect();state.guides.y.push(Math.round((e.clientY-rect.top)/state.zoom));renderGuides();saveHist()});

function inlineEditElement(node){
  if(state.preview) return;
  const el = by(node.dataset.id);
  if(!el) return;
  const r = node.getBoundingClientRect();
  const ed = document.createElement('div');
  ed.className='inline-editor';
  ed.contentEditable='true';
  ed.textContent=el.text;
  ed.style.left=r.left+'px';
  ed.style.top=r.top+'px';
  ed.style.width=Math.max(120,r.width)+'px';
  ed.style.minHeight=Math.max(42,r.height)+'px';
  document.body.appendChild(ed);
  ed.focus();
  const range=document.createRange();
  range.selectNodeContents(ed);
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  let done=false;
  function finish(save=true){
    if(done) return; done=true;
    if(save){ el.text = ed.innerText; saveHist(); }
    ed.remove(); render();
  }
  ed.addEventListener('keydown',ev=>{
    if(ev.key==='Escape'){ev.preventDefault();finish(false)}
    if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();finish(true)}
  });
  ed.addEventListener('blur',()=>finish(true));
}

function currentPageHtml(){
  const pg=page();
  const body=pg.elements.filter(e=>!e.hidden).map(el=>{
    const img=assetUrl(el),borderStyle=safeBorderStyle(el.borderStyle);
    const bg=img?`url(${img}) center/cover`:safeColor(el.fill,'transparent');
    const border=(el.fill==='transparent'||borderStyle==='none')?'0':`${Math.max(0,safeNumber(el.borderWidth,1))}px ${borderStyle} ${safeColor(el.border,'#cbd5e1')}`;
    return `<div style="position:absolute;left:${safeNumber(el.x)}px;top:${safeNumber(el.y)}px;width:${Math.max(1,safeNumber(el.w,1))}px;height:${Math.max(1,safeNumber(el.h,1))}px;display:flex;align-items:center;justify-content:center;background:${bg};color:${safeColor(el.color,'#111827')};border-radius:${el.radius>=999?'999px':safeNumber(el.radius)+'px'};font-size:${Math.max(1,safeNumber(el.font,14))}px;font-family:${safeFontFamily(el.fontFamily)};font-weight:${String(el.weight||'600')};opacity:${Math.max(0,Math.min(100,safeNumber(el.opacity,100)))/100};border:${border};box-shadow:${safeShadow(el.shadow)};transform:${el.rotation?`rotate(${safeNumber(el.rotation)}deg)`:''};transform-origin:center center;white-space:pre-wrap;padding:${el.type==='text'||el.type==='line'?'0':'8px'};box-sizing:border-box;overflow:hidden">${img?'':esc(el.text)}</div>`;
  }).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(pg.name)}</title></head><body style="margin:0;background:#111827;font-family:Inter,Segoe UI,system-ui,sans-serif"><section style="position:relative;width:${safeNumber(pg.width,1200)}px;height:${safeNumber(pg.height,800)}px;margin:40px auto;background:${safeColor(pg.background,'#ffffff')};overflow:hidden">${body}</section></body></html>`;
}

document.getElementById('exportManagerBtn').onclick=()=>document.getElementById('exportModal').style.display='flex';
document.getElementById('exportCloseBtn').onclick=()=>document.getElementById('exportModal').style.display='none';
document.getElementById('exportProjectCard').onclick=()=>document.getElementById('exportJsonBtn').click();
document.getElementById('exportHtmlCard').onclick=()=>document.getElementById('exportHtmlBtn').click();
document.getElementById('exportBundleCard').onclick=exportRealZip;
document.getElementById('exportPageCard').onclick=()=>download('forge-current-page.html', currentPageHtml(), 'text/html');

function duplicateCurrentPage(){
  const pg=page();
  const copy={id:'page_'+Date.now(),name:pg.name+' copy',width:pg.width,height:pg.height,background:pg.background,elements:pg.elements.map(el=>({...el,id:uid(),name:el.name}))};
  state.pages.push(copy);
  state.current=copy.id;
  saveHist(); render(); toast('Page duplicated');
}
function deleteCurrentPage(){
  if(state.pages.length<2){toast('Need at least one page'); return;}
  if(!confirm('Delete current page?')) return;
  state.pages=state.pages.filter(p=>p.id!==state.current);
  state.current=state.pages[0].id;
  state.selected=[];
  saveHist(); render(); toast('Page deleted');
}

function reorderElement(id, direction){
  const arr=els();
  const i=arr.findIndex(e=>e.id===id);
  if(i<0) return;
  const j=i+direction;
  if(j<0 || j>=arr.length) return;
  [arr[i],arr[j]]=[arr[j],arr[i]];
  saveHist(); render();
}

function addNewPageFromBlueprint(name){
  state.pages.push({id:'page_'+Date.now(),name:'New '+name,width:1200,height:800,background:'#ffffff',elements:[]});
  state.current=state.pages.at(-1).id;
  loadBlueprint(name);
  toast('New page from blueprint');
}


// ===== V11 completion systems =====
const dropLine = document.getElementById('dropLine');

function groupSelection(){
  const arr = selected();
  if(arr.length < 2){ toast('Select 2+ elements to group'); return; }
  const gid = 'grp_' + Date.now();
  arr.forEach(el => el.groupId = gid);
  saveHist(); render(); toast('Grouped');
}
function ungroupSelection(){
  selected().forEach(el => delete el.groupId);
  saveHist(); render(); toast('Ungrouped');
}
document.getElementById('groupBtn').onclick = groupSelection;
document.getElementById('ungroupBtn').onclick = ungroupSelection;

function selectGroupIfNeeded(id, event){
  const el = by(id);
  if(!el || !el.groupId || event.shiftKey || event.ctrlKey) return false;
  const members = els().filter(x => x.groupId === el.groupId).map(x => x.id);
  state.selected = members;
  return true;
}

function renderTemplates(){
  const box = document.getElementById('templatesList');
  if(!box) return;
  box.innerHTML = '';
  if(!state.templates.length){
    box.innerHTML = '<div style="color:var(--muted);font-size:12px">No saved templates yet.</div>';
    return;
  }
  state.templates.forEach(tpl=>{
    const row=document.createElement('div');
    row.className='row-item';
    const icon=document.createElement('span');icon.textContent='▧';
    const input=document.createElement('input');input.value=tpl.name;input.onchange=e=>{tpl.name=e.target.value;saveHist();renderTemplates();};
    const insert=document.createElement('button');insert.textContent='Insert';insert.onclick=()=>insertTemplate(tpl.id);
    row.append(icon,input,insert);
    box.appendChild(row);
  });
}
function insertTemplate(id){
  const tpl = state.templates.find(t=>t.id===id);
  if(!tpl) return;
  const baseX = 80 + els().length*8, baseY = 80 + els().length*8;
  const inserted = tpl.items.map(item=>({...item,id:uid(),x:baseX+item.x,y:baseY+item.y,name:item.name+' copy'}));
  els().push(...inserted);
  state.selected = inserted.map(x=>x.id);
  saveHist(); render(); toast('Template inserted');
}
document.getElementById('saveTemplateBtn').onclick = saveTemplate;

function applyColorToSelection(color){
  const arr=selected();
  if(arr.length){ arr.forEach(el=>el.fill=color); saveHist(); render(); }
  else { page().background=color; saveHist(); render(); }
}
document.querySelectorAll('[data-color]').forEach(chip=>chip.onclick=()=>applyColorToSelection(chip.dataset.color));

function smartSnapValue(value, axis, movingIds){
  if(!state.snap) return value;
  const threshold = 6;
  const guides = [];
  els().forEach(el=>{
    if(movingIds.includes(el.id)) return;
    if(axis==='x') guides.push(el.x, el.x+el.w, el.x+el.w/2);
    else guides.push(el.y, el.y+el.h, el.y+el.h/2);
  });
  for(const g of guides){
    if(Math.abs(value-g) <= threshold){
      const cr=canvas.getBoundingClientRect();
      if(axis==='x') showGuide('x', cr.left + g*state.zoom);
      if(axis==='y') showGuide('y', cr.top + g*state.zoom);
      return g;
    }
  }
  return snap(value);
}

function copyStyle(){
  const el=selected()[0];
  if(!el) return;
  state.styleClip = {
    fill:el.fill,color:el.color,border:el.border,borderWidth:el.borderWidth,
    borderStyle:el.borderStyle,radius:el.radius,font:el.font,fontFamily:el.fontFamily,
    weight:el.weight,opacity:el.opacity,shadow:el.shadow
  };
  toast('Style copied');
}
function pasteStyle(){
  if(!state.styleClip) return;
  selected().forEach(el=>Object.assign(el,state.styleClip));
  saveHist(); render(); toast('Style pasted');
}

document.getElementById('shortcutsBtn').onclick=()=>document.getElementById('shortcutModal').style.display='flex';
document.getElementById('shortcutCloseBtn').onclick=()=>document.getElementById('shortcutModal').style.display='none';

document.getElementById('newProjectBtn').onclick=createNewProject;
document.getElementById('projectBtn').onclick=()=>{
  document.getElementById('projectNameInput').value=state.project.name||'';
  document.getElementById('projectDescriptionInput').value=state.project.description||'';
  document.getElementById('projectTagsInput').value=(state.project.tags||[]).join(', ');
  document.getElementById('projectModal').style.display='flex';
};
document.getElementById('projectCloseBtn').onclick=()=>document.getElementById('projectModal').style.display='none';
document.getElementById('projectSaveBtn').onclick=()=>{
  state.project.name=document.getElementById('projectNameInput').value||'Untitled FORGE Project';
  state.project.description=document.getElementById('projectDescriptionInput').value||'';
  state.project.tags=document.getElementById('projectTagsInput').value.split(',').map(x=>x.trim()).filter(Boolean);
  saveHist();
  document.getElementById('projectModal').style.display='none';
  toast('Project metadata saved');
};

// Extend home panel with local-only reminder
setTimeout(()=> {
  const home = document.querySelector('#homeModal .modal-body');
  if(home && !document.getElementById('localOnlyNote')){
    const note=document.createElement('div');
    note.id='localOnlyNote';
    note.style.cssText='margin-top:16px;padding:12px;border:1px solid var(--line);border-radius:10px;color:var(--muted);background:rgba(255,255,255,.035)';
    note.textContent='Local-only rule: no login, no cloud save, no GitHub save. Export .forge.json for backup.';
    home.appendChild(note);
  }
}, 200);



// ===== V15 final MVP systems =====
function renderAssets(){
  const box=document.getElementById('assetsList'); if(!box) return;
  box.innerHTML='';
  if(!state.assets.length){box.innerHTML='<div class="nest-hint">No local image assets uploaded.</div>';return;}
  state.assets.forEach(asset=>{
    const row=document.createElement('div'); row.className='asset-row';
    const preview=document.createElement('div');preview.className='asset-preview';preview.style.backgroundImage=`url(${safeImageDataUrl(asset.data)})`;
    const meta=document.createElement('div');const name=document.createElement('b');name.textContent=asset.name;const hint=document.createElement('span');hint.style.color='var(--muted)';hint.textContent='Local embedded image';meta.append(name,document.createElement('br'),hint);
    const addBtn=document.createElement('button');addBtn.textContent='Add';addBtn.onclick=()=>add('image',80+els().length*10,80+els().length*10,{text:'',assetId:asset.id,fill:'#ffffff'});
    row.append(preview,meta,addBtn);
    box.appendChild(row);
  });
}
document.getElementById('uploadAssetBtn').onclick=()=>document.getElementById('assetFileInput').click();
document.getElementById('assetFileInput').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  if(f.size>MAX_ASSET_BYTES){toast('Image must be under 1.5 MB');e.target.value='';return}
  if(f.type==='image/svg+xml'){toast('SVG uploads are blocked for safety');e.target.value='';return}
  const r=new FileReader();
  r.onload=()=>{state.assets.push({id:'asset_'+Date.now(),name:f.name,data:r.result});saveHist();renderAssets();toast('Asset added locally')};
  r.readAsDataURL(f);
};
function nestSelection(){
  const arr=selected();
  if(arr.length<2){toast('Select a container and child elements');return;}
  const container=arr.find(e=>['container','card','grid','sidebar'].includes(e.type));
  if(!container){toast('Select a container/card/grid/sidebar too');return;}
  arr.forEach(el=>{if(el.id!==container.id)el.parent=container.id});
  saveHist();render();toast('Nested metadata saved');
}
function unnestSelection(){selected().forEach(el=>el.parent=null);saveHist();render();toast('Unnested')}
document.getElementById('nestBtn').onclick=nestSelection;document.getElementById('unnestBtn').onclick=unnestSelection;
// Minimal no-compression ZIP writer for local downloads
function crc32buf(buf){let table=crc32buf.table;if(!table){table=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=((c&1)?(0xedb88320^(c>>>1)):(c>>>1));table[n]=c>>>0}crc32buf.table=table}let crc=0^(-1);for(let i=0;i<buf.length;i++)crc=(crc>>>8)^table[(crc^buf[i])&0xff];return (crc^(-1))>>>0}
function u8str(s){return new TextEncoder().encode(s)}
function u16(n){return [n&255,(n>>>8)&255]}function u32(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]}
function dosDateTime(){const d=new Date();let time=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()/2);let date=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();return {time:time|0,date:date|0}}
function concatU8(parts){let len=parts.reduce((a,p)=>a+p.length,0),out=new Uint8Array(len),off=0;parts.forEach(p=>{out.set(p,off);off+=p.length});return out}
function makeZip(files){let locals=[],centrals=[],offset=0,dt=dosDateTime();for(const [name,text] of Object.entries(files)){const nameB=u8str(name),data=u8str(text),crc=crc32buf(data);const local=concatU8([new Uint8Array([0x50,0x4b,0x03,0x04]),new Uint8Array(u16(20)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(dt.time)),new Uint8Array(u16(dt.date)),new Uint8Array(u32(crc)),new Uint8Array(u32(data.length)),new Uint8Array(u32(data.length)),new Uint8Array(u16(nameB.length)),new Uint8Array(u16(0)),nameB,data]);locals.push(local);const central=concatU8([new Uint8Array([0x50,0x4b,0x01,0x02]),new Uint8Array(u16(20)),new Uint8Array(u16(20)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(dt.time)),new Uint8Array(u16(dt.date)),new Uint8Array(u32(crc)),new Uint8Array(u32(data.length)),new Uint8Array(u32(data.length)),new Uint8Array(u16(nameB.length)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u32(0)),new Uint8Array(u32(offset)),nameB]);centrals.push(central);offset+=local.length}const cdSize=centrals.reduce((a,p)=>a+p.length,0),cdOffset=offset;const end=concatU8([new Uint8Array([0x50,0x4b,0x05,0x06]),new Uint8Array(u16(0)),new Uint8Array(u16(0)),new Uint8Array(u16(centrals.length)),new Uint8Array(u16(centrals.length)),new Uint8Array(u32(cdSize)),new Uint8Array(u32(cdOffset)),new Uint8Array(u16(0))]);return concatU8([...locals,...centrals,end])}
function downloadBlob(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportRealZip(){const files={'index.html':exportHtml(),'forge-project.forge.json':JSON.stringify(exportProjectObject(),null,2),'current-page.html':currentPageHtml(),'README.txt':'FORGE local ZIP export. No cloud save.'};downloadBlob('forge-export.zip',new Blob([makeZip(files)],{type:'application/zip'}))}


// ===== V15 ship-ready local beta hardening =====
const FORGE_VERSION = '15.0.0-local-beta';

function assertCheck(name, fn){
  try{
    const result = fn();
    if(result === true) return {name,status:'pass',detail:'OK'};
    if(typeof result === 'string') return {name,status:'warn',detail:result};
    return {name,status:'pass',detail:'OK'};
  }catch(err){
    return {name,status:'fail',detail:err.message || String(err)};
  }
}

function runForgeQA(){
  const checks = [];
  checks.push(assertCheck('Core DOM exists', ()=>{
    ['canvas','work','componentsPanel','pagesList','layersList','blueprintList','exportHtmlBtn','exportJsonBtn','fileInput'].forEach(id=>{
      if(!document.getElementById(id)) throw new Error('Missing #' + id);
    });
    return true;
  }));
  checks.push(assertCheck('Project state valid', ()=>{
    if(!state || !Array.isArray(state.pages)) throw new Error('state.pages missing');
    if(!state.pages.length) throw new Error('No pages');
    if(!page()) throw new Error('Current page not found');
    return true;
  }));
  checks.push(assertCheck('Page dimensions valid', ()=>{
    state.pages.forEach(pg=>{
      if(!Number(pg.width) || !Number(pg.height)) throw new Error('Invalid page size: '+pg.name);
      if(!Array.isArray(pg.elements)) throw new Error('Missing elements array: '+pg.name);
    });
    return true;
  }));
  checks.push(assertCheck('No duplicate element IDs', ()=>{
    const ids = [];
    state.pages.forEach(pg=>pg.elements.forEach(el=>ids.push(el.id)));
    const dup = ids.find((id,i)=>ids.indexOf(id)!==i);
    if(dup) throw new Error('Duplicate id: '+dup);
    return true;
  }));
  checks.push(assertCheck('Element geometry valid', ()=>{
    state.pages.forEach(pg=>pg.elements.forEach(el=>{
      ['x','y','w','h'].forEach(k=>{
        if(typeof el[k] !== 'number' || Number.isNaN(el[k])) throw new Error(el.name+' has invalid '+k);
      });
      if(el.w < 1 || el.h < 1) throw new Error(el.name+' has invalid size');
    }));
    return true;
  }));
  checks.push(assertCheck('Autosave available', ()=>{
    localStorage.setItem('forge-v15-test','ok');
    if(localStorage.getItem('forge-v15-test') !== 'ok') throw new Error('localStorage write failed');
    localStorage.removeItem('forge-v15-test');
    return true;
  }));
  checks.push(assertCheck('JSON export valid', ()=>{
    const obj = exportProjectObject();
    const text = JSON.stringify(obj);
    const parsed = JSON.parse(text);
    if(!parsed.pages?.length) throw new Error('JSON export missing pages');
    return true;
  }));
  checks.push(assertCheck('HTML export valid', ()=>{
    const out = exportHtml();
    if(!out.includes('<!DOCTYPE html>')) throw new Error('Missing doctype');
    if(!out.includes('FORGE') && !out.includes('Prototype')) return 'HTML exports, but title is generic';
    return true;
  }));
  checks.push(assertCheck('ZIP export engine valid', ()=>{
    if(typeof makeZip !== 'function') throw new Error('makeZip missing');
    const zip = makeZip({'test.txt':'ok'});
    if(!(zip instanceof Uint8Array) || zip.length < 20) throw new Error('Invalid zip result');
    return true;
  }));
  checks.push(assertCheck('Preview actions data valid', ()=>{
    state.pages.forEach(pg=>pg.elements.forEach(el=>{
      if(el.action && !['page','toggle','modal'].includes(el.action)) throw new Error('Unknown action '+el.action+' on '+el.name);
    }));
    return true;
  }));
  renderQaResults(checks);
  return checks;
}

function renderQaResults(checks){
  const body = document.getElementById('qaResults');
  const summary = document.getElementById('qaSummary');
  if(!body || !summary) return;
  body.innerHTML = '';
  summary.innerHTML = '';
  const pass = checks.filter(c=>c.status==='pass').length;
  const warn = checks.filter(c=>c.status==='warn').length;
  const fail = checks.filter(c=>c.status==='fail').length;
  summary.innerHTML = `<span class="health-chip ok">Pass: ${pass}</span><span class="health-chip ${warn?'bad':''}">Warn: ${warn}</span><span class="health-chip ${fail?'bad':'ok'}">Fail: ${fail}</span>`;
  checks.forEach(c=>{
    const tr = document.createElement('tr');
    const cls = c.status==='pass'?'qa-pass':(c.status==='warn'?'qa-warn':'qa-fail');
    tr.innerHTML = `<td>${esc(c.name)}</td><td class="${cls}">${c.status.toUpperCase()}</td><td>${esc(c.detail)}</td>`;
    body.appendChild(tr);
  });
}

document.getElementById('qaBtn').onclick = ()=>{document.getElementById('qaModal').style.display='flex';runForgeQA();};
document.getElementById('runQaBtn').onclick = runForgeQA;
document.getElementById('qaCloseBtn').onclick = ()=>document.getElementById('qaModal').style.display='none';
document.getElementById('guideBtn').onclick = ()=>document.getElementById('guideModal').style.display='flex';
document.getElementById('guideCloseBtn').onclick = ()=>document.getElementById('guideModal').style.display='none';

window.addEventListener('error', e=>{
  console.error('FORGE runtime error:', e.error || e.message);
  const status = document.getElementById('statusText');
  if(status) status.textContent = 'Runtime warning: open QA';
});

function migrateLegacyAutosave(){
  const current = localStorage.getItem('forge-v15-project');
  if(current) return;
  const legacyKeys = ['forge-v10-project','forge-v9-fixed','forge-v8-ship','forge-functional'];
  for(const key of legacyKeys){
    const found = localStorage.getItem(key);
    if(found){
      localStorage.setItem('forge-v15-project', found);
      break;
    }
  }
}

function showFirstRunHint(){
  if(localStorage.getItem('forge-v15-seen-guide')) return;
  localStorage.setItem('forge-v15-seen-guide','yes');
  setTimeout(()=>toast('Tip: open Guide or Blueprints to start fast'), 500);
}

function finalShipReadinessNote(){
  console.info('FORGE V15 local beta: single-file, local-only, no cloud save.');
}

function initHome(){document.getElementById('homeBlueprints').innerHTML=document.getElementById('blueprintList').innerHTML;document.querySelectorAll('#homeBlueprints [data-blueprint]').forEach(b=>b.onclick=()=>{document.getElementById('homeModal').style.display='none';loadBlueprint(b.dataset.blueprint)})}
migrateLegacyAutosave();try{const savedClipboard=localStorage.getItem('forge-v15-clipboard');if(savedClipboard)state.clipboard=JSON.parse(savedClipboard)}catch(err){console.warn('Clipboard restore failed',err)}const saved=localStorage.getItem('forge-v15-project');if(saved){try{loadProjectObject(JSON.parse(saved));migrateProject&&migrateProject()}catch(err){console.warn('Autosave restore failed',err)}}showFirstRunHint();finalShipReadinessNote();
initHome();render();
