(() => {
  const STORAGE_KEY = "dreamwalker-visual-studio-v3";
  let repoBase = "";
  let workspaceLabel = "workspace";
  let state = null, selectedId = null, connectFrom = null, drag = null, resize = null, saveTimer = null;
  let selectedIds = new Set(), undoStack = [], redoStack = [], zoom = 1, spaceDown = false, pan = null;
  const COLLAPSE_KEY = "dreamwalker-visual-studio-collapsed-v1";
  const NAV_KEY = "dreamwalker-visual-studio-navigation-v1";
  let collapsedFolders = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]"));

  const el = id => document.getElementById(id);
  const canvas = el("canvas"), connectionsSvg = el("connections"), library = el("library"), canvasShell = el("canvasShell");
  const boardTitle = el("boardTitle"), boardFolderLabel = el("boardFolderLabel"), saveState = el("saveState"), gitState = el("gitState");
  const selectionBar = el("selectionBar"), selectionCount = el("selectionCount"), zoomLabel = el("zoomLabel");

  async function loadConfig(){
    try{
      const res=await fetch("/api/config",{cache:"no-store"});
      if(!res.ok) throw new Error("Config unavailable");
      const config=await res.json();
      repoBase=config.repoBase||"";
      workspaceLabel=config.workspaceName||"workspace";
    }catch(err){
      repoBase="";
      workspaceLabel="workspace";
    }
  }

  async function gitAction(endpoint, body=null){
    const options=body
      ? {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}
      : {method:"POST"};
    const res=await fetch(endpoint,options);
    const result=await res.json();
    if(!res.ok || !result.ok) throw new Error(result.error||"Git action failed");
    return result;
  }

  async function refreshGitStatus(){
    if(!gitState)return;
    gitState.textContent="Checking book repo…";
    gitState.className="git-state";
    try{
      const res=await fetch("/api/git-status",{cache:"no-store"});
      const info=await res.json();
      if(!res.ok || !info.isGitRepo){
        gitState.textContent="Book repo: not connected";
        gitState.classList.add("git-error");
        return;
      }
      const branch=info.branch||"unknown";
      if(info.clean){
        gitState.textContent=`Book repo: ${branch} · clean`;
        gitState.classList.add("git-clean");
      }else{
        const count=info.changedCount||0;
        gitState.textContent=`Book repo: ${branch} · ${count} change${count===1?"":"s"}`;
        gitState.classList.add("git-dirty");
      }
      gitState.title=info.remote?(`origin: ${info.remote}`):"No origin remote found";
    }catch(err){
      gitState.textContent="Book repo: status unavailable";
      gitState.classList.add("git-error");
    }
  }

  function walkFolders(folders, fn, path=[]){
    for(const folder of folders || []){
      const nextPath=[...path, folder];
      if(fn(folder,nextPath)===false) return false;
      if(walkFolders(folder.children || [], fn, nextPath)===false) return false;
    }
  }

  function findFolder(id){
    let found=null;
    walkFolders(state.folders,(folder,path)=>{ if(folder.id===id){found={folder,path};return false;} });
    return found;
  }

  function findBoard(id){
    let found=null;
    walkFolders(state.folders,(folder,path)=>{
      const board=(folder.boards || []).find(b=>b.id===id);
      if(board){found={folder,board,path};return false;}
    });
    return found;
  }


  function compactLegacyVisuals(data){
    if(Number(data.visualUiVersion||0)>=4) return false;
    for(const list of Object.values(data.items||{})){
      for(const item of list||[]){
        if(item.type==="image") continue;
        if(item.type==="section"){
          item.w=Math.max(Number(item.w)||520,420);
          item.h=Math.max(Number(item.h)||90,70);
          continue;
        }
        item.w=Math.min(Number(item.w)||240,360);
        item.h=Math.min(Number(item.h)||150,190);
      }
    }
    data.visualUiVersion=4;
    return true;
  }

  async function loadState(){
    saveState.textContent="Loading shared board…";
    try{
      const res=await fetch("/api/board",{cache:"no-store"});
      if(!res.ok) throw new Error("Shared board unavailable");
      state=await res.json();
      const compacted=compactLegacyVisuals(state);
      const nav=JSON.parse(localStorage.getItem(NAV_KEY)||"{}");
      const navBoard=findBoardInData(state,nav.activeBoard);
      if(navBoard){
        state.activeBoard=nav.activeBoard;
        state.activeFolder=navBoard.folder.id;
      }else{
        const first=findFirstBoardInData(state);
        state.activeBoard=first?.board?.id||null;
        state.activeFolder=first?.folder?.id||state.folders?.[0]?.id||null;
      }
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      saveState.textContent=compacted?"Visual cards compacted":"Shared board loaded";
      if(compacted)setTimeout(persist,50);
    }catch(err){
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw) throw err;
      state=JSON.parse(raw);
      saveState.textContent="Offline fallback — not syncing";
    }
  }

  function findFirstBoardInData(data){
    let result=null;
    const recur=(folders,path=[])=>{
      for(const folder of folders||[]){
        const p=[...path,folder];
        if((folder.boards||[]).length){result={folder,board:folder.boards[0],path:p};return true;}
        if(recur(folder.children||[],p)) return true;
      }
      return false;
    };
    recur(data.folders||[]);
    return result;
  }

  function findBoardInData(data,id){
    let result=null;
    const recur=(folders,path=[])=>{
      for(const folder of folders||[]){
        const p=[...path,folder];
        const board=(folder.boards||[]).find(b=>b.id===id);
        if(board){result={folder,board,path:p};return true;}
        if(recur(folder.children||[],p)) return true;
      }
      return false;
    };
    recur(data.folders||[]);
    return result;
  }

  function saveNavigation(){
    localStorage.setItem(NAV_KEY,JSON.stringify({activeFolder:state.activeFolder,activeBoard:state.activeBoard}));
  }

  async function persist(){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    saveNavigation();
    const sharedState=JSON.parse(JSON.stringify(state));
    delete sharedState.activeFolder;
    delete sharedState.activeBoard;
    try{
      const res=await fetch("/api/board",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sharedState)});
      if(!res.ok) throw new Error("Save failed");
      saveState.textContent=`Saved to ${workspaceLabel}`;
      refreshGitStatus();
    }catch(err){
      saveState.textContent="Saved in browser only — workspace save failed";
    }
  }

  function markSaving(){ saveState.textContent="Saving…"; clearTimeout(saveTimer); saveTimer=setTimeout(persist,350); }

  function currentBoard(){ return findBoard(state.activeBoard); }
  function currentItems(){ if(!state.items[state.activeBoard]) state.items[state.activeBoard]=[]; return state.items[state.activeBoard]; }
  function cloneState(){ return JSON.parse(JSON.stringify(state)); }

  function pushHistory(){
    if(!state)return;
    undoStack.push(cloneState());
    if(undoStack.length>60) undoStack.shift();
    redoStack=[];
    updateHistoryButtons();
  }

  function restoreSnapshot(snapshot){
    state=JSON.parse(JSON.stringify(snapshot));
    selectedId=null;
    selectedIds.clear();
    connectFrom=null;
    saveNavigation();
    markSaving();
    render();
  }

  function undo(){
    if(!undoStack.length)return;
    redoStack.push(cloneState());
    restoreSnapshot(undoStack.pop());
    updateHistoryButtons();
  }

  function redo(){
    if(!redoStack.length)return;
    undoStack.push(cloneState());
    restoreSnapshot(redoStack.pop());
    updateHistoryButtons();
  }

  function updateHistoryButtons(){
    if(el("undoBtn")) el("undoBtn").disabled=!undoStack.length;
    if(el("redoBtn")) el("redoBtn").disabled=!redoStack.length;
  }

  function setSelection(ids){
    selectedIds=new Set(ids||[]);
    selectedId=[...selectedIds].at(-1)||null;
    updateSelectionBar();
  }

  function toggleSelection(id,additive=false){
    if(!additive){
      setSelection([id]);
      return;
    }
    const next=new Set(selectedIds);
    if(next.has(id)) next.delete(id); else next.add(id);
    setSelection([...next]);
  }

  function updateSelectionBar(){
    if(!selectionBar)return;
    const count=selectedIds.size;
    selectionBar.hidden=count===0;
    if(selectionCount) selectionCount.textContent=count===1?"1 selected":count+" selected";
    if(el("connectBtn")) el("connectBtn").disabled=count!==1;
  }

  function updateZoom(){
    zoom=Math.min(2,Math.max(.35,zoom));
    canvas.style.zoom=String(zoom);
    if(zoomLabel) zoomLabel.textContent=Math.round(zoom*100)+"%";
  }

  function setZoom(next,anchorX=null,anchorY=null){
    const old=zoom;
    const shellRect=canvasShell.getBoundingClientRect();
    const ax=anchorX??(shellRect.left+shellRect.width/2);
    const ay=anchorY??(shellRect.top+shellRect.height/2);
    const contentX=(canvasShell.scrollLeft+(ax-shellRect.left))/old;
    const contentY=(canvasShell.scrollTop+(ay-shellRect.top))/old;
    zoom=next;
    updateZoom();
    canvasShell.scrollLeft=contentX*zoom-(ax-shellRect.left);
    canvasShell.scrollTop=contentY*zoom-(ay-shellRect.top);
  }

  function fitBoard(){
    const items=currentItems();
    if(!items.length){ zoom=1; updateZoom(); canvasShell.scrollTo({left:0,top:0,behavior:"smooth"}); return; }
    const minX=Math.min(...items.map(i=>Number(i.x)||0));
    const minY=Math.min(...items.map(i=>Number(i.y)||0));
    const maxX=Math.max(...items.map(i=>(Number(i.x)||0)+(Number(i.w)||240)));
    const maxY=Math.max(...items.map(i=>(Number(i.y)||0)+(Number(i.h)||150)));
    const pad=120;
    const target=Math.min(
      1.25,
      Math.max(.35,Math.min(
        canvasShell.clientWidth/(maxX-minX+pad*2),
        canvasShell.clientHeight/(maxY-minY+pad*2)
      ))
    );
    zoom=target;
    updateZoom();
    canvasShell.scrollTo({
      left:Math.max(0,(minX-pad)*zoom),
      top:Math.max(0,(minY-pad)*zoom),
      behavior:"smooth"
    });
  }

  function renderFolder(folder,depth=0){
    const wrap=document.createElement("section");
    wrap.className="folder-group nested-folder";
    wrap.style.marginLeft=(depth*12)+"px";

    const row=document.createElement("div");
    row.className="folder-row";

    const hasContents=(folder.boards||[]).length>0 || (folder.children||[]).length>0;
    const collapsed=collapsedFolders.has(folder.id);

    const toggle=document.createElement("button");
    toggle.type="button";
    toggle.className="folder-toggle";
    toggle.textContent=hasContents?(collapsed?"▸":"▾"):"·";
    toggle.disabled=!hasContents;
    toggle.title=collapsed?"Expand folder":"Collapse folder";
    toggle.addEventListener("click",()=>{
      if(collapsedFolders.has(folder.id)) collapsedFolders.delete(folder.id);
      else collapsedFolders.add(folder.id);
      localStorage.setItem(COLLAPSE_KEY,JSON.stringify([...collapsedFolders]));
      renderLibrary();
    });
    row.appendChild(toggle);

    const title=document.createElement("button");
    title.type="button";
    title.className="folder-title folder-title-button"+(folder.id===state.activeFolder?" active-folder":"");
    title.textContent=folder.name;
    title.title="Select this folder, then use + Folder or + Board";
    title.addEventListener("click",()=>{state.activeFolder=folder.id;saveNavigation();renderLibrary();});
    row.appendChild(title);
    wrap.appendChild(row);

    if(!collapsed){
      (folder.boards||[]).forEach(board=>{
        const b=document.createElement("button");
        b.type="button";
        b.className="board-link"+(board.id===state.activeBoard?" active":"");
        b.textContent=board.name;
        b.addEventListener("click",()=>{
          state.activeBoard=board.id; state.activeFolder=folder.id;
          setSelection([]); connectFrom=null; saveNavigation(); render();
        });
        wrap.appendChild(b);
      });

      (folder.children||[]).forEach(child=>wrap.appendChild(renderFolder(child,depth+1)));
    }
    return wrap;
  }

  function renderLibrary(){
    library.innerHTML="";
    (state.folders||[]).forEach(folder=>library.appendChild(renderFolder(folder,0)));
  }

  function ensureCanvasSpace(extraItem=null){
    const items=[...currentItems()];
    if(extraItem && !items.includes(extraItem)) items.push(extraItem);
    let neededWidth=6000, neededHeight=4500;
    for(const item of items){
      neededWidth=Math.max(neededWidth,(item.x||0)+(item.w||240)+1400);
      neededHeight=Math.max(neededHeight,(item.y||0)+(item.h||150)+1200);
    }
    canvas.style.width=neededWidth+"px";
    canvas.style.height=neededHeight+"px";
  }

  function render(){
    renderLibrary();
    const info=currentBoard();
    if(!info)return;
    boardTitle.textContent=info.board.name;
    boardFolderLabel.textContent=info.path.map(f=>f.name).join(" / ");
    canvas.querySelectorAll(".board-item").forEach(n=>n.remove());
    currentItems().forEach(item=>canvas.appendChild(makeItemNode(item)));
    ensureCanvasSpace();
    updateZoom();
    updateSelectionBar();
    updateHistoryButtons();
    drawConnections();
  }

  function beginItemDrag(item,e,node){
    if(!selectedIds.has(item.id)) toggleSelection(item.id,e.shiftKey);
    if(!selectedIds.has(item.id)) return;
    pushHistory();
    const starts={};
    for(const id of selectedIds){
      const found=currentItems().find(i=>i.id===id);
      if(found) starts[id]={x:Number(found.x)||0,y:Number(found.y)||0};
    }
    drag={ids:[...selectedIds],startX:e.clientX,startY:e.clientY,starts};
    node.setPointerCapture(e.pointerId);
  }

  function makeItemNode(item){
    const tpl=el("itemTemplate").content.firstElementChild.cloneNode(true);
    tpl.dataset.id=item.id; tpl.dataset.status=item.status||"open"; tpl.dataset.type=item.type||"note";
    tpl.style.left=(item.x||40)+"px"; tpl.style.top=(item.y||40)+"px";
    tpl.style.width=(item.w||240)+"px"; tpl.style.height=(item.h||150)+"px";
    tpl.style.zIndex=String(item.z||1);
    if(selectedIds.has(item.id)) tpl.classList.add("selected");

    const type=tpl.querySelector(".item-type"), title=tpl.querySelector(".item-title");
    const body=tpl.querySelector(".item-body"), status=tpl.querySelector(".status-select");
    const source=tpl.querySelector(".source-link");
    type.textContent=item.type==="image"?"Image":item.type==="card"?"Card":item.type==="section"?"Section":"Sticky";
    title.value=item.title||""; body.value=item.body||""; status.value=item.status||"open";

    if(item.source&&repoBase){source.href=repoBase+item.source;source.classList.add("has-source");}

    if(item.type==="section"){
      tpl.classList.add("section-card");
      body.remove();
      status.closest(".item-handle").querySelector(".item-type").textContent="Section";
      status.style.display="none";
    }

    if(item.type==="image"){
      tpl.classList.add("image-card"); body.remove();
      const img=document.createElement("img");
      img.src=item.imagePath||"";
      img.alt=item.title||"Board image";
      img.title=item.title||"";
      title.insertAdjacentElement("afterend",img);

      img.addEventListener("pointerdown",e=>{
        e.preventDefault(); e.stopPropagation();
        if(connectFrom&&connectFrom!==item.id){
          addConnection(connectFrom,item.id);
          connectFrom=null;
          return;
        }
        beginItemDrag(item,e,tpl);
        render();
      });
    }

    tpl.addEventListener("pointerdown",e=>{
      if(e.target.closest("input,textarea,select,a,.resize-handle")) return;
      if(connectFrom&&connectFrom!==item.id){addConnection(connectFrom,item.id);connectFrom=null;return;}
      toggleSelection(item.id,e.shiftKey);
      render();
    });

    tpl.querySelector(".item-handle").addEventListener("pointerdown",e=>{
      if(e.target.closest("select")) return;
      e.preventDefault();e.stopPropagation();
      beginItemDrag(item,e,tpl);
      render();
    });

    tpl.querySelector(".resize-handle").addEventListener("pointerdown",e=>{
      e.preventDefault();e.stopPropagation();
      if(!selectedIds.has(item.id))setSelection([item.id]);
      pushHistory();
      resize={id:item.id,startX:e.clientX,startY:e.clientY,w:item.w||240,h:item.h||150};
      tpl.setPointerCapture(e.pointerId);
    });

    const snapshotEdit=()=>{
      if(tpl.dataset.editSnapshot)return;
      tpl.dataset.editSnapshot="1";
      pushHistory();
    };
    title.addEventListener("focus",snapshotEdit,{once:true});
    title.addEventListener("input",()=>{item.title=title.value;markSaving();});
    if(body){
      body.addEventListener("focus",snapshotEdit,{once:true});
      body.addEventListener("input",()=>{item.body=body.value;markSaving();});
    }
    status.addEventListener("change",()=>{pushHistory();item.status=status.value;tpl.dataset.status=item.status;markSaving();});
    return tpl;
  }

  function uid(prefix="id"){return prefix+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);}

  function addItem(type,data={}){
    if(!state.activeBoard){alert("Open a board first.");return;}
    pushHistory();
    const items=currentItems(),offset=items.length*28;
    const section=type==="section";
    const item={
      id:uid(type),type,
      title:data.title||(section?"Section heading":type==="card"?"New card":"New note"),
      body:data.body||"",status:data.status||"open",
      x:data.x??(80+(offset%420)),y:data.y??(80+(offset%360)),
      w:data.w??(type==="image"?300:section?520:240),
      h:data.h??(type==="image"?260:section?90:150),
      source:data.source||"",imagePath:data.imagePath||"",z:data.z||1
    };
    items.push(item);
    setSelection([item.id]);
    markSaving();render();
  }

  function deleteSelected(){
    if(!selectedIds.size)return;
    pushHistory();
    const ids=new Set(selectedIds);
    state.items[state.activeBoard]=currentItems().filter(i=>!ids.has(i.id));
    const connections=state.connections[state.activeBoard]||[];
    state.connections[state.activeBoard]=connections.filter(x=>!ids.has(x.from)&&!ids.has(x.to));
    setSelection([]);
    markSaving();render();
  }

  function duplicateSelected(){
    if(!selectedIds.size)return;
    pushHistory();
    const items=currentItems();
    const originals=items.filter(i=>selectedIds.has(i.id));
    const copies=originals.map((item,index)=>({
      ...JSON.parse(JSON.stringify(item)),
      id:uid(item.type||"item"),
      x:(Number(item.x)||0)+36+(index*8),
      y:(Number(item.y)||0)+36+(index*8),
      z:(Number(item.z)||1)+1
    }));
    items.push(...copies);
    setSelection(copies.map(i=>i.id));
    markSaving();render();
  }

  function changeLayer(direction){
    if(!selectedIds.size)return;
    pushHistory();
    const items=currentItems();
    const selected=items.filter(i=>selectedIds.has(i.id));
    const zValues=items.map(i=>Number(i.z||1));
    let z=direction==="front"?Math.max(1,...zValues)+1:Math.min(1,...zValues)-selected.length;
    for(const item of selected){ item.z=z; z+=1; }
    markSaving();render();
  }

  function addConnection(from,to){
    if(!state.connections[state.activeBoard])state.connections[state.activeBoard]=[];
    const list=state.connections[state.activeBoard];
    if(!list.some(c=>c.from===from&&c.to===to))list.push({id:uid("c"),from,to});
    markSaving();render();
  }

  function drawConnections(){
    connectionsSvg.innerHTML='<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="connection-arrow"></path></marker></defs>';
    const list=state.connections[state.activeBoard]||[],map=new Map(currentItems().map(i=>[i.id,i]));
    list.forEach(c=>{
      const a=map.get(c.from),b=map.get(c.to);if(!a||!b)return;
      const line=document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",(a.x||0)+(a.w||260)/2);line.setAttribute("y1",(a.y||0)+(a.h||210)/2);
      line.setAttribute("x2",(b.x||0)+(b.w||260)/2);line.setAttribute("y2",(b.y||0)+(b.h||210)/2);
      line.setAttribute("class","connection-line");line.setAttribute("marker-end","url(#arrow)");connectionsSvg.appendChild(line);
    });
  }

  function promptName(label,current=""){const v=window.prompt(label,current);return v&&v.trim()?v.trim():null;}

  function removeFolderById(folders,id){
    for(let i=0;i<(folders||[]).length;i++){
      if(folders[i].id===id){folders.splice(i,1);return true;}
      if(removeFolderById(folders[i].children||[],id)) return true;
    }
    return false;
  }

  function firstBoardId(){
    let id=null;
    walkFolders(state.folders,folder=>{
      if((folder.boards||[]).length){id=folder.boards[0].id;return false;}
    });
    return id;
  }

  async function uploadImage(file){
    if(file.size>10*1024*1024)throw new Error("Please use an image smaller than 10 MB.");
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const res=await fetch("/api/image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,dataUrl})});
    const result=await res.json();if(!res.ok)throw new Error(result.error||"Image upload failed");return result.path;
  }

  function canvasPointFromClient(clientX,clientY){
    const rect=canvas.getBoundingClientRect();
    return {
      x:Math.max(0,(clientX-rect.left)/zoom),
      y:Math.max(0,(clientY-rect.top)/zoom)
    };
  }

  async function addImageFiles(files,dropPoint=null){
    const imageFiles=Array.from(files||[]).filter(file=>file.type.startsWith("image/"));
    if(!imageFiles.length)return;
    pushHistory();
    saveState.textContent=imageFiles.length===1?"Saving image to workspace…":"Saving "+imageFiles.length+" images to workspace…";
    const addedIds=[];
    let index=0;
    for(const file of imageFiles){
      try{
        const path=await uploadImage(file);
        const items=currentItems();
        const cols=Math.max(1,Math.ceil(Math.sqrt(imageFiles.length)));
        const baseX=dropPoint?.x??(100+(items.length*24)%700);
        const baseY=dropPoint?.y??(100+(items.length*24)%500);
        const x=baseX+(index%cols)*340;
        const y=baseY+Math.floor(index/cols)*290;
        const item={
          id:uid("image"),type:"image",title:file.name,body:"",status:"open",
          x,y,w:320,h:260,source:"",imagePath:path,z:1
        };
        items.push(item);
        addedIds.push(item.id);
        index++;
      }catch(err){
        alert("Could not add "+file.name+": "+(err.message||"upload failed"));
      }
    }
    if(addedIds.length){
      setSelection(addedIds);
      markSaving();
      render();
    }else{
      saveState.textContent="Image save failed";
    }
  }

  el("addNoteBtn").addEventListener("click",()=>addItem("note"));
  el("addCardBtn").addEventListener("click",()=>addItem("card"));
  el("addSectionBtn").addEventListener("click",()=>addItem("section"));
  el("duplicateBtn").addEventListener("click",duplicateSelected);
  el("deleteBtn").addEventListener("click",deleteSelected);
  el("connectBtn").addEventListener("click",()=>{
    if(selectedIds.size!==1)return;
    connectFrom=[...selectedIds][0];
    saveState.textContent="Now click the item you want to connect to";
  });
  el("bringFrontBtn").addEventListener("click",()=>changeLayer("front"));
  el("sendBackBtn").addEventListener("click",()=>changeLayer("back"));

  el("undoBtn").addEventListener("click",undo);
  el("redoBtn").addEventListener("click",redo);
  el("zoomOutBtn").addEventListener("click",()=>setZoom(zoom-.1));
  el("zoomInBtn").addEventListener("click",()=>setZoom(zoom+.1));
  el("zoomLabel").addEventListener("click",()=>setZoom(1));
  el("fitBtn").addEventListener("click",fitBoard);
  el("homeBtn").addEventListener("click",()=>{
    canvasShell.scrollTo({left:0,top:0,behavior:"smooth"});
  });

  el("imageInput").addEventListener("click",e=>{ e.target.value=""; });
  el("imageInput").addEventListener("change",async e=>{
    await addImageFiles(e.target.files);
    e.target.value="";
  });

  canvasShell.addEventListener("dragover",e=>{
    if(Array.from(e.dataTransfer?.items||[]).some(item=>item.type.startsWith("image/"))){
      e.preventDefault();
      canvasShell.classList.add("drop-active");
    }
  });
  canvasShell.addEventListener("dragleave",e=>{
    if(!canvasShell.contains(e.relatedTarget))canvasShell.classList.remove("drop-active");
  });
  canvasShell.addEventListener("drop",async e=>{
    const files=Array.from(e.dataTransfer?.files||[]).filter(file=>file.type.startsWith("image/"));
    if(!files.length)return;
    e.preventDefault();
    canvasShell.classList.remove("drop-active");
    await addImageFiles(files,canvasPointFromClient(e.clientX,e.clientY));
  });

  canvas.addEventListener("pointerdown",e=>{
    if(e.target!==canvas && e.target!==connectionsSvg)return;
    if(spaceDown || e.button===1){
      pan={startX:e.clientX,startY:e.clientY,left:canvasShell.scrollLeft,top:canvasShell.scrollTop};
      canvasShell.classList.add("panning");
      e.preventDefault();
    }else{
      setSelection([]);
      render();
    }
  });

  el("newFolderBtn").addEventListener("click",()=>{
    const parent=findFolder(state.activeFolder);
    if(!parent){alert("Select a folder in the sidebar first.");return;}
    const name=promptName('New subfolder inside "'+parent.folder.name+'"');if(!name)return;
    if(!parent.folder.children)parent.folder.children=[];
    const id=uid("folder");parent.folder.children.push({id,name,boards:[],children:[]});state.activeFolder=id;saveNavigation();markSaving();renderLibrary();
  });

  el("newBoardBtn").addEventListener("click",()=>{
    const target=findFolder(state.activeFolder);
    if(!target){alert("Select the folder where this board should live.");return;}
    const name=promptName("Board name");if(!name)return;
    const id=uid("board");if(!target.folder.boards)target.folder.boards=[];
    target.folder.boards.push({id,name});state.items[id]=[];state.activeBoard=id;state.activeFolder=target.folder.id;saveNavigation();markSaving();render();
  });

  el("renameFolderBtn").addEventListener("click",()=>{
    const target=findFolder(state.activeFolder);
    if(!target){alert("Select a folder first.");return;}
    const name=promptName("Rename folder",target.folder.name);if(!name)return;
    target.folder.name=name;markSaving();render();
  });

  el("deleteFolderBtn").addEventListener("click",()=>{
    const target=findFolder(state.activeFolder);
    if(!target){alert("Select a folder first.");return;}
    const hasBoards=(target.folder.boards||[]).length>0;
    const hasChildren=(target.folder.children||[]).length>0;
    if(hasBoards||hasChildren){
      alert("For safety, a folder can only be deleted when it is empty. Move or delete its boards/subfolders first.");
      return;
    }
    if(!confirm('Delete the empty folder "'+target.folder.name+'"?')) return;
    removeFolderById(state.folders,target.folder.id);
    state.activeFolder=state.folders?.[0]?.id||null;saveNavigation();markSaving();render();
  });

  el("renameBoardBtn").addEventListener("click",()=>{
    const info=currentBoard();if(!info){alert("Open a board first.");return;}
    const name=promptName("Rename board",info.board.name);if(!name)return;
    info.board.name=name;markSaving();render();
  });

  el("deleteBoardBtn").addEventListener("click",()=>{
    const info=currentBoard();if(!info){alert("Open a board first.");return;}
    const count=(state.items[state.activeBoard]||[]).length;
    const warning=count?(' This board contains '+count+' item'+(count===1?'':'s')+'.'):'';
    if(!confirm('Delete the board "'+info.board.name+'"?'+warning+' This cannot be undone from inside the Visual Studio.')) return;
    info.folder.boards=info.folder.boards.filter(b=>b.id!==state.activeBoard);
    delete state.items[state.activeBoard];delete state.connections[state.activeBoard];
    state.activeBoard=firstBoardId();
    const next=findBoard(state.activeBoard);state.activeFolder=next?.folder?.id||state.folders?.[0]?.id||null;
    selectedId=null;saveNavigation();markSaving();render();
  });

  el("saveNowBtn").addEventListener("click",async()=>{
    clearTimeout(saveTimer);saveState.textContent="Saving now…";await persist();
  });

  el("getLatestBtn").addEventListener("click",async()=>{
    saveState.textContent="Getting latest book updates…";
    try{
      const result=await gitAction("/api/git-pull");
      await loadState();
      selectedId=null;
      connectFrom=null;
      render();
      saveState.textContent=result.summary==="Already up to date."
        ?"Workspace reloaded from book repo"
        :(result.summary||"Book repo updated");
      await refreshGitStatus();
    }catch(err){
      saveState.textContent="Get Latest failed";
      alert(err.message||"Could not pull the book repo.");
    }
  });

  el("saveVersionBtn").addEventListener("click",async()=>{
    clearTimeout(saveTimer);
    await persist();
    const message=window.prompt("Version message","Update Dreamwalker book workspace");
    if(message===null)return;
    const trimmed=message.trim();
    if(!trimmed){alert("Enter a version message.");return;}
    saveState.textContent="Saving book version…";
    try{
      const result=await gitAction("/api/git-commit",{message:trimmed});
      saveState.textContent=result.summary||"Version saved";
      await refreshGitStatus();
    }catch(err){
      saveState.textContent="Save Version failed";
      alert(err.message||"Could not commit the book repo.");
    }
  });

  el("pushGitBtn").addEventListener("click",async()=>{
    saveState.textContent="Pushing book repo to GitHub…";
    try{
      const result=await gitAction("/api/git-push");
      saveState.textContent=result.summary||"Book repo pushed to GitHub";
      await refreshGitStatus();
    }catch(err){
      saveState.textContent="Push failed";
      alert(err.message||"Could not push the book repo.");
    }
  });

  el("exportBtn").addEventListener("click",()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="dreamwalker-visual-board-backup.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });

  el("importInput").addEventListener("change",e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;const reader=new FileReader();
    reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed.folders||!parsed.items)throw new Error("Invalid");state=parsed;selectedId=null;
        if(!state.activeBoard){
          const first=findFirstBoardInData(state);
          state.activeBoard=first?.board?.id||null;
          state.activeFolder=first?.folder?.id||state.folders?.[0]?.id||null;
        }
        saveNavigation();markSaving();render();}
      catch(err){alert("That file is not a valid Dreamwalker visual-board export.");}e.target.value="";};
    reader.readAsText(file);
  });

  window.addEventListener("pointermove",e=>{
    if(drag){
      const item=currentItems().find(i=>i.id===drag.id);
      const node=canvas.querySelector('[data-id="'+drag.id+'"]');
      if(item&&node){
        item.x=Math.max(0,drag.x+e.clientX-drag.startX);
        item.y=Math.max(0,drag.y+e.clientY-drag.startY);
        node.style.left=item.x+"px";
        node.style.top=item.y+"px";
        ensureCanvasSpace(item);
        drawConnections();
        markSaving();
      }
    }
    if(resize){
      const item=currentItems().find(i=>i.id===resize.id);
      const node=canvas.querySelector('[data-id="'+resize.id+'"]');
      if(item&&node){
        item.w=Math.max(item.type==="image"?120:150,resize.w+e.clientX-resize.startX);
        item.h=Math.max(item.type==="image"?90:100,resize.h+e.clientY-resize.startY);
        node.style.width=item.w+"px";
        node.style.height=item.h+"px";
        ensureCanvasSpace(item);
        drawConnections();
        markSaving();
      }
    }
  });

  window.addEventListener("pointerup",()=>{
    drag=null;
    resize=null;
  });

  window.addEventListener("pointercancel",()=>{
    drag=null;
    resize=null;
  });

  canvas.addEventListener("keydown",e=>{if((e.key==="Delete"||e.key==="Backspace")&&!e.target.matches("input,textarea,select"))deleteSelected();});

  loadConfig().then(()=>Promise.all([loadState(),refreshGitStatus()])).then(render).catch(()=>{saveState.textContent="Could not load workspace board";alert("Dreamwalker could not load board data. Start it with the Dreamwalker launcher and a valid book workspace.");});
})();