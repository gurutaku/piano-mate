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
    const PRACTICE = STAFF;
    const COLUMN_START = 160;
    const COLUMN_GAP = 112;
    const SNAP_RADIUS = 43;
    const PRACTICE_START_X = STAFF.viewW - 112;

    let events = [];
    let draftNotes = [];
    let nextEventId = 1;
    let nextNoteId = 1;
    let selectedNote = null;
    let selectedHit = null;
    let dragging = false;
    let dragMoved = false;
    let pointerStart = null;
    let activePointerId = null;
    let detector = null;
    let isPractising = false;
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
      const accidentalMarkup = note.accidental===0 ? '' : `<text class="note-accidental${cls}" ${noteId} x="${x-39}" y="${y+13}">${glyph}</text>`;
      const ledger=ledgerMarkup(x,y,note.clef==='treble'?staff.treble.bottom:staff.bass.bottom,staff.stepY,note.step,'ledger-line',60);
      return `${ledger}${accidentalMarkup}
        ${state==='preview'?`<ellipse class="preview-ring" cx="${x}" cy="${y}" rx="31" ry="23"/>`:''}
        <ellipse class="notehead${cls}" ${noteId} cx="${x}" cy="${y}" rx="25" ry="17" transform="rotate(-18 ${x} ${y})"/>`;
    }
    function visualNoteX(note, notes, columnX) {
      const hasAdjacent = notes.some(other=>other!==note&&other.clef===note.clef&&Math.abs(other.step-note.step)===1);
      let offset = hasAdjacent ? (Math.abs(note.step)%2===0 ? -17 : 17) : 0;
      const samePosition = notes.filter(other=>other.clef===note.clef&&other.step===note.step);
      if(samePosition.length>1){const sameIndex=samePosition.indexOf(note);offset+=(sameIndex-(samePosition.length-1)/2)*24;}
      return columnX+offset;
    }
    function renderColumnMarkup(entries, columnX, staff=STAFF) {
      if(!entries.length)return '';
      const notes=entries.map(entry=>entry.note);
      const positions=entries.map(entry=>({note:entry.note,state:entry.state,x:visualNoteX(entry.note,notes,columnX),y:noteY(entry.note,staff)}));
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
        <text class="staff-label" x="${staff.left}" y="548">BASS</text>
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
    function fitStaffSvg(svg, viewport, contentW, staff=STAFF) {
      const available=Math.max(240,viewport.clientWidth||staff.viewW);
      const scale=available/staff.viewW;
      const width=contentW*scale;
      const height=staff.viewH*scale;
      svg.setAttribute('viewBox',`0 0 ${contentW} ${staff.viewH}`);
      svg.setAttribute('width',String(width));
      svg.setAttribute('height',String(height));
      svg.style.width=`${width}px`;
      svg.style.height=`${height}px`;
      svg.dataset.scale=String(scale);
      svg.dataset.contentWidth=String(contentW);
    }
    function staffContentWidth() {
      const allX=[...events.map(ev=>ev.x),...draftNotes.map(note=>note.x),...(selectedNote?[selectedNote.x]:[])];
      const maxX=allX.length?Math.max(...allX):COLUMN_START;
      return Math.max(STAFF.viewW,Math.ceil((maxX+88)/40)*40);
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
      const contentW=staffContentWidth();
      let html=drawGrandStaffBase(contentW,EDITOR,false);
      const columns=new Map();
      const addToColumn=(note,state)=>{
        const x=Math.round(note.x);
        if(!columns.has(x))columns.set(x,[]);
        columns.get(x).push({note,state});
      };
      events.forEach(ev=>ev.notes.forEach(note=>addToColumn(note,'saved')));
      draftNotes.forEach(note=>addToColumn(note,'draft'));
      if(selectedNote)addToColumn(selectedNote,'preview');
      [...columns.entries()].sort((a,b)=>a[0]-b[0]).forEach(([x,entries])=>{
        html+=renderColumnMarkup(entries,x,EDITOR);
      });
      if(!events.length&&!draftNotes.length&&!selectedNote){
        html+=`<text class="staff-hint" x="${STAFF.viewW/2}" y="${STAFF.viewH/2}" text-anchor="middle">Drag on either staff to place your first note</text>`;
      }
      svg.innerHTML=html;
      fitStaffSvg(svg,viewport,contentW,EDITOR);
      $('addBtn').disabled=draftNotes.length===0;
      $('clearNotesBtn').disabled=events.length===0&&!draftNotes.length;
      $('selectionDot').classList.toggle('ready',draftNotes.length>0||!!selectedNote);
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
      const x=nearestColumnX(Math.max(COLUMN_START,point.x));
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
      $('progressCount').textContent=`${Math.min(currentIndex,events.length)} / ${events.length}`;
      $('progressFill').style.width=events.length?`${Math.min(100,currentIndex/events.length*100)}%`:'0%';
    }
    function resetPractice() {
      currentIndex=0;practiceViewStarted=false;resetAttempt();resetCarryover();wrongFlash=[];clearTimeout(wrongFlashTimer);
      updateProgress();renderPracticeStaff();
      $('practiceViewport').scrollLeft=0;
      $('startBtn').textContent='🎹 Start practice';
      $('startBtn').disabled=!events.length||isPractising;
      $('practiceHint').textContent=events.length?'Scroll to preview your music, then start when ready.':'Add notes to begin.';
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
      resetPractice();drawEditorStaff();renderPracticeStaff();
      $('editorHint').textContent='Notes added. Keep building, or start playing the sequence.';
      showToast('Notes added to the grand staff.');
      requestAnimationFrame(()=>{
        const v=$('composerViewport');v.scrollLeft=Math.max(0,v.scrollWidth-v.clientWidth);
      });
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
      $('editorHint').textContent=`${draftNotes.length} new ${draftNotes.length===1?'note':'notes'} ready. Add notes when you are finished.`;
    }
    function drawPracticeBase(contentW) {
      return drawGrandStaffBase(contentW,PRACTICE,true);
    }
    function practiceOffset() {
      if(!practiceViewStarted||!events.length)return 0;
      return PRACTICE_START_X-events[0].x;
    }
    function practiceEventX(event) { return event.x+practiceOffset(); }
    function renderPracticeStaff() {
      const svg=$('practiceStaff');
      const viewport=$('practiceViewport');
      const offset=practiceOffset();
      const xs=events.map(ev=>ev.x+offset);
      const maxX=xs.length?Math.max(...xs):COLUMN_START;
      const contentW=Math.max(STAFF.viewW,Math.ceil((maxX+95)/40)*40);
      let html=drawPracticeBase(contentW);
      events.forEach((ev,index)=>{
        const state=practiceViewStarted?(index<currentIndex?'completed':index===currentIndex?'current':'future'):'future';
        html+=renderNoteGroup(ev.notes,practiceEventX(ev),state,null,PRACTICE);
      });
      if(wrongFlash.length&&events[currentIndex]){
        const x=practiceEventX(events[currentIndex]);
        const wrong=wrongFlash.map(m=>midiSpelling(m,m>=60?'treble':'bass'));
        html+=renderNoteGroup(wrong,x,'wrong',null,PRACTICE);
      }
      if(!events.length){
        html+=`<text class="staff-hint" x="${STAFF.viewW/2}" y="${STAFF.viewH/2}" text-anchor="middle" style="font-size:22px;font-weight:850">Add notes to begin</text>`;
      }else if(practiceViewStarted&&currentIndex>=events.length){
        html+=`<text class="staff-hint" x="${Math.max(STAFF.viewW/2,maxX)}" y="${STAFF.viewH/2}" text-anchor="middle" style="font-size:22px;font-weight:850">All done! ✨</text>`;
      }
      svg.innerHTML=html;
      fitStaffSvg(svg,viewport,contentW,PRACTICE);
      if(practiceViewStarted)requestAnimationFrame(scrollPracticeToCurrent);
    }
    function scrollPracticeToCurrent() {
      if(!practiceViewStarted||!events.length)return;
      const viewport=$('practiceViewport');
      const svg=$('practiceStaff');
      const scale=Number(svg.dataset.scale)||1;
      const current=events[Math.min(currentIndex,events.length-1)];
      if(!current)return;
      const x=practiceEventX(current)*scale;
      const rightPad=Math.min(58,viewport.clientWidth*.14);
      const targetScroll=Math.max(0,x-(viewport.clientWidth-rightPad));
      viewport.scrollLeft=targetScroll;
    }
    function renderAll() { drawEditorStaff();renderPracticeStaff();updateProgress(); }
    function showWrong(midiValues) {
      wrongFlash=[...new Set(midiValues)];renderPracticeStaff();clearTimeout(wrongFlashTimer);
      wrongFlashTimer=setTimeout(()=>{wrongFlash=[];renderPracticeStaff();},620);
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
      if(!events.length)return;
      try{
        $('startBtn').disabled=true;$('startBtn').textContent='Starting…';
        const {create}=await import('https://cdn.jsdelivr.net/npm/@markusstrasser/pitchplease@3.1.0/pitchplease.js');
        detector=create({model:'piano',threshold:{on:.6,off:.36},stabilityFrames:2,clearAfterMs:180,
          onNotes:(notes)=>comparePlayed(notes),
          onError:err=>{console.error(err);showToast(`Microphone issue: ${err.message||err.code||'check permission'}`);}
        });
        const ok=await detector.start();
        if(!ok)throw new Error('The microphone could not start. Check Safari permission and try again.');
        isPractising=true;resetAttempt();resetCarryover();
        $('startBtn').textContent='Practice running';$('startBtn').disabled=true;$('stopBtn').disabled=false;
        $('practiceHint').textContent='Play the note or chord at the right side of the staff.';
        renderPracticeStaff();updateProgress();
        const monitor=()=>{if(!isPractising||!detector)return;if(detector.stats?.cpuLoad>.88&&detector.model==='piano'){detector.setModel('fast').catch(()=>{});}};
        clearInterval(cpuMonitorTimer);cpuMonitorTimer=setInterval(monitor,2500);
      }catch(err){
        console.error(err);detector?.stop?.();detector=null;isPractising=false;practiceViewStarted=false;
        $('startBtn').disabled=!events.length;$('startBtn').textContent='🎹 Start practice';$('stopBtn').disabled=true;
        $('practiceHint').textContent='';renderPracticeStaff();showToast(err.message||'Could not start the microphone.');
      }
    }
    function stopPractice(completed=false) {
      clearInterval(cpuMonitorTimer);cpuMonitorTimer=null;
      if(detector){try{detector.stop();}catch(err){console.warn(err);}detector=null;}
      isPractising=false;$('startBtn').disabled=!events.length;$('startBtn').textContent=completed?'Practice again':'🎹 Start practice';$('stopBtn').disabled=true;
      if(!completed)$('practiceHint').textContent='Practice paused. Start again whenever you are ready.';
      updateProgress();renderPracticeStaff();
    }

    // A single grand staff is used for both note entry and practice display.
    // Pointer capture keeps the live notehead stable while the SVG is redrawn.
    const composerSurface=$('composerStaff');
    composerSurface.addEventListener('pointerdown',event=>{
      if(event.button!==undefined&&event.button!==0)return;
      if(dragging||isPractising)return;
      const point=svgPoint(event,composerSurface);
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

    $('accidentalSelect').addEventListener('change',()=>{
      if(selectedNote)selectedNote.accidental=Number($('accidentalSelect').value);
      drawEditorStaff();
    });
    $('addBtn').addEventListener('click',addDraftNotes);
    $('clearNotesBtn').addEventListener('click',()=>{
      if(isPractising)stopPractice(false);
      events=[];draftNotes=[];selectedNote=null;selectedHit=null;
      resetPractice();drawEditorStaff();renderPracticeStaff();
      $('editorHint').textContent='Staff cleared. Drag on either clef to start again.';
    });
    $('startBtn').addEventListener('click',()=>{
      if(isPractising||!events.length)return;
      currentIndex=0;practiceViewStarted=true;resetAttempt();resetCarryover();wrongFlash=[];
      renderPracticeStaff();requestAnimationFrame(scrollPracticeToCurrent);startPractice();
    });
    $('stopBtn').addEventListener('click',()=>stopPractice(false));
    window.addEventListener('resize',()=>{drawEditorStaff();renderPracticeStaff();});
    window.addEventListener('orientationchange',()=>setTimeout(()=>{drawEditorStaff();renderPracticeStaff();},250));
    if('serviceWorker'in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service worker:',err)));

    drawEditorStaff();renderPracticeStaff();updateProgress();
