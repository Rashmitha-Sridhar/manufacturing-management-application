const API="http://127.0.0.1:5000/api";
async function api(path,opts={}){
  const headers = {"Content-Type":"application/json"};
  const token = localStorage.getItem('token');
  if(token) headers['Authorization'] = 'Bearer ' + token;
  try{
    return await fetch(API+path, {...opts, headers});
  }catch(err){
    console.error('Network/API fetch failed', err);
    showAuthMessage('Failed to reach the backend. Is the server running?');
    throw err;
  }
}

function showAuthMessage(msg){
  const el = document.getElementById('authMessage');
  if(!el) return;
  el.textContent = msg || '';
}

function isAuthed(){ return !!localStorage.getItem('token'); }

function currentUserId(){
  const v = localStorage.getItem('user_id');
  if(!v) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function renderAuthControls(){
  const token = localStorage.getItem('token');
  const loginForm = document.getElementById('loginForm');
  const logoutPane = document.getElementById('logoutPane');
  const whoami = document.getElementById('whoami');
  if(token){
    if(loginForm) loginForm.style.display='none';
    if(logoutPane) { logoutPane.style.display='block'; }
    if(whoami) {
      const uid = localStorage.getItem('user_id');
      whoami.textContent = uid ? ('User: '+uid) : 'Authenticated';
    }
    // mark documentElement as authenticated (defensive script checks this) and body for CSS
  try{ document.documentElement.setAttribute('data-auth','true'); document.body.setAttribute('data-auth','true'); }catch(e){}
    // undo inline hiding defensive script may have applied
    try{ const nav = document.querySelector('header nav'); if(nav) nav.style.display=''; const main = document.querySelector('main'); if(main) Array.from(main.children).forEach(ch=>{ if(ch.id!=='authControls') ch.style.display=''; }); }catch(e){}
  } else {
    if(loginForm) loginForm.style.display='block';
    if(logoutPane) logoutPane.style.display='none';
  try{ document.documentElement.setAttribute('data-auth','false'); document.body.removeAttribute('data-auth'); }catch(e){}
    // re-apply inline hiding for defensive script compatibility
    try{ const nav = document.querySelector('header nav'); if(nav) nav.style.display='none'; const main = document.querySelector('main'); if(main) Array.from(main.children).forEach(ch=>{ if(ch.id!=='authControls') ch.style.display='none'; }); }catch(e){}
  }
}

// show auth-only controls only on specific pages
function updatePageAuthControls(){
  const isOrders = window.location.pathname.endsWith('orders.html') || document.getElementById('ordersPage');
  if(document.documentElement.getAttribute('data-auth')==='true' && isOrders) {
    document.body.setAttribute('data-show-orders','true');
  } else {
    document.body.removeAttribute('data-show-orders');
  }
}

async function login(){
  const email = document.getElementById('emailInput').value;
  const password = document.getElementById('passwordInput').value;
  try{
    const r = await fetch(API + '/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email,password})});
    const j = await r.json();
    if(!r.ok){ showAuthMessage(j.error || 'Login failed'); return; }
  localStorage.setItem('token', j.token);
  if(j.id) localStorage.setItem('user_id', String(j.id));
    showAuthMessage('');
    renderAuthControls();
    await init();
  }catch(e){ console.error(e); showAuthMessage('Login request failed'); }
}

function logout(){ localStorage.removeItem('token'); renderAuthControls(); showAuthMessage('Logged out'); }

async function signup(){
  const email = document.getElementById('emailInput').value;
  const password = document.getElementById('passwordInput').value;
  try{
    const r = await fetch(API + '/auth/signup', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email,password})});
    const j = await r.json();
    if(!r.ok){ showAuthMessage(j.error || 'Signup failed'); return; }
  localStorage.setItem('token', j.token);
  if(j.id) localStorage.setItem('user_id', String(j.id));
    showAuthMessage('');
    renderAuthControls();
    await init();
  }catch(e){ console.error(e); showAuthMessage('Signup request failed'); }
}
async function loadKPIs(){
  // Allow KPIs to be loaded without authentication (public dashboard)
  const r=await api("/reports/orders");
  if(!r.ok){ if(r.status===401){ showAuthMessage('Not authenticated — please log in.'); } console.error('KPIs load failed', r.status); return; }
  showAuthMessage('');
  const d=await r.json();
  if(document.getElementById("kpis")) document.getElementById("kpis").innerHTML = `<div class="card">Total: ${d.total}</div><div class="card">Planned: ${d.planned}</div><div class="card">In Progress: ${d.in_progress}</div><div class="card">Completed: ${d.completed}</div>`;
}
async function loadProducts(){
  if(!isAuthed()) return;
  const r=await api("/products");
  if(!r.ok){ if(r.status===401){ showAuthMessage('Not authenticated — please log in.'); } console.error('Products load failed', r.status); return; }
  showAuthMessage('');
  const data=await r.json();
  const tbody=document.querySelector("#productsTable tbody"); if(!tbody) return; tbody.innerHTML = "";
  data.forEach(p=>{
    const ownerId = (p.created_by === null || p.created_by === undefined) ? null : parseInt(p.created_by,10);
    const mine = (ownerId !== null) && (ownerId === currentUserId());
    const ownerLabel = mine ? 'You' : (ownerId ? ('User '+ownerId) : '—');
  const actions = mine ? `<button class="auth-only" onclick="deleteProduct(${p.id})" aria-label="Delete product ${p.name}" title="Delete product ${p.name}">Delete</button>` : '';
  tbody.innerHTML+=`<tr><td>${p.id}</td><td>${p.name}</td><td>${p.type}</td><td>${p.stock_qty}</td><td>${ownerLabel}</td><td>${actions}</td></tr>`;
  });
}
async function loadBOMs(){
  if(!isAuthed()) return;
  const r=await api("/bom");
  if(!r.ok){ if(r.status===401){ showAuthMessage('Not authenticated — please log in.'); } console.error('BOMs load failed', r.status); return; }
  showAuthMessage('');
  const data=await r.json();
  const tbody=document.querySelector("#bomTable tbody"); if(!tbody) return; tbody.innerHTML = "";
  data.forEach(b=>{ tbody.innerHTML+=`<tr><td>${b.id}</td><td>${b.product_id}</td><td><pre>${JSON.stringify(b.components)}</pre></td><td><pre>${JSON.stringify(b.operations)}</pre></td></tr>`; });
}

