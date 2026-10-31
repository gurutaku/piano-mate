    const $ = id => document.getElementById(id);
    const LETTERS = ['C','D','E','F','G','A','B'];
    const LETTER_INDEX = {C:0,D:1,E:2,F:3,G:4,A:5,B:6};
    const NATURAL_PC = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
    const ACCIDENTAL_GLYPH = {'-1':'♭','0':'♮','1':'♯'};
    const STAFF = {
      viewW:760,viewH:580,left:92,right:725,stepY:16,centerX:405,
      treble:{top:108,bottom:236},bass:{top:356,bottom:484}
    };
    const EDITOR = STAFF;
    const PRACTICE = {
      viewW:1540,viewH:520,left:92,right:1510,stepY:12,centerX:800,
      treble:{top:88,bottom:184},bass:{top:300,bottom:396},
      noteRx:39,noteRy:27,noteOffset:21,ledgerLength:84,accidentalOffset:48,accidentalFontSize:54
    };
    const PRACTICE_START_X = 145;
    const PRACTICE_MIN_STEP_X = 110;
    const PRACTICE_MAX_VISIBLE_EVENTS = 20;
    const PRACTICE_RIGHT_MARGIN = 70;
    // Reserve enough logical width for 20 well-spaced events. On especially
    // wide displays the event spacing expands, never the number shown.
    const PRACTICE_BASE_W = PRACTICE_START_X + (PRACTICE_MAX_VISIBLE_EVENTS-1)*PRACTICE_MIN_STEP_X + PRACTICE_RIGHT_MARGIN + 55;
    let practiceColumnGap = PRACTICE_MIN_STEP_X;
    const COLUMN_START = 160;
    const COLUMN_GAP = 112;
    const PAGE_SLOTS = 6;
    const PAGE_SPAN = COLUMN_GAP * PAGE_SLOTS;
    const SNAP_RADIUS = 43;

    let events = [];
    let draftNotes = [];
    let nextEventId = 1;
    let nextNoteId = 1;
    let selectedNote = null;
    let selectedHit = null;
    let editorPageIndex = 0;
    let barLines = [];
    let barLineMode = false;
    let practiceModeActive = false;
    let completedIndices = new Set();
    let lastWrongSpokenAt = 0;
    let dragging = false;
    let dragMoved = false;
    let pointerStart = null;
    let activePointerId = null;
    let detector = null;
    let isPractising = false;
    let practiceStarting = false;
    let practiceStartToken = 0;
    let practiceViewStarted = false;
    let currentIndex = 0;
    let attempt = {lastSoundAt:0,matched:new Set(),candidateFrames:new Map()};
    // Pitches from the previous step may still ring during a slur. Ignore those
    // trailing pitches until the detector reports them released.
    let carryoverMidis = new Set();
    let carryoverReleaseFrames = new Map();
    let wrongFlash = [];
    let wrongFlashTimer = null;
    let toastTimer = null;
    let cpuMonitorTimer = null;

    function midiFromParts(letter, accidental, octave) {
      return (Number(octave)+1)*12 + NATURAL_PC[letter] + Number(accidental);
    }
    function noteFromStep(clef, step, accidental, x=COLUMN_START) {
      const base = clef==='treble' ? {letter:'E',octave:4} : {letter:'G',octave:2};
      const diatonic = base.octave*7 + LETTER_INDEX[base.letter] + step;
      const octave = Math.floor(diatonic/7);
      const letter = LETTERS[((diatonic%7)+7)%7];
      const acc = Number(accidental);
      return {id:-1,clef,step,letter,accidental:acc,octave,midi:midiFromParts(letter,acc,octave),x};
    }
    function formatNote(note) {
      const accidental = note.accidental===0 ? '' : (note.accidental===1 ? '♯' : '♭');
      return `${note.letter}${accidental}${note.octave}`;
    }
    function midiSpelling(midi, clef) {
      const names = [
        ['C',0],['C',1],['D',0],['D',1],['E',0],['F',0],
        ['F',1],['G',0],['G',1],['A',0],['A',1],['B',0]
      ];
      const n = Math.round(midi);
      const octave = Math.floor(n/12)-1;
      const [letter,accidental] = names[((n%12)+12)%12];
      const base = clef==='treble' ? {letter:'E',octave:4} : {letter:'G',octave:2};
      const targetDiatonic = octave*7 + LETTER_INDEX[letter];
      const step = targetDiatonic - (base.octave*7 + LETTER_INDEX[base.letter]);
      return {id:null,clef,step,letter,accidental,octave,midi:n,x:0};
    }
    function showToast(message) {
      const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);
      toastTimer=setTimeout(()=>el.classList.remove('show'),2200);
    }

    function noteY(note, staff=STAFF) {
      const baseY = note.clef==='treble' ? staff.treble.bottom : staff.bass.bottom;
      return baseY - note.step*staff.stepY;
    }
    function ledgerMarkup(x,y,baseY,stepY,step,cls='ledger-line',length=60) {
      let html='';
      if (step>8) {
        for (let st=10;st<=step;st+=2) { const yy=baseY-st*stepY; html+=`<line class="${cls}" x1="${x-length/2}" y1="${yy}" x2="${x+length/2}" y2="${yy}"/>`; }
      } else if (step<0) {
        for (let st=-2;st>=step;st-=2) { const yy=baseY-st*stepY; html+=`<line class="${cls}" x1="${x-length/2}" y1="${yy}" x2="${x+length/2}" y2="${yy}"/>`; }
      }
      return html;
    }
    function noteMarkup(note, x, y, state='', staff=STAFF) {
      const cls=state?` ${state}`:'';
      const glyph=ACCIDENTAL_GLYPH[String(note.accidental)]||'';
      const noteId=Number(note.id)>0?`data-note-id="${note.id}"`:'';
      const accidentalMarkup = note.accidental===0 ? '' : `<text class="note-accidental${cls}" ${noteId} x="${x-(staff.accidentalOffset||39)}" y="${y+13}"${staff.accidentalFontSize?` style="font-size:${staff.accidentalFontSize}px"`:''}>${glyph}</text>`;
      const ledger=ledgerMarkup(x,y,note.clef==='treble'?staff.treble.bottom:staff.bass.bottom,staff.stepY,note.step,'ledger-line',staff.ledgerLength||60);
      const rx=staff.noteRx||25,ry=staff.noteRy||17;
      return `${ledger}${accidentalMarkup}
        ${state==='preview'?`<ellipse class="preview-ring" cx="${x}" cy="${y}" rx="${Math.round(rx*1.24)}" ry="${Math.round(ry*1.28)}"/>`:''}
        <ellipse class="notehead${cls}" ${noteId} cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(-18 ${x} ${y})"/>`;
    }
    function visualNoteX(note, notes, columnX, staff=STAFF) {
      const hasAdjacent = notes.some(other=>other!==note&&other.clef===note.clef&&Math.abs(other.step-note.step)===1);
      const stagger=staff.noteOffset||17;
      let offset = hasAdjacent ? (Math.abs(note.step)%2===0 ? -stagger : stagger) : 0;
      const samePosition = notes.filter(other=>other.clef===note.clef&&other.step===note.step);
      if(samePosition.length>1){const sameIndex=samePosition.indexOf(note);offset+=(sameIndex-(samePosition.length-1)/2)*24;}
      return columnX+offset;
    }
    function renderColumnMarkup(entries, columnX, staff=STAFF) {
      if(!entries.length)return '';
      const notes=entries.map(entry=>entry.note);
      const positions=entries.map(entry=>({note:entry.note,state:entry.state,x:visualNoteX(entry.note,notes,columnX,staff),y:noteY(entry.note,staff)}));
      const minY=Math.min(...positions.map(p=>p.y));
      const maxY=Math.max(...positions.map(p=>p.y));
      let html='';
      if(entries.length>1&&maxY-minY>1){
        html+=`<line class="chord-guide" x1="${columnX}" y1="${minY-5}" x2="${columnX}" y2="${maxY+5}"/>`;
      }
      positions.forEach(({note,state,x,y})=>{html+=noteMarkup(note,x,y,state,staff);});
      return html;
    }
    function renderNoteGroup(notes, columnX, state, previewId=null, staff=STAFF) {
      return renderColumnMarkup(notes.map(note=>({note,state:previewId!==null&&note.id===previewId?'preview':state})),columnX,staff);
    }
    function drawGrandStaffBase(contentW, staff=STAFF, dark=false) {
      const right=Math.max(staff.right,contentW-30);
      let html=`<rect x="0" y="0" width="${contentW}" height="${staff.viewH}" rx="13" fill="${dark?'transparent':'#fffefa'}"/>
        <text class="staff-label" x="${staff.left}" y="42">TREBLE</text>
        <text class="staff-label" x="${staff.left}" y="${staff.bass.bottom+64}">BASS</text>
        <text class="clef-mark" x="5" y="${staff.treble.bottom+12}">𝄞</text>
        <text class="clef-mark" x="5" y="${staff.bass.bottom+12}">𝄢</text>`;
      for(let i=0;i<5;i++){
        const ty=staff.treble.top+i*staff.stepY*2;
        const by=staff.bass.top+i*staff.stepY*2;
        html+=`<line class="staff-line" x1="${staff.left}" y1="${ty}" x2="${right}" y2="${ty}"/>`;
        html+=`<line class="staff-line" x1="${staff.left}" y1="${by}" x2="${right}" y2="${by}"/>`;
      }
      html+=`<line class="staff-separator" x1="${staff.left}" y1="${staff.treble.bottom+65}" x2="${right}" y2="${staff.treble.bottom+65}"/>`;
      return html;
    }
    function fitEditorStaffSvg(svg, viewport, staff=STAFF) {
      // The composer is always one fixed-width logical page. Never write a
      // content-derived pixel width/height: Safari can treat changing SVG
      // intrinsic dimensions as a viewport resize and visually zoom the page.
      svg.setAttribute('viewBox',`0 0 ${staff.viewW} ${staff.viewH}`);
      svg.setAttribute('preserveAspectRatio','xMidYMid meet');
      svg.setAttribute('width',String(staff.viewW));
      svg.setAttribute('height',String(staff.viewH));
      svg.style.setProperty('display','block');
      svg.style.setProperty('width','100%','important');
      svg.style.setProperty('height','auto','important');
      svg.style.setProperty('max-width','100%','important');
      svg.style.setProperty('min-width','0','important');
      svg.style.setProperty('aspect-ratio',`${staff.viewW} / ${staff.viewH}`);
      svg.dataset.contentWidth=String(staff.viewW);
      // Keep the clipping viewport tied to its parent, not to SVG content.
      viewport.style.width='100%';
      viewport.style.maxWidth='100%';
      viewport.style.minWidth='0';
      viewport.style.overflow='hidden';
    }
    function fitStaffSvg(svg, viewport, contentW, staff=STAFF) {
      // Keep the growing practice score entirely inside its own horizontal
      // scroller. Never let the score's intrinsic width contribute to the
      // document width (Safari on small iPhones can otherwise auto-scale the
      // page when another page of notes is added).
      viewport.style.width='100%';
      viewport.style.maxWidth='100%';
      viewport.style.minWidth='0';
      viewport.style.display='block';
      viewport.style.overflowX='auto';
      viewport.style.overflowY='hidden';
      const rectWidth=viewport.getBoundingClientRect?.().width||0;
      const measured=rectWidth||viewport.clientWidth||0;
      const available=Math.max(1,Math.floor(measured||Math.min(staff.viewW,window.innerWidth||staff.viewW)));
      const scale=available/staff.viewW;
      const width=contentW*scale;
      const height=staff.viewH*scale;
      svg.setAttribute('viewBox',`0 0 ${contentW} ${staff.viewH}`);
      svg.setAttribute('width',String(width));
      svg.setAttribute('height',String(height));
      svg.style.display='block';
      svg.style.width=`${width}px`;
      svg.style.height=`${height}px`;
      svg.style.maxWidth='none';
      svg.style.minWidth='0';
      svg.style.flex='none';
      svg.dataset.scale=String(scale);
      svg.dataset.contentWidth=String(contentW);
    }
    function editorPageOffset() { return editorPageIndex * PAGE_SPAN; }
    function editorLastUsedPage() {
      const xs=[...events.map(ev=>ev.x),...draftNotes.map(note=>note.x),...barLines,...(selectedNote?[selectedNote.x]:[])];
      return xs.length?Math.max(0,Math.floor((Math.max(...xs)-COLUMN_START)/PAGE_SPAN)):0;
    }
    function updateEditorPageNav() {
      $('composerPageLabel').textContent=`Page ${editorPageIndex+1}`;
      $('composerPrevPage').disabled=editorPageIndex<=0;
      // Permit one empty page beyond the latest page containing notes.
      $('composerNextPage').disabled=editorPageIndex>=editorLastUsedPage()+1;
    }
    function changeEditorPage(delta) {
      if(dragging||isPractising)return;
      const next=Math.max(0,Math.min(editorLastUsedPage()+1,editorPageIndex+delta));
      if(next===editorPageIndex)return;
      editorPageIndex=next;selectedNote=null;selectedHit=null;drawEditorStaff();
    }
    function groupByColumn(notes) {
      const groups=new Map();
      notes.forEach(note=>{
        const key=Math.round(note.x);
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(note);
      });
      return [...groups.entries()].sort((a,b)=>a[0]-b[0]);
    }
    function drawEditorStaff() {
      const svg=$('composerStaff');
      const viewport=$('composerViewport');
      const pageOffset=editorPageOffset();
      const pageMin=pageOffset+COLUMN_START-1;
      const pageMax=pageOffset+COLUMN_START+(PAGE_SLOTS-1)*COLUMN_GAP+1;
      let html=drawGrandStaffBase(STAFF.viewW,EDITOR,false);
      const columns=new Map();
      barLines.forEach(barX=>{
        const localX=barX-pageOffset;
        if(localX>=70&&localX<=STAFF.viewW-18){
          html+=`<line class="bar-line" data-bar-x="${barX}" x1="${localX}" y1="${EDITOR.treble.top-9}" x2="${localX}" y2="${EDITOR.bass.bottom+9}"/>`;
        }
      });
      const addToColumn=(note,state)=>{
        if(note.x<pageMin||note.x>pageMax)return;
        const x=Math.round(note.x-pageOffset);
        if(!columns.has(x))columns.set(x,[]);
        columns.get(x).push({note,state});
      };
      events.forEach(ev=>ev.notes.forEach(note=>addToColumn(note,'saved')));
      draftNotes.forEach(note=>addToColumn(note,'draft'));
      if(selectedNote)addToColumn(selectedNote,'preview');
      [...columns.entries()].sort((a,b)=>a[0]-b[0]).forEach(([x,entries])=>{
        html+=renderColumnMarkup(entries,x,EDITOR);
      });
      if(!columns.size){
        html+=`<text class="staff-hint" x="${STAFF.viewW/2}" y="${STAFF.viewH/2}" text-anchor="middle">${editorPageIndex===0?'Drag on either staff to place your first note':'Place notes on this page'}</text>`;
      }
      svg.innerHTML=html;
      fitEditorStaffSvg(svg,viewport,EDITOR);
      $('addBtn').disabled=events.length===0&&!draftNotes.length;
      $('clearNotesBtn').disabled=events.length===0&&!draftNotes.length&&!barLines.length;
      $('barLineBtn').setAttribute('aria-pressed',String(barLineMode));
      $('barLineBtn').textContent=barLineMode?'Tap a gap on the staff…':'＋ Add bar line';
      $('selectionDot').classList.toggle('ready',draftNotes.length>0||!!selectedNote);
      updateEditorPageNav();
    }
    function svgPoint(event, svg=$('composerStaff')) {
      const rect=svg.getBoundingClientRect();
      const vb=svg.viewBox.baseVal;
      return {
        x:(event.clientX-rect.left)*vb.width/rect.width,
        y:(event.clientY-rect.top)*vb.height/rect.height
      };
    }
    function nearestColumnX(rawX) {
      const columns=[...events.map(ev=>ev.x),...draftNotes.map(note=>note.x)];
      if(columns.length){
        const nearest=columns.reduce((best,x)=>Math.abs(x-rawX)<Math.abs(best-rawX)?x:best,columns[0]);
        if(Math.abs(nearest-rawX)<=SNAP_RADIUS)return nearest;
      }
      const slot=Math.max(0,Math.round((rawX-COLUMN_START)/COLUMN_GAP));
      return COLUMN_START+slot*COLUMN_GAP;
    }
    function pickNoteAt(point) {
      const clef=Math.abs(point.y-(EDITOR.treble.top+EDITOR.treble.bottom)/2)<=Math.abs(point.y-(EDITOR.bass.top+EDITOR.bass.bottom)/2)?'treble':'bass';
      const staffBottom=EDITOR[clef].bottom;
      const step=Math.max(-8,Math.min(17,Math.round((staffBottom-point.y)/EDITOR.stepY)));
      const pageOffset=editorPageOffset();
      const localX=Math.max(COLUMN_START,Math.min(COLUMN_START+(PAGE_SLOTS-1)*COLUMN_GAP,point.x));
      const x=nearestColumnX(pageOffset+localX);
      const note=noteFromStep(clef,step,Number($('accidentalSelect').value),x);
      if(note.midi<21||note.midi>108){showToast('That note is outside the piano keyboard range.');return null;}
      return note;
    }
    function findNoteHitFromEvent(event) {
      let node=event.target;
      while(node&&node!==$('composerStaff')){
        const id=Number(node.getAttribute?.('data-note-id'));
        if(id>0){
          for(const ev of events){const note=ev.notes.find(item=>item.id===id);if(note)return {source:'event',eventId:ev.id,note};}
          const draft=draftNotes.find(item=>item.id===id);
          if(draft)return {source:'draft',noteId:draft.id,note:draft};
        }
        node=node.parentNode;
      }
      return null;
    }
    function resetAttempt(){attempt={lastSoundAt:0,matched:new Set(),candidateFrames:new Map()};}
    function resetCarryover(){carryoverMidis.clear();carryoverReleaseFrames.clear();}
    function updateProgress() {
      const done=Math.min(completedIndices.size,events.length);
      $('progressCount').textContent=`${done} / ${events.length}`;
      $('progressFill').style.width=events.length?`${Math.min(100,done/events.length*100)}%`:'0%';
    }
    function resetPractice(renderStaff=true) {
      currentIndex=0;practiceViewStarted=false;completedIndices.clear();resetAttempt();resetCarryover();wrongFlash=[];clearTimeout(wrongFlashTimer);
      updateProgress();
      if(renderStaff&&practiceModeActive)renderPracticeStaff();
      if(practiceModeActive)$('practiceViewport').scrollLeft=0;
      $('startBtn').textContent='Start';
      $('startBtn').disabled=!events.length||isPractising;
      $('practiceHint').textContent=events.length?'Scroll through the music and tap a note or chord to choose where to start.':'Add notes to begin.';
    }
    function addDraftNotes() {
      if(!draftNotes.length)return;
      if(isPractising)stopPractice(false);
      const grouped=groupByColumn(draftNotes);
      grouped.forEach(([x,notes])=>{
        let event=events.find(ev=>Math.abs(ev.x-x)<1);
        if(!event){event={id:nextEventId++,x,notes:[]};events.push(event);}
        notes.forEach(note=>{
          if(!event.notes.some(existing=>existing.midi===note.midi&&existing.clef===note.clef)){
            event.notes.push({...note,id:nextNoteId++});
          }
        });
      });
      events=events.filter(ev=>ev.notes.length).sort((a,b)=>a.x-b.x);
      draftNotes=[];selectedNote=null;selectedHit=null;
      resetPractice(false);drawEditorStaff();
      $('editorHint').textContent='Music ready. Press Ready to open the landscape practice screen.';
    }
    function removeNoteHit(hit) {
      if(isPractising)stopPractice(false);
      if(hit.source==='draft'){
        draftNotes=draftNotes.filter(note=>note.id!==hit.noteId);
      }else{
        const event=events.find(ev=>ev.id===hit.eventId);
        if(event){event.notes=event.notes.filter(note=>note.id!==hit.note.id);if(!event.notes.length)events=events.filter(ev=>ev.id!==event.id);}
      }
      resetPractice();drawEditorStaff();renderPracticeStaff();
      $('editorHint').textContent='Note removed. Tap another note to remove it, or drag to add notes.';
    }
    function addOneDraftNote(note) {
      if(!note)return;
      const duplicate=[...draftNotes,...events.flatMap(ev=>ev.notes)].some(existing=>existing.midi===note.midi&&existing.clef===note.clef&&Math.abs(existing.x-note.x)<1);
      if(duplicate){showToast('That note is already in this chord.');return;}
      note.id=nextNoteId++;
      draftNotes.push(note);
      $('editorHint').textContent=`${draftNotes.length} new ${draftNotes.length===1?'note':'notes'} placed. Add more notes or bar lines, then press Ready.`;
    }
    function drawPracticeBase(contentW) {
      return drawGrandStaffBase(contentW,PRACTICE,true);
    }
    function practiceEventX(index) {
      return PRACTICE_START_X + index*practiceColumnGap;
    }
    function practiceBarX(barX) {
      if(!events.length)return PRACTICE_START_X;
      const rightIndex=events.findIndex(ev=>ev.x>barX);
      if(rightIndex===0)return PRACTICE_START_X-.5*practiceColumnGap;
      if(rightIndex<0)return PRACTICE_START_X+(events.length-.5)*practiceColumnGap;
      const leftIndex=rightIndex-1;
      const leftX=events[leftIndex].x,rightX=events[rightIndex].x;
      const fraction=Math.max(0,Math.min(1,(barX-leftX)/(rightX-leftX)));
      return PRACTICE_START_X+(leftIndex+fraction)*practiceColumnGap;
    }
    function getPracticeLayout(viewport) {
      const width=Math.max(1,viewport.clientWidth||window.innerWidth||800);
      const height=Math.max(1,viewport.clientHeight||220);
      // The staff height and 20-event logical width jointly determine scale.
      // If height is the limiting dimension on a very wide screen, increase
      // the horizontal pitch between events so a 21st chord cannot enter view.
      const scale=Math.min(width/PRACTICE_BASE_W,height/PRACTICE.viewH);
      const visibleUnits=width/scale;
      // A gap of at least one nineteenth of the viewport's logical width
      // prevents 21 event centres (and their noteheads) fitting at any scroll
      // offset, not just when the score is at its far-left starting position.
      const gapForTwenty=visibleUnits/(PRACTICE_MAX_VISIBLE_EVENTS-1);
      practiceColumnGap=events.length>=PRACTICE_MAX_VISIBLE_EVENTS
        ? Math.max(PRACTICE_MIN_STEP_X,gapForTwenty)
        : PRACTICE_MIN_STEP_X;
      const lastEventX=events.length?PRACTICE_START_X+(events.length-1)*practiceColumnGap:PRACTICE_START_X;
      // For scores up to 20 events, keep the staff filling the viewport. Longer
      // scores extend the SVG inside this scroller, never the document itself.
      const contentW=Math.ceil(Math.max(visibleUnits,lastEventX+PRACTICE_RIGHT_MARGIN)/10)*10;
      return {width,height,scale,contentW};
    }
    function fitPracticeSvg(svg,viewport,layout) {
      const {width,scale,contentW}=layout;
      const pixelW=contentW*scale;
      const pixelH=PRACTICE.viewH*scale;
      svg.setAttribute('viewBox',`0 0 ${contentW} ${PRACTICE.viewH}`);
      svg.setAttribute('width',String(pixelW));svg.setAttribute('height',String(pixelH));
      svg.style.display='block';svg.style.width=`${pixelW}px`;svg.style.height=`${pixelH}px`;
      svg.style.maxWidth='none';svg.style.minWidth='0';svg.style.flex='none';
      svg.style.marginLeft=pixelW<width?'auto':'0';svg.style.marginRight=pixelW<width?'auto':'0';
      svg.dataset.scale=String(scale);svg.dataset.contentWidth=String(contentW);
      svg.dataset.columnGap=String(practiceColumnGap);svg.dataset.maxVisible=String(PRACTICE_MAX_VISIBLE_EVENTS);
      viewport.style.width='100%';viewport.style.maxWidth='100%';viewport.style.minWidth='0';
      viewport.style.overflowX=contentW*scale>width+1?'auto':'hidden';
    }
    function renderPracticeStaff() {
      const svg=$('practiceStaff');
      const viewport=$('practiceViewport');
      if(!practiceModeActive){svg.innerHTML='';return;}
      const layout=getPracticeLayout(viewport);
      const contentW=layout.contentW;
      let html=drawPracticeBase(contentW);
      // Bar lines are mapped to the gap between the notes they separate.
      barLines.forEach(bar=>{
        const x=practiceBarX(bar);
        html+=`<line class="bar-line" x1="${x}" y1="${PRACTICE.treble.top-5}" x2="${x}" y2="${PRACTICE.bass.bottom+5}" style="stroke:#e2eee8;stroke-width:3.5"/>`;
      });
      events.forEach((ev,index)=>{
        const x=practiceEventX(index);
        const state=completedIndices.has(index)?'completed':index===currentIndex?'current':'future';
        html+=`<g class="practice-event ${index===currentIndex?'selected':''}" data-event-index="${index}">
          <rect class="practice-event-zone" x="${x-practiceColumnGap/2}" y="52" width="${practiceColumnGap}" height="${PRACTICE.bass.bottom+60-52}"/>
          ${renderNoteGroup(ev.notes,x,state,null,PRACTICE)}
        </g>`;
      });
      if(wrongFlash.length&&events[currentIndex]){
        const x=practiceEventX(currentIndex);
        const wrong=wrongFlash.map(m=>midiSpelling(m,m>=60?'treble':'bass'));
        html+=renderNoteGroup(wrong,x,'wrong',null,PRACTICE);
      }
      if(!events.length){
        html+=`<text class="staff-hint" x="${PRACTICE.viewW/2}" y="${PRACTICE.viewH/2}" text-anchor="middle" style="font-size:24px;font-weight:850">Add notes to begin</text>`;
      }else if(currentIndex>=events.length){
        html+=`<text class="staff-hint" x="${Math.max(PRACTICE.viewW/2,PRACTICE_START_X)}" y="${PRACTICE.viewH/2}" text-anchor="middle" style="font-size:24px;font-weight:850">All done! ✨</text>`;
      }
      svg.innerHTML=html;
      fitPracticeSvg(svg,viewport,layout);
      if(isPractising)requestAnimationFrame(scrollPracticeToCurrent);
    }
    function scrollPracticeToCurrent() {
      if(!practiceModeActive||!events.length)return;
      const viewport=$('practiceViewport');
      const scale=Number($('practiceStaff').dataset.scale)||1;
      const x=practiceEventX(Math.min(currentIndex,events.length-1))*scale;
      const rightPad=Math.min(42,viewport.clientWidth*.07);
      const targetScroll=Math.max(0,x-(viewport.clientWidth-rightPad));
      viewport.scrollLeft=targetScroll;
    }
    function selectPracticeEvent(index) {
      if(!practiceModeActive||isPractising||practiceStarting||index<0||index>=events.length)return;
      currentIndex=index;
      for(const done of [...completedIndices])if(done>=index)completedIndices.delete(done);
      resetAttempt();resetCarryover();wrongFlash=[];clearTimeout(wrongFlashTimer);
      $('wrongNoteMessage').hidden=true;
      updateProgress();renderPracticeStaff();
      $('practiceHint').textContent=`Starting point selected: ${index+1} of ${events.length}. Press Start when ready.`;
    }
    function addBarLineFromPoint(point) {
      const minGapX=COLUMN_START-COLUMN_GAP/2;
      const maxGapX=COLUMN_START+(PAGE_SLOTS-1.5)*COLUMN_GAP;
      if(point.x<minGapX-4||point.x>maxGapX+4){showToast('Tap a space between the note columns.');return;}
      const pageOffset=editorPageOffset();
      const target=Math.max(-1,Math.min(PAGE_SLOTS-2,Math.round((point.x-COLUMN_START)/COLUMN_GAP-.5)));
      const barX=pageOffset+COLUMN_START+(target+.5)*COLUMN_GAP;
      if(barLines.some(x=>Math.abs(x-barX)<10)){showToast('There is already a bar line in that space.');return;}
      barLines.push(barX);barLines.sort((a,b)=>a-b);
      barLineMode=false;drawEditorStaff();
      $('editorHint').textContent='Bar line added. It separates the notes on either side.';
    }
    function enterPracticeMode() {
      if(!events.length)return;
      practiceModeActive=true;practiceViewStarted=true;
      completedIndices.clear();currentIndex=0;resetAttempt();resetCarryover();wrongFlash=[];
      $('wrongNoteMessage').hidden=true;
      const panel=$('practicePanel');
      document.documentElement.classList.add('practice-mode');
      panel.classList.add('practice-fullscreen');
      $('startBtn').disabled=false;$('startBtn').textContent='Start';$('stopBtn').disabled=true;
      $('practiceHint').textContent='Scroll through the music and tap a note or chord to choose where to start.';
      // Use native element fullscreen where available (desktop and supported tablets).
      // iPhone Safari uses this fixed-screen PWA fallback plus a physical rotation.
      try{
        const request=panel.requestFullscreen||panel.webkitRequestFullscreen;
        if(request&&(document.fullscreenEnabled||panel.webkitRequestFullscreen)){
          Promise.resolve(request.call(panel,{navigationUI:'hide'})).then(()=>{
            try{if(practiceModeActive)screen.orientation?.lock?.('landscape')?.catch?.(()=>{});}catch(err){/* optional */}
          }).catch(()=>{
            try{if(practiceModeActive)screen.orientation?.lock?.('landscape')?.catch?.(()=>{});}catch(err){/* optional */}
          });
        }else{
          try{if(practiceModeActive)screen.orientation?.lock?.('landscape')?.catch?.(()=>{});}catch(err){/* not supported on iPhone Safari */}
        }
      }catch(err){/* CSS full-screen fallback remains active */}
      renderPracticeStaff();updateProgress();
      requestAnimationFrame(()=>{$('practiceViewport').scrollLeft=0;});
    }
    async function exitPracticeMode() {
      practiceStartToken++;practiceStarting=false;
      if(isPractising)stopPractice(false);
      else if(detector){try{detector.stop();}catch(err){}detector=null;}
      practiceModeActive=false;practiceViewStarted=false;
      $('practicePanel').classList.remove('practice-fullscreen');
      document.documentElement.classList.remove('practice-mode');
      try{screen.orientation?.unlock?.();}catch(err){/* optional */}
      if(document.fullscreenElement){try{await document.exitFullscreen();}catch(err){/* already exited */}}
      else if(document.webkitFullscreenElement&&document.webkitExitFullscreen){try{document.webkitExitFullscreen();}catch(err){/* optional */}}
      $('wrongNoteMessage').hidden=true;
      $('practiceHint').textContent='Practice closed. Make any changes, then press Ready to play again.';
      $('startBtn').disabled=!events.length;
      renderPracticeStaff();
    }
    function renderAll() { drawEditorStaff();renderPracticeStaff();updateProgress(); }
    function showWrong(midiValues) {
      wrongFlash=[...new Set(midiValues)];
      const message=$('wrongNoteMessage');message.hidden=false;message.textContent='Wrong note!';
      renderPracticeStaff();
      const now=Date.now();
      if(now-lastWrongSpokenAt>1300&&'speechSynthesis'in window&&'SpeechSynthesisUtterance'in window){
        lastWrongSpokenAt=now;
        try{window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance('Wrong note!');utterance.rate=1.08;utterance.pitch=1.05;utterance.volume=.85;window.speechSynthesis.speak(utterance);}catch(err){/* visual feedback still appears */}
      }
      clearTimeout(wrongFlashTimer);
      wrongFlashTimer=setTimeout(()=>{wrongFlash=[];message.hidden=true;renderPracticeStaff();},850);
    }

    function closestExpected(actual,expected,tolerance) {
      let best=-1,bestDiff=Infinity;
      expected.forEach((m,i)=>{const diff=Math.abs(actual-m);if(diff<=tolerance&&diff<bestDiff){best=i;bestDiff=diff;}});
      return best;
    }
    function updateCarryoverRelease(heardSet) {
      // Keep a completed pitch muted while it is still ringing. Three clear
      // detector frames (~35 ms) are enough to distinguish a real release
      // without requiring a long silence between slurred notes.
      for (const midi of [...carryoverMidis]) {
        if (heardSet.has(midi)) {
          carryoverReleaseFrames.set(midi, 0);
        } else {
          const clearFrames = (carryoverReleaseFrames.get(midi) || 0) + 1;
          carryoverReleaseFrames.set(midi, clearFrames);
          if (clearFrames >= 3) {
            carryoverMidis.delete(midi);
            carryoverReleaseFrames.delete(midi);
          }
        }
      }
    }
    function rememberTrailingPitches(completedEvent, nextEvent, heardSet) {
      const completed = new Set(completedEvent.notes.map(note => note.midi));
      const next = new Set((nextEvent?.notes || []).map(note => note.midi));
      const samePitchSet = completed.size === next.size && [...completed].every(midi => next.has(midi));
      for (const midi of completed) {
        // A pitch shared by two different chord shapes can remain held as a
        // common tone. An identical next event, however, needs a fresh strike.
        if (samePitchSet || !next.has(midi)) {
          carryoverMidis.add(midi);
          carryoverReleaseFrames.set(midi, 0);
        }
      }
    }
    function comparePlayed(notes) {
      if(!isPractising||currentIndex>=events.length)return;
      const now=performance.now();
      const heard=notes.filter(n=>n.prob>=Number($('sensitivitySelect').value)).map(n=>Math.round(n.midi));
      const unique=[...new Set(heard)];
      const heardSet=new Set(unique);
      updateCarryoverRelease(heardSet);

      const target=events[currentIndex];if(!target)return;
      if(!unique.length){
        // A brief gap clears an in-progress candidate, but already-confirmed
        // chord tones remain remembered while the player adds the other tones.
        attempt.candidateFrames.clear();
        return;
      }
      attempt.lastSoundAt=now;
      const expected=target.notes.map(n=>n.midi);
      const tolerance=Number($('toleranceSelect').value);
      const wrong=[];
      const candidateThisFrame=new Map();

      unique.forEach(midi=>{
        const idx=closestExpected(midi,expected,tolerance);
        if(idx>=0){
          const expectedMidi=expected[idx];
          // A note still ringing from the previous step must not count as a
          // new note in this step (important for tied/slurred transitions).
          if(carryoverMidis.has(midi)||carryoverMidis.has(expectedMidi))return;
          if(!candidateThisFrame.has(expectedMidi))candidateThisFrame.set(expectedMidi,idx);
        }else if(!carryoverMidis.has(midi)){
          wrong.push(midi);
        }
      });

      // Candidate notes must be present on consecutive frames. Count each
      // expected pitch only once per detector frame.
      for(const midi of [...attempt.candidateFrames.keys()]){
        if(!candidateThisFrame.has(midi))attempt.candidateFrames.delete(midi);
      }
      for(const [midi,idx] of candidateThisFrame){
        const frames=(attempt.candidateFrames.get(midi)||0)+1;
        attempt.candidateFrames.set(midi,frames);
        if(frames>=2)attempt.matched.add(idx);
      }
      if(wrong.length)showWrong(wrong);
      if(attempt.matched.size>=expected.length){
        const completedEvent=target;
        completedIndices.add(currentIndex);
        currentIndex++;
        rememberTrailingPitches(completedEvent,events[currentIndex],heardSet);
        resetAttempt();wrongFlash=[];clearTimeout(wrongFlashTimer);
        updateProgress();renderPracticeStaff();
        if(currentIndex<events.length)requestAnimationFrame(scrollPracticeToCurrent);
        if(currentIndex>=events.length){
          $('practiceHint').textContent='Wonderful! You played the whole piece. 🎉';
          stopPractice(true);
        }else $('practiceHint').textContent='Great! Find the next note on the staff.';
      }
    }
    async function startPractice() {
      if(!events.length||practiceStarting||isPractising)return;
      practiceStarting=true;
      const startToken=++practiceStartToken;
      try{
        $('startBtn').disabled=true;$('startBtn').textContent='Starting…';
        const {create}=await import('https://cdn.jsdelivr.net/npm/@markusstrasser/pitchplease@3.1.0/pitchplease.js');
        if(startToken!==practiceStartToken||!practiceModeActive)return;
        detector=create({model:'piano',threshold:{on:.6,off:.36},stabilityFrames:2,clearAfterMs:180,
          onNotes:(notes)=>comparePlayed(notes),
          onError:err=>{console.error(err);showToast(`Microphone issue: ${err.message||err.code||'check permission'}`);}
        });
        const ok=await detector.start();
        if(startToken!==practiceStartToken||!practiceModeActive){try{detector?.stop?.();}catch(err){}detector=null;practiceStarting=false;return;}
        if(!ok)throw new Error('The microphone could not start. Check Safari permission and try again.');
        practiceStarting=false;isPractising=true;resetAttempt();resetCarryover();
        $('startBtn').textContent='Playing';$('startBtn').disabled=true;$('stopBtn').disabled=false;
        $('practiceHint').textContent='Play the highlighted note or chord at the right side of the staff.';
        renderPracticeStaff();updateProgress();
        const monitor=()=>{if(!isPractising||!detector)return;if(detector.stats?.cpuLoad>.88&&detector.model==='piano'){detector.setModel('fast').catch(()=>{});}};
        clearInterval(cpuMonitorTimer);cpuMonitorTimer=setInterval(monitor,2500);
      }catch(err){
        if(startToken!==practiceStartToken)return;
        practiceStarting=false;console.error(err);detector?.stop?.();detector=null;isPractising=false;practiceViewStarted=true;
        $('startBtn').disabled=!events.length;$('startBtn').textContent='Start';$('stopBtn').disabled=true;
        $('practiceHint').textContent='';renderPracticeStaff();showToast(err.message||'Could not start the microphone.');
      }
    }
    function stopPractice(completed=false) {
      clearInterval(cpuMonitorTimer);cpuMonitorTimer=null;practiceStarting=false;
      if(detector){try{detector.stop();}catch(err){console.warn(err);}detector=null;}
      isPractising=false;$('startBtn').disabled=!events.length;$('startBtn').textContent=completed?'Play again':'Start';$('stopBtn').disabled=true;
      if(!completed)$('practiceHint').textContent='Paused. Scroll and tap a note or chord to choose a new starting point, or press Start to continue.';
      updateProgress();renderPracticeStaff();
    }

    // A single grand staff is used for both note entry and practice display.
    // Pointer capture keeps the live notehead stable while the SVG is redrawn.
    const composerSurface=$('composerStaff');
    composerSurface.addEventListener('pointerdown',event=>{
      if(event.button!==undefined&&event.button!==0)return;
      if(dragging||isPractising)return;
      const point=svgPoint(event,composerSurface);
      const barNode=event.target.closest?.('[data-bar-x]');
      if(barNode){
        const x=Number(barNode.getAttribute('data-bar-x'));
        barLines=barLines.filter(value=>Math.abs(value-x)>1);
        drawEditorStaff();$('editorHint').textContent='Bar line removed.';return;
      }
      if(barLineMode){addBarLineFromPoint(point);return;}
      selectedHit=findNoteHitFromEvent(event);
      pointerStart={x:event.clientX,y:event.clientY};
      dragMoved=false;dragging=true;activePointerId=event.pointerId;
      if(!selectedHit)selectedNote=pickNoteAt(point);
      try{composerSurface.setPointerCapture(event.pointerId);}catch(err){/* capture is optional */}
      drawEditorStaff();
    });
    composerSurface.addEventListener('pointermove',event=>{
      if(!dragging||event.pointerId!==activePointerId)return;
      const moved=Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y);
      if(moved>5)dragMoved=true;
      if(dragMoved||!selectedHit){
        selectedNote=pickNoteAt(svgPoint(event,composerSurface));
        drawEditorStaff();
      }
    });
    function finishEditorPointer(event,cancelled=false){
      if(!dragging||event.pointerId!==activePointerId)return;
      dragging=false;activePointerId=null;
      if(cancelled){selectedNote=null;selectedHit=null;pointerStart=null;drawEditorStaff();return;}
      if(selectedHit&&!dragMoved){
        const hit=selectedHit;selectedHit=null;selectedNote=null;pointerStart=null;
        removeNoteHit(hit);return;
      }
      if(selectedNote){
        if(selectedHit&&dragMoved){
          // Dragging an existing note repositions it; a simple tap removes it.
          if(selectedHit.source==='draft'){
            const index=draftNotes.findIndex(note=>note.id===selectedHit.noteId);
            if(index>=0){selectedNote.id=draftNotes[index].id;draftNotes[index]=selectedNote;}
          }else{
            const ev=events.find(item=>item.id===selectedHit.eventId);
            const movedId=selectedHit.note.id;
            if(ev){const index=ev.notes.findIndex(note=>note.id===movedId);if(index>=0)ev.notes.splice(index,1);}
            selectedNote.id=movedId;
            let destination=events.find(item=>Math.abs(item.x-selectedNote.x)<1);
            if(!destination){destination={id:nextEventId++,x:selectedNote.x,notes:[]};events.push(destination);}
            if(!destination.notes.some(note=>note.midi===selectedNote.midi&&note.clef===selectedNote.clef))destination.notes.push({...selectedNote,id:selectedNote.id>0?selectedNote.id:nextNoteId++});
            events=events.filter(item=>item.notes.length).sort((a,b)=>a.x-b.x);
          }
          selectedNote=null;selectedHit=null;pointerStart=null;resetPractice();drawEditorStaff();renderPracticeStaff();
          $('editorHint').textContent='Note moved. Notes in the same column form a chord.';
          return;
        }
        addOneDraftNote({...selectedNote});
      }
      selectedNote=null;selectedHit=null;pointerStart=null;drawEditorStaff();
    }
    composerSurface.addEventListener('pointerup',event=>finishEditorPointer(event,false));
    composerSurface.addEventListener('pointercancel',event=>finishEditorPointer(event,true));
    composerSurface.addEventListener('lostpointercapture',event=>finishEditorPointer(event,true));

    $('composerPrevPage').addEventListener('click',()=>changeEditorPage(-1));
    $('composerNextPage').addEventListener('click',()=>changeEditorPage(1));
    $('accidentalSelect').addEventListener('change',()=>{
      if(selectedNote)selectedNote.accidental=Number($('accidentalSelect').value);
      drawEditorStaff();
    });
    $('barLineBtn').addEventListener('click',()=>{
      barLineMode=!barLineMode;
      $('editorHint').textContent=barLineMode?'Tap one of the spaces between note columns to place a bar line. Tap an existing bar line to remove it.':'Drag on the staff to place notes.';
      drawEditorStaff();
    });
    $('addBtn').addEventListener('click',()=>{
      if(!events.length&&!draftNotes.length)return;
      addDraftNotes();
      if(!events.length)return;
      barLineMode=false;drawEditorStaff();enterPracticeMode();
    });
    $('clearNotesBtn').addEventListener('click',()=>{
      if(isPractising)stopPractice(false);
      events=[];draftNotes=[];barLines=[];selectedNote=null;selectedHit=null;editorPageIndex=0;barLineMode=false;
      resetPractice();drawEditorStaff();renderPracticeStaff();
      $('editorHint').textContent='Staff cleared. Drag on either clef to start again.';
    });
    $('startBtn').addEventListener('click',()=>{
      if(isPractising||!events.length)return;
      if(currentIndex>=events.length){completedIndices.clear();currentIndex=0;}
      resetAttempt();resetCarryover();wrongFlash=[];
      $('wrongNoteMessage').hidden=true;
      renderPracticeStaff();requestAnimationFrame(scrollPracticeToCurrent);startPractice();
    });
    $('stopBtn').addEventListener('click',()=>stopPractice(false));
    $('exitPracticeBtn').addEventListener('click',()=>exitPracticeMode());
    $('practiceStaff').addEventListener('click',event=>{
      const node=event.target.closest?.('[data-event-index]');
      if(!node)return;
      selectPracticeEvent(Number(node.getAttribute('data-event-index')));
    });
    const handleFullscreenChange=()=>{
      const nativeFullscreen=document.fullscreenElement||document.webkitFullscreenElement;
      if(practiceModeActive&&!nativeFullscreen&&$('practicePanel').classList.contains('practice-fullscreen')){
        // Browser Escape / system fullscreen exit: return to the editor cleanly.
        exitPracticeMode();
      }
    };
    document.addEventListener('fullscreenchange',handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange',handleFullscreenChange);
    window.addEventListener('resize',()=>{drawEditorStaff();if(practiceModeActive)renderPracticeStaff();});
    window.addEventListener('orientationchange',()=>setTimeout(()=>{drawEditorStaff();if(practiceModeActive)renderPracticeStaff();},250));
    if('serviceWorker'in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service worker:',err)));

    drawEditorStaff();renderPracticeStaff();updateProgress();
