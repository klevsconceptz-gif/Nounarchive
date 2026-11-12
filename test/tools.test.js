import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const page=await readFile('public/tool.html','utf8');
const script=await readFile('public/tools.js','utf8');
const resources=JSON.parse(await readFile('public/resources.json','utf8'));
const archive=JSON.parse(await readFile('data/seed.json','utf8'));
async function openTool(id){
 const dom=new JSDOM(page,{url:`https://nounarchive.test/tool.html?id=${encodeURIComponent(id)}`,runScripts:'outside-only'});
 const w=dom.window;
 w.fetch=async url=>({ok:true,json:async()=>url==='/api/archive'?archive:{items:resources,refreshMinutes:1440}});
 w.eval(script);
 await new Promise(resolve=>setTimeout(resolve,5));
 return dom;
}

test('every resource directory item resolves to a working local tool page',async()=>{
 const supported=new Set(['grades','budget','timetable','calendar','planner','practice','admissions','opportunities','project','similarity','file-resizer','glossary','faq','news','directory','library','notes','dashboard','notebook']);
 for(const item of resources){
  assert.ok(supported.has(item.localTool),`${item.title} has an unsupported local tool`);
  const dom=await openTool(item.id);
  try{
   const d=dom.window.document;
   assert.equal(d.getElementById('tool-title').textContent,item.title,item.id);
   assert.ok(d.getElementById('tool-content').children.length>0,item.id);
   assert.doesNotMatch(d.getElementById('tool-content').textContent,/Tool not found|temporarily unavailable/);
   for(const a of d.querySelectorAll('a[href]'))assert.equal(new URL(a.href).origin,'https://nounarchive.test',`${item.id}: ${a.href}`);
  }finally{dom.window.close();}
 }
});

test('CGPA calculator uses course-unit weighting and saves its inputs locally',async()=>{
 const dom=await openTool('cgpa-calculator');
 try{
  const w=dom.window,d=w.document,row=d.querySelector('.grade-row');
  row.querySelector('[data-units]').value='3';row.querySelector('[data-grade]').value='A';
  d.getElementById('grade-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(d.getElementById('grade-result').textContent,/5\.00/);
  assert.match(d.getElementById('grade-result').textContent,/3 total units/);
  assert.ok(w.localStorage.getItem('nounarchive-tool:cgpa-calculator'));
 }finally{dom.window.close();}
});

test('fee tool totals entered costs and the timetable rejects overlaps',async()=>{
 const budget=await openTool('fee-checker');
 try{
  const w=budget.window,d=w.document;d.getElementById('budget-name').value='Registration';d.getElementById('budget-amount').value='1200';
  d.getElementById('budget-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(d.getElementById('budget-total').textContent,/1,200\.00/);
 }finally{budget.window.close();}
 const timetable=await openTool('personalised-timetable');
 try{
  const w=timetable.window,d=w.document,form=d.getElementById('event-form');
  const add=(start,end)=>{d.getElementById('event-name').value='Study block';d.getElementById('event-day').value='Monday';d.getElementById('event-start').value=start;d.getElementById('event-end').value=end;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
  add('09:00','10:00');assert.equal(d.querySelectorAll('#event-list .tool-list-row').length,1);
  add('09:30','10:30');assert.equal(d.querySelectorAll('#event-list .tool-list-row').length,1);
  assert.match(d.getElementById('schedule-status').textContent,/overlaps/);
 }finally{timetable.window.close();}
});

test('academic calendar, study planner, and application checklist save changes',async()=>{
 const calendar=await openTool('academic-calendar');
 try{
  const w=calendar.window,d=w.document;d.getElementById('event-name').value='Registration reminder';d.getElementById('event-date').value='2026-11-20';
  d.getElementById('event-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(d.querySelectorAll('#event-list .tool-list-row').length,1);
 }finally{calendar.window.close();}
 const planner=await openTool('study-planner');
 try{
  const w=planner.window,d=w.document;d.getElementById('task-name').value='Review unit one';d.getElementById('task-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(d.querySelectorAll('#task-list .tool-list-row').length,1);d.querySelector('[data-done]').click();assert.ok(d.querySelector('.tool-list-row.is-done'));
 }finally{planner.window.close();}
 const admissions=await openTool('admission-eligibility');
 try{
  const w=admissions.window,d=w.document;assert.equal(d.querySelectorAll('#check-list .tool-list-row').length,5);d.querySelector('[data-check="0"]').click();assert.ok(d.querySelector('.tool-list-row.is-done'));
 }finally{admissions.window.close();}
});

test('practice set accepts user questions and reveals answers locally',async()=>{
 const dom=await openTool('past-questions');
 try{
  const w=dom.window,d=w.document;d.getElementById('question-text').value='What is a study plan?';d.getElementById('answer-text').value='A set of planned learning tasks.';
  d.getElementById('question-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const answer=d.querySelector('[data-answer="0"]');assert.equal(answer.hidden,true);d.querySelector('[data-reveal="0"]').click();assert.equal(answer.hidden,false);assert.match(answer.textContent,/planned learning tasks/);
 }finally{dom.window.close();}
});

test('opportunity tracker stores entries and the local file resizer produces a download',async()=>{
 const opportunities=await openTool('scholarship-hub');
 try{
  const w=opportunities.window,d=w.document;d.getElementById('opportunity-name').value='Study grant';d.getElementById('opportunity-date').value='2026-12-01';
  d.getElementById('opportunity-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.match(d.getElementById('opportunity-list').textContent,/Study grant/);
 }finally{opportunities.window.close();}
 const resizer=await openTool('image-resizer');
 try{
  const w=resizer.window,d=w.document;w.URL.createObjectURL=()=> 'blob:local-image';w.URL.revokeObjectURL=()=>{};
  w.Image=class{naturalWidth=800;naturalHeight=600;set src(value){this._src=value;this.onload?.();}get src(){return this._src;}};
  const fileInput=d.getElementById('image-file');Object.defineProperty(fileInput,'files',{value:[{type:'image/png',name:'photo.png'}]});
  const canvas=d.createElement.bind(d);d.createElement=(name,...args)=>{const element=canvas(name,...args);if(name==='canvas'){element.getContext=()=>({drawImage(){}});element.toBlob=callback=>callback(new w.Blob(['image'],{type:'image/png'}));}return element;};
  fileInput.dispatchEvent(new w.Event('change'));assert.equal(d.getElementById('image-width').value,'800');d.getElementById('image-width').value='400';d.getElementById('resize-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(d.getElementById('image-output').textContent,/Download resized image/);assert.match(d.getElementById('image-status').textContent,/Image resized/);
 }finally{resizer.window.close();}
});

test('project outline and text comparison perform their local actions',async()=>{
 const project=await openTool('project-topic-generator');
 try{
  const w=project.window,d=w.document;d.getElementById('project-theme').value='open learning';d.getElementById('project-group').value='distance learners';
  d.getElementById('project-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(d.querySelectorAll('#project-results .tool-list-row').length,5);assert.match(d.getElementById('project-results').textContent,/open learning/);
 }finally{project.window.close();}
 const compare=await openTool('text-similarity-checker');
 try{
  const w=compare.window,d=w.document;d.getElementById('text-one').value='open learning and study';d.getElementById('text-two').value='open learning support';
  d.getElementById('similarity-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(d.getElementById('similarity-result').textContent,/Approximate unique-word overlap/);
 }finally{compare.window.close();}
});
