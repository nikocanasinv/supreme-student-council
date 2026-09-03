const state = { user:null, page:"dashboard", inventory:[], scanner:null };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const api = async (url, options={}) => {
  const res = await fetch(url, {headers: {"Content-Type":"application/json", ...(options.headers||{})}, ...options});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
};
function toast(msg, bad=false){const t=$("toast");t.textContent=msg;t.className=`toast show ${bad?"bad":"good"}`;setTimeout(()=>t.className="toast",2800)}
function badge(status){const c=status==="AVAILABLE"?"available":status==="LOW STOCK"?"low":"out";return `<span class="badge ${c}">${esc(status)}</span>`}

async function boot(){
  const data = await api("/api/me");
  if(data.user) startApp(data.user); else showLogin();
}
function showLogin(){$("loginView").classList.remove("hidden");$("appView").classList.add("hidden")}
function startApp(user){
  state.user=user;$("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
  $("currentUser").textContent=user.full_name;$("currentRole").textContent=user.role;
  buildNav();navigate("dashboard");
}
function buildNav(){
  const nav=$("nav");
  const items=state.user.role==="ADMIN"
    ? [["dashboard","▦ Dashboard"],["inventory","▤ Inventory"],["add","＋ Add Supply"],["transactions","↻ Transactions"],["reports","▥ Reports"],["users","♙ Users"],["notifications","🔔 Notifications"]]
    : [["dashboard","▦ Dashboard"],["withdraw","▣ Withdraw Supply"],["mytransactions","↻ My Transactions"]];
  nav.innerHTML=items.map(([id,label])=>`<button data-page="${id}">${label}</button>`).join("");
  nav.querySelectorAll("button").forEach(b=>b.onclick=()=>navigate(b.dataset.page));
}
function navigate(page){
  state.page=page;
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const meta={
    dashboard:["Dashboard","Inventory overview"],inventory:["Inventory","Manage office supplies"],add:["Add Supply","Register a new inventory item"],
    transactions:["Transaction History","Complete audit trail"],reports:["Reports","Inventory status and export"],users:["User Management","Manage Council accounts"],
    notifications:["Notifications","Inventory activity"],withdraw:["Withdraw Supply","Select, scan, verify, and release supplies"],mytransactions:["My Transactions","Your inventory withdrawals"]
  }[page]||["Dashboard",""];
  $("pageTitle").textContent=meta[0];$("pageSubtitle").textContent=meta[1];
  ({dashboard:renderDashboard,inventory:renderInventory,add:renderAdd,transactions:renderTransactions,reports:renderReports,users:renderUsers,notifications:renderNotifications,withdraw:renderWithdraw,mytransactions:renderMyTransactions}[page])();
}

async function renderDashboard(){
  const d=await api("/api/dashboard");
  const inv=await api("/api/inventory");
  state.inventory=inv.items;

  const isAdmin=state.user.role==="ADMIN";
  const supplyCards=state.inventory.length
    ? state.inventory.map(x=>{
        const available=x.available_barcode_count ?? 0;
        const hasBarcodes=(x.barcode_count||0)>0;
        const status=x.quantity===0?"OUT OF STOCK":x.quantity<=x.minimum_stock?"LOW STOCK":"AVAILABLE";
        return `
          <button type="button" class="supply-card" data-supply-id="${x.id}">
            <div class="supply-card-top">
              <span class="supply-icon">▤</span>
              ${badge(status)}
            </div>
            <h3>${esc(x.supply_name)}</h3>
            <p class="supply-category">${esc(x.category)}</p>
            <div class="supply-quantity"><span>Current Quantity</span><strong>${x.quantity}</strong><small>${esc(x.unit)}</small></div>
            ${hasBarcodes
              ? `<p class="supply-barcode-info">Barcodes: ${available}/${x.quantity} available</p>`
              : `<p class="supply-barcode-info muted">Individual barcodes not assigned</p>`}
            <span class="supply-card-hint">${isAdmin?"Tap to manage supply":"Tap to withdraw"}</span>
          </button>`;
      }).join("")
    : `<div class="empty supply-empty">No supplies are currently available.</div>`;

  $("content").innerHTML=`
  <div class="cards">
    <div class="stat"><div class="label">TOTAL SUPPLIES</div><div class="value">${d.totalSupplies}</div></div>
    <div class="stat"><div class="label">TOTAL QUANTITY</div><div class="value">${d.totalQuantity}</div></div>
    <div class="stat"><div class="label">RELEASED UNITS</div><div class="value">${d.released}</div></div>
    <div class="stat"><div class="label">TRANSACTIONS</div><div class="value">${d.totalTransactions}</div></div>
  </div>

  <div class="panel supply-dashboard-panel">
    <div class="panel-head">
      <div>
        <h3>${isAdmin?"Supplies":"Available Supplies"}</h3>
        <p class="muted">${isAdmin
          ?"Tap a supply to view its current quantity, add stock, or manage individual barcodes."
          :"Tap a supply to see its current quantity, choose how many pieces to withdraw, then scan the required barcodes."}</p>
      </div>
    </div>
    <div class="supply-grid">${supplyCards}</div>
  </div>

  ${isAdmin?`
  <div class="grid2">
    <div class="panel"><div class="panel-head"><h3>Stock Alerts</h3></div>
      ${d.lowItems.length?`<div class="table-wrap"><table><thead><tr><th>Supply</th><th>Stock</th><th>Minimum</th><th>Status</th></tr></thead><tbody>${d.lowItems.map(x=>`<tr><td>${esc(x.supply_name)}</td><td>${x.quantity} ${esc(x.unit)}</td><td>${x.minimum_stock}</td><td>${badge(x.status)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">No low-stock items.</div>`}
    </div>
    <div class="panel"><div class="panel-head"><h3>System Status</h3></div>
      <p>Active Admin accounts: <b>JJ, Judiel, Sir Ey, Niko</b></p>
      <p>Low stock items: <b>${d.lowStock}</b></p><p>Out of stock items: <b>${d.outOfStock}</b></p>
      <p class="muted">All withdrawals are recorded with user, barcode, previous stock, new stock, and date/time.</p>
    </div>
  </div>`:""}

  <div id="dashboardSupplyModalTarget"></div>`;

  document.querySelectorAll(".supply-card").forEach(card=>{
    card.addEventListener("click",()=>{
      const item=state.inventory.find(x=>String(x.id)===String(card.dataset.supplyId));
      if(!item)return;
      if(isAdmin)openAdminSupplyActions(item);
      else openUserWithdraw(item);
    });
  });
}

function openAdminSupplyActions(item){
  const barcodeCount=item.barcode_count||0;
  const available=item.available_barcode_count||0;
  openModal(`Supply — ${item.supply_name}`,`
    <div class="supply-detail">
      <div class="supply-detail-quantity"><span>Current Quantity</span><strong>${item.quantity}</strong><small>${esc(item.unit)}</small></div>
      <p><b>Category:</b> ${esc(item.category)}</p>
      <p><b>Minimum Stock:</b> ${item.minimum_stock}</p>
      <p><b>Individual Barcodes:</b> ${barcodeCount?`${available} available / ${barcodeCount} total`:"Not assigned yet"}</p>
      ${item.description?`<p><b>Description:</b> ${esc(item.description)}</p>`:""}
      <div class="actions supply-admin-actions">
        <button type="button" class="primary" id="dashboardAddStock">＋ Add Supplies</button>
        <button type="button" class="secondary" id="dashboardBarcodes">▤ View Barcodes</button>
      </div>
    </div>`);
  $("dashboardAddStock").onclick=()=>manageBarcodes(item.id);
  $("dashboardBarcodes").onclick=()=>manageBarcodes(item.id);
}

function openUserWithdraw(item){
  if(item.quantity<=0)return toast("This supply is out of stock.",true);
  openModal(`Withdraw — ${item.supply_name}`,`
    <div class="supply-detail">
      <div class="supply-detail-quantity"><span>Current Quantity</span><strong>${item.quantity}</strong><small>${esc(item.unit)}</small></div>
      <p class="muted">${(item.barcode_count||0)>0
        ? `Individual barcodes available: <b>${item.available_barcode_count}/${item.quantity}</b>`
        : `This supply uses the existing supply barcode: <code>${esc(item.barcode)}</code>`}</p>
      <form id="dashboardWithdrawForm">
        <label>How many ${esc(item.unit)} do you want to withdraw?
          <input id="dashboardWithdrawQty" type="number" min="1" max="${item.quantity}" value="1" required>
        </label>
        <div class="actions" style="margin-top:15px">
          <button class="primary" type="submit">📷 Continue to Scan Barcodes</button>
          <button class="secondary" type="button" id="dashboardCancelWithdraw">Cancel</button>
        </div>
      </form>
    </div>`);
  $("dashboardCancelWithdraw").onclick=closeModal;
  $("dashboardWithdrawForm").onsubmit=e=>{
    e.preventDefault();
    const qty=Number($("dashboardWithdrawQty").value);
    if(!Number.isInteger(qty)||qty<=0)return toast("Enter a valid quantity.",true);
    if(qty>item.quantity)return toast("Quantity exceeds available stock.",true);
    if((item.barcode_count||0)>0 && qty>item.available_barcode_count)return toast("There are not enough available individual barcodes for that quantity.",true);
    closeModal();
    startScannerForItem(item,qty);
  };
}

async function renderInventory(){
  const d=await api("/api/inventory");state.inventory=d.items;
  $("content").innerHTML=`
  <div class="panel"><div class="toolbar">
    <input id="invSearch" placeholder="Search supply, category, or barcode">
    <button class="primary" type="button" id="inventoryAddSupplyBtn">＋ Add Supply</button>
  </div>
  <p class="muted">Each physical piece can have its own barcode. Use <b>Manage Barcodes</b> to create, view, print, or add individual barcode labels.</p>
  <div class="table-wrap"><table><thead><tr><th>Barcode</th><th>Supply</th><th>Category</th><th>Quantity</th><th>Unit</th><th>Barcodes</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody>${d.items.map(x=>{
    const count=x.barcode_count||0, available=x.available_barcode_count||0;
    const barcodeInfo=count===0
      ? `<span class="badge low">NOT ITEMIZED</span>`
      : `<span class="muted">${available}/${x.quantity} available</span>`;
    return `<tr><td>${esc(x.barcode)}</td><td><b>${esc(x.supply_name)}</b></td><td>${esc(x.category)}</td><td>${x.quantity}</td><td>${esc(x.unit)}</td><td>${barcodeInfo}</td><td>${badge(x.status)}</td><td><div class="actions"><button type="button" class="secondary inventory-action" data-action="barcodes" data-id="${x.id}">Barcodes</button><button type="button" class="secondary inventory-action" data-action="edit" data-id="${x.id}">Edit</button><button type="button" class="danger inventory-action" data-action="deactivate" data-id="${x.id}">Deactivate</button></div></td></tr>`;
  }).join("")||`<tr><td colspan="8" class="empty">No supplies found.</td></tr>`}</tbody></table></div></div>`;

  // Inventory action buttons are wired with JavaScript instead of inline
  // onclick handlers because Helmet's Content Security Policy blocks inline JS.
  document.querySelectorAll("#content .inventory-action").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const id=Number(btn.dataset.id);
      if(btn.dataset.action==="barcodes") manageBarcodes(id);
      else if(btn.dataset.action==="edit") editSupply(id);
      else if(btn.dataset.action==="deactivate") deleteSupply(id);
    });
  });

  $("inventoryAddSupplyBtn").addEventListener("click",()=>navigate("add"));
  $("invSearch").oninput=e=>filterInventory(e.target.value);
}
function filterInventory(q){
  const rows=document.querySelectorAll("tbody tr");const s=q.toLowerCase();
  rows.forEach(r=>r.style.display=r.textContent.toLowerCase().includes(s)?"":"none");
}
async function editSupply(id){
  const x=state.inventory.find(i=>i.id===id);if(!x)return;
  const itemized=(x.barcode_count||0)>0;
  openModal("Edit Inventory",`
  <form id="editSupplyForm"><div class="form-grid">
  ${field("Supply Name","supply_name",x.supply_name)}${field("Category","category",x.category)}
  ${field("Barcode (master)","barcode",x.barcode)}${field("Quantity","quantity",x.quantity,"number")}
  ${field("Unit","unit",x.unit)}${field("Minimum Stock","minimum_stock",x.minimum_stock,"number")}
  <label class="full-field">Description<textarea name="description">${esc(x.description)}</textarea></label>
  </div>
  ${itemized?`<p class="muted"><b>Individual barcode mode:</b> Quantity is controlled by the physical barcode records. Use the <b>Barcodes</b> button in Inventory to add or remove stock labels.</p>`:""}
  <div class="actions" style="margin-top:15px"><button class="primary">Save Changes</button><button type="button" class="secondary" onclick="closeModal()">Cancel</button></div></form>`);
  if(itemized)$("editSupplyForm").elements.quantity.disabled=true;
  $("editSupplyForm").onsubmit=async e=>{
    e.preventDefault();
    try{
      const body=Object.fromEntries(new FormData(e.target));
      if(itemized)body.quantity=x.quantity;
      await api(`/api/inventory/${id}`,{method:"PUT",body:JSON.stringify(body)});
      closeModal();toast("Inventory updated.");renderInventory();
    }catch(err){toast(err.message,true)}
  };
}
function deleteSupply(id){if(!confirm("Deactivate this supply? Its transaction history will remain recorded."))return;api(`/api/inventory/${id}`,{method:"DELETE"}).then(()=>{toast("Supply deactivated.");renderInventory()}).catch(e=>toast(e.message,true))}
function field(label,name,value="",type="text"){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" required></label>`}

async function renderAdd(){
  $("content").innerHTML=`
  <div class="panel">
    <h3>Register New Supply</h3>
    <p class="muted">Enter the stock quantity, then enter one unique barcode for every physical piece. The system will show a barcode image for each code.</p>
    <form id="addSupplyForm" style="margin-top:15px">
      <div class="form-grid">
        ${field("Supply Name","supply_name")}${field("Category","category")}
        ${field("Quantity","quantity",0,"number")}${field("Unit","unit","Pieces")}
        ${field("Minimum Stock","minimum_stock",0,"number")}
        <label class="full-field">Description<textarea name="description" placeholder="Optional notes"></textarea></label>
      </div>

      <div class="panel barcode-setup-panel">
        <div class="panel-head">
          <div>
            <h3>Individual Barcode Labels</h3>
            <p class="muted">One barcode code is required for each quantity.</p>
          </div>
          <button type="button" class="secondary" id="autoFillBarcodeBtn">Auto-fill Sequential</button>
        </div>
        <label>Starting Number (optional)<input id="barcodeStart" inputmode="numeric" placeholder="Example: 12345"></label>
        <div id="barcodeInputs" class="barcode-inputs">
          <div class="empty">Enter a quantity above to create the barcode fields.</div>
        </div>
      </div>

      <div class="actions" style="margin-top:15px"><button class="primary">Save Supply + Barcodes</button><button type="button" class="secondary" onclick="navigate('inventory')">Cancel</button></div>
    </form>
  </div>`;

  const qtyInput=$('addSupplyForm').elements.quantity;
  const redraw=()=>{
    const qty=Math.max(0,Math.min(500,Number(qtyInput.value)||0));
    const existing=[...document.querySelectorAll(".new-barcode-code")].map(x=>x.value);
    const box=$("barcodeInputs");
    if(!qty){box.innerHTML=`<div class="empty">Enter a quantity above to create the barcode fields.</div>`;return;}
    box.innerHTML=Array.from({length:qty},(_,i)=>`
      <div class="barcode-row">
        <div class="barcode-number"><b>Piece #${i+1}</b><span class="muted">${esc($("addSupplyForm").elements.unit.value||"Unit")}</span></div>
        <label class="barcode-code-label">Barcode Code<input class="new-barcode-code" data-index="${i}" value="${esc(existing[i]||"")}" required></label>
        <div class="barcode-preview-wrap"><svg id="newBarcodePreview${i}" class="barcode-preview"></svg></div>
      </div>`).join("");
    document.querySelectorAll(".new-barcode-code").forEach(input=>{
      input.addEventListener("input",()=>renderBarcodePreview(input.value,`newBarcodePreview${input.dataset.index}`));
      renderBarcodePreview(input.value,`newBarcodePreview${input.dataset.index}`);
    });
  };
  qtyInput.addEventListener("input",redraw);
  $('addSupplyForm').elements.unit.addEventListener("input",redraw);

  $("autoFillBarcodeBtn").onclick=()=>{
    const start=Number($("barcodeStart").value);
    const inputs=[...document.querySelectorAll(".new-barcode-code")];
    if(!Number.isSafeInteger(start)||start<0)return toast("Enter a valid starting number first.",true);
    inputs.forEach((input,i)=>{input.value=String(start+i);renderBarcodePreview(input.value,`newBarcodePreview${i}`)});
  };

  $("addSupplyForm").onsubmit=async e=>{
    e.preventDefault();
    try{
      const form=new FormData(e.target);
      const qty=Number(form.get("quantity"));
      const codes=[...document.querySelectorAll(".new-barcode-code")].map(x=>x.value.trim());
      if(!Number.isInteger(qty)||qty<0)throw new Error("Quantity must be a non-negative whole number.");
      if(qty>0&&codes.length!==qty)throw new Error(`Enter ${qty} barcode(s), one for each piece.`);
      if(new Set(codes.map(x=>x.toLowerCase())).size!==codes.length)throw new Error("Barcode values must be unique.");
      if(codes.some(x=>!x))throw new Error("Every barcode field must be filled in.");
      const body={
        supply_name:form.get("supply_name"),category:form.get("category"),
        quantity:qty,unit:form.get("unit"),minimum_stock:form.get("minimum_stock"),
        description:form.get("description"),barcodes:codes
      };
      await api("/api/inventory",{method:"POST",body:JSON.stringify(body)});
      toast("Supply and individual barcodes saved.");navigate("inventory");
    }catch(err){toast(err.message,true)}
  };
}

function renderBarcodePreview(code, svgId){
  const svg=$(svgId);
  if(!svg)return;
  svg.innerHTML="";
  if(!code)return;
  if(typeof JsBarcode==="undefined"){
    svg.outerHTML=`<div class="muted">Barcode library unavailable.</div>`;
    return;
  }
  try{
    JsBarcode(svg,code,{format:"CODE128",displayValue:true,fontSize:14,height:55,margin:8});
  }catch(e){
    svg.innerHTML="";
    const text=document.createElementNS("http://www.w3.org/2000/svg","text");
    text.setAttribute("x","5");text.setAttribute("y","22");text.setAttribute("fill","#6b7280");
    text.textContent="Invalid barcode value";
    svg.appendChild(text);
  }
}

function printBarcode(code,supplyName,pieceLabel){
  const holder=document.createElement("svg");
  document.body.appendChild(holder);
  try{
    JsBarcode(holder,code,{format:"CODE128",displayValue:true,fontSize:16,height:70,margin:12});
    const svg=holder.outerHTML;
    const win=window.open("","_blank","width=700,height=500");
    if(!win){toast("Please allow pop-ups to print the barcode.",true);return;}
    win.document.write(`<!doctype html><html><head><title>Barcode - ${esc(supplyName)}</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:30px}.label{display:inline-block;border:1px dashed #999;padding:20px;min-width:360px}h2{margin:0 0 5px}p{margin:5px 0 15px;color:#555}</style></head><body><div class="label"><h2>${esc(supplyName)}</h2><p>${esc(pieceLabel)}</p>${svg}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
    win.document.close();
  }finally{holder.remove();}
}

async function manageBarcodes(id){
  try{
    const d=await api(`/api/inventory/${id}/barcodes`);
    const total=d.counts.total, available=d.counts.available, withdrawn=d.counts.withdrawn;
    const currentStock=d.inventory.quantity;

    let body=`
      <div class="barcode-summary">
        <b>Stock:</b> ${currentStock} ${esc(d.inventory.unit)}
        &nbsp; • &nbsp; <b>Total labels:</b> ${total}
        &nbsp; • &nbsp; <b>Available:</b> ${available}
        &nbsp; • &nbsp; <b>Withdrawn:</b> ${withdrawn}
      </div>`;

    if(total===0 && currentStock>0){
      body+=`<div class="panel barcode-assign-panel">
        <h3>Assign Individual Barcodes</h3>
        <p class="muted">This existing supply has no individual labels yet. Enter exactly <b>${currentStock}</b> barcode codes to label the current stock.</p>
        <form id="assignBarcodeForm"><div id="manageBarcodeInputs"></div>
        <div class="actions"><button class="primary">Save Barcodes</button></div></form>
      </div>`;
    }else if(total>0){
      body+=`<div class="panel">
        <div class="panel-head"><h3>Barcode Labels</h3><button class="secondary" id="printAllBarcodes">Print Available Labels</button></div>
        <div class="barcode-grid">${d.barcodes.map((b,i)=>`
          <div class="barcode-card">
            <div><b>Piece #${i+1}</b><span class="badge ${b.status==="AVAILABLE"?"available":"out"}">${esc(b.status)}</span></div>
            <svg id="manageBarcode${b.id}" class="barcode-preview"></svg>
            <code>${esc(b.barcode)}</code>
            <div class="actions">
              <button class="secondary print-one" data-code="${esc(b.barcode)}" data-name="${esc(d.inventory.supply_name)}" data-piece="Piece #${i+1}">Print</button>
              ${b.status==="AVAILABLE"?`<button class="danger remove-barcode" data-id="${b.id}">Remove</button>`:""}
            </div>
          </div>`).join("")}</div>
      </div>`;
    }else{
      body+=`<div class="panel"><h3>No barcode labels yet</h3><p class="muted">This supply currently has zero stock. Add new pieces below and give each piece its own barcode.</p></div>`;
    }

    body+=`<div class="panel">
      <h3>Add New Stock + Barcodes</h3>
      <p class="muted">Adding new barcode labels here also increases the stock quantity.</p>
      <form id="addBarcodeForm">
        <div class="form-grid">
          <label>Number of new pieces<input id="newBarcodeQty" type="number" min="1" max="500" value="1" required></label>
          <label>Starting Number (optional)<input id="manageBarcodeStart" inputmode="numeric" placeholder="Example: 12345"></label>
        </div>
        <div id="additionalBarcodeInputs"></div>
        <div class="actions"><button class="primary">Add Barcode(s)</button></div>
      </form>
    </div>`;

    openModal(`Barcodes — ${d.inventory.supply_name}`,body);

    if(total===0 && currentStock>0){
      const inputs=document.getElementById("manageBarcodeInputs");
      inputs.innerHTML=Array.from({length:currentStock},(_,i)=>`
        <div class="barcode-row">
          <div class="barcode-number"><b>Piece #${i+1}</b></div>
          <label class="barcode-code-label">Barcode Code<input class="manage-new-code" data-index="${i}" required></label>
          <div class="barcode-preview-wrap"><svg id="assignPreview${i}" class="barcode-preview"></svg></div>
        </div>`).join("");
      document.querySelectorAll(".manage-new-code").forEach(input=>{
        input.oninput=()=>renderBarcodePreview(input.value,`assignPreview${input.dataset.index}`);
      });
      $("assignBarcodeForm").onsubmit=async e=>{
        e.preventDefault();
        try{
          const codes=[...document.querySelectorAll(".manage-new-code")].map(x=>x.value.trim());
          if(codes.some(x=>!x))throw new Error("Every barcode field must be filled in.");
          if(new Set(codes.map(x=>x.toLowerCase())).size!==codes.length)throw new Error("Barcode values must be unique.");
          await api(`/api/inventory/${id}/barcodes`,{method:"POST",body:JSON.stringify({barcodes:codes})});
          toast("Individual barcodes assigned.");closeModal();renderInventory();
        }catch(e){toast(e.message,true)}
      };
    }

    if(total>0){
      document.querySelectorAll(".barcode-preview").forEach(svg=>{
        const b=d.barcodes.find(x=>`manageBarcode${x.id}`===svg.id);
        if(b)renderBarcodePreview(b.barcode,svg.id);
      });
      document.querySelectorAll(".print-one").forEach(btn=>{
        btn.onclick=()=>printBarcode(btn.dataset.code,btn.dataset.name,btn.dataset.piece);
      });
      document.querySelectorAll(".remove-barcode").forEach(btn=>btn.onclick=async()=>{
        if(!confirm("Remove this available barcode and one piece from stock?"))return;
        try{
          await api(`/api/inventory/${id}/barcodes/${btn.dataset.id}`,{method:"DELETE"});
          toast("Barcode removed.");manageBarcodes(id);renderInventory();
        }catch(e){toast(e.message,true)}
      });
      $("printAllBarcodes").onclick=()=>{
        const availableRows=d.barcodes.filter(x=>x.status==="AVAILABLE");
        const win=window.open("","_blank","width=900,height=700");
        if(!win)return toast("Please allow pop-ups to print the barcodes.",true);
        const labels=availableRows.map((b,i)=>{
          const holder=document.createElement("svg");
          JsBarcode(holder,b.barcode,{format:"CODE128",displayValue:true,fontSize:14,height:55,margin:8});
          return `<div class="label"><h3>${esc(d.inventory.supply_name)}</h3><p>Piece #${i+1}</p>${holder.outerHTML}</div>`;
        }).join("");
        win.document.write(`<!doctype html><html><head><title>Barcodes - ${esc(d.inventory.supply_name)}</title><style>body{font-family:Arial;padding:20px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:15px}.label{text-align:center;border:1px dashed #999;padding:12px;break-inside:avoid}.label h3{margin:0}.label p{margin:4px 0 8px;color:#555}</style></head><body><div class="grid">${labels}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
        win.document.close();
      };
    }

    const buildAdditional=()=>{
      const qty=Math.max(1,Math.min(500,Number($("newBarcodeQty").value)||1));
      $("additionalBarcodeInputs").innerHTML=Array.from({length:qty},(_,i)=>`
        <div class="barcode-row compact">
          <div class="barcode-number"><b>New Piece #${i+1}</b></div>
          <label class="barcode-code-label">Barcode Code<input class="additional-code" data-index="${i}" required></label>
          <div class="barcode-preview-wrap"><svg id="additionalPreview${i}" class="barcode-preview"></svg></div>
        </div>`).join("");
      document.querySelectorAll(".additional-code").forEach(input=>{
        input.oninput=()=>renderBarcodePreview(input.value,`additionalPreview${input.dataset.index}`);
      });
    };

    $("newBarcodeQty").oninput=buildAdditional;
    $("manageBarcodeStart").oninput=()=>{
      const start=Number($("manageBarcodeStart").value);
      const inputs=[...document.querySelectorAll(".additional-code")];
      if(!Number.isSafeInteger(start)||start<0)return;
      inputs.forEach((input,i)=>{
        input.value=String(start+i);
        renderBarcodePreview(input.value,`additionalPreview${i}`);
      });
    };
    buildAdditional();

    $("addBarcodeForm").onsubmit=async e=>{
      e.preventDefault();
      try{
        const codes=[...document.querySelectorAll(".additional-code")].map(x=>x.value.trim());
        if(codes.some(x=>!x))throw new Error("Every barcode field must be filled in.");
        if(new Set(codes.map(x=>x.toLowerCase())).size!==codes.length)throw new Error("Barcode values must be unique.");
        await api(`/api/inventory/${id}/barcodes`,{method:"POST",body:JSON.stringify({barcodes:codes})});
        toast("New stock and barcodes added.");manageBarcodes(id);renderInventory();
      }catch(e){toast(e.message,true)}
    };
  }catch(e){toast(e.message,true)}
}
async function renderTransactions(){
  const d=await api("/api/transactions");
  const rows=d.transactions||[];
  const added=rows.filter(x=>x.transaction_type==="ADDED" || (x.transaction_type==="ADJUSTED" && Number(x.quantity)>0));
  const withdrawn=rows.filter(x=>x.transaction_type==="WITHDRAWN" || (x.transaction_type==="ADJUSTED" && Number(x.quantity)<0));
  const other=rows.filter(x=>!added.includes(x) && !withdrawn.includes(x));
  const table=(items,mode)=>{
    const heading=mode==="added"?"Quantity Added":mode==="withdrawn"?"Quantity Withdrawn":"Change";
    const label=mode==="added"?"adding":mode==="withdrawn"?"withdrawal":"other";
    return `<div class="table-wrap"><table><thead><tr><th>Date/Time</th><th>User</th><th>Supply</th><th>Barcode</th><th>Action</th><th>${heading}</th><th>Previous</th><th>New</th><th>Remarks</th></tr></thead><tbody>${items.map(x=>txRow(x,mode)).join("")||`<tr><td colspan="9" class="empty">No ${label} history.</td></tr>`}</tbody></table></div>`;
  };
  $("content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Transaction History</h3><div class="actions"><button class="secondary" id="refreshTransactionsBtn">Refresh</button><button class="danger" id="deleteTransactionsBtn">Delete History</button></div></div>
    <div class="actions" style="margin-bottom:15px"><button class="primary tx-tab" data-tab="all">All Activity</button><button class="secondary tx-tab" data-tab="added">Adding History</button><button class="secondary tx-tab" data-tab="withdrawn">Withdrawal History</button><button class="secondary tx-tab" data-tab="other">Other Changes</button></div>
    <input id="txSearch" placeholder="Search this history..." style="margin-bottom:15px"><div id="txHistoryBody"></div></div>`;
  const datasets={all:rows,added,withdrawn,other};
  let active="all";
  const renderTab=()=>{
    $("txHistoryBody").innerHTML=table(datasets[active],active);
    const search=($("txSearch").value||"").toLowerCase();
    document.querySelectorAll("#txHistoryBody tbody tr").forEach(r=>r.style.display=!search||r.textContent.toLowerCase().includes(search)?"":"none");
    document.querySelectorAll(".tx-tab").forEach(b=>b.className=b.dataset.tab===active?"primary tx-tab":"secondary tx-tab");
  };
  document.querySelectorAll(".tx-tab").forEach(b=>b.onclick=()=>{active=b.dataset.tab;renderTab()});
  $("txSearch").oninput=renderTab;
  $("refreshTransactionsBtn").onclick=renderTransactions;
  $("deleteTransactionsBtn").onclick=async()=>{
    if(!rows.length){toast("There is no transaction history to delete.",true);return;}
    if(!confirm("Delete ALL transaction history? This permanently removes the history but does NOT change current inventory quantities.")) return;
    try{
      const r=await api("/api/transactions",{method:"DELETE",body:JSON.stringify({})});
      toast(`${r.deleted||0} history record(s) deleted.`);
      renderTransactions();
    }catch(e){toast(e.message,true)}
  };
  renderTab();
}
function txRow(x,mode="all"){const qty=Math.abs(Number(x.quantity)||0);const change=mode==="added"?`+${qty}`:mode==="withdrawn"?`-${qty}`:`${x.quantity>0?"+":""}${x.quantity}`;return `<tr><td>${esc(x.created_at)}</td><td>${esc(x.user_name||"System")}</td><td>${esc(x.supply_name||"Deactivated Supply")}</td><td>${esc(x.barcode)}</td><td>${esc(x.transaction_type)}</td><td>${change}</td><td>${x.previous_quantity}</td><td>${x.new_quantity}</td><td>${esc(x.remarks)}</td></tr>`}

async function renderReports(){
  const d=await api("/api/inventory");
  $("content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Current Inventory Report</h3><div class="actions"><button class="primary" id="emailReportBtn">PDF + Email Report</button><button class="secondary" id="csvReportBtn">Export CSV</button><button class="secondary" id="printReportBtn">Print</button><button class="danger" id="deleteReportHistoryBtn">Delete History</button></div></div>
  <p class="muted" style="margin:0 0 15px">Generate the current inventory PDF and choose the email address(es) that should receive it. The address you enter here is the recipient for this report only.</p>
  <div class="table-wrap"><table><thead><tr><th>Supply</th><th>Category</th><th>Barcode</th><th>Current Quantity</th><th>Minimum</th><th>Status</th></tr></thead><tbody>${d.items.map(x=>`<tr><td>${esc(x.supply_name)}</td><td>${esc(x.category)}</td><td>${esc(x.barcode)}</td><td>${x.quantity} ${esc(x.unit)}</td><td>${x.minimum_stock}</td><td>${badge(x.status)}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">No inventory.</td></tr>`}</tbody></table></div></div>`;

  $("csvReportBtn").onclick=()=>{window.location="/api/export.csv"};
  $("printReportBtn").onclick=()=>window.print();
  $("deleteReportHistoryBtn").onclick=()=>deleteTransactionHistory("report");
  $("emailReportBtn").onclick=()=>openReportEmailModal();
}

function openReportEmailModal(){
  openModal("Send PDF Report",`<div class="form-grid"><div class="field"><label>Email address(es)</label><input id="reportRecipient" type="text" placeholder="example@email.com, another@email.com" autocomplete="email"><small class="muted">Enter one or more recipient email addresses separated by commas. The report will be sent to exactly the address(es) entered here.</small></div></div><div class="actions" style="margin-top:15px"><button class="secondary" id="cancelReportEmailBtn">Cancel</button><button class="primary" id="sendReportEmailBtn">Send PDF Report</button></div>`);
  $("cancelReportEmailBtn").onclick=closeModal;
  $("reportRecipient").focus();
  $("sendReportEmailBtn").onclick=sendReportEmail;
}

async function sendReportEmail(){
  const input=$("reportRecipient");
  const btn=$("sendReportEmailBtn");
  const to=(input.value||"").trim();
  if(!to){toast("Enter the email address you want to send the report to.",true);input.focus();return;}
  btn.disabled=true;
  btn.textContent="Sending…";
  try{
    const res=await fetch("/api/export.pdf-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to})});
    if(!res.ok){ const data=await res.json().catch(()=>({})); throw new Error(data.error||"Report email failed."); }
    const pdfBlob=await res.blob();
    const url=URL.createObjectURL(pdfBlob); const a=document.createElement("a"); a.href=url; a.download=`Council_Inventory_Report_${new Date().toISOString().slice(0,10)}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    closeModal();
    toast(`PDF report sent to ${res.headers.get("X-Report-Recipient")||to}.`);
  }catch(e){toast(e.message,true);btn.disabled=false;btn.textContent="Send PDF Report";}
}

async function deleteTransactionHistory(source="transactions"){
  const d=await api("/api/transactions");
  const count=(d.transactions||[]).length;
  if(!count){toast("There is no transaction history to delete.",true);return;}
  const ok=confirm(`Delete ALL ${count} transaction history record(s)? This permanently removes the history but does NOT change current inventory quantities.`);
  if(!ok)return;
  try{
    const r=await api("/api/transactions",{method:"DELETE",body:JSON.stringify({})});
    toast(`${r.deleted||0} history record(s) deleted.`);
    if(source==="report") renderReports(); else renderTransactions();
  }catch(e){toast(e.message,true)}
}

async function renderUsers(){
  const d = await api("/api/users");

  $("content").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Council Accounts</h3>
        <button class="primary" id="addUserBtn">＋ Add User</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            ${d.users.map(u => `
              <tr>
                <td>${esc(u.full_name)}</td>
                <td>${esc(u.username)}</td>
                <td>${u.role}</td>
                <td>${u.status}</td>
                <td>${esc(u.created_at)}</td>
                <td>
                  <button class="secondary edit-user-btn" data-user-id="${u.id}">
                    Edit
                  </button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Add User button
  $("addUserBtn").addEventListener("click", () => {
    newUser();
  });

  // Edit buttons
  document.querySelectorAll(".edit-user-btn").forEach(button => {
    button.addEventListener("click", () => {
      const user = d.users.find(u => u.id == button.dataset.userId);
      if (user) editUser(user);
    });
  });
}
function newUser(){openModal("Create Council Account",`<form id="userForm"><div class="form-grid">${field("Full Name","full_name")}${field("Username","username")}${field("Password","password")}<label>Role<select name="role"><option>USER</option><option>ADMIN</option></select></label></div><div class="actions" style="margin-top:15px"><button class="primary">Create Account</button></div></form>`);$("userForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/users",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});closeModal();toast("Account created.");renderUsers()}catch(err){toast(err.message,true)}}}
function editUser(u){openModal("Edit Account",`<form id="editUserForm"><div class="form-grid">${field("Full Name","full_name",u.full_name)}<label>Role<select name="role"><option ${u.role==="USER"?"selected":""}>USER</option><option ${u.role==="ADMIN"?"selected":""}>ADMIN</option></select></label><label>Status<select name="status"><option ${u.status==="ACTIVE"?"selected":""}>ACTIVE</option><option ${u.status==="DISABLED"?"selected":""}>DISABLED</option></select></label><label>New Password (optional)<input name="password" type="password" minlength="8"></label></div><p class="muted">Username: <b>${esc(u.username)}</b></p><div class="actions"><button class="primary">Save</button></div></form>`);$("editUserForm").onsubmit=async e=>{e.preventDefault();try{await api(`/api/users/${u.id}`,{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});closeModal();toast("Account updated.");renderUsers()}catch(err){toast(err.message,true)}}}

async function renderNotifications(){
  const d=await api("/api/notifications");
  $("content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Inventory Notifications</h3><button class="secondary" onclick="api('/api/notifications/read',{method:'POST'}).then(()=>renderNotifications())">Mark Mine Read</button></div>${d.notifications.map(n=>`<div style="padding:13px;border-bottom:1px solid var(--border)"><b>${esc(n.created_at)}</b> — ${esc(n.message)} <span class="muted">(${esc(n.recipient||"")})</span></div>`).join("")||`<div class="empty">No notifications.</div>`}</div>`;
}

async function renderWithdraw(){
  const d=await api("/api/inventory");state.inventory=d.items.filter(x=>x.quantity>0);
  $("content").innerHTML=`<div class="panel"><h3>Withdraw / Use Supply</h3><p class="muted">Select the supply and quantity. For itemized supplies, the camera will verify each individual barcode before stock is deducted.</p>
  <form id="withdrawForm"><div class="form-grid"><label>Supply<select id="withdrawSupply" name="inventory_id" required><option value="">Select supply</option>${state.inventory.map(x=>`<option value="${x.id}">${esc(x.supply_name)} — ${x.quantity} ${esc(x.unit)}</option>`).join("")}</select></label>
  <label>Quantity<input id="withdrawQty" name="quantity" type="number" min="1" required></label></div>
  <div id="selectedInfo" class="panel hidden"></div>
  <div class="actions" style="margin-top:15px"><button type="button" class="primary" id="scanBtn">📷 Scan Barcode</button></div>
  <div id="scanResult" style="margin-top:15px"></div></form></div>`;
  $("withdrawSupply").onchange=showSelected;$("scanBtn").onclick=startScanner;
}
async function showSelected(){
  const x=state.inventory.find(i=>String(i.id)===String($("withdrawSupply").value)),box=$("selectedInfo");
  if(!x){box.classList.add("hidden");return}
  box.classList.remove("hidden");
  let itemized=x.barcode_count>0;
  box.innerHTML=itemized
    ? `<b>${esc(x.supply_name)}</b><br>Available: ${x.quantity} ${esc(x.unit)}<br>Individual barcodes available: ${x.available_barcode_count}/${x.quantity}`
    : `<b>${esc(x.supply_name)}</b><br>Available: ${x.quantity} ${esc(x.unit)}<br>Barcode required: <code>${esc(x.barcode)}</code><br><span class="muted">This supply has not been converted to individual barcode mode yet.</span>`;
}
async function startScanner(){
  const x=state.inventory.find(i=>String(i.id)===String($("withdrawSupply").value));
  const qty=Number($("withdrawQty").value);
  if(!x)return toast("Select a supply first.",true);
  if(!Number.isInteger(qty)||qty<=0)return toast("Enter a valid quantity.",true);
  if(qty>x.quantity)return toast("Quantity exceeds available stock.",true);
  if((x.barcode_count||0)>0 && qty>x.available_barcode_count)return toast("There are not enough available individual barcodes.",true);
  startScannerForItem(x,qty);
}

async function startScannerForItem(x,qty){
  const itemized=(x.barcode_count||0)>0;
  let scanned=[];
  let finished=false;
  let controls=null;

  openModal("Scan or Enter Barcode",`<div class="scanner">
    <p id="scanInstruction">${itemized?`Scan or enter piece 1 of ${qty}. Each code must belong to ${esc(x.supply_name)}.`:`Scan or enter the barcode for this supply.`}</p>
    <div class="scan-progress"><b id="scanProgress">${itemized?`0 / ${qty}`:"1 barcode"}</b></div>
    <div class="scan-frame"><video id="scannerVideo" autoplay muted playsinline></video></div>
    <p id="scanStatus" class="muted">Starting camera… You can also type the barcode below.</p>
    <div class="manual-barcode-entry">
      <label><b>Or type barcode number</b>
        <input id="manualBarcodeInput" type="text" inputmode="numeric" autocomplete="off" placeholder="Enter barcode number">
      </label>
      <button type="button" class="secondary" id="manualBarcodeBtn">✓ Use Typed Barcode</button>
    </div>
    <div id="scannedCodes" class="scanned-codes"></div>
    <button class="secondary" id="stopScan">Stop Camera</button>
  </div>`);

  const acceptCode=async(rawCode)=>{
    if(finished)return;
    const code=String(rawCode||"").trim();
    if(!code){toast("Enter a barcode number first.",true);return;}
    if(scanned.some(v=>v.toLowerCase()===code.toLowerCase())){
      const status=$("scanStatus");
      if(status)status.textContent="Duplicate barcode. Scan a different piece.";
      return;
    }

    scanned.push(code);
    const list=$("scannedCodes");
    if(list)list.innerHTML=scanned.map((c,i)=>`<span class="scanned-code">✓ Piece ${i+1}: <code>${esc(c)}</code></span>`).join("");
    const progress=$("scanProgress");
    if(progress)progress.textContent=itemized?`${scanned.length} / ${qty}`:"1 barcode";

    const input=$("manualBarcodeInput");
    if(input){input.value="";input.focus();}

    if(itemized && scanned.length<qty){
      const instruction=$("scanInstruction");
      const status=$("scanStatus");
      if(instruction)instruction.textContent=`Scan or enter piece ${scanned.length+1} of ${qty}.`;
      if(status)status.textContent="Barcode accepted. Scan or enter the next piece.";
      return;
    }

    finished=true;
    if(controls){try{controls.stop()}catch(e){}}
    state.scanner=null;
    closeModal();
    await verifyAndConfirm(x,qty,scanned);
  };

  $("manualBarcodeBtn").onclick=()=>acceptCode($("manualBarcodeInput").value);
  $("manualBarcodeInput").addEventListener("keydown",e=>{
    if(e.key==="Enter"){e.preventDefault();acceptCode(e.target.value);}
  });

  try{
    if(typeof ZXingBrowser==="undefined")throw new Error("Barcode scanner library did not load. You can still type the barcode manually.");
    const codeReader=new ZXingBrowser.BrowserMultiFormatReader();
    state.scanner=codeReader;
    controls=await codeReader.decodeFromConstraints({video:{facingMode:{ideal:"environment"}}},"scannerVideo",async(result,err,ctrl)=>{
      if(!result || finished)return;
      await acceptCode(result.getText());
    });
    state.scanner=controls;
    $("stopScan").onclick=()=>{finished=true;try{controls.stop()}catch(e){}state.scanner=null;closeModal()};
    $("scanStatus").textContent="Camera ready. Scan the barcode, or type the barcode number below.";
    $("manualBarcodeInput").focus();
  }catch(e){
    console.error("CAMERA ERROR:",e);
    $("scanStatus").textContent=`Camera unavailable. You can type the barcode number below instead. ${e.message||""}`;
    $("stopScan").onclick=()=>{finished=true;try{controls?.stop()}catch(e){}state.scanner=null;closeModal()};
    $("manualBarcodeInput").focus();
  }
}

async function verifyAndConfirm(x,qty,barcodes){
  const codes=Array.isArray(barcodes)?barcodes:[barcodes];
  const legacy=!x.barcode_count;
  const match=legacy
    ? codes.length===1 && String(codes[0]).trim()===String(x.barcode).trim()
    : codes.length===qty;

  if(!match){
    openModal(`Barcode Verification — ${esc(x.supply_name)}`,`<div class="receipt">
      <h3>✕ Barcode Not Matched</h3>
      <p>The scanned barcode does not match the selected supply.</p>
      <div class="actions"><button class="secondary" id="cancelWithdrawal">Cancel</button><button class="primary" id="scanAgainBtn">📷 Scan Again</button></div>
    </div>`);
    $("cancelWithdrawal").onclick=closeModal;
    $("scanAgainBtn").onclick=()=>{closeModal();startScannerForItem(x,qty)};
    return;
  }

  // Scanning NEVER deducts stock. Deduction happens only after confirmation.
  const codeList=codes.map((c,i)=>`<li><b>Piece ${i+1}:</b> <code>${esc(c)}</code></li>`).join("");
  openModal(`Confirm Withdrawal — ${esc(x.supply_name)}`,`<div class="receipt">
    <h3>✓ BARCODE SCAN COMPLETE</h3>
    <p class="muted">Review the details below. <b>Stock has NOT been deducted yet.</b></p>
    <div class="panel" style="margin:15px 0">
      <p><b>Supply:</b> ${esc(x.supply_name)}</p>
      <p><b>Quantity:</b> ${qty} ${esc(x.unit)}</p>
      <p><b>Current Stock:</b> ${x.quantity} ${esc(x.unit)}</p>
      <p><b>After Withdrawal:</b> ${x.quantity-qty} ${esc(x.unit)}</p>
      <p><b>Scanned Barcode${codes.length>1?'s':''}:</b></p>
      <ol>${codeList}</ol>
    </div>
    <div class="actions">
      <button class="secondary" id="cancelWithdrawal">Cancel</button>
      <button class="secondary" id="rescanWithdrawal">📷 Rescan</button>
      <button class="primary" id="confirmWithdrawal">✓ Confirm Withdrawal</button>
    </div>
    <p id="withdrawConfirmStatus" class="muted" style="margin-top:12px"></p>
  </div>`);

  $("cancelWithdrawal").onclick=closeModal;
  $("rescanWithdrawal").onclick=()=>{closeModal();startScannerForItem(x,qty)};
  $("confirmWithdrawal").onclick=()=>submitWithdrawal(x,qty,codes);
}

async function submitWithdrawal(x,qty,codes){
  const confirmBtn=$("confirmWithdrawal");
  const cancelBtn=$("cancelWithdrawal");
  const rescanBtn=$("rescanWithdrawal");
  const status=$("withdrawConfirmStatus");
  if(confirmBtn)confirmBtn.disabled=true;
  if(cancelBtn)cancelBtn.disabled=true;
  if(rescanBtn)rescanBtn.disabled=true;
  if(status)status.textContent="Saving withdrawal and deducting stock… Please wait.";

  try{
    const body={inventory_id:x.id,quantity:qty,barcodes:codes,barcode:codes[0]};
    const r=await api("/api/withdraw",{method:"POST",body:JSON.stringify(body)});
    const local=state.inventory.find(i=>String(i.id)===String(x.id));
    if(local){
      local.quantity=Number(r.receipt.remaining);
      if(local.barcode_count) local.available_barcode_count=Math.max(0,Number(local.available_barcode_count)-qty);
    }

    openModal(`Withdrawal Complete — ${esc(x.supply_name)}`,`<div class="receipt">
      <h3>✓ WITHDRAWAL SUCCESSFUL</h3>
      <p><b>User:</b> ${esc(r.receipt.user)}</p>
      <p><b>Supply:</b> ${esc(r.receipt.supply)}</p>
      <p><b>Quantity Withdrawn:</b> ${r.receipt.quantity} ${esc(r.receipt.unit)}</p>
      <p><b>Barcode${codes.length>1?'s':''}:</b> ${esc(r.receipt.barcode)}</p>
      <p><b>Remaining Stock:</b> ${r.receipt.remaining} ${esc(r.receipt.unit)}</p>
      <p><b>Date/Time:</b> ${esc(r.receipt.date_time)}</p>
      <div class="actions" style="margin-top:16px"><button class="secondary" id="printWithdrawalReceipt">Print Receipt</button><button class="primary" id="finishWithdrawal">Done</button></div>
    </div>`);
    $("printWithdrawalReceipt").onclick=()=>window.print();
    $("finishWithdrawal").onclick=async()=>{
      closeModal();
      if(state.page==="withdraw") await renderWithdraw(); else await renderDashboard();
    };
    if(state.page!=="withdraw") await renderDashboard();
    toast(`Withdrawal recorded. ${r.receipt.remaining} ${r.receipt.unit} remaining.`);
  }catch(e){
    console.error("WITHDRAW ERROR:",e);
    openModal(`Withdrawal Not Completed — ${esc(x.supply_name)}`,`<div class="receipt">
      <h3>✕ WITHDRAWAL NOT COMPLETED</h3><p>${esc(e.message)}</p>
      <p class="muted">No stock was deducted because the withdrawal was not completed.</p>
      <div class="actions"><button class="secondary" id="cancelWithdrawal">Cancel</button><button class="primary" id="scanAgainBtn">📷 Scan Again</button></div>
    </div>`);
    $("cancelWithdrawal").onclick=closeModal;
    $("scanAgainBtn").onclick=()=>{closeModal();startScannerForItem(x,qty)};
    toast(e.message,true);
  }
}

async function renderMyTransactions(){
  const d=await api("/api/my-transactions");
  $("content").innerHTML=`<div class="panel"><div class="table-wrap"><table><thead><tr><th>Date/Time</th><th>Supply</th><th>Barcode</th><th>Action</th><th>Quantity</th><th>Previous</th><th>New</th></tr></thead><tbody>${d.transactions.map(x=>`<tr><td>${esc(x.created_at)}</td><td>${esc(x.supply_name||"")}</td><td>${esc(x.barcode)}</td><td>${esc(x.transaction_type)}</td><td>${x.quantity}</td><td>${x.previous_quantity}</td><td>${x.new_quantity}</td></tr>`).join("")||`<tr><td colspan="7" class="empty">No transactions yet.</td></tr>`}</tbody></table></div></div>`;
}

function openModal(title,body){$("modalTitle").textContent=title;$("modalBody").innerHTML=body;$("modal").classList.remove("hidden")}
function closeModal(){if(state.scanner){try{state.scanner.reset?.()}catch(e){}state.scanner=null}$("modal").classList.add("hidden");$("modalBody").innerHTML=""}
$("closeModal").onclick=closeModal;
$("modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
$("togglePassword").onclick=()=>{const p=$("loginPassword");p.type=p.type==="password"?"text":"password";$("togglePassword").textContent=p.type==="password"?"Show":"Hide"};
$("loginForm").onsubmit=async e=>{e.preventDefault();$("loginError").textContent="";try{const d=await api("/api/login",{method:"POST",body:JSON.stringify({username:$("loginUsername").value,password:$("loginPassword").value})});startApp(d.user)}catch(err){$("loginError").textContent=err.message}};
$("logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});state.user=null;showLogin();$("loginForm").reset()};
boot();