// Predefined BOMs keyed by normalized product name
const PREDEFINED_BOMS = {
  'r15 bike': {
    title: 'R15 Bike',
    rows: [
      ['Frame',1,'₹20,000'],['Engine (155cc, liquid cooled)',1,'₹70,000'],['Fuel tank',1,'₹7,000'],['Front wheel assembly',1,'₹12,000'],['Rear wheel assembly',1,'₹10,000'],['Front suspension',1,'₹6,000'],['Rear suspension',1,'₹5,000'],['Brake system (front + rear)',1,'₹8,000'],['Seat assembly',1,'₹3,000'],['Electrical system',1,'₹15,000'],['Exhaust system',1,'₹6,000'],['Body panels + fairings','Set','₹18,000']
    ],
    total: '≈ ₹1,80,000'
  },
  'table': {
    title: 'Table',
    rows: [['Tabletop',1,'₹2,000'],['Legs',4,'₹1,600'],['Frame/Support',1,'₹1,200'],['Fasteners','Set','₹300'],['Finish','-','₹500']],
    total: '≈ ₹5,600'
  },
  'chair': {
    title: 'Chair',
    rows: [['Seat base',1,'₹700'],['Backrest',1,'₹600'],['Legs',4,'₹1,200'],['Support rails',2,'₹400'],['Fasteners','Set','₹200'],['Finish','-','₹300']],
    total: '≈ ₹3,400'
  },
  'door': {
    title: 'Door',
    rows: [['Door panel',1,'₹5,000'],['Hinges',3,'₹600'],['Door frame',1,'₹2,500'],['Handle/knob',1,'₹800'],['Lock mechanism',1,'₹1,200'],['Finish','-','₹700']],
    total: '≈ ₹10,800'
  },
  'stove': {
    title: 'Stove',
    rows: [['Stove body/frame',1,'₹2,000'],['Burners',2,'₹1,400'],['Gas pipe/manifold',1,'₹1,000'],['Control knobs',2,'₹400'],['Grates',2,'₹800'],['Ignition system',1,'₹1,200'],['Rubber feet',4,'₹200']],
    total: '≈ ₹7,000'
  }
};

