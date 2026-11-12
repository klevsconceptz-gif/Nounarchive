(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const requestedId = params.get('id') || '';
  const titleEl = $('tool-title');
  const descriptionEl = $('tool-description');
  const categoryEl = $('tool-category');
  const content = $('tool-content');
  const notice = $('tool-notice');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const slug = value => String(value || 'resource').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,80) || 'resource';
  let record;
  let resources = [];
  const key = `nounarchive-tool:${requestedId}`;

  function readState(fallback) {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeState(value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      notice.textContent = 'Saved on this device.';
      return true;
    } catch {
      notice.textContent = 'Browser storage is unavailable; your entry could not be saved.';
      return false;
    }
  }

  function setMessage(target, message, error = false) {
    target.textContent = message;
    target.classList.toggle('is-error', error);
  }

  function addPageLink(href, label) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    return a;
  }

  function renderGrades() {
    content.innerHTML = `
      <div class="tool-intro-note"><strong>Weighted grade calculator</strong><span>Enter course units and grades. Add previous CGPA details for a cumulative estimate.</span></div>
      <form id="grade-form" class="tool-form">
        <div class="tool-grid"><label>Previous CGPA (optional)<input id="prior-cgpa" type="number" min="0" max="5" step="0.01" inputmode="decimal"></label><label>Previously completed units<input id="prior-units" type="number" min="0" max="1000" step="1" inputmode="numeric" value="0"></label></div>
        <div class="tool-section-head"><h2>Courses</h2><button id="add-course" class="secondary" type="button">Add course</button></div>
        <div id="grade-rows" class="tool-rows"></div>
        <button class="primary" type="submit">Calculate GPA</button>
      </form>
      <output id="grade-result" class="tool-result" aria-live="polite">Add your courses to calculate a weighted GPA.</output>
      <p class="tool-help">Grade points used: A 5, B 4, C 3, D 2, E 1, F 0. This workspace calculates only the values you enter.</p>`;
    const saved = readState({ courses: [{}], priorCgpa: '', priorUnits: 0 });
    const rows = $('grade-rows');
    $('prior-cgpa').value = saved.priorCgpa ?? '';
    $('prior-units').value = saved.priorUnits ?? 0;
    const getRows = () => [...rows.querySelectorAll('.tool-row')].map(row => ({
      course: row.querySelector('[data-course]').value,
      units: row.querySelector('[data-units]').value,
      grade: row.querySelector('[data-grade]').value
    }));
    const persist = () => writeState({ courses: getRows(), priorCgpa: $('prior-cgpa').value, priorUnits: $('prior-units').value });
    const addRow = values => {
      const row = document.createElement('div');
      row.className = 'tool-row grade-row';
      row.innerHTML = `<label>Course / code<input data-course maxlength="100" value="${escape(values?.course || '')}" placeholder="e.g. Course code"></label><label>Units<input data-units type="number" min="1" max="30" step="1" inputmode="numeric" value="${escape(values?.units ?? '')}" required></label><label>Grade<select data-grade><option value="A">A · 5 points</option><option value="B">B · 4 points</option><option value="C">C · 3 points</option><option value="D">D · 2 points</option><option value="E">E · 1 point</option><option value="F">F · 0 points</option></select></label><button class="icon-button" type="button" data-remove aria-label="Remove course">Remove</button>`;
      if (values?.grade) row.querySelector('[data-grade]').value = values.grade;
      rows.append(row);
      row.addEventListener('input', persist);
      row.addEventListener('change', persist);
      row.querySelector('[data-remove]').addEventListener('click', () => { row.remove(); persist(); });
    };
    for (const course of (Array.isArray(saved.courses) && saved.courses.length ? saved.courses : [{}])) addRow(course);
    $('add-course').addEventListener('click', () => addRow({}));
    $('prior-cgpa').addEventListener('input', persist);
    $('prior-units').addEventListener('input', persist);
    $('grade-form').addEventListener('submit', event => {
      event.preventDefault();
      const courses = getRows().filter(row => row.units !== '');
      const invalid = courses.find(row => !Number.isFinite(Number(row.units)) || Number(row.units) < 1 || Number(row.units) > 30);
      const priorCgpa = Number($('prior-cgpa').value || 0);
      const priorUnits = Number($('prior-units').value || 0);
      if (!courses.length || invalid || (priorUnits > 0 && (priorCgpa < 0 || priorCgpa > 5))) {
        setMessage($('grade-result'), 'Enter at least one course, valid unit values, and a CGPA between 0 and 5 when using previous units.', true);
        return;
      }
      const points = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
      const units = courses.reduce((sum, course) => sum + Number(course.units), 0);
      const score = courses.reduce((sum, course) => sum + points[course.grade] * Number(course.units), 0);
      const totalUnits = units + priorUnits;
      const gpa = totalUnits ? (score + priorCgpa * priorUnits) / totalUnits : 0;
      setMessage($('grade-result'), `Weighted GPA: ${gpa.toFixed(2)} · ${totalUnits} total units`);
      persist();
    });
  }

  function renderBudget() {
    content.innerHTML = `
      <div class="tool-intro-note"><strong>Semester cost planner</strong><span>Add the amounts you want to budget. The total uses your entries and does not assume an official fee schedule.</span></div>
      <form id="budget-form" class="tool-form"><div class="tool-grid"><label>Item<input id="budget-name" maxlength="100" placeholder="e.g. Registration" required></label><label>Amount (₦)<input id="budget-amount" type="number" min="0" step="0.01" inputmode="decimal" required></label></div><div class="form-actions"><button class="primary" type="submit">Add to estimate</button><button id="budget-clear" class="secondary" type="button">Clear estimate</button></div></form>
      <div id="budget-list" class="tool-list"></div><output id="budget-total" class="tool-result">Estimated total: ₦0.00</output>`;
    let items = readState([]);
    if (!Array.isArray(items)) items = [];
    const render = () => {
      $('budget-list').innerHTML = items.map((item, index) => `<div class="tool-list-row"><span>${escape(item.name)}</span><strong>₦${Number(item.amount).toLocaleString('en-NG', {minimumFractionDigits:2, maximumFractionDigits:2})}</strong><button class="icon-button" type="button" data-delete="${index}" aria-label="Remove ${escape(item.name)}">Remove</button></div>`).join('') || '<p class="tool-empty">Add items to build your estimate.</p>';
      const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      $('budget-total').textContent = `Estimated total: ₦${total.toLocaleString('en-NG', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
      $('budget-list').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => { items.splice(Number(button.dataset.delete), 1); writeState(items); render(); }));
    };
    $('budget-form').addEventListener('submit', event => {
      event.preventDefault();
      const amount = Number($('budget-amount').value);
      const name = $('budget-name').value.trim();
      if (!name || !Number.isFinite(amount) || amount < 0) return;
      items.push({ name, amount });
      writeState(items); render(); event.target.reset(); $('budget-name').focus();
    });
    $('budget-clear').addEventListener('click', () => { items = []; writeState(items); render(); });
    render();
  }

  function renderTimePlanner(calendar = false) {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    content.innerHTML = calendar ? `
      <div class="tool-intro-note"><strong>Personal academic calendar</strong><span>Add important dates and reminders you want to keep in view.</span></div>
      <form id="event-form" class="tool-form"><div class="tool-grid"><label>Event<input id="event-name" maxlength="120" required placeholder="e.g. Study session"></label><label>Date<input id="event-date" type="date" required></label><label>Time (optional)<input id="event-time" type="time"></label><label>Notes (optional)<input id="event-note" maxlength="240"></label></div><button class="primary" type="submit">Add calendar event</button></form><div id="event-list" class="tool-list"></div>` : `
      <div class="tool-intro-note"><strong>Weekly timetable</strong><span>Add class, study, or exam blocks. Overlapping blocks on the same day are flagged before saving.</span></div>
      <form id="event-form" class="tool-form"><div class="tool-grid"><label>Activity<input id="event-name" maxlength="120" required placeholder="e.g. Study group"></label><label>Day<select id="event-day">${days.map(day=>`<option>${day}</option>`).join('')}</select></label><label>Start<input id="event-start" type="time" required></label><label>End<input id="event-end" type="time" required></label></div><button class="primary" type="submit">Add timetable block</button><p id="schedule-status" class="tool-inline-status" role="status"></p></form><div id="event-list" class="tool-list"></div>`;
    let items = readState([]);
    if (!Array.isArray(items)) items = [];
    const render = () => {
      const sorted = [...items].sort((a,b) => calendar ? `${a.date} ${a.time||''}`.localeCompare(`${b.date} ${b.time||''}`) : `${days.indexOf(a.day)} ${a.start}`.localeCompare(`${days.indexOf(b.day)} ${b.start}`));
      $('event-list').innerHTML = sorted.map(item => `<div class="tool-list-row"><div><strong>${escape(item.name)}</strong><small>${calendar ? `${escape(item.date)}${item.time ? ` · ${escape(item.time)}` : ''}` : `${escape(item.day)} · ${escape(item.start)}–${escape(item.end)}`}${item.note ? ` · ${escape(item.note)}` : ''}</small></div><button class="icon-button" type="button" data-delete="${escape(item.key)}">Remove</button></div>`).join('') || '<p class="tool-empty">No items saved yet.</p>';
      $('event-list').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => { items = items.filter(item => item.key !== button.dataset.delete); writeState(items); render(); }));
    };
    $('event-form').addEventListener('submit', event => {
      event.preventDefault();
      const row = { key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: $('event-name').value.trim() };
      if (calendar) {
        row.date = $('event-date').value;
        row.time = $('event-time').value;
        row.note = $('event-note').value.trim();
        if (!row.name || !row.date) return;
      } else {
        row.day = $('event-day').value;
        row.start = $('event-start').value;
        row.end = $('event-end').value;
        if (!row.name || !row.start || !row.end || row.start >= row.end) {
          setMessage($('schedule-status'), 'Choose a valid start and end time.', true);
          return;
        }
        const start = row.start.split(':').reduce((hour, part) => hour * 60 + Number(part), 0);
        const end = row.end.split(':').reduce((hour, part) => hour * 60 + Number(part), 0);
        const collision = items.some(item => item.day === row.day && start < item.end.split(':').reduce((h,p)=>h*60+Number(p),0) && end > item.start.split(':').reduce((h,p)=>h*60+Number(p),0));
        if (collision) {
          setMessage($('schedule-status'), 'That time overlaps another saved block. Change the day or time and try again.', true);
          return;
        }
      }
      items.push(row); writeState(items); render(); event.target.reset();
      if (!calendar) setMessage($('schedule-status'), 'Timetable block saved.');
    });
    render();
  }

  function renderPlanner() {
    content.innerHTML = `
      <div class="tool-intro-note"><strong>Study task planner</strong><span>Turn a goal into a dated task list and check items off as you finish.</span></div>
      <form id="task-form" class="tool-form"><div class="tool-grid"><label>Task<input id="task-name" maxlength="140" required placeholder="e.g. Review unit 3"></label><label>Course or area<input id="task-course" maxlength="80" placeholder="Optional"></label><label>Due date<input id="task-date" type="date"></label></div><button class="primary" type="submit">Add study task</button></form><div id="task-list" class="tool-list"></div>`;
    let tasks = readState([]);
    if (!Array.isArray(tasks)) tasks = [];
    const render = () => {
      tasks.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      $('task-list').innerHTML = tasks.map((task,index)=>`<div class="tool-list-row ${task.done?'is-done':''}"><label class="check-row"><input type="checkbox" data-done="${index}" ${task.done?'checked':''}><span><strong>${escape(task.name)}</strong><small>${escape(task.course||'General study')}${task.date?` · Due ${escape(task.date)}`:''}</small></span></label><button class="icon-button" type="button" data-delete="${index}" aria-label="Remove ${escape(task.name)}">Remove</button></div>`).join('') || '<p class="tool-empty">Add a task to start your plan.</p>';
      $('task-list').querySelectorAll('[data-done]').forEach(input=>input.addEventListener('change',()=>{tasks[Number(input.dataset.done)].done=input.checked;writeState(tasks);render();}));
      $('task-list').querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>{tasks.splice(Number(button.dataset.delete),1);writeState(tasks);render();}));
    };
    $('task-form').addEventListener('submit',event=>{event.preventDefault();tasks.push({name:$('task-name').value.trim(),course:$('task-course').value.trim(),date:$('task-date').value,done:false});writeState(tasks);render();event.target.reset();});
    render();
  }

  function renderPractice() {
    content.innerHTML = `
      <div class="tool-intro-note"><strong>Build a private practice set</strong><span>Add questions from your own study material, then reveal answers while you revise.</span></div>
      <form id="question-form" class="tool-form"><label>Question<textarea id="question-text" rows="3" maxlength="1000" required placeholder="Write a question to practise"></textarea></label><label>Answer or explanation<textarea id="answer-text" rows="3" maxlength="1800" required placeholder="Add the answer or a short explanation"></textarea></label><button class="primary" type="submit">Add to practice set</button></form><div id="question-list" class="tool-list"></div>`;
    let questions = readState([]);
    if (!Array.isArray(questions)) questions = [];
    const render = () => {
      $('question-list').innerHTML = questions.map((question,index)=>`<article class="practice-card"><h3>${escape(question.question)}</h3><p class="answer-text" data-answer="${index}" hidden>${escape(question.answer)}</p><div class="form-actions"><button class="secondary" type="button" data-reveal="${index}">Show answer</button><button class="icon-button" type="button" data-delete="${index}">Remove</button></div></article>`).join('') || '<p class="tool-empty">No practice questions saved yet. Add a question to begin.</p>';
      $('question-list').querySelectorAll('[data-reveal]').forEach(button=>button.addEventListener('click',()=>{const answer=$(`answer-${button.dataset.reveal}`) || $('question-list').querySelector(`[data-answer="${button.dataset.reveal}"]`);if(!answer)return;answer.hidden=!answer.hidden;button.textContent=answer.hidden?'Show answer':'Hide answer';}));
      $('question-list').querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>{questions.splice(Number(button.dataset.delete),1);writeState(questions);render();}));
    };
    $('question-form').addEventListener('submit',event=>{event.preventDefault();questions.push({question:$('question-text').value.trim(),answer:$('answer-text').value.trim()});writeState(questions);render();event.target.reset();});
    render();
  }

  function renderAdmissions() {
    const defaults = [
      'Choose a programme and entry route to investigate',
      'Confirm the current programme-specific requirements',
      'List the certificates and documents you need',
      'Record dates and questions to verify before applying',
      'Save your next follow-up action'
    ];
    const state = readState({ checks: defaults.map(text=>({text,done:false})), note:'' });
    if (!Array.isArray(state.checks)) state.checks = defaults.map(text=>({text,done:false}));
    content.innerHTML = `<div class="tool-intro-note"><strong>Personal application checklist</strong><span>Use this to organise questions and documents. Verify official, programme-specific details through your normal student-admission process.</span></div><form id="check-form" class="tool-form"><div class="tool-grid"><label>Add a checklist item<input id="check-new" maxlength="140" placeholder="e.g. Ask about an entry document"></label><button class="secondary align-end" type="submit">Add item</button></div></form><div id="check-list" class="tool-list"></div><label class="tool-note-label">My application notes<textarea id="application-note" rows="5" maxlength="3000" placeholder="Keep personal questions and next steps here"></textarea></label>`;
    const render = () => {
      $('check-list').innerHTML = state.checks.map((item,index)=>`<div class="tool-list-row ${item.done?'is-done':''}"><label class="check-row"><input type="checkbox" data-check="${index}" ${item.done?'checked':''}><span>${escape(item.text)}</span></label><button class="icon-button" type="button" data-delete="${index}">Remove</button></div>`).join('');
      $('check-list').querySelectorAll('[data-check]').forEach(input=>input.addEventListener('change',()=>{state.checks[Number(input.dataset.check)].done=input.checked;writeState(state);render();}));
      $('check-list').querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>{state.checks.splice(Number(button.dataset.delete),1);writeState(state);render();}));
    };
    $('application-note').value=state.note||'';
    $('application-note').addEventListener('input',()=>{state.note=$('application-note').value;writeState(state);});
    $('check-form').addEventListener('submit',event=>{event.preventDefault();const value=$('check-new').value.trim();if(value){state.checks.push({text:value,done:false});writeState(state);render();event.target.reset();}});
    render();
  }

  function renderOpportunities() {
    content.innerHTML = `<div class="tool-intro-note"><strong>Opportunity tracker</strong><span>Track scholarship, career, internship, or other opportunities you have found.</span></div><form id="opportunity-form" class="tool-form"><div class="tool-grid"><label>Opportunity<input id="opportunity-name" maxlength="140" required></label><label>Deadline<input id="opportunity-date" type="date"></label><label>Next step<input id="opportunity-next" maxlength="120" placeholder="Optional"></label></div><button class="primary" type="submit">Save opportunity</button></form><div id="opportunity-list" class="tool-list"></div>`;
    let items=readState([]);if(!Array.isArray(items))items=[];
    const render=()=>{
      $('opportunity-list').innerHTML=items.map((item,index)=>`<div class="tool-list-row"><div><strong>${escape(item.name)}</strong><small>${item.date?`Deadline ${escape(item.date)}`:'No deadline added'}${item.next?` · Next: ${escape(item.next)}`:''}</small></div><button class="icon-button" data-delete="${index}" type="button">Remove</button></div>`).join('')||'<p class="tool-empty">No opportunities saved yet.</p>';
      $('opportunity-list').querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>{items.splice(Number(button.dataset.delete),1);writeState(items);render();}));
    };
    $('opportunity-form').addEventListener('submit',event=>{event.preventDefault();items.push({name:$('opportunity-name').value.trim(),date:$('opportunity-date').value,next:$('opportunity-next').value.trim()});writeState(items);render();event.target.reset();});render();
  }

  function renderProject() {
    content.innerHTML = `<div class="tool-intro-note"><strong>Project and seminar outline builder</strong><span>Use your own topic inputs to generate editable title frameworks and a planning checklist.</span></div><form id="project-form" class="tool-form"><div class="tool-grid"><label>Subject or theme<input id="project-theme" maxlength="120" required placeholder="e.g. online learning"></label><label>Population / group<input id="project-group" maxlength="100" placeholder="e.g. undergraduate students"></label><label>Location or context<input id="project-place" maxlength="100" placeholder="Optional"></label><label>Focus<input id="project-focus" maxlength="100" placeholder="e.g. access, outcomes, experience"></label></div><button class="primary" type="submit">Generate title ideas</button></form><div id="project-results" class="tool-list"></div><p class="tool-help">Review and refine each idea to match your programme requirements and research scope.</p>`;
    const saved=readState({theme:'',group:'',place:'',focus:''});
    $('project-theme').value=saved.theme||'';$('project-group').value=saved.group||'';$('project-place').value=saved.place||'';$('project-focus').value=saved.focus||'';
    const makeTitles=(theme,group,place,focus)=>{
      const subject=theme.trim(),population=group.trim()||'selected learners',context=place.trim()||'a selected study setting',outcome=focus.trim()||'student experience';
      return [
        `An assessment of ${subject} and ${outcome} among ${population} in ${context}`,
        `Factors influencing ${subject} among ${population}: evidence from ${context}`,
        `The relationship between ${subject} and ${outcome}: a study of ${population}`,
        `Evaluating approaches to ${subject} in ${context}`,
        `Challenges and opportunities in ${subject}: perspectives from ${population}`
      ];
    };
    $('project-form').addEventListener('submit',event=>{
      event.preventDefault();const values={theme:$('project-theme').value.trim(),group:$('project-group').value.trim(),place:$('project-place').value.trim(),focus:$('project-focus').value.trim()};
      const titles=makeTitles(values.theme,values.group,values.place,values.focus);
      writeState({...values,titles});
      $('project-results').innerHTML=titles.map((title,index)=>`<div class="tool-list-row"><span><strong>${index+1}.</strong> ${escape(title)}</span><button class="secondary" data-copy="${index}" type="button">Copy</button></div>`).join('');
    });
    if(saved.titles?.length){$('project-results').innerHTML=saved.titles.map((title,index)=>`<div class="tool-list-row"><span><strong>${index+1}.</strong> ${escape(title)}</span><button class="secondary" data-copy="${index}" type="button">Copy</button></div>`).join('');}
    $('project-results').addEventListener('click',async event=>{
      const button=event.target.closest('[data-copy]');if(!button)return;
      const text=(readState({}).titles||[])[Number(button.dataset.copy)];if(!text)return;
      try{await navigator.clipboard.writeText(text);button.textContent='Copied';}catch{setMessage(notice,'Copy is unavailable here; select and copy the title text.',true);}
    });
  }

  function renderSimilarity() {
    content.innerHTML = `<div class="tool-intro-note"><strong>Local text comparison</strong><span>Compare two passages in this browser to estimate shared word overlap.</span></div><form id="similarity-form" class="tool-form"><div class="tool-grid"><label>Passage one<textarea id="text-one" rows="8" maxlength="20000"></textarea></label><label>Passage two<textarea id="text-two" rows="8" maxlength="20000"></textarea></label></div><button class="primary" type="submit">Compare text</button></form><output id="similarity-result" class="tool-result">Enter two passages to compare.</output><p class="tool-help">This is a basic word-overlap indicator. It is not a plagiarism verdict and does not compare against external databases.</p>`;
    $('similarity-form').addEventListener('submit',event=>{
      event.preventDefault();
      const tokenize=value=>new Set(value.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}']+/gu)||[]);
      const one=tokenize($('text-one').value),two=tokenize($('text-two').value);
      if(!one.size||!two.size){setMessage($('similarity-result'),'Enter text in both boxes before comparing.',true);return;}
      const shared=[...one].filter(word=>two.has(word)).length;
      const overlap=shared/Math.max(one.size,two.size)*100;
      setMessage($('similarity-result'),`Approximate unique-word overlap: ${overlap.toFixed(1)}% · ${shared} shared words`);
    });
  }

  function renderFileResizer() {
    content.innerHTML = `<div class="tool-intro-note"><strong>Image resizer</strong><span>Select an image from this device, choose output dimensions, then download a resized copy. The image is processed in your browser.</span></div><form id="resize-form" class="tool-form"><label>Choose an image<input id="image-file" type="file" accept="image/*" required></label><div class="tool-grid"><label>Width in pixels<input id="image-width" type="number" min="1" max="10000" inputmode="numeric" required></label><label>Height in pixels<input id="image-height" type="number" min="1" max="10000" inputmode="numeric" required></label></div><label class="check-row"><input id="keep-ratio" type="checkbox" checked><span>Keep the original proportions when width changes</span></label><button class="primary" type="submit">Resize image</button></form><p id="image-status" class="tool-inline-status" role="status"></p><div id="image-output"></div>`;
    let sourceImage=null,sourceUrl='';
    const fileInput=$('image-file'),width=$('image-width'),height=$('image-height');
    const keep=$('keep-ratio');
    fileInput.addEventListener('change',()=>{
      if(sourceUrl)URL.revokeObjectURL(sourceUrl);
      const file=fileInput.files?.[0];if(!file)return;
      if(!file.type.startsWith('image/')){setMessage($('image-status'),'Choose a valid image file.',true);return;}
      sourceUrl=URL.createObjectURL(file);sourceImage=new Image();
      sourceImage.onload=()=>{width.value=sourceImage.naturalWidth;height.value=sourceImage.naturalHeight;setMessage($('image-status'),`Ready: ${sourceImage.naturalWidth} × ${sourceImage.naturalHeight} pixels.`);};
      sourceImage.onerror=()=>setMessage($('image-status'),'This image could not be opened in your browser.',true);
      sourceImage.src=sourceUrl;
    });
    width.addEventListener('input',()=>{if(keep.checked&&sourceImage?.naturalWidth){height.value=Math.max(1,Math.round(Number(width.value)*sourceImage.naturalHeight/sourceImage.naturalWidth));}});
    $('resize-form').addEventListener('submit',event=>{
      event.preventDefault();
      const w=Number(width.value),h=Number(height.value);
      if(!sourceImage||!w||!h||w>10000||h>10000){setMessage($('image-status'),'Choose an image and valid dimensions up to 10,000 pixels.',true);return;}
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const context=canvas.getContext('2d');context.drawImage(sourceImage,0,0,w,h);
      const type=fileInput.files[0].type==='image/jpeg'?'image/jpeg':'image/png';
      canvas.toBlob(blob=>{
        if(!blob){setMessage($('image-status'),'The resized image could not be created.',true);return;}
        const outputUrl=URL.createObjectURL(blob);const link=document.createElement('a');link.className='download-link';link.href=outputUrl;link.download=`${fileInput.files[0].name.replace(/\.[^.]+$/,'')}-resized.${type==='image/jpeg'?'jpg':'png'}`;link.textContent=`Download resized image · ${w} × ${h}`;
        $('image-output').replaceChildren(link);setMessage($('image-status'),'Image resized. Download the copy below.');
      },type,.92);
    });
  }

  const glossary = [
    ['Academic calendar','A schedule of key dates such as registration periods, assessments, and examinations.'],
    ['CGPA','Cumulative grade-point average calculated across completed courses using their units.'],
    ['Course unit','A measure used to describe the credit weight of a course.'],
    ['Distance learning','A study approach where learning and teaching take place across separate locations.'],
    ['Examination','An assessment used to evaluate learning or course outcomes.'],
    ['Semester','A defined period of academic study.'],
    ['Study centre','A location that may provide student-facing academic or administrative support.'],
    ['TMA','Tutor-marked assessment: coursework or an assessment activity for a course.']
  ];
  function renderGlossary() {
    content.innerHTML = `<div class="tool-intro-note"><strong>Study glossary</strong><span>Search common study and open-learning terms.</span></div><label>Find a term<input id="glossary-search" type="search" placeholder="Search terms"></label><div id="glossary-list" class="tool-list"></div>`;
    const render=()=>{
      const q=$('glossary-search').value.trim().toLowerCase();
      const matches=glossary.filter(([term,definition])=>`${term} ${definition}`.toLowerCase().includes(q));
      $('glossary-list').innerHTML=matches.map(([term,definition])=>`<details class="tool-faq"><summary>${escape(term)}</summary><p>${escape(definition)}</p></details>`).join('')||'<p class="tool-empty">No matching terms.</p>';
    };
    $('glossary-search').addEventListener('input',render);render();
  }

  function renderFaq() {
    const questions=[
      ['Where are my tool entries stored?','Interactive entries are saved in this browser on this device. Clearing browser data may remove them.'],
      ['Can I open a tool from another device?','These tools use local browser storage, so entries do not automatically sync between devices.'],
      ['Does the result tool retrieve official grades?','No. Enter your own published grades to calculate a weighted GPA locally.'],
      ['Can I add my own practice questions?','Yes. The practice set lets you save questions and explanations you provide.'],
      ['How do I find new updates?','The news archive is refreshed daily and links to local Nounarchive story summaries.']
    ];
    content.innerHTML=`<div class="tool-intro-note"><strong>Tool help</strong><span>Quick answers for using the local student workspaces.</span></div>${questions.map(([q,a])=>`<details class="tool-faq"><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join('')}`;
  }

  function renderNews() {
    content.innerHTML=`<div class="tool-intro-note"><strong>Local news and updates</strong><span>Search indexed headlines and open each item on Nounarchive.</span></div><label>Search updates<input id="local-news-search" type="search" placeholder="Search headlines"></label><div id="local-news-list" class="tool-list"></div>`;
    const draw=async()=>{
      let archive;
      try{const response=await fetch('/api/archive');if(!response.ok)throw Error();archive=await response.json();}catch{$('local-news-list').innerHTML='<p class="tool-empty">The local update index is temporarily unavailable.</p>';return;}
      const q=$('local-news-search').value.trim().toLowerCase();
      const items=(archive.items||[]).filter(item=>`${item.title} ${item.excerpt} ${item.category}`.toLowerCase().includes(q)).sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
      $('local-news-list').innerHTML=items.map(item=>`<article class="tool-list-row"><div><strong>${escape(item.title)}</strong><small>${escape(item.category||'Update')}${item.publishedAt?` · ${escape(new Date(item.publishedAt).toLocaleDateString('en-GB'))}`:''}</small><p>${escape(item.excerpt||'')}</p></div><a href="/story.html?id=${encodeURIComponent(item.id)}">Read summary →</a></article>`).join('')||'<p class="tool-empty">No updates match your search.</p>';
    };
    $('local-news-search').addEventListener('input',draw);draw();
  }

  function renderDirectory() {
    content.innerHTML=`<div class="tool-intro-note"><strong>Personal shortlist</strong><span>Save a programme, study centre, faculty, or resource and keep your notes here.</span></div><form id="directory-form" class="tool-form"><div class="tool-grid"><label>Item name<input id="directory-name" maxlength="140" required></label><label>Type<select id="directory-kind"><option>Programme</option><option>Study centre</option><option>Faculty</option><option>Other resource</option></select></label></div><label>Notes<textarea id="directory-note" rows="3" maxlength="800"></textarea></label><button class="primary" type="submit">Add to shortlist</button></form><div id="directory-list" class="tool-list"></div>`;
    let items=readState([]);if(!Array.isArray(items))items=[];
    const render=()=>{
      $('directory-list').innerHTML=items.map((item,index)=>`<div class="tool-list-row"><div><strong>${escape(item.name)}</strong><small>${escape(item.kind)}</small>${item.note?`<p>${escape(item.note)}</p>`:''}</div><button class="icon-button" type="button" data-delete="${index}">Remove</button></div>`).join('')||'<p class="tool-empty">Your shortlist is empty.</p>';
      $('directory-list').querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>{items.splice(Number(button.dataset.delete),1);writeState(items);render();}));
    };
    $('directory-form').addEventListener('submit',event=>{event.preventDefault();items.push({name:$('directory-name').value.trim(),kind:$('directory-kind').value,note:$('directory-note').value.trim()});writeState(items);render();event.target.reset();});render();
  }

  function renderLibrary() {
    content.innerHTML=`<div class="tool-intro-note"><strong>Course and resource library</strong><span>Save course codes, reading notes, and revision status for your own study.</span></div><form id="library-form" class="tool-form"><div class="tool-grid"><label>Course or topic<input id="library-title" maxlength="140" required placeholder="e.g. Course code or topic"></label><label>Progress<select id="library-progress"><option>To review</option><option>In progress</option><option>Reviewed</option></select></label></div><label>Notes<textarea id="library-note" rows="3" maxlength="1200"></textarea></label><button class="primary" type="submit">Save to library</button></form><div id="library-list" class="tool-list"></div>`;
    let items=readState([]);if(!Array.isArray(items))items=[];
    const render=()=>{
      $('library-list').innerHTML=items.map((item,index)=>`<article class="practice-card"><div class="tool-list-row"><strong>${escape(item.title)}</strong><span class="resource-meta">${escape(item.progress)}</span><button class="icon-button" data-delete="${index}" type="button">Remove</button></div>${item.note?`<p>${escape(item.note)}</p>`:''}</article>`).join('')||'<p class="tool-empty">Save a course or topic to start your library.</p>';
      $('library-list').querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',()=>{items.splice(Number(button.dataset.delete),1);writeState(items);render();}));
    };
    $('library-form').addEventListener('submit',event=>{event.preventDefault();items.push({title:$('library-title').value.trim(),progress:$('library-progress').value,note:$('library-note').value.trim()});writeState(items);render();event.target.reset();});render();
  }

  function renderNotes() {
    content.innerHTML=`<div class="tool-intro-note"><strong>Study notebook</strong><span>Draft course summaries, study notes, and exam-review points. Notes save as you type.</span></div><label>Note title<input id="note-title" maxlength="140" placeholder="Add a title"></label><label>Your notes<textarea id="note-body" rows="15" maxlength="12000" placeholder="Write a course summary or revision note…"></textarea></label><p id="note-count" class="tool-inline-status"></p>`;
    const saved=readState({title:'',body:''});$('note-title').value=saved.title||'';$('note-body').value=saved.body||'';
    const persist=()=>{writeState({title:$('note-title').value,body:$('note-body').value});const words=$('note-body').value.trim().split(/\s+/).filter(Boolean).length;$('note-count').textContent=`${words} word${words===1?'':'s'}`;};
    $('note-title').addEventListener('input',persist);$('note-body').addEventListener('input',persist);persist();
  }

  function renderDashboard() {
    const relevant=resources.filter(item=>item.id!==requestedId).slice(0,12);
    const savedTasks=(()=>{try{return JSON.parse(localStorage.getItem('nounarchive-tool:study-planner')||'[]').filter(task=>!task.done).length;}catch{return 0;}})();
    content.innerHTML=`<div class="tool-intro-note"><strong>Your local student workspace</strong><span>Jump into a tool or continue planning your next study task.</span></div><div class="tool-stat"><strong>${savedTasks}</strong><span>open study tasks on this device</span></div><div class="tool-section-head"><h2>Tools to open</h2><a href="/resources.html">View all →</a></div><div class="tool-link-grid">${relevant.map(item=>`<a href="/tool.html?id=${encodeURIComponent(item.id)}"><strong>${escape(item.title)}</strong><span>${escape(item.category||'Student support')} →</span></a>`).join('')}</div>`;
  }

  async function render() {
    if (!requestedId) { content.innerHTML='<p class="tool-empty">Choose a tool from the resource directory.</p>'; return; }
    let payload;
    try {
      const response=await fetch('/api/resources');if(!response.ok)throw Error();payload=await response.json();
    } catch {
      const response=await fetch('/resources.json');if(!response.ok)throw Error();payload=await response.json();
    }
    resources=Array.isArray(payload)?payload:(payload.items||[]);
    record=resources.find(item=>String(item.id||slug(item.title))===requestedId);
    if(!record){content.innerHTML='<div class="tool-empty"><h2>Tool not found</h2><p>This item may have been removed from the directory.</p><a href="/resources.html">Return to resources →</a></div>';return;}
    document.title=`${record.title} · Nounarchive`;
    titleEl.textContent=record.title;
    descriptionEl.textContent=record.description||'Use this local student workspace.';
    categoryEl.textContent=record.category||'STUDENT TOOL';
    const type=record.localTool||'notebook';
    const handlers={
      grades:renderGrades,budget:renderBudget,timetable:()=>renderTimePlanner(false),calendar:()=>renderTimePlanner(true),
      planner:renderPlanner,practice:renderPractice,admissions:renderAdmissions,opportunities:renderOpportunities,
      project:renderProject,similarity:renderSimilarity,'file-resizer':renderFileResizer,glossary:renderGlossary,
      faq:renderFaq,news:renderNews,directory:renderDirectory,library:renderLibrary,notes:renderNotes,
      dashboard:renderDashboard,notebook:renderNotes
    };
    (handlers[type]||renderNotes)();
  }

  render().catch(() => {
    content.innerHTML='<div class="tool-empty"><h2>This tool is temporarily unavailable.</h2><p>Please return to the resource directory and try again.</p><a href="/resources.html">Return to resources →</a></div>';
  });
})();
