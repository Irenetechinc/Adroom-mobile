export const AGENT_EXTENSION_DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:,">
  <title>Adirum AI · Agent Extension</title>
  <style>
    :root{color-scheme:dark;--bg:#0b1020;--panel:#111a2d;--line:#27344d;--text:#e2e8f0;--muted:#91a0b8;--cyan:#00e5ff;--green:#34d399;--red:#fb7185}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,sans-serif}
    main{max-width:1400px;margin:auto;padding:28px 20px 60px}h1{margin:0;font-size:26px}h2{margin:0 0 14px;font-size:18px}
    .sub{color:var(--muted);margin:5px 0 22px}.toolbar,.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px}
    .toolbar{display:flex;gap:10px;padding:14px;margin-bottom:18px;align-items:center;flex-wrap:wrap}.panel{padding:18px;margin:16px 0}
    input,button{font:inherit;border-radius:8px;border:1px solid var(--line);padding:9px 12px;background:#0b1324;color:var(--text)}
    input{min-width:280px;flex:1}button{cursor:pointer;background:#102331;border-color:#1b5361}button:hover{background:#163443}
    button.danger{background:#351924;border-color:#743144;color:#fecdd3}button.small{padding:5px 9px;font-size:12px}
    .status{color:var(--muted);font-size:12px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #202c42;vertical-align:top}th{color:#a9bad1;font-weight:600;white-space:nowrap}
    td{max-width:360px;overflow-wrap:anywhere}.pill{display:inline-block;padding:2px 7px;border-radius:99px;background:#1c2b42;color:#b7c6dc}
    .active{color:var(--green)}.failed,.terminated,.disabled,.rejected{color:var(--red)}.queued,.running{color:var(--cyan)}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted);margin:0;font-size:11px;max-width:500px}
    @media(max-width:700px){main{padding:18px 10px}.panel{padding:12px}th,td{padding:7px 5px}}
  </style>
</head>
<body>
<main>
  <h1>Agent self-extension</h1>
  <p class="sub">Review sub-agent runs, tested tool versions, audit events, and resource usage.</p>
  <div class="toolbar">
    <form id="auth-form" style="display:flex;gap:10px;flex:1;align-items:center">
      <input id="token" type="password" autocomplete="current-password" placeholder="Admin token">
      <button id="load" type="submit">Load dashboard</button>
    </form>
    <span id="status" class="status">Admin authorization required.</span>
  </div>
  <section class="panel">
    <h2>Sub-agent run tree</h2>
    <div class="table-wrap"><table><thead><tr><th>Task</th><th>Agent</th><th>Status</th><th>Credits</th><th>Created</th><th>Result / reason</th><th>Action</th></tr></thead><tbody id="runs"></tbody></table></div>
  </section>
  <section class="panel">
    <h2>Dynamic tools</h2>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Owner</th><th>Version</th><th>Status</th><th>Usage</th><th>Tests</th><th>Dependencies</th><th>Actions</th></tr></thead><tbody id="tools"></tbody></table></div>
  </section>
  <section class="panel">
    <h2>Recent audit events</h2>
    <div class="table-wrap"><table><thead><tr><th>Time</th><th>Agent</th><th>Event</th><th>Run / tool</th><th>Details</th></tr></thead><tbody id="audit"></tbody></table></div>
  </section>
</main>
<script>
var tokenInput=document.getElementById('token');
var statusNode=document.getElementById('status');
tokenInput.value=localStorage.getItem('admin_token')||'';
function cell(row,value){var td=document.createElement('td');td.textContent=value==null?'':String(value);row.appendChild(td);return td;}
function button(label,className,handler){var el=document.createElement('button');el.textContent=label;el.className='small '+(className||'');el.addEventListener('click',handler);return el;}
function authHeaders(){return {'Authorization':'Bearer '+tokenInput.value,'Content-Type':'application/json'};}
async function request(url,options){var response=await fetch(url,options||{headers:authHeaders()});var body=await response.json().catch(function(){return {};});if(!response.ok)throw new Error(body.error||'Request failed');return body;}
function renderRuns(runs){
  var body=document.getElementById('runs');body.replaceChildren();
  var byParent={};runs.forEach(function(run){var key=run.parent_run_id||'root';(byParent[key]||(byParent[key]=[])).push(run);});
  Object.keys(byParent).forEach(function(key){byParent[key].sort(function(a,b){return String(a.created_at).localeCompare(String(b.created_at));});});
  function addRun(run,depth){
    var tr=document.createElement('tr');var task=cell(tr,(depth?'↳ ':'')+run.task_name);task.style.paddingLeft=(8+depth*18)+'px';
    cell(tr,run.agent_type);var status=cell(tr,run.status);status.className=run.status;
    cell(tr,run.credits_charged);cell(tr,run.created_at?new Date(run.created_at).toLocaleString():'');
    cell(tr,run.error_message||run.termination_reason||(run.result&&run.result.report)||'');
    var action=cell(tr,'');
    if(run.status==='queued'||run.status==='running')action.appendChild(button('Terminate tree','danger',async function(){if(!confirm('Terminate this run and its active children?'))return;try{await request('/admin/api/agent-extension/runs/'+encodeURIComponent(run.id)+'/terminate',{method:'POST',headers:authHeaders(),body:JSON.stringify({reason:'Terminated from admin dashboard'})});await load();}catch(error){statusNode.textContent=error.message;}}));
    body.appendChild(tr);
    (byParent[run.id]||[]).forEach(function(child){addRun(child,depth+1);});
  }
  var ids=new Set(runs.map(function(run){return run.id;}));
  runs.filter(function(run){return !run.parent_run_id||!ids.has(run.parent_run_id);}).forEach(function(run){addRun(run,0);});
}
function renderTools(tools){
  var body=document.getElementById('tools');body.replaceChildren();
  tools.forEach(function(tool){
    var tr=document.createElement('tr');cell(tr,tool.tool_name);cell(tr,tool.owner_agent_type);cell(tr,'v'+tool.version);
    var state=cell(tr,tool.status);state.className=tool.status;cell(tr,tool.use_count||0);
    var testCell=cell(tr,'');testCell.textContent=(tool.test_results||[]).filter(function(test){return test.passed;}).length+'/'+(tool.test_results||[]).length+' passed';
    cell(tr,(tool.dependency_names||[]).join(', ')||'—');
    var actions=cell(tr,'');
    if(tool.status==='active')actions.appendChild(button('Disable tool','danger',async function(){if(!confirm('Disable this tool and its versions?'))return;try{await request('/admin/api/agent-extension/tools/'+encodeURIComponent(tool.id)+'/disable',{method:'POST',headers:authHeaders(),body:JSON.stringify({reason:'Disabled from admin dashboard'})});await load();}catch(error){statusNode.textContent=error.message;}}));
    var prior=tools.filter(function(candidate){return candidate.user_id===tool.user_id&&candidate.owner_agent_type===tool.owner_agent_type&&candidate.tool_name===tool.tool_name&&candidate.id!==tool.id&&candidate.status!=='rejected';}).sort(function(a,b){return b.version-a.version;})[0];
    if(prior&&tool.status==='active')actions.appendChild(button('Restore v'+prior.version,'',async function(){if(!confirm('Restore version '+prior.version+' and disable the current version?'))return;try{await request('/admin/api/agent-extension/tools/'+encodeURIComponent(tool.id)+'/rollback',{method:'POST',headers:authHeaders(),body:JSON.stringify({version_id:prior.id})});await load();}catch(error){statusNode.textContent=error.message;}}));
    if(tool.status==='disabled'&&!tools.some(function(candidate){return candidate.user_id===tool.user_id&&candidate.owner_agent_type===tool.owner_agent_type&&candidate.tool_name===tool.tool_name&&candidate.status==='active';}))actions.appendChild(button('Restore this version','',async function(){if(!confirm('Restore this tool version?'))return;try{await request('/admin/api/agent-extension/tools/'+encodeURIComponent(tool.id)+'/rollback',{method:'POST',headers:authHeaders(),body:JSON.stringify({version_id:tool.id})});await load();}catch(error){statusNode.textContent=error.message;}}));
    body.appendChild(tr);
  });
}
function renderAudit(events){
  var body=document.getElementById('audit');body.replaceChildren();
  events.forEach(function(event){var tr=document.createElement('tr');cell(tr,event.created_at?new Date(event.created_at).toLocaleString():'');cell(tr,event.actor_agent_type);cell(tr,event.event_type);cell(tr,event.subagent_run_id||event.tool_id||'');var detail=cell(tr,'');var pre=document.createElement('pre');pre.textContent=JSON.stringify(event.details||{});detail.appendChild(pre);body.appendChild(tr);});
}
async function load(){
  if(!tokenInput.value){statusNode.textContent='Enter an admin token first.';return;}
  statusNode.textContent='Loading…';
  try{localStorage.setItem('admin_token',tokenInput.value);var data=await request('/admin/api/agent-extension/snapshot',{headers:authHeaders()});renderRuns(data.runs||[]);renderTools(data.tools||[]);renderAudit(data.audit||[]);statusNode.textContent='Updated '+new Date().toLocaleTimeString();}
  catch(error){statusNode.textContent=error.message;}
}
document.getElementById('auth-form').addEventListener('submit',function(event){event.preventDefault();load();});
if(tokenInput.value)load();
setInterval(function(){if(tokenInput.value)load();},30000);
</script>
</body>
</html>`;