async function lookupBOMByOrder(){
  const val = document.getElementById('orderLookupId').value.trim();
  const out = document.getElementById('bomResult');
  if(!val){ out.innerHTML = '<small class="muted">Please enter an order ID.</small>'; return; }
  const id = Number(val);
  if(Number.isNaN(id)){ out.innerHTML = '<small class="muted">Order ID must be numeric.</small>'; return; }
  try{
    const r = await api('/orders?');
    // fetch single MO via GET /api/orders?status= is not ideal; use /api/orders and filter client-side
    const rr = await api('/orders');
    if(!rr.ok){ out.innerHTML = '<small class="muted">Could not fetch orders.</small>'; return; }
    const mos = await rr.json();
    const mo = mos.find(m=>Number(m.id)===id);
    if(!mo){ out.innerHTML = `<small class="muted">Order #${id} not found.</small>`; return; }
    // fetch product to get product name
    const pr = await api('/products'); if(!pr.ok){ out.innerHTML = '<small class="muted">Could not fetch products.</small>'; return; }
    const products = await pr.json();
    const prod = products.find(p=>p.id === mo.product_id || String(p.id) === String(mo.product_id));
    const pname = prod ? (prod.name||'').toString().toLowerCase() : '';
    // try to match one of the predefined names
    let matched = null;
    Object.keys(PREDEFINED_BOMS).forEach(k=>{ if(pname.indexOf(k) !== -1) matched = PREDEFINED_BOMS[k]; });
    if(!matched){ out.innerHTML = `<small class="muted">Product '${prod?prod.name:'unknown'}' does not have a predefined BOM.</small>`; return; }
    // render table
    let html = `<h3>${matched.title}</h3><table class="card" style="width:100%;margin-top:8px;border-collapse:collapse"><thead><tr><th>Item No</th><th>Component</th><th>Qty</th><th>Est. Price (INR)</th></tr></thead><tbody>`;
    matched.rows.forEach((r,i)=>{ html += `<tr><td style="padding:6px">${i+1}</td><td style="padding:6px">${r[0]}</td><td style="padding:6px">${r[1]}</td><td style="padding:6px">${r[2]}</td></tr>`; });
    html += `</tbody></table><div style="margin-top:8px;font-weight:700">Total ${matched.total}</div>`;
    out.innerHTML = html;
  }catch(e){ console.error(e); out.innerHTML = '<small class="muted">Lookup failed.</small>'; }
}

