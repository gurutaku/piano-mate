    const $ = id => document.getElementById(id);
    const LETTERS = ['C','D','E','F','G','A','B'];
    const LETTER_INDEX = {C:0,D:1,E:2,F:3,G:4,A:5,B:6};
    const NATURAL_PC = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
    const ACCIDENTAL_GLYPH = {'-1':'♭','0':'♮','1':'♯'};
    const EDITOR = {viewW:760,viewH:290,left:85,right:730,top:92,bottom:164,stepY:9,centerX:455};
    const PRACTICE = {
      viewW:760,viewH:350,left:94,right:730,
      treble:{top:42,bottom:114},bass:{top:226,bottom:298},stepY:9,centerX:414
    };

    let events = [];
    let nextEventId = 1;
    let activeClef = 'treble';
    let selectedNote = null;
    let chordMode = false;
    let chordDraft = [];
    let chordX = null;
    let dragging = false;
    let activePointerId = null;
    let detector = null;
    let isPractising = false;
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
    function noteFromStep(clef, step, accidental, x=EDITOR.centerX) {
      const base = clef==='treble' ? {letter:'E',octave:4} : {letter:'G',octave:2};
      const diatonic = base.octave*7 + LETTER_INDEX[base.letter] + step;
      const octave = Math.floor(diatonic/7);
      const letter = LETTERS[((diatonic%7)+7)%7];
      const acc = Number(accidental);
      return {clef,step,letter,accidental:acc,octave,midi:midiFromParts(letter,acc,octave),x};
    }
    function formatNote(note) {
      // Natural pitches use the plain note name; only sharps and flats
      // receive an accidental symbol in notation and sequence labels.
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
      return {clef,step,letter,accidental,octave,midi:n,x:0};
    }
    function safeText(value) { return String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function showToast(message) {
      const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);
      toastTimer=setTimeout(()=>el.classList.remove('show'),2200);
    }

    function noteY(note, staff) {
      const baseY = note.clef==='treble' ? staff.treble.bottom : staff.bass.bottom;
      return baseY - note.step*staff.stepY;
    }
    function ledgerMarkup(x,y,baseY,stepY,step,cls='ledger-line',length=34) {
      let html='';
      if (step>8) {
        for (let s=10;s<=step;s+=2) { const yy=baseY-s*stepY; html+=`<line class="${cls}" x1="${x-length/2}" y1="${yy}" x2="${x+length/2}" y2="${yy}"/>`; }
      } else if (step<0) {
        for (let s=-2;s>=step;s-=2) { const yy=baseY-s*stepY; html+=`<line class="${cls}" x1="${x-length/2}" y1="${yy}" x2="${x+length/2}" y2="${yy}"/>`; }
      }
      return html;
    }
    function noteMarkup(note, x, y, state='', staff=null) {
      const cls=state?` ${state}`:'';
      const glyph=ACCIDENTAL_GLYPH[String(note.accidental)]||'';
      const accidentalMarkup = note.accidental===0 ? '' : `<text class="note-accidental${cls}" x="${x-24}" y="${y+8}">${glyph}</text>`;
      const ledger=staff ? ledgerMarkup(x,y, note.clef==='treble'?staff.treble.bottom:staff.bass.bottom,staff.stepY,note.step) : '';
      return `${ledger}
        ${accidentalMarkup}
        ${state==='preview'?`<ellipse class="preview-ring" cx="${x}" cy="${y}" rx="17" ry="13"/>`:''}
        <ellipse class="notehead${cls}" cx="${x}" cy="${y}" rx="12" ry="8" transform="rotate(-18 ${x} ${y})"/>`;
    }
    function drawEditorStaff() {
      const svg=$('composerStaff');
      const base={top:EDITOR.top,bottom:EDITOR.bottom,stepY:EDITOR.stepY};
      let html=`<rect x="0" y="0" width="760" height="290" rx="13" fill="#fffefa"/>
        <text class="staff-label" x="${EDITOR.left}" y="34">${activeClef==='treble'?'TREBLE CLEF':'BASS CLEF'}</text>
        <text class="clef-mark" x="22" y="${activeClef==='treble'?157:155}">${activeClef==='treble'?'𝄞':'𝄢'}</text>`;
      for(let i=0;i<5;i++){const y=EDITOR.top+i*18;html+=`<line class="staff-line" x1="${EDITOR.left}" y1="${y}" x2="${EDITOR.right}" y2="${y}"/>`;}
      html+=`<line class="staff-separator" x1="${EDITOR.left}" y1="248" x2="${EDITOR.right}" y2="248"/>
        <text class="staff-hint" x="${EDITOR.left}" y="274">Drag up for higher notes · drag down for lower notes</text>`;
      // Keep the in-progress note visible in both single-note and chord modes.
      // In chord mode the committed draft notes share one x-position, while the
      // live preview remains visible as the player drags to choose its pitch.
      const shown=[...chordDraft];
      if(selectedNote) shown.push(selectedNote);
      shown.forEach((note,index)=>{
        const isLivePreview = note===selectedNote;
        const x=chordMode&&chordX!==null&&!isLivePreview?chordX:(note.x||EDITOR.centerX);
        const displayNote=note.clef===activeClef?note:{...midiSpelling(note.midi,activeClef),x};
        const y=EDITOR.bottom-displayNote.step*EDITOR.stepY;
        const state=chordDraft.includes(note)?'draft':'preview';
        html+=noteMarkup(displayNote,x,y,state, {treble:base,bass:base,stepY:EDITOR.stepY});
      });
      if(!shown.length){
        const ghostY=EDITOR.bottom-4*EDITOR.stepY;
        html+=`<ellipse cx="${EDITOR.centerX}" cy="${ghostY}" rx="12" ry="8" fill="#d6ddd7" stroke="#b9c6bd" stroke-width="1.5" stroke-dasharray="3 3" transform="rotate(-18 ${EDITOR.centerX} ${ghostY})"/>`;
      }
      svg.innerHTML=html;
      $('addBtn').disabled=chordMode ? chordDraft.length<2 : !selectedNote;
      $('addBtn').textContent=chordMode?'Add chord':'Add note';
      $('cancelChordBtn').disabled=!chordMode;
      $('chordToggle').classList.toggle('primary',chordMode);
      $('chordToggle').textContent=chordMode?'Chord mode on':'＋ Build a chord';
      $('chordToggle').setAttribute('aria-pressed',String(chordMode));
      $('selectionDot').classList.toggle('ready',chordMode?chordDraft.length>0:!!selectedNote);
    }
    function renderClefTabs() {
      $('trebleTab').classList.toggle('active',activeClef==='treble');
      $('bassTab').classList.toggle('active',activeClef==='bass');
      $('trebleTab').setAttribute('aria-pressed',String(activeClef==='treble'));
      $('bassTab').setAttribute('aria-pressed',String(activeClef==='bass'));
    }
    function svgPoint(event) {
      const svg=$('composerStaff');const rect=svg.getBoundingClientRect();
      return {x:(event.clientX-rect.left)*EDITOR.viewW/rect.width,y:(event.clientY-rect.top)*EDITOR.viewH/rect.height};
    }
    function pickNote(event) {
      const p=svgPoint(event);
      const step=Math.max(-7,Math.min(16,Math.round((EDITOR.bottom-p.y)/EDITOR.stepY)));
      const note=noteFromStep(activeClef,step,Number($('accidentalSelect').value),Math.max(EDITOR.left+55,Math.min(EDITOR.right-35,p.x)));
      if(note.midi<21||note.midi>108){showToast('That note is outside the piano keyboard range.');return null;}
      return note;
    }
    function addSelectedNote() {
      if(chordMode){
        if(chordDraft.length<2)return;
        appendEvent(chordDraft);
        showToast('Chord added to your music path.');
        chordDraft=[];chordX=null;selectedNote=null;chordMode=false;
        $('editorHint').textContent='Chord added. Drag on the staff to place the next note.';
      }else{
        if(!selectedNote)return;
        appendEvent([selectedNote]);
        $('editorHint').textContent=`${formatNote(selectedNote)} added. Drag to place the next note.`;
        selectedNote=null;
      }
      drawEditorStaff();renderSequence();renderPracticeStaff();
    }
    function appendEvent(notes) {
      const clean=[];const seen=new Set();
      notes.forEach(n=>{const k=`${n.midi}:${n.clef}`;if(!seen.has(k)){seen.add(k);clean.push({...n});}});
      if(clean.length)events.push({id:nextEventId++,notes:clean});
      if(isPractising)stopPractice(false);
      resetPractice();renderSequence();
    }
    function toggleChordMode() {
      if(chordMode){chordDraft=[];chordX=null;chordMode=false;selectedNote=null;$('editorHint').textContent='Chord cancelled. Drag on the staff to place a note.';}
      else{chordMode=true;chordDraft=[];chordX=null;selectedNote=null;$('editorHint').textContent='Place each chord note on the staff. Switch clefs for notes in both hands.';}
      drawEditorStaff();
    }
    function renderSequence() {
      const list=$('eventList');
      $('eventCount').textContent=`${events.length} ${events.length===1?'step':'steps'}`;
      $('clearNotesBtn').disabled=!events.length;
      $('startBtn').disabled=!events.length||isPractising;
      if(!events.length){list.innerHTML='<div class="empty-seq">Your music path is empty.<br>Place a note on the staff above to begin.</div>';updateProgress();return;}
      list.innerHTML=events.map((event,i)=>`<div class="event-row" data-event="${event.id}"><span class="event-num">${i+1}</span><div class="event-notes">${event.notes.map(n=>`<span class="note-chip">${safeText(formatNote(n))}<small>${n.clef==='treble'?'TR':'BS'}</small></span>`).join('')}</div><button class="remove-event" type="button" aria-label="Remove step ${i+1}">×</button></div>`).join('');
      updateProgress();
    }
    function updateProgress() {
      $('progressCount').textContent=`${Math.min(currentIndex,events.length)} / ${events.length}`;
      $('progressFill').style.width=events.length?`${Math.min(100,currentIndex/events.length*100)}%`:'0%';
    }
    function resetAttempt(){attempt={lastSoundAt:0,matched:new Set(),candidateFrames:new Map()};}
    function resetCarryover(){carryoverMidis.clear();carryoverReleaseFrames.clear();}
    function resetPractice(){currentIndex=0;resetAttempt();resetCarryover();wrongFlash=[];clearTimeout(wrongFlashTimer);updateProgress();renderPracticeStaff();}

    function noteStaffStep(note) { return note.step; }
    function noteClusterMarkup(notes, staff, state='') {
      const sorted=[...notes].sort((a,b)=>a.step-b.step);
      let html='';
      sorted.forEach((note,i)=>{
        const sameClef=sorted.filter(other=>other.clef===note.clef);
        const sameClefEarlier=sorted.slice(0,i).filter(prev=>prev.clef===note.clef&&prev.step===note.step).length;
        let x=staff.centerX;
        // Adjacent seconds alternate slightly left and right so noteheads remain distinct.
        const close=sameClef.some(other=>other!==note&&Math.abs(other.step-note.step)===1);
        if(close)x+=(note.step%2===0?-9:9);
        if(sameClefEarlier)x+=sameClefEarlier*15;
        const y=(note.clef==='treble'?staff.treble.bottom:staff.bass.bottom)-note.step*staff.stepY;
        html+=noteMarkup(note,x,y,state,staff);
      });
      return html;
    }
    function drawPracticeBase() {
      const s=PRACTICE;let html='<rect x="0" y="0" width="760" height="350" rx="13" fill="transparent"/>';
      html+=`<text class="clef-mark" x="25" y="${s.treble.bottom+7}">𝄞</text><text class="clef-mark" x="25" y="${s.bass.bottom+5}">𝄢</text>`;
      for(let i=0;i<5;i++){
        const ty=s.treble.top+i*18,by=s.bass.top+i*18;
        html+=`<line class="staff-line" x1="${s.left}" y1="${ty}" x2="${s.right}" y2="${ty}"/><line class="staff-line" x1="${s.left}" y1="${by}" x2="${s.right}" y2="${by}"/>`;
      }
      html+=`<line class="staff-separator" x1="${s.left}" y1="${s.treble.bottom+54}" x2="${s.right}" y2="${s.treble.bottom+54}"/>`;
      return html;
    }
    function renderPracticeStaff() {
      const svg=$('practiceStaff');let html=drawPracticeBase();
      const target=events[currentIndex];
      if(target){html+=noteClusterMarkup(target.notes,PRACTICE,'');}
      if(wrongFlash.length){
        const wrong=wrongFlash.map(m=>midiSpelling(m,m>=60?'treble':'bass'));
        html+=noteClusterMarkup(wrong,PRACTICE,'wrong');
      }
      if(!target){
        const label=events.length&&currentIndex>=events.length?'All done!':'Add notes to begin';
        html+=`<text class="staff-hint" x="${PRACTICE.centerX}" y="178" text-anchor="middle" style="font-size:17px;font-weight:800">${label}</text>`;
      }
      svg.innerHTML=html;
    }
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
        if(currentIndex>=events.length){
          $('practiceHint').textContent='Wonderful! You played the whole music path. 🎉';
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
        $('practiceHint').textContent='Play the highlighted note or chord.';
        updateProgress();
        const monitor=()=>{if(!isPractising||!detector)return;if(detector.stats?.cpuLoad>.88&&detector.model==='piano'){detector.setModel('fast').catch(()=>{});}};
        clearInterval(cpuMonitorTimer);cpuMonitorTimer=setInterval(monitor,2500);
      }catch(err){
        console.error(err);detector?.stop?.();detector=null;isPractising=false;
        $('startBtn').disabled=!events.length;$('startBtn').textContent='🎹 Start practice';$('stopBtn').disabled=true;
        $('practiceHint').textContent='';showToast(err.message||'Could not start the microphone.');
      }
    }
    function stopPractice(completed=false) {
      clearInterval(cpuMonitorTimer);cpuMonitorTimer=null;
      if(detector){try{detector.stop();}catch(err){console.warn(err);}detector=null;}
      isPractising=false;$('startBtn').disabled=!events.length;$('startBtn').textContent=completed?'Practice again':'🎹 Start practice';$('stopBtn').disabled=true;
      if(!completed)$('practiceHint').textContent='Practice paused. Start again whenever you are ready.';
      updateProgress();
    }

    // Pointer events stay on the stable wrapper while the SVG redraws. This is
    // important on touch screens: replacing SVG children during a drag must not
    // interrupt the pointer stream or hide the live notehead preview.
    const composerSurface=$('composerSurface');
    composerSurface.addEventListener('pointerdown',event=>{
      if(event.button!==undefined&&event.button!==0)return;
      if(dragging)return; // Ignore a second finger until the active drag ends.
      const note=pickNote(event);if(!note)return;
      event.preventDefault();dragging=true;activePointerId=event.pointerId;
      try{composerSurface.setPointerCapture(event.pointerId);}catch(err){/* capture is optional */}
      selectedNote=note;
      drawEditorStaff();
    });
    composerSurface.addEventListener('pointermove',event=>{
      if(!dragging||event.pointerId!==activePointerId)return;
      const note=pickNote(event);if(!note)return;
      // Keep chord notes aligned in one column after the first note is placed;
      // the live notehead still follows the finger vertically with clear preview.
      selectedNote=chordMode&&chordX!==null?{...note,x:chordX}:note;
      drawEditorStaff();
    });
    function releaseStaffPointer(event){
      if(!dragging||event.pointerId!==activePointerId)return;
      dragging=false;activePointerId=null;
      if(chordMode&&selectedNote){
        // The first released note establishes the chord column. Later notes snap
        // to it, while their pitch is selected independently by dragging.
        if(chordX===null)chordX=selectedNote.x;
        const placedNote={...selectedNote,x:chordX};
        const duplicate=chordDraft.some(n=>n.midi===placedNote.midi&&n.clef===placedNote.clef);
        if(!duplicate)chordDraft.push(placedNote);
        selectedNote=null;
        $('editorHint').textContent=`${chordDraft.length} chord ${chordDraft.length===1?'note':'notes'} placed. Drag to add another note, or add the chord.`;
      }else if(selectedNote){
        $('editorHint').textContent=`${formatNote(selectedNote)} selected. Choose Add note to place it in your music path.`;
      }
      drawEditorStaff();
    }
    composerSurface.addEventListener('pointerup',releaseStaffPointer);
    composerSurface.addEventListener('pointercancel',releaseStaffPointer);
    composerSurface.addEventListener('lostpointercapture',releaseStaffPointer);

    $('trebleTab').addEventListener('click',()=>{activeClef='treble';selectedNote=null;renderClefTabs();drawEditorStaff();});
    $('bassTab').addEventListener('click',()=>{activeClef='bass';selectedNote=null;renderClefTabs();drawEditorStaff();});
    $('accidentalSelect').addEventListener('change',()=>{
      if(selectedNote){selectedNote=noteFromStep(selectedNote.clef,selectedNote.step,Number($('accidentalSelect').value),selectedNote.x);}
      drawEditorStaff();
    });
    $('chordToggle').addEventListener('click',toggleChordMode);
    $('cancelChordBtn').addEventListener('click',toggleChordMode);
    $('addBtn').addEventListener('click',addSelectedNote);
    $('clearNotesBtn').addEventListener('click',()=>{
      if(isPractising)stopPractice(false);events=[];chordDraft=[];chordX=null;selectedNote=null;chordMode=false;resetPractice();renderSequence();drawEditorStaff();
      $('editorHint').textContent='Music path cleared. Drag on the staff to begin again.';
    });
    $('eventList').addEventListener('click',event=>{
      const remove=event.target.closest('.remove-event');if(!remove)return;
      const row=remove.closest('[data-event]');if(isPractising)stopPractice(false);
      events=events.filter(item=>item.id!==Number(row.dataset.event));resetPractice();renderSequence();
    });
    $('startBtn').addEventListener('click',()=>{if(isPractising)return;currentIndex=0;resetAttempt();resetCarryover();wrongFlash=[];renderPracticeStaff();startPractice();});
    $('stopBtn').addEventListener('click',()=>stopPractice(false));
    window.addEventListener('resize',()=>{drawEditorStaff();renderPracticeStaff();});
    window.addEventListener('orientationchange',()=>setTimeout(()=>{drawEditorStaff();renderPracticeStaff();},250));
    if('serviceWorker'in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service worker:',err)));

    renderClefTabs();drawEditorStaff();renderSequence();renderPracticeStaff();
