const $=id=>document.getElementById(id);
let csrf='',posts=[],selected=null,dirty=false,busy=false,resultBatches=[],resultRows=[],resultNextOffset=null;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'success';}
function resultMessage(text,error=false){$('results-import-status').textContent=text;$('results-import-status').className=error?'setup-note error':'setup-note';}
function showLogin(){$('reset-panel').hidden=true;$('reset-form').reset();csrf='';posts=[];selected=null;resultBatches=[];resultRows=[];resultNextOffset=null;$('post-form').reset();$('post-list').replaceChildren();$('workspace').hidden=true;$('login-panel').hidden=false;$('results-record-list').replaceChildren();$('results-file').value='';$('results-import-status').textContent='';$('results-batch').replaceChildren(new Option('No batches loaded',''));$('results-more').hidden=true;}
async function api(path,options={}){
 const response=await fetch('/api/admin'+path,{...options,headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1','X-CSRF-Token':csrf,...options.headers}});
 const body=await response.json();if(!response.ok){if(response.status===401&&path!=='/login')showLogin();throw Error(body.error||'Request failed.');}return body;
}
function renderList(){
 const published=posts.filter(p=>p.status==='published').length;
 $('stats').innerHTML=`<div class="desk-stat"><b>${posts.length}</b>Total updates</div><div class="desk-stat"><b>${published}</b>Published</div><div class="desk-stat"><b>${posts.length-published}</b>Drafts</div>`;
 const filtered=posts.filter(p=>p.title.toLowerCase().includes($('post-search').value.toLowerCase()));
 $('post-list').innerHTML=filtered.map(p=>`<button class="post-entry ${p.id===selected?'selected':''}" data-id="${p.id}"><strong>${escape(p.title)}</strong><span>${p.status==='published'?'● Published':'○ Draft'} · ${new Date(p.updatedAt).toLocaleDateString()}</span></button>`).join('')||'<p class="setup-note">No updates here yet. Your next post starts on the right.</p>';
}
function updateButton(){$('save-post').textContent=$('visibility').value==='published'?'Publish update ↗':'Save draft';}
function edit(post=null){selected=post?.id||null;dirty=false;$('title').value=post?.title||'';$('content').value=post?.content||'';$('excerpt').value=post?.excerpt||'';$('category').value=post?.category||'Campus news';$('visibility').value=post?.status||'draft';$('editor-label').textContent=post?'EDIT UPDATE':'NEW UPDATE';$('editor-heading').textContent=post?'Edit update':'Create an update';$('delete-post').hidden=!post;$('preview').hidden=true;updateButton();renderList();}
function canLeave(){return !busy&&(!dirty||confirm('Discard your unsaved changes?'));}
function renderBatchOptions(){
 const select=$('results-batch'),selectedValue=select.value;
 select.replaceChildren(new Option(resultBatches.length?'Select an import batch':'No batches loaded',''));
 for(const batch of resultBatches){const option=new Option(`${batch.created_at.slice(0,10)} · ${batch.imported_records}/${batch.total_records} rows · ${batch.source_format.toUpperCase()}`,batch.id);select.add(option);}
 if(resultBatches.some(batch=>batch.id===selectedValue))select.value=selectedValue;
 $('results-delete').disabled=!select.value;
}
async function loadResultBatches(selectId=''){
 const data=await api('/student-results/batches');resultBatches=data.batches||[];renderBatchOptions();
 if(selectId&&resultBatches.some(batch=>batch.id===selectId))$('results-batch').value=selectId;
 $('results-delete').disabled=!$('results-batch').value;
}
function renderResultRows(){
 const query=$('results-search').value.trim().toLowerCase();
 const rows=resultRows.filter(row=>!query||JSON.stringify(row.data).toLowerCase().includes(query));
 if(!rows.length){$('results-record-list').innerHTML=`<p class="setup-note">${resultRows.length?'No loaded rows match this filter.':'No result rows are loaded.'}</p>`;return;}
 const fields=[...new Set(rows.flatMap(row=>Object.keys(row.data||{})))].slice(0,30);
 const header=fields.map(field=>`<th scope="col">${escape(field)}</th>`).join('');
 const body=rows.map(row=>`<tr>${fields.map(field=>{const value=row.data?.[field];return `<td>${escape(value&&typeof value==='object'?JSON.stringify(value):value)}</td>`;}).join('')}</tr>`).join('');
 $('results-record-list').innerHTML=`<p class="setup-note">Showing ${rows.length} of ${resultRows.length} loaded records.</p><table class="results-table"><thead><tr><th scope="col">Row</th>${header}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${row.rowIndex+1}</th>${fields.map(field=>{const value=row.data?.[field];return `<td>${escape(value&&typeof value==='object'?JSON.stringify(value):value)}</td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
}
async function loadSelectedResults(append=false){
 const batchId=$('results-batch').value;if(!batchId){resultMessage('Select a batch to review its records.');return;}
 if(!append){resultRows=[];resultNextOffset=0;}
 const offset=append?(resultNextOffset??0):0;
 const data=await api(`/student-results/batches/${batchId}?limit=50&offset=${offset}`);
 resultRows=append?resultRows.concat(data.items||[]):data.items||[];resultNextOffset=data.nextOffset;
 $('results-more').hidden=resultNextOffset===null;
 $('results-delete').disabled=false;
 renderResultRows();
 const batch=data.batch;resultMessage(`Loaded ${resultRows.length} of ${batch.imported_records} imported records. Records remain encrypted in storage.`);
}
function parseCsv(text){
 const input=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
 for(let index=0;index<input.length;index++){
  const character=input[index];
  if(quoted){if(character==='"'&&input[index+1]==='"'){cell+='"';index++;}else if(character==='"')quoted=false;else cell+=character;continue;}
  if(character==='"'&&cell===''){quoted=true;continue;}
  if(character===','){row.push(cell);cell='';continue;}
  if(character==='\n'||character==='\r'){if(character==='\r'&&input[index+1]==='\n')index++;row.push(cell);rows.push(row);row=[];cell='';continue;}
  cell+=character;
 }
 if(quoted)throw Error('The CSV file has an unclosed quoted field.');
 if(cell!==''||row.length){row.push(cell);rows.push(row);}
 const headerRow=rows.shift()||[];if(!headerRow.length)throw Error('The CSV file has no column headings.');
 const headers=headerRow.map((value,index)=>value.trim()||`column_${index+1}`),counts=new Map();
 const unique=headers.map((header,index)=>{const count=(counts.get(header)||0)+1;counts.set(header,count);return count===1?header:`${header}_${count}`;});
 return rows.filter(values=>values.some(value=>value.trim()!=='')).map(values=>Object.fromEntries(unique.map((header,index)=>[header,values[index]??''])));
}
async function readResultsFile(file){
 const name=file.name.toLowerCase(),text=await file.text();
 if(name.endsWith('.csv'))return {format:'csv',records:parseCsv(text)};
 if(name.endsWith('.json')){const parsed=JSON.parse(text);const records=Array.isArray(parsed)?parsed:parsed?.records;if(!Array.isArray(records)||!records.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))throw Error('The JSON file must contain an array of result records.');return {format:'json',records};}
 throw Error('Choose a CSV or JSON export file.');
}
async function importResults(){
 if(busy)return;const file=$('results-file').files?.[0];if(!file){resultMessage('Choose the authorized CSV or JSON export first.',true);return;}
 busy=true;$('results-import').disabled=true;
 try{
  const {format,records}=await readResultsFile(file);if(!records.length)throw Error('The export contains no result rows.');
  const created=await api('/student-results/batches',{method:'POST',body:JSON.stringify({format,totalRecords:records.length})});
  const batchId=created.batchId;resultMessage(`Import started. Encrypting ${records.length} records…`);
  for(let offset=0;offset<records.length;offset+=50){const chunk=records.slice(offset,offset+50);const response=await api(`/student-results/batches/${batchId}/import`,{method:'POST',body:JSON.stringify({offset,records:chunk})});resultMessage(`Encrypted ${response.importedRecords} of ${response.totalRecords} records…`);}
  $('results-file').value='';await loadResultBatches(batchId);$('results-search').value='';await loadSelectedResults(false);resultMessage(`Imported ${records.length} records. They are encrypted in storage and available only in this signed-in workspace.`);
 }catch(error){resultMessage(error.message||'The results export could not be imported.',true);}
 finally{busy=false;$('results-import').disabled=false;}
}
async function enter(){posts=await api('/posts');$('login-panel').hidden=true;$('workspace').hidden=false;edit();await loadResultBatches();}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const result=await api('/login',{method:'POST',body:JSON.stringify({password:$('password').value})});csrf=result.csrf;$('password').value='';await enter();message('Signed in. Welcome to your editorial desk.');}catch(e){message(e.message,true);}finally{button.disabled=false;}});
$('open-reset').addEventListener('click',()=>{$('login-panel').hidden=true;$('reset-panel').hidden=false;message('');$('password').value='';$('reset-token').focus();});
$('cancel-reset').addEventListener('click',()=>{showLogin();message('');$('password').focus();});
$('reset-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.submitter;
 if($('new-password').value!==$('confirm-password').value){message('The new passwords do not match.',true);return;}
 button.disabled=true;
 try{await api('/password-reset',{method:'POST',body:JSON.stringify({token:$('reset-token').value,newPassword:$('new-password').value})});showLogin();$('password').value='';message('Password reset. All previous sessions have ended. Sign in with your new password.');$('password').focus();}
 catch(error){message(error.message,true);}
 finally{button.disabled=false;}
});
$('post-form').addEventListener('input',()=>{dirty=true;});$('visibility').addEventListener('change',()=>{dirty=true;updateButton();});
$('post-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;$('save-post').disabled=true;try{const fields={title:$('title').value,content:$('content').value,excerpt:$('excerpt').value,category:$('category').value,status:$('visibility').value};const post=await api(selected?'/posts/'+selected:'/posts',{method:selected?'PUT':'POST',body:JSON.stringify(fields)});posts=await api('/posts');edit(post);message(post.status==='published'?'Published! Your update is now visible on the website.':'Draft saved. Only the admin can see it.');}catch(e){message(e.message,true);}finally{busy=false;$('save-post').disabled=false;}});
$('post-list').addEventListener('click',e=>{const id=e.target.closest('[data-id]')?.dataset.id;if(id&&canLeave())edit(posts.find(p=>p.id===id));});
$('new-post').addEventListener('click',()=>{if(canLeave()){edit();$('title').focus();}});
$('post-search').addEventListener('input',renderList);
$('preview-button').addEventListener('click',()=>{$('preview-title').textContent=$('title').value||'Untitled update';$('preview-content').textContent=$('content').value;$('preview').hidden=false;$('preview').scrollIntoView({behavior:'smooth'});});
$('delete-post').addEventListener('click',async()=>{if(!selected||busy||!confirm('Permanently delete this post? It will also disappear from the public website.'))return;busy=true;try{await api('/posts/'+selected,{method:'DELETE'});posts=await api('/posts');edit();message('Post deleted.');}catch(e){message(e.message,true);}finally{busy=false;}});
$('logout').addEventListener('click',async()=>{if(!canLeave())return;try{await api('/logout',{method:'POST'});showLogin();dirty=false;message('Signed out securely.');}catch(e){message(e.message,true);}});
$('results-import').addEventListener('click',importResults);
$('results-load').addEventListener('click',()=>loadSelectedResults(false).catch(error=>resultMessage(error.message,true)));
$('results-more').addEventListener('click',()=>loadSelectedResults(true).catch(error=>resultMessage(error.message,true)));
$('results-batch').addEventListener('change',()=>{$('results-delete').disabled=!$('results-batch').value;resultRows=[];$('results-record-list').replaceChildren();$('results-more').hidden=true;});
$('results-batch').addEventListener('change',()=>loadSelectedResults(false).catch(error=>resultMessage(error.message,true)));
$('results-search').addEventListener('input',renderResultRows);
$('results-delete').addEventListener('click',async()=>{const batchId=$('results-batch').value;if(!batchId||!confirm('Permanently delete this imported private results batch?'))return;try{await api(`/student-results/batches/${batchId}`,{method:'DELETE'});resultRows=[];await loadResultBatches();$('results-record-list').innerHTML='<p class="setup-note">Batch deleted.</p>';resultMessage('Private results batch deleted.');}catch(error){resultMessage(error.message,true);}});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
(async()=>{try{const session=await api('/session');csrf=session.csrf;await enter();}catch{showLogin();}})();