document.addEventListener('DOMContentLoaded',()=>{
  const btn = document.getElementById('orderLookupBtn');
  if(btn){ btn.addEventListener('click', (e)=>{ e.preventDefault(); lookupBOMByOrder(); }); }
});
async function loadMOs(){
  if(!isAuthed()) return;
  const r = await api("/orders");
  if(!r.ok){
    const err = await r.json().catch(()=>null);
    if(r.status===401){ showAuthMessage('Not authenticated — please log in.'); }
    console.error('MOs load failed', r.status, err);
    return;
  }
  showAuthMessage('');
  const data = await r.json();
  // debug: dump raw response for inspection
  try{ const dbg = document.getElementById('woDebug'); if(dbg) dbg.textContent = JSON.stringify(data, null, 2); }catch(e){}
  const tbody = document.querySelector('#moTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  // only these statuses are editable from the Orders page
  const statuses = ['planned','in_progress','confirmed'];
  const isOrders = document.body.hasAttribute('data-show-orders');
  data.forEach(m => {
    const tr = document.createElement('tr');
    const statusSelectId = 'mo-status-'+m.id;
    // build status select HTML
    const optionsHtml = statuses.map(s=>`<option value="${s}">${s.replace(/_/g,' ')}</option>`).join('');
    let statusHtml = '';
    if(isOrders){
      statusHtml = `<select id="${statusSelectId}">${optionsHtml}</select>`;
    } else {
      // on dashboard, show non-editable status text
      statusHtml = `<span class="muted">${m.status.replace(/_/g,' ')}</span>`;
    }
    tr.innerHTML = '<td>'+m.id+'</td>'+
                   '<td>'+m.product_id+'</td>'+
                   '<td>'+m.quantity+'</td>'+
                   '<td>'+statusHtml+'</td>'+
                   '<td>'+
                     (isOrders? ('<button class="auth-only orders-only" onclick="deleteMO('+m.id+')">Delete</button> <button class="auth-only orders-only" onclick="updateMOStatus('+m.id+')">Update Status</button>') : '')+
                   '</td>';
    tbody.appendChild(tr);
    // set the select to current status
  try{ const sel = document.getElementById(statusSelectId); if(sel) sel.value = m.status; }catch(e){}
  });
}

async function updateMOStatus(id){
  const sel = document.getElementById('mo-status-'+id);
  if(!sel) return;
  const status = sel.value;
  try{
    const r = await api('/orders',{method:'PUT', body: JSON.stringify({id: id, status: status})});
    if(!r.ok){ const j = await r.json().catch(()=>null); showAuthMessage((j&&j.error) || 'Update failed'); return; }
    showAuthMessage('Order status updated');
    await loadMOs();
  }catch(e){ console.error(e); showAuthMessage('Status update failed'); }
}

async function filterMOs(status){
  const r = await api('/orders'+(status?('?status='+status):''));
  const data = await r.json();
  const tbody = document.querySelector('#moTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  const statuses = ['planned','in_progress','confirmed'];
  const isOrders = document.body.hasAttribute('data-show-orders');
  const optionsHtml = statuses.map(s=>`<option value="${s}">${s.replace(/_/g,' ')}</option>`).join('');
  data.forEach(m => {
    const tr = document.createElement('tr');
    const statusSelectId = 'mo-status-'+m.id;
    let statusHtml = '';
    if(isOrders){
      statusHtml = `<select id="${statusSelectId}">${optionsHtml}</select>`;
    } else {
      statusHtml = `<span class="muted">${m.status.replace(/_/g,' ')}</span>`;
    }
    tr.innerHTML = '<td>'+m.id+'</td>'+
                   '<td>'+m.product_id+'</td>'+
                   '<td>'+m.quantity+'</td>'+
                   '<td>'+statusHtml+'</td>'+
                   '<td>'+(isOrders? ('<button class="auth-only orders-only" onclick="deleteMO('+m.id+')">Delete</button> <button class="auth-only orders-only" onclick="updateMOStatus('+m.id+')">Update Status</button>') : '')+'</td>';
    tbody.appendChild(tr);
    try{ const sel = document.getElementById(statusSelectId); if(sel) sel.value = m.status; }catch(e){}
  });
}

async function loadComponents(){
  if(!isAuthed()) return;
  const r=await api('/products');
  const data=await r.json();
  const tbody=document.querySelector('#componentsTable tbody'); if(!tbody) return; tbody.innerHTML='';
  data.filter(p=>p.type=='raw' || p.type=='component').forEach(p=>{ tbody.innerHTML+=`<tr><td>${p.id}</td><td>${p.name}</td><td>${p.stock_qty}</td></tr>`; });
}
async function deleteMO(id){await api("/orders?id="+id,{method:"DELETE"});loadMOs();}
async function deleteProduct(id){
  if(!confirm('Delete product #'+id+'? This cannot be undone.')) return;
  try{
    const r = await api('/products?id='+id,{method:'DELETE'});
    if(!r.ok){ const j = await r.json().catch(()=>null); showAuthMessage((j&&j.error) || 'Delete failed'); return; }
    showAuthMessage('Product deleted');
    await loadProducts();
  }catch(e){ console.error(e); showAuthMessage('Delete request failed'); }
}
async function loadWOs(){
  // Render Orders data directly (show product id, MO id, Qty / Delivery, Operation=product.type, Status)
  const tbody = document.querySelector('#woTable tbody');
  if(!tbody) return;
  try{
    const [ordersResp, prodsResp] = await Promise.all([api('/orders'), api('/products')]);
    if(!ordersResp.ok){ tbody.innerHTML = '<tr><td colspan="5" class="muted">Failed to load orders (status: '+ordersResp.status+').</td></tr>'; return; }
    const orders = await ordersResp.json();
    const prods = prodsResp && prodsResp.ok ? await prodsResp.json() : [];
    const prodById = {};
    prods.forEach(p=>{ prodById[p.id] = p; });

    tbody.innerHTML = '';
    orders.forEach(m => {
      const tr = document.createElement('tr');
      const productId = m.product_id || '';
      const product = prodById[productId] || null;
      const operation = product ? (product.type || '') : '';
      const qty = m.quantity || '';
      const deadline = m.deadline || '';
      const qtyDeadline = (qty?('Qty: '+qty):'') + (deadline?((qty? ' / ':'') + 'Delivery: '+deadline):'');
      const productName = product ? (product.name || '') : '';

  tr.innerHTML = '<td title="'+(productName.replace(/"/g,'&quot;')||'')+'">'+(productId||'')+'</td>'+
         '<td>'+(productName||'')+'</td>'+
         '<td>'+(m.id||'')+'</td>'+
         '<td>'+(qtyDeadline||'')+'</td>'+
         '<td>'+(operation||'')+'</td>'+
         '<td>'+(m.status||'')+'</td>';
      tbody.appendChild(tr);
    });
  if(orders.length===0){ tbody.innerHTML = '<tr><td colspan="6" class="muted">No orders found.</td></tr>'; }
  }catch(e){ console.error('Failed to render orders for WO view', e); tbody.innerHTML = '<tr><td colspan="5" class="muted">Error loading data.</td></tr>'; }
}
async function updateWO(id,status){
  try{
    const r = await api('/work-orders/'+id+'/status',{method:'PUT', body: JSON.stringify({status})});
    if(r && r.ok){ loadWOs(); if(typeof loadStock === 'function') loadStock(); }
  }catch(e){ console.error('Failed to update WO status', e); }
}
async function loadStock(){
  try{
    // fetch both ledger and product list; we'll compute totals from ledger and fall back to product.stock_qty
    const [stockResp, prodsResp] = await Promise.all([api('/stock'), api('/products')]);
    if(!prodsResp.ok){ console.error('Products load failed', prodsResp.status); return; }
    const prods = await prodsResp.json();
    // compute ledger sums if ledger is available
    let ledger = [];
    if(stockResp && stockResp.ok){ ledger = await stockResp.json(); }

    // build map product_id -> net quantity from ledger
    const ledgerTotals = {};
    ledger.forEach(entry => {
      const pid = entry.product_id;
      if(!pid) return;
      const sign = (entry.movement_type === 'in') ? 1 : -1;
      ledgerTotals[pid] = (ledgerTotals[pid] || 0) + (sign * (entry.quantity || 0));
    });

    // dedupe and sort products by id
    const unique = [];
    const seen = new Set();
    prods.sort((a,b)=> (a.id||0)-(b.id||0)).forEach(p=>{ if(!seen.has(p.id)){ seen.add(p.id); unique.push(p); } });

    showAuthMessage('');
    const tbody=document.querySelector("#stockTable tbody"); if(!tbody) return; tbody.innerHTML = "";
    unique.forEach((p, idx)=>{
      const pname = p.name || '';
      const ptype = p.type || '';
      // Use ledger total if present (ledger records are usually deltas); otherwise fall back to product.stock_qty
      const ledgerSum = ledgerTotals[p.id];
      const qty = (typeof ledgerSum === 'number') ? ledgerSum : (p.stock_qty || 0);
      tbody.innerHTML+=`<tr><td>${idx+1}</td><td>${pname}</td><td>${p.id}</td><td>${ptype}</td><td>${qty}</td></tr>`;
    });
  }catch(e){ console.error('Error loading stock', e); }
}

async function init(){ renderAuthControls(); await Promise.all([loadKPIs(), loadMOs(), loadWOs(), loadProducts(), loadBOMs(), loadStock()]); }

// auto-init when script loads if page is index
if(window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/') ){
  window.addEventListener('load', ()=>{ init(); });
}
function downloadReport(){window.location=API+"/reports/export";}
document.addEventListener("DOMContentLoaded",()=>{
  // ensure auth-based UI visibility is enforced immediately
  try{ renderAuthControls(); }catch(e){}
  if(document.getElementById("kpis")) loadKPIs();
  if(document.getElementById("productsTable")) {
    loadProducts();
    const pf = document.getElementById('productForm');
    if(pf){
      pf.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = Object.fromEntries(fd.entries());
        try{ const r = await api('/products',{method:'POST', body: JSON.stringify(payload)}); if(!r.ok){ const j=await r.json().catch(()=>null); showAuthMessage((j&&j.error) || 'Create failed'); } }
        catch(err){ console.error(err); showAuthMessage('Failed to reach backend'); }
        e.target.reset(); loadProducts();
      });
    }
  }
  if(document.getElementById("bomTable")) {
    loadBOMs();
    const bf = document.getElementById('bomForm');
    if(bf){
      bf.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const fd=new FormData(e.target);
        let comps, ops;
        try { comps = JSON.parse(fd.get('components')||'[]'); ops = JSON.parse(fd.get('operations')||'[]'); }
        catch { alert('Invalid JSON in BOM fields'); return; }
        try{ const r = await api('/bom',{method:'POST', body: JSON.stringify({product_id: fd.get('product_id'), components: comps, operations: ops})}); if(!r.ok){ const j=await r.json().catch(()=>null); showAuthMessage((j&&j.error) || 'Create BOM failed'); } }
        catch(err){ console.error(err); showAuthMessage('Failed to reach backend'); }
        e.target.reset(); loadBOMs();
      });
    }
  }
  if(document.getElementById("moTable")) {
    loadMOs();
    const mf = document.getElementById('moForm');
    if(mf){
      mf.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const fd=new FormData(e.target);
  const payload = { product_id: fd.get('product_id'), quantity: Number(fd.get('quantity')||1), deadline: fd.get('deadline')||null, status: 'confirmed' };
        try{
          const r = await api('/orders',{method:'POST', body: JSON.stringify(payload)});
          if(!r.ok){ const j=await r.json().catch(()=>null); showAuthMessage((j&&j.error) || 'Create MO failed'); }
          else { await loadMOs(); if(typeof loadStock === 'function') loadStock(); }
        }
        catch(err){ console.error(err); showAuthMessage('Failed to reach backend'); }
        e.target.reset();
      });
    }
  }
  // date input fallback: if browser doesn't show native picker, attach a simple prompt-based fallback
  try{
    const dateInputs = document.querySelectorAll('input[type=date]');
    // if flatpickr is available, use it for nicer UX
    if(window.flatpickr){
      dateInputs.forEach(inp=>{
        try{ flatpickr(inp, {dateFormat:'Y-m-d', allowInput:true}); }catch(e){}
      });
    } else {
      // if browser doesn't implement showPicker, fallback to prompt on focus
      dateInputs.forEach(inp=>{
        if(inp && typeof inp.showPicker !== 'function'){
          inp.addEventListener('focus', ()=>{
            // small prompt fallback: ask yyyy-mm-dd
            const v = prompt('Enter date (YYYY-MM-DD)', inp.value || '');
            if(v) inp.value = v;
          });
        }
      });
    }
  }catch(e){}
  // update page-specific auth-only visibility
  try{ updatePageAuthControls(); }catch(e){}
  if(document.getElementById("woTable")) loadWOs();
  if(document.getElementById("stockTable")) loadStock();
  if(document.getElementById('componentsTable')) loadComponents();
});
