// ================== CONFIG ==================
const items = [
  "AFICHES","VOLANTES","PENDONES","MINI PENDONES","PASACALLES",
  "VALLA IMPRESA","MURALES","MANILLAS DE SATIN","GORRAS ESTAMPADAS",
  "CAMISETAS","TARJETAS DOBLE CARA","TARJETÓN PEDAGÓGICO",
  "PENDÓN TARJETÓN","ABANICO DE MANO", "STICKERS","MICROPERFORADOS"
];

const proveedores = ["Digiprint","Muelle Publicidad ","Bordados Barranquilla","estampado y publicidad",
                    "Caratos"];
const cats = ["conjunta","laura","gustavo"];
const LS_KEY = "publicidad_kardex_v1";

// ================== UI STATE (buscadores/paginación) ==================
// Se mantiene en memoria para conservar página/filtro incluso tras editar/eliminar.
const uiState = {
  search: {}, // key -> term
  page: {}    // key -> current page (1-based)
};

function uiKey(type, cat){
  return `${type}-${cat}`;
}

function getSearchTerm(key){
  return String(uiState.search[key] || "").trim().toLowerCase();
}

function getPage(key){
  const p = Number(uiState.page[key] || 1);
  return isFinite(p) && p > 0 ? Math.floor(p) : 1;
}

function setPage(key, page){
  uiState.page[key] = Math.max(1, Number(page) || 1);
}

function attachSearchAndPager({ type, cat, searchInputId, pagerId, pageSize }){
  const key = uiKey(type, cat);
  // defaults
  if(uiState.search[key] === undefined) uiState.search[key] = "";
  if(uiState.page[key] === undefined) uiState.page[key] = 1;

  const inp = document.getElementById(searchInputId);
  if(inp && !inp.dataset.bound){
    inp.value = uiState.search[key] || "";
    inp.addEventListener("input", ()=>{
      uiState.search[key] = inp.value;
      setPage(key, 1);
      // re-render sección específica
      if(type === "solicitudes") renderSolicitudes(cat);
      if(type === "recepciones") renderRecepciones(cat);
      if(type === "entregas") renderEntregas(cat);
    });
    inp.dataset.bound = "1";
  }

  // guardar referencias para renderPager
  const pagerEl = document.getElementById(pagerId);
  if(pagerEl){
    pagerEl.dataset.key = key;
    pagerEl.dataset.type = type;
    pagerEl.dataset.cat = cat;
    pagerEl.dataset.pageSize = String(pageSize);
  }
}

function paginateAndFilter(arr, { key, pageSize, matches }){
  const term = getSearchTerm(key);
  const filtered = term
    ? arr.filter(row => matches(row, term))
    : arr.slice();

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  let page = getPage(key);
  if(page > totalPages) page = totalPages;
  setPage(key, page);

  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);
  return { pageItems, total, totalPages, page, term };
}

function renderPager(pagerId, { key, page, totalPages, onPageChange }){
  const ul = document.getElementById(pagerId);
  if(!ul) return;

  // limpiar
  ul.innerHTML = "";
  if(totalPages <= 1) return;

  const mkItem = (label, targetPage, disabled=false, active=false)=>{
    const li = document.createElement("li");
    li.className = `page-item${disabled ? " disabled" : ""}${active ? " active" : ""}`;
    const a = document.createElement("a");
    a.className = "page-link";
    a.href = "#";
    a.textContent = label;
    a.addEventListener("click", (e)=>{
      e.preventDefault();
      if(disabled) return;
      onPageChange(targetPage);
    });
    li.appendChild(a);
    return li;
  };

  ul.appendChild(mkItem("«", page - 1, page <= 1));

  // ventana de páginas (máx 7 botones)
  const windowSize = 7;
  let start = Math.max(1, page - Math.floor(windowSize/2));
  let end = start + windowSize - 1;
  if(end > totalPages){
    end = totalPages;
    start = Math.max(1, end - windowSize + 1);
  }

  for(let p = start; p <= end; p++){
    ul.appendChild(mkItem(String(p), p, false, p === page));
  }

  ul.appendChild(mkItem("»", page + 1, page >= totalPages));
}

// ================== STATE ==================
let db = JSON.parse(localStorage.getItem(LS_KEY)) || {
  counters: { SOL: 0, REC: 0, ENT: 0 },
  solicitudes: [],   // {id,categoria,proveedor,fecha,items:[{item,cant}]}
  recepciones: [],   // {id,solicitudId,categoria,proveedor,fecha,items:[{item,cant}],obs}
  entregas: []       // {id,categoria,fecha,persona,estado,obs,items:[{item,cant}]}
};

// ================== MIGRACIONES / SHAPE ==================
// (para no romper datos existentes en localStorage)
function ensureDbShape(){
  db.counters = db.counters || { SOL: 0, REC: 0, ENT: 0 };
  db.solicitudes = Array.isArray(db.solicitudes) ? db.solicitudes : [];
  db.recepciones = Array.isArray(db.recepciones) ? db.recepciones : [];
  db.entregas = Array.isArray(db.entregas) ? db.entregas : [];

  // Asegurar campo estado en entregas antiguas
  db.entregas.forEach(e=>{
    if(!e.estado) e.estado = "ENTREGADO";
  });
}
ensureDbShape();

// carritos temporales
let carritosRecepcion = { conjunta: [], laura: [], gustavo: [] };
let carritosEntrega = { conjunta: [], laura: [], gustavo: [] };

// ================== DOM HELPERS ==================
function $(id){ return document.getElementById(id); }
function fmtItems(arr){ return arr.map(x => `${x.item}: ${x.cant}`).join(" | "); }

function pad(n, len=4){
  const s = String(n);
  return s.length >= len ? s : "0".repeat(len - s.length) + s;
}
function nextId(prefix){
  db.counters[prefix] = (db.counters[prefix] || 0) + 1;
  return `${prefix}-${pad(db.counters[prefix])}`;
}
function getEl(id){
  return document.getElementById(id);
}
function catNorm(v){
  return String(v || "").trim().toLowerCase(); // "CONJUNTA" => "conjunta"
}

// ================== INIT SELECTS ==================
function fillBasicSelects(){
  cats.forEach(cat=>{
    // proveedor selects
    const solProv = $(`solProv-${cat}`);
    const recProv = $(`recProv-${cat}`);
    [solProv, recProv].forEach(sel=>{
      sel.innerHTML = "";
      proveedores.forEach(p=>{
        const o = document.createElement("option");
        o.value = p; o.textContent = p;
        sel.appendChild(o);
      });
    });

    // item selects (solicitud)
    const solItem = $(`solItem-${cat}`);
    solItem.innerHTML = "";
    items.forEach(it=>{
      const o = document.createElement("option");
      o.value = it; o.textContent = it;
      solItem.appendChild(o);
    });

    // item selects (entrega)
    const entItem = $(`entItem-${cat}`);
    entItem.innerHTML = "";
    items.forEach(it=>{
      const o = document.createElement("option");
      o.value = it; o.textContent = it;
      entItem.appendChild(o);
    });

    // cuando cambia solicitud en recepción -> refrescar ítems pendientes
    $(`recSol-${cat}`).addEventListener("change", ()=> syncRecProveedorDesdeSolicitud(cat));
    $(`recSol-${cat}`).addEventListener("change", ()=> refreshRecItemsPendientes(cat));

    // cuando cambia item en entrega -> mostrar disponibilidad
    $(`entItem-${cat}`).addEventListener("change", ()=> updateEntregaDisponible(cat));
    $(`entQty-${cat}`).addEventListener("input", ()=> updateEntregaDisponible(cat));
  });
}

// ================== COMPUTOS ==================
function solicitadoPorCatItem(cat, item){
  let total = 0;
  db.solicitudes.filter(s=>s.categoria===cat).forEach(s=>{
    s.items.forEach(it=>{
      if(it.item===item) total += Number(it.cant||0);
    });
  });
  return total;
}

function recibidoPorCatItem(cat, item){
  let total = 0;
  db.recepciones.filter(r=>r.categoria===cat).forEach(r=>{
    r.items.forEach(it=>{
      if(it.item===item) total += Number(it.cant||0);
    });
  });
  return total;
}

function entregadoPorCatItem(cat, item){
  let total = 0;
  db.entregas.filter(e=>e.categoria===cat).forEach(e=>{
    e.items.forEach(it=>{
      if(it.item===item) total += Number(it.cant||0);
    });
  });
  return total;
}

function stockPorCatItem(cat, item){
  const s = recibidoPorCatItem(cat,item) - entregadoPorCatItem(cat,item);
  return s < 0 ? 0 : s;
}

// pendiente por solicitud+item = solicitado en esa solicitud - recibido ligado a esa solicitud
function recibidoPorSolicitudItem(solId, item){
  let total = 0;
  db.recepciones.filter(r=>r.solicitudId===solId).forEach(r=>{
    r.items.forEach(it=>{
      if(it.item===item) total += Number(it.cant||0);
    });
  });
  return total;
}

function solicitadoEnSolicitudItem(solId, item){
  const sol = db.solicitudes.find(s=>s.id===solId);
  if(!sol) return 0;
  const row = sol.items.find(x=>x.item===item);
  return Number(row?.cant || 0);
}

function pendienteSolicitudItem(solId, item){
  return Math.max(0, solicitadoEnSolicitudItem(solId,item) - recibidoPorSolicitudItem(solId,item));
}

// ================== VIEWS NAV ==================
window.goView = function(view){
  const map = {
    proveedores: "view-proveedores",
    entregas: "view-entregas",
    stock: "view-stock",
    dashboard: "view-dashboard"
  };
  Object.values(map).forEach(id=>$(id).classList.add("d-none"));
  $(map[view]).classList.remove("d-none");
};

// ================== GUARDAR / SESION ==================
window.guardarTodo = function(){
  localStorage.setItem(LS_KEY, JSON.stringify(db));
  alert("Guardado ✅");
};

window.cerrar = function(){
  localStorage.removeItem("login");
  window.location.href = "index.html";
};

// ================== SOLICITUDES ==================
window.crearSolicitud = function(cat){
  const proveedor = $(`solProv-${cat}`).value;
  const fecha = ($(`solFecha-${cat}`).value || "").trim();

  if(!fecha){
    alert("Selecciona la fecha de solicitud.");
    return;
  }

  const id = nextId("SOL");
  db.solicitudes.push({
    id,
    categoria: cat,
    proveedor,
    fecha,
    items: []
  });

  // seleccionar recién creada
  renderAll();
  $(`solSelect-${cat}`).value = id;
  $(`recSol-${cat}`).value = id;
  syncRecProveedorDesdeSolicitud(cat);
  refreshRecItemsPendientes(cat);
};

window.agregarItemSolicitud = function(cat){
  const solId = $(`solSelect-${cat}`).value;
  const item = $(`solItem-${cat}`).value;
  const qty = Number($(`solQty-${cat}`).value || 0);

  if(!solId){
    alert("Primero crea/selecciona una solicitud.");
    return;
  }
  if(qty <= 0){
    alert("Cantidad debe ser mayor a 0.");
    return;
  }

  const sol = db.solicitudes.find(s=>s.id===solId);
  if(!sol){ alert("Solicitud no encontrada."); return; }

  const found = sol.items.find(x=>x.item===item);
  if(found) found.cant += qty;
  else sol.items.push({ item, cant: qty });

  renderAll();
  $(`solSelect-${cat}`).value = solId;
};

window.delSolicitud = function(solId){
  // Validación: no permitir borrar si tiene recepciones
  const tieneRec = db.recepciones.some(r=>r.solicitudId===solId);
  if(tieneRec){
    alert("No se puede eliminar esta solicitud porque ya tiene recepciones registradas.");
    return;
  }
  db.solicitudes = db.solicitudes.filter(s=>s.id!==solId);
  renderAll();
};

// ================== RECEPCIONES ==================
function syncRecProveedorDesdeSolicitud(cat){
  const solId = $(`recSol-${cat}`).value;
  const sol = db.solicitudes.find(s=>s.id===solId);
  if(sol){
    $(`recProv-${cat}`).value = sol.proveedor;
  }
}

function refreshRecItemsPendientes(cat){
  const solId = $(`recSol-${cat}`).value;
  const sel = $(`recItem-${cat}`);
  sel.innerHTML = "";

  if(!solId) return;

  const sol = db.solicitudes.find(s=>s.id===solId);
  if(!sol) return;

  // mostrar todos los items de la solicitud (aunque el pendiente sea 0)
  sol.items.forEach(it=>{
    const pend = pendienteSolicitudItem(solId, it.item);
    const solicitado = solicitadoEnSolicitudItem(solId, it.item);
    const o = document.createElement("option");
    o.value = it.item;
    o.textContent = `${it.item} (solicitado: ${solicitado} | pendiente: ${pend})`;
    sel.appendChild(o);
  });

  if(sel.options.length === 0){
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "Sin pendientes";
    sel.appendChild(o);
  }
}

window.limpiarRecepcion = function(cat){
  carritosRecepcion[cat] = [];
  $(`recObs-${cat}`).value = "";
  $(`recQty-${cat}`).value = 1;
  renderCarritoRecepcion(cat);
};

window.agregarItemRecepcion = function(cat){
  const solId = $(`recSol-${cat}`).value;
  const itemText = $(`recItem-${cat}`).value;
  const qty = Number($(`recQty-${cat}`).value || 0);

  if(!solId){
    alert("No hay solicitud seleccionada.");
    return;
  }
  if(!itemText){
    alert("No hay ítems pendientes para recibir en esta solicitud.");
    return;
  }
  if(qty <= 0){
    alert("Cantidad debe ser mayor a 0.");
    return;
  }

  const pend = pendienteSolicitudItem(solId, itemText);

  // VALIDACIÓN: no recibir más de lo pendiente
  const yaEnCarrito = carritosRecepcion[cat]
    .filter(x=>x.solicitudId===solId && x.item===itemText)
    .reduce((a,x)=>a+Number(x.cant||0),0);
  // Si recibes más de lo pendiente, se registrará como excedente y sumará a stock
  if(qty + yaEnCarrito > pend){
    const exced = (qty + yaEnCarrito) - pend;
    const ok = confirm(`Vas a recibir ${qty} de "${itemText}". Esto supera el pendiente actual (${pend}) considerando lo que ya tienes en carrito (${yaEnCarrito}). Excedente a registrar: ${exced}.\n\n¿Deseas continuar?`);
    if(!ok) return;
  }

  // agregar al carrito de recepción
  carritosRecepcion[cat].push({ solicitudId: solId, item: itemText, cant: qty });
  renderCarritoRecepcion(cat);
  refreshRecItemsPendientes(cat);
};

function renderCarritoRecepcion(cat){
  // no tabla dedicada; se refleja al guardar en el listado de recepciones.
  // (si quieres, luego lo muestro en tabla. Por ahora, controlamos con alert.)
}

window.guardarRecepcion = function(cat){
  const solId = $(`recSol-${cat}`).value;
  const fecha = ($(`recFecha-${cat}`).value || "").trim();
  const proveedor = $(`recProv-${cat}`).value;
  const obs = ($(`recObs-${cat}`).value || "").trim();

  // VALIDACIÓN: no guardar sin fecha
  if(!fecha){
    alert("No se puede guardar: la fecha de recepción es obligatoria.");
    return;
  }

  // VALIDACIÓN: no recibir sin solicitud
  if(!solId){
    alert("No se puede guardar: selecciona una solicitud.");
    return;
  }

  // VALIDACIÓN: carrito no vacío
  const carrito = carritosRecepcion[cat].filter(x=>x.solicitudId===solId);
  if(carrito.length === 0){
    alert("Agrega al menos un item recibido.");
    return;
  }

  // VALIDACIÓN EXTRA: re-chequear pendientes (por si cambió algo)
  // Permitimos excedentes: si hay cantidades por encima del pendiente, pedimos confirmación
  const excedentes = [];
  for(const it of carrito){
    const pend = pendienteSolicitudItem(solId, it.item);
    const cant = Number(it.cant||0);
    if(cant > pend){
      excedentes.push({ item: it.item, cant, pend, exced: cant - pend });
    }
  }
  if(excedentes.length){
    const detalle = excedentes.map(x=>`- ${x.item}: recibido ${x.cant} | pendiente ${x.pend} | excedente ${x.exced}`).join("\n");
    const ok = confirm(`Hay recepciones con excedente (se sumarán a stock):\n\n${detalle}\n\n¿Deseas continuar y guardar la recepción?`);
    if(!ok) return;
  }


  const id = nextId("REC");
  db.recepciones.push({
    id,
    solicitudId: solId,
    categoria: cat,
    proveedor,
    fecha,
    items: carrito.map(x=>({ item: x.item, cant: x.cant })),
    obs
  });

  // limpiar carrito de esa solicitud
  carritosRecepcion[cat] = carritosRecepcion[cat].filter(x=>x.solicitudId!==solId);

  // reset
  $(`recObs-${cat}`).value = "";
  $(`recQty-${cat}`).value = 1;

  renderAll();
};

window.delRecepcion = function(recId){
  db.recepciones = db.recepciones.filter(r=>r.id!==recId);
  renderAll();
};

// ================== ENTREGAS A PERSONAS ==================
function updateEntregaDisponible(cat){
  const it = $(`entItem-${cat}`).value;
  const disp = stockPorCatItem(cat, it);
  $(`entDisp-${cat}`).textContent = `Disponible en stock: ${disp}`;
}

window.agregarItemEntrega = function(cat){
  const item = $(`entItem-${cat}`).value;
  const qty = Number($(`entQty-${cat}`).value || 0);

  if(qty <= 0){
    alert("Cantidad debe ser mayor a 0.");
    return;
  }

  // calcular disponible considerando lo que ya agregaste al carrito
  const disp = stockPorCatItem(cat, item);
  const ya = carritosEntrega[cat].filter(x=>x.item===item).reduce((a,x)=>a+Number(x.cant||0),0);

  if(qty + ya > disp){
    alert(`No hay stock suficiente para ${item}. Disponible: ${disp}. Ya en carrito: ${ya}.`);
    return;
  }

  // sumar si ya existe
  const found = carritosEntrega[cat].find(x=>x.item===item);
  if(found) found.cant += qty;
  else carritosEntrega[cat].push({ item, cant: qty });

  renderCarritoEntrega(cat);
  updateEntregaDisponible(cat);
};

function renderCarritoEntrega(cat){
  const tbody = $(`bodyCarrito-${cat}`);
  tbody.innerHTML = "";

  if(carritosEntrega[cat].length === 0){
    tbody.innerHTML = `<tr><td colspan="3" class="text-muted">Sin ítems agregados</td></tr>`;
    return;
  }

  carritosEntrega[cat].forEach((it, idx)=>{
    tbody.innerHTML += `
      <tr>
        <td>${it.item}</td>
        <td>${it.cant}</td>
        <td><button class="btn btn-sm btn-danger" onclick="delItemCarritoEntrega('${cat}',${idx})">Quitar</button></td>
      </tr>
    `;
  });
}

window.delItemCarritoEntrega = function(cat, idx){
  carritosEntrega[cat].splice(idx,1);
  renderCarritoEntrega(cat);
  updateEntregaDisponible(cat);
};

window.guardarEntrega = function(cat){
  const persona = ($(`entPersona-${cat}`).value || "").trim();
  const fecha = ($(`entFecha-${cat}`).value || "").trim();
  const estado = ($(`entEstado-${cat}`)?.value || "ENTREGADO").trim();
  const obs = ($(`entObs-${cat}`).value || "").trim();

  // VALIDACIONES
  if(!persona){
    alert("No se puede guardar: la persona es obligatoria.");
    return;
  }
  if(!fecha){
    alert("No se puede guardar: la fecha es obligatoria.");
    return;
  }
  if(carritosEntrega[cat].length === 0){
    alert("Agrega al menos un item a la entrega.");
    return;
  }

  // VALIDACIÓN: stock suficiente (re-chequeo)
  for(const it of carritosEntrega[cat]){
    const disp = stockPorCatItem(cat, it.item);
    if(it.cant > disp){
      alert(`Stock insuficiente para ${it.item}. Disponible actual: ${disp}.`);
      return;
    }
  }

  const id = nextId("ENT");
  db.entregas.push({
    id,
    categoria: cat,
    fecha,
    persona,
    estado,
    obs,
    items: carritosEntrega[cat].map(x=>({ item:x.item, cant:x.cant }))
  });

  // limpiar formulario y carrito
  carritosEntrega[cat] = [];
  $(`entPersona-${cat}`).value = "";
  $(`entFecha-${cat}`).value = "";
  if($(`entEstado-${cat}`)) $(`entEstado-${cat}`).value = "ENTREGADO";
  $(`entObs-${cat}`).value = "";
  $(`entQty-${cat}`).value = 1;

  renderAll();
};

window.delEntrega = function(entId){
  db.entregas = db.entregas.filter(e=>e.id!==entId);
  renderAll();
};

// ================== RENDER ==================
function renderAll(){
  cats.forEach(cat=>{
    renderSolicitudes(cat);
    renderRecepciones(cat);
    renderEntregas(cat);
    renderSelectSolicitudes(cat);
    refreshRecItemsPendientes(cat);
    updateEntregaDisponible(cat);
    renderCarritoEntrega(cat);
  });

  renderStock();
  renderDashboard();

  // guardar en LS al render para no perder info
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function initListControls(){
  // Proveedores -> Solicitudes / Recepciones (10 por página)
  cats.forEach(cat=>{
    attachSearchAndPager({
      type: "solicitudes",
      cat,
      searchInputId: `searchSolicitudes-${cat}`,
      pagerId: `pagerSolicitudes-${cat}`,
      pageSize: 10
    });
    attachSearchAndPager({
      type: "recepciones",
      cat,
      searchInputId: `searchRecepciones-${cat}`,
      pagerId: `pagerRecepciones-${cat}`,
      pageSize: 10
    });
  });

  // Entregas -> (15 por página)
  cats.forEach(cat=>{
    attachSearchAndPager({
      type: "entregas",
      cat,
      searchInputId: `searchEntregas-${cat}`,
      pagerId: `pagerEntregas-${cat}`,
      pageSize: 15
    });
  });
}

function renderSelectSolicitudes(cat){
  const solSel = $(`solSelect-${cat}`);
  const recSel = $(`recSol-${cat}`);

  const sols = db.solicitudes.filter(s=>s.categoria===cat);

  solSel.innerHTML = "";
  recSel.innerHTML = "";

  const addOpt = (sel, s)=>{
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.id} | ${s.proveedor} | ${s.fecha}`;
    sel.appendChild(o);
  };

  sols.forEach(s=>{
    addOpt(solSel, s);
    addOpt(recSel, s);
  });

  // si no hay solicitudes
  if(sols.length === 0){
    const o1 = document.createElement("option");
    o1.value = ""; o1.textContent = "Sin solicitudes";
    solSel.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = ""; o2.textContent = "Sin solicitudes";
    recSel.appendChild(o2);
  }

  // sincronizar proveedor de recepción cuando cambia selección
  syncRecProveedorDesdeSolicitud(cat);
}

function renderSolicitudes(cat){
  const tbody = $(`bodySolicitudes-${cat}`);
  tbody.innerHTML = "";

  const key = uiKey("solicitudes", cat);
  const arr = db.solicitudes.filter(s=>s.categoria===cat).slice().reverse();

  const { pageItems, total, totalPages, page } = paginateAndFilter(arr, {
    key,
    pageSize: 10,
    matches: (s, term) => String(s.proveedor||"").toLowerCase().includes(term)
  });

  // paginador
  renderPager(`pagerSolicitudes-${cat}`, {
    key,
    page,
    totalPages,
    onPageChange: (p)=>{ setPage(key, p); renderSolicitudes(cat); }
  });

  if(total === 0){
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Sin solicitudes</td></tr>`;
    return;
  }

  pageItems.forEach(s=>{
    tbody.innerHTML += `
      <tr>
        <td><b>${s.id}</b></td>
        <td>${s.proveedor}</td>
        <td>${s.fecha}</td>
        <td class="text-start">${fmtItems(s.items)}</td>
        <td>
          <div class="d-flex justify-content-center gap-1 flex-wrap">
            <button class="btn btn-sm btn-warning" onclick="editSolicitud('${s.id}')"><i class="fa-solid fa-pencil"></i></button>
            <button class="btn btn-sm btn-danger" onclick="confirmDelSolicitud('${s.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

function renderRecepciones(cat){
  const tbody = $(`bodyRecepciones-${cat}`);
  tbody.innerHTML = "";

  const key = uiKey("recepciones", cat);
  const arr = db.recepciones.filter(r=>r.categoria===cat).slice().reverse();

  const { pageItems, total, totalPages, page } = paginateAndFilter(arr, {
    key,
    pageSize: 10,
    matches: (r, term) => String(r.proveedor||"").toLowerCase().includes(term)
  });

  renderPager(`pagerRecepciones-${cat}`, {
    key,
    page,
    totalPages,
    onPageChange: (p)=>{ setPage(key, p); renderRecepciones(cat); }
  });

  if(total === 0){
    tbody.innerHTML = `<tr><td colspan="7" class="text-muted">Sin recepciones</td></tr>`;
    return;
  }

  pageItems.forEach(r=>{
    tbody.innerHTML += `
      <tr>
        <td><b>${r.id}</b></td>
        <td>${r.solicitudId}</td>
        <td>${r.fecha}</td>
        <td>${r.proveedor}</td>
        <td class="text-start">${fmtItems(r.items)}</td>
        <td class="text-start">${r.obs || ""}</td>
        <td>
          <div class="d-flex justify-content-center gap-1 flex-wrap">
            <button class="btn btn-sm btn-warning" onclick="editRecepcion('${r.id}')"><i class="fa-solid fa-pencil"></i></button>
            <button class="btn btn-sm btn-danger" onclick="confirmDelRecepcion('${r.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

function renderEntregas(cat){
  const tbody = $(`bodyEntregas-${cat}`);
  tbody.innerHTML = "";

  const key = uiKey("entregas", cat);
  const arr = db.entregas.filter(e=>e.categoria===cat).slice().reverse();

  const { pageItems, total, totalPages, page } = paginateAndFilter(arr, {
    key,
    pageSize: 15,
    matches: (e, term) => {
      const persona = String(e.persona||"").toLowerCase();
      const obs = String(e.obs||"").toLowerCase();
      const its = fmtItems(e.items||[]).toLowerCase();
      return persona.includes(term) || its.includes(term) || obs.includes(term);
    }
  });

  renderPager(`pagerEntregas-${cat}`, {
    key,
    page,
    totalPages,
    onPageChange: (p)=>{ setPage(key, p); renderEntregas(cat); }
  });

  if(total === 0){
    tbody.innerHTML = `<tr><td colspan="7" class="text-muted">Sin entregas</td></tr>`;
    return;
  }

  pageItems.forEach(e=>{
    tbody.innerHTML += `
      <tr>
        <td><b>${e.id}</b></td>
        <td>${e.fecha}</td>
        <td class="text-start">${e.persona}</td>
        <td>${e.estado || "ENTREGADO"}</td>
        <td class="text-start">${fmtItems(e.items)}</td>
        <td class="text-start">${e.obs || ""}</td>
        <td>
          <div class="d-flex justify-content-center gap-1 flex-wrap">
            <button class="btn btn-sm btn-warning" onclick="editEntrega('${e.id}')"><i class="fa-solid fa-pencil"></i></button>
            <button class="btn btn-sm btn-danger" onclick="confirmDelEntrega('${e.id}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
}

// ================== CONFIRMACIONES DE BORRADO ==================
window.confirmDelSolicitud = function(solId){
  if(confirm(`¿Eliminar la solicitud ${solId}?`)) window.delSolicitud(solId);
};
window.confirmDelRecepcion = function(recId){
  if(confirm(`¿Eliminar la recepción ${recId}?`)) window.delRecepcion(recId);
};
window.confirmDelEntrega = function(entId){
  if(confirm(`¿Eliminar la entrega ${entId}?`)) window.delEntrega(entId);
};

function renderStock(){
  const tbody = $("bodyStock");
  tbody.innerHTML = "";
  items.forEach(item=>{
    tbody.innerHTML += `
      <tr>
        <td class="fw-semibold">${item}</td>
        <td>${stockPorCatItem("conjunta", item)}</td>
        <td>${stockPorCatItem("laura", item)}</td>
        <td>${stockPorCatItem("gustavo", item)}</td>
      </tr>
    `;
  });
}

function renderDashboard(){
  // ---------- helpers ----------
  const sumObjItems = (itemsArr)=> itemsArr.reduce((a,it)=>a + (Number(it.cant)||0), 0);

  const totalSolicitadoCat = (cat) =>
    db.solicitudes.filter(s=>s.categoria===cat).reduce((acc,s)=>acc + sumObjItems(s.items), 0);

  const totalRecibidoCat = (cat) =>
    db.recepciones.filter(r=>r.categoria===cat).reduce((acc,r)=>acc + sumObjItems(r.items), 0);

  const totalEntregadoCat = (cat) =>
    db.entregas.filter(e=>e.categoria===cat).reduce((acc,e)=>acc + sumObjItems(e.items), 0);

  const totalStockCat = (cat) => {
    let t = 0;
    items.forEach(it => t += stockPorCatItem(cat, it));
    return t;
  };

  // ---------- 0) tarjetas superiores ----------
  const solT = totalSolicitadoCat("conjunta") + totalSolicitadoCat("laura") + totalSolicitadoCat("gustavo");
  const recT = totalRecibidoCat("conjunta")   + totalRecibidoCat("laura")   + totalRecibidoCat("gustavo");
  const entT = totalEntregadoCat("conjunta")  + totalEntregadoCat("laura")  + totalEntregadoCat("gustavo");
  const stkT = totalStockCat("conjunta")      + totalStockCat("laura")      + totalStockCat("gustavo");

  const elSol = document.getElementById("dashSolicitado");
  const elRec = document.getElementById("dashRecibido");
  const elEnt = document.getElementById("dashEntregado");
  const elStk = document.getElementById("dashStock");
  if(elSol) elSol.textContent = solT;
  if(elRec) elRec.textContent = recT;
  if(elEnt) elEnt.textContent = entT;
  if(elStk) elStk.textContent = stkT;

  // ---------- 1) Resumen por categoría ----------
  const bodyCat = document.getElementById("dashByCat");
  if(bodyCat){
    const rows = [
      ["CONJUNTA","conjunta"],
      ["LAURA","laura"],
      ["GUSTAVO","gustavo"]
    ].map(([label,cat])=>{
      const s = totalSolicitadoCat(cat);
      const r = totalRecibidoCat(cat);
      const e = totalEntregadoCat(cat);
      const st= totalStockCat(cat);
      return `<tr>
        <td class="fw-semibold">${label}</td>
        <td>${s}</td><td>${r}</td><td>${e}</td><td>${st}</td>
      </tr>`;
    }).join("");
    bodyCat.innerHTML = rows || `<tr><td colspan="5" class="text-muted">Sin datos</td></tr>`;
  }

  // ---------- 2) Solicitado por ítem y categoría ----------
  const reqBody = document.getElementById("dashReqByItemCat");
  if(reqBody){
    reqBody.innerHTML = "";
    let any = false;
    items.forEach(item=>{
      const c = solicitadoPorCatItem("conjunta", item);
      const l = solicitadoPorCatItem("laura", item);
      const g = solicitadoPorCatItem("gustavo", item);
      const t = c + l + g;
      if(t>0) any = true;
      reqBody.innerHTML += `
        <tr>
          <td class="fw-semibold text-start">${item}</td>
          <td>${c}</td><td>${l}</td><td>${g}</td><td>${t}</td>
        </tr>`;
    });
    if(!any){
      reqBody.innerHTML = `<tr><td colspan="5" class="text-muted">Aún no hay solicitudes registradas.</td></tr>`;
    }
  }

  // ---------- 3) Dropdown proveedor + detalle por item y categoría ----------
  renderDashboardProveedorDropdown();
}

function renderDashboardProveedorDropdown(){
  const sel = document.getElementById("dashProveedorSelect");
  const body = document.getElementById("dashProvDetailBody");
  if(!sel || !body) return;

  // proveedores presentes en recepciones (si no hay, usa la lista base)
  const base = ["Digiprint","Muelle Publicidad ","Bordados Barranquilla"];
  const fromDb = Array.from(new Set(db.recepciones.map(r=>r.proveedor).filter(Boolean)));
  const provs = (fromDb.length ? fromDb : base);

  const current = sel.value || provs[0];
  sel.innerHTML = provs.map(p=>`<option value="${p}">${p}</option>`).join("");
  sel.value = provs.includes(current) ? current : provs[0];

  sel.onchange = ()=> renderDashboardProveedorDetail(sel.value);
  renderDashboardProveedorDetail(sel.value);
}

function recibidoPorProveedorCatItem(prov, cat, item){
  return db.recepciones
    .filter(r=>r.proveedor===prov && r.categoria===cat)
    .reduce((acc,r)=>{
      const it = r.items.find(x=>x.item===item);
      return acc + (it ? (Number(it.cant)||0) : 0);
    },0);
}

function renderDashboardProveedorDetail(prov){
  const body = document.getElementById("dashProvDetailBody");
  if(!body) return;

  let any = false;
  body.innerHTML = "";

  items.forEach(item=>{
    const c = recibidoPorProveedorCatItem(prov,"conjunta",item);
    const l = recibidoPorProveedorCatItem(prov,"laura",item);
    const g = recibidoPorProveedorCatItem(prov,"gustavo",item);
    const t = c + l + g;
    if(t>0) any = true;

    body.innerHTML += `
      <tr>
        <td class="text-start fw-semibold">${item}</td>
        <td>${c}</td><td>${l}</td><td>${g}</td><td>${t}</td>
      </tr>`;
  });

  if(!any){
    body.innerHTML = `<tr><td colspan="5" class="text-muted">Este proveedor aún no registra recepciones.</td></tr>`;
  }
}

window.editSolicitud = function(solId){
  const sol = db.solicitudes.find(s=>s.id===solId);
  if(!sol) return alert("Solicitud no encontrada.");

  const newProv = prompt("Proveedor:", sol.proveedor);
  if(newProv === null) return;

  const newFecha = prompt("Fecha (YYYY-MM-DD):", sol.fecha);
  if(newFecha === null) return;

  // editar cantidades por item
  const updatedItems = [];
  for(const it of sol.items){
    const recibido = recibidoPorSolicitudItem(solId, it.item);
    const val = prompt(`Cantidad solicitada para ${it.item} (mínimo recibido: ${recibido})`, String(it.cant));
    if(val === null) return; // cancelar todo
    const n = Number(val);
    if(!Number.isFinite(n) || n < recibido){
      return alert(`Valor inválido. Para ${it.item} no puedes ser menor que lo recibido (${recibido}).`);
    }
    if(n > 0) updatedItems.push({ item: it.item, cant: n });
  }

  sol.proveedor = newProv.trim() || sol.proveedor;
  sol.fecha = newFecha.trim() || sol.fecha;
  sol.items = updatedItems;

  renderAll();
};

window.editRecepcion = function(recId){
  const rec = db.recepciones.find(r=>r.id===recId);
  if(!rec) return alert("Recepción no encontrada.");

  const solId = rec.solicitudId;
  const sol = db.solicitudes.find(s=>s.id===solId);
  if(!sol) return alert("La solicitud asociada no existe.");

  const newFecha = prompt("Fecha de recepción (YYYY-MM-DD):", rec.fecha);
  if(newFecha === null) return;
  if(!newFecha.trim()) return alert("La fecha es obligatoria.");

  const newProv = prompt("Proveedor:", rec.proveedor);
  if(newProv === null) return;

  const newObs = prompt("Observaciones:", rec.obs || "");
  if(newObs === null) return;

  // Para validar: recibido total por solicitud+item excluyendo esta recepción
  function recibidoExcluyendo(item){
    let total = 0;
    db.recepciones
      .filter(r=>r.solicitudId===solId && r.id!==recId)
      .forEach(r=>{
        r.items.forEach(it=>{
          if(it.item===item) total += Number(it.cant||0);
        });
      });
    return total;
  }

  const updatedItems = [];
  for(const it of rec.items){
    const solicitado = solicitadoEnSolicitudItem(solId, it.item);
    const recibidoOtros = recibidoExcluyendo(it.item);
    const maxPermitido = Math.max(0, solicitado - recibidoOtros);

    const val = prompt(`Cantidad recibida para ${it.item} (máx permitido: ${maxPermitido})`, String(it.cant));
    if(val === null) return;
    const n = Number(val);

    if(!Number.isFinite(n) || n < 0 || n > maxPermitido){
      return alert(`Valor inválido. Para ${it.item} no puede superar ${maxPermitido}.`);
    }
    if(n > 0) updatedItems.push({ item: it.item, cant: n });
  }

  rec.fecha = newFecha.trim();
  rec.proveedor = newProv.trim() || rec.proveedor;
  rec.obs = newObs.trim();
  rec.items = updatedItems;

  renderAll();
};

window.editEntrega = function(entId){
  const ent = db.entregas.find(e=>e.id===entId);
  if(!ent) return alert("Entrega no encontrada.");

  const cat = ent.categoria;

  const newPersona = prompt("Persona:", ent.persona);
  if(newPersona === null) return;
  if(!newPersona.trim()) return alert("Persona es obligatoria.");

  const newFecha = prompt("Fecha (YYYY-MM-DD):", ent.fecha);
  if(newFecha === null) return;
  if(!newFecha.trim()) return alert("La fecha es obligatoria.");

  const newObs = prompt("Observación:", ent.obs || "");
  if(newObs === null) return;

  // stock disponible para editar: stock actual + lo que esta entrega ya había consumido en ese item
  const updatedItems = [];
  for(const it of ent.items){
    const stockActual = stockPorCatItem(cat, it.item);
    const disponibleParaEditar = stockActual + Number(it.cant||0);

    const val = prompt(`Cantidad entregada para ${it.item} (disponible para editar: ${disponibleParaEditar})`, String(it.cant));
    if(val === null) return;
    const n = Number(val);

    if(!Number.isFinite(n) || n < 0 || n > disponibleParaEditar){
      return alert(`Valor inválido. Para ${it.item} no puede superar ${disponibleParaEditar}.`);
    }
    if(n > 0) updatedItems.push({ item: it.item, cant: n });
  }

  ent.persona = newPersona.trim();
  ent.fecha = newFecha.trim();
  ent.obs = newObs.trim();
  ent.items = updatedItems;

  renderAll();
};

// ===== Modal helpers =====
let editModalInstance = null;
let editContext = null; // { type: 'solicitud'|'recepcion'|'entrega', id: '...', categoria: '...' }

function $(id){ return document.getElementById(id); }

function showEditError(msg){
  const a = $("editModalAlert");
  a.textContent = msg;
  a.classList.remove("d-none");
}
function clearEditError(){
  const a = $("editModalAlert");
  a.textContent = "";
  a.classList.add("d-none");
}

function fillProveedorSelect(selected){
  const sel = $("editProveedor");
  sel.innerHTML = "";
  proveedores.forEach(p=>{
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if(p === selected) opt.selected = true;
    sel.appendChild(opt);
  });
}

function buildItemMap(itemsArr){
  const m = {};
  (itemsArr || []).forEach(it => m[it.item] = Number(it.cant || 0));
  return m;
}

// Crea la tabla de items con inputs y límites por fila
function renderEditItemsTable({ valueMap, limitMap, noteMap }){
  const tbody = $("editItemsBody");
  tbody.innerHTML = "";

  items.forEach(item=>{
    const val = valueMap[item] ?? 0;
    const limit = limitMap[item] ?? null;
    const note = noteMap[item] ?? "";

    tbody.innerHTML += `
      <tr>
        <td class="text-start fw-semibold">${item}</td>
        <td>
          <input type="number" min="0" step="1"
                 class="form-control text-center editItemInput"
                 data-item="${item}"
                 value="${val}">
        </td>
        <td class="small">
          ${limit === null ? "-" : limit}
        </td>
        <td class="small text-start">${note}</td>
      </tr>
    `;
  });
}

function readModalItems(){
  const inputs = document.querySelectorAll(".editItemInput");
  const out = [];
  for(const inp of inputs){
    const item = inp.dataset.item;
    const n = Number(inp.value);
    if(!Number.isFinite(n) || n < 0) return { error: `Cantidad inválida en ${item}` };
    if(n > 0) out.push({ item, cant: n });
  }
  return { items: out };
}

function openEditModal({ type, id }){
  clearEditError();

  // preparar instancia modal
  if(!editModalInstance){
    editModalInstance = new bootstrap.Modal(document.getElementById("editModal"));
  }

  editContext = { type, id };

  // UI toggles
  $("editPersonaWrap").style.display = (type === "entrega") ? "" : "none";
  $("editEstadoWrap").style.display = (type === "entrega") ? "" : "none";
  $("editObsWrap").style.display = (type === "recepcion" || type === "entrega") ? "" : "none";
  $("editProveedor").disabled = (type === "entrega"); // entrega a personas NO depende del proveedor
  $("editProveedorHelp").textContent = (type === "entrega")
    ? "En entregas a personas no aplica proveedor."
    : "";

  // cargar datos del registro
  if(type === "solicitud"){
    const sol = db.solicitudes.find(s=>s.id===id);
    if(!sol) return alert("Solicitud no encontrada.");

    $("editModalTitle").textContent = `Editar Solicitud ${sol.id} (${sol.categoria.toUpperCase()})`;
    fillProveedorSelect(sol.proveedor);
    $("editFecha").value = sol.fecha || "";

    const current = buildItemMap(sol.items);

    // límites: mínimo = recibido
    const limitMap = {};
    const noteMap = {};
    items.forEach(item=>{
      const min = recibidoPorSolicitudItem(sol.id, item);
      limitMap[item] = `Mín: ${min}`;
      noteMap[item] = `No puede ser menor que lo recibido (${min}).`;
    });

    renderEditItemsTable({
      valueMap: current,
      limitMap,
      noteMap
    });

    $("editModalSaveBtn").onclick = () => saveEditSolicitud(sol.id);

  } else if(type === "recepcion"){
    const rec = db.recepciones.find(r=>r.id===id);
    if(!rec) return alert("Recepción no encontrada.");

    const sol = db.solicitudes.find(s=>s.id===rec.solicitudId);
    if(!sol) return alert("La solicitud asociada no existe.");

    $("editModalTitle").textContent = `Editar Recepción ${rec.id} (${rec.categoria.toUpperCase()})`;
    fillProveedorSelect(rec.proveedor);
    $("editFecha").value = rec.fecha || "";
    $("editObs").value = rec.obs || "";

    const current = buildItemMap(rec.items);

    function recibidoExcluyendo(item){
      let total = 0;
      db.recepciones
        .filter(r=>r.solicitudId===rec.solicitudId && r.id!==rec.id)
        .forEach(r=>{
          (r.items||[]).forEach(it=>{
            if(it.item===item) total += Number(it.cant||0);
          });
        });
      return total;
    }

    // límites: máximo = solicitado - recibidoOtros
    const limitMap = {};
    const noteMap = {};
    items.forEach(item=>{
      const solicitado = solicitadoEnSolicitudItem(rec.solicitudId, item);
      const recibidoOtros = recibidoExcluyendo(item);
      const max = Math.max(0, solicitado - recibidoOtros);
      limitMap[item] = `Máx: ${max}`;
      noteMap[item] = `Solicitado: ${solicitado}. Ya recibido (otras): ${recibidoOtros}.`;
    });

    renderEditItemsTable({
      valueMap: current,
      limitMap,
      noteMap
    });

    $("editModalSaveBtn").onclick = () => saveEditRecepcion(rec.id);

  } else if(type === "entrega"){
    const ent = db.entregas.find(e=>e.id===id);
    if(!ent) return alert("Entrega no encontrada.");

    $("editModalTitle").textContent = `Editar Entrega ${ent.id} (${ent.categoria.toUpperCase()})`;
    // proveedor deshabilitado
    fillProveedorSelect(proveedores[0] || "Digiprint");
    $("editFecha").value = ent.fecha || "";
    $("editPersona").value = ent.persona || "";
    $("editEstado").value = ent.estado || "ENTREGADO";
    $("editObs").value = ent.obs || "";

    const current = buildItemMap(ent.items);

    // límites: máximo = stock actual + lo que ya tenía esta entrega
    const limitMap = {};
    const noteMap = {};
    items.forEach(item=>{
      const stock = stockPorCatItem(ent.categoria, item);
      const actual = current[item] ?? 0;
      const max = stock + actual;
      limitMap[item] = `Máx: ${max}`;
      noteMap[item] = `Stock actual: ${stock}. (Incluye lo ya entregado en este registro: ${actual}).`;
    });

    renderEditItemsTable({
      valueMap: current,
      limitMap,
      noteMap
    });

    $("editModalSaveBtn").onclick = () => saveEditEntrega(ent.id);
  }

  editModalInstance.show();
}

// ===== Save handlers (validaciones fuertes) =====
function saveEditSolicitud(solId){
  clearEditError();
  const sol = db.solicitudes.find(s=>s.id===solId);
  if(!sol) return showEditError("Solicitud no encontrada.");

  const prov = $("editProveedor").value;
  const fecha = $("editFecha").value;
  if(!fecha) return showEditError("La fecha es obligatoria.");

  const read = readModalItems();
  if(read.error) return showEditError(read.error);

  // Validar mínimos por recibido
  for(const item of items){
    const rec = recibidoPorSolicitudItem(solId, item);
    const entered = (read.items.find(x=>x.item===item)?.cant) || 0;
    if(entered < rec){
      return showEditError(`En ${item} no puedes poner ${entered}. Mínimo permitido: ${rec} (ya recibido).`);
    }
  }

  sol.proveedor = prov;
  sol.fecha = fecha;
  sol.items = read.items;

  editModalInstance.hide();
  renderAll();
}

function saveEditRecepcion(recId){
  clearEditError();
  const rec = db.recepciones.find(r=>r.id===recId);
  if(!rec) return showEditError("Recepción no encontrada.");

  const fecha = $("editFecha").value;
  if(!fecha) return showEditError("La fecha es obligatoria.");

  const prov = $("editProveedor").value;
  const obs = $("editObs").value || "";

  const solId = rec.solicitudId;

  function recibidoExcluyendo(item){
    let total = 0;
    db.recepciones
      .filter(r=>r.solicitudId===solId && r.id!==recId)
      .forEach(r=>{
        (r.items||[]).forEach(it=>{
          if(it.item===item) total += Number(it.cant||0);
        });
      });
    return total;
  }

  const read = readModalItems();
  if(read.error) return showEditError(read.error);

  // Validar máximos
  for(const item of items){
    const solicitado = solicitadoEnSolicitudItem(solId, item);
    const recibidoOtros = recibidoExcluyendo(item);
    const max = Math.max(0, solicitado - recibidoOtros);

    const entered = (read.items.find(x=>x.item===item)?.cant) || 0;
    if(entered > max){
      return showEditError(`En ${item} no puedes recibir ${entered}. Máximo permitido: ${max}.`);
    }
  }

  rec.fecha = fecha;
  rec.proveedor = prov;
  rec.obs = obs.trim();
  rec.items = read.items;

  editModalInstance.hide();
  renderAll();
}

function saveEditEntrega(entId){
  clearEditError();
  const ent = db.entregas.find(e=>e.id===entId);
  if(!ent) return showEditError("Entrega no encontrada.");

  const fecha = $("editFecha").value;
  if(!fecha) return showEditError("La fecha es obligatoria.");

  const persona = ($("editPersona").value || "").trim();
  if(!persona) return showEditError("La persona es obligatoria.");

  const obs = $("editObs").value || "";
  const estado = ($("editEstado").value || "ENTREGADO").trim();

  const current = buildItemMap(ent.items);
  const read = readModalItems();
  if(read.error) return showEditError(read.error);

  // Validar contra stock editable
  for(const item of items){
    const stock = stockPorCatItem(ent.categoria, item);
    const actual = current[item] ?? 0;
    const max = stock + actual;

    const entered = (read.items.find(x=>x.item===item)?.cant) || 0;
    if(entered > max){
      return showEditError(`En ${item} no puedes entregar ${entered}. Máximo disponible: ${max}.`);
    }
  }

  ent.fecha = fecha;
  ent.persona = persona;
  ent.estado = estado;
  ent.obs = obs.trim();
  ent.items = read.items;

  editModalInstance.hide();
  renderAll();
}

// ===== Exponer funciones editar para botones =====
window.editSolicitud = (id) => openEditModal({ type:"solicitud", id });
window.editRecepcion = (id) => openEditModal({ type:"recepcion", id });
window.editEntrega  = (id) => openEditModal({ type:"entrega", id });

// ================== STARTUP ==================
fillBasicSelects();
initListControls();
renderAll();
goView("proveedores");

// ================== EXPORT EXCEL (XLSX) ==================
// view: 'proveedores' | 'entregas'
window.downloadExcel = function(view, cat){
  try{
    if(typeof XLSX === "undefined"){
      alert("No se pudo cargar la librería de Excel (XLSX). Revisa tu conexión.");
      return;
    }

    const wb = XLSX.utils.book_new();
    const catLabel = String(cat||"").toUpperCase();

    const addSheet = (name, rows) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    if(view === "entregas"){
      const data = db.entregas.filter(e=>e.categoria===cat).slice().reverse();
      const rows = [
        ["ID","Fecha","Persona","Estado","Items","Observación"],
        ...data.map(e=>[
          e.id,
          e.fecha,
          e.persona,
          e.estado || "ENTREGADO",
          fmtItems(e.items||[]),
          e.obs || ""
        ])
      ];
      addSheet("Entregas", rows);

    } else if(view === "proveedores"){
      const sols = db.solicitudes.filter(s=>s.categoria===cat).slice().reverse();
      const recs = db.recepciones.filter(r=>r.categoria===cat).slice().reverse();

      const rowsSol = [
        ["ID","Proveedor","Fecha","Items"],
        ...sols.map(s=>[s.id, s.proveedor, s.fecha, fmtItems(s.items||[])])
      ];
      const rowsRec = [
        ["ID","Solicitud","Fecha","Proveedor","Items","Observación"],
        ...recs.map(r=>[r.id, r.solicitudId, r.fecha, r.proveedor, fmtItems(r.items||[]), r.obs||""])
      ];
      addSheet("Solicitudes", rowsSol);
      addSheet("Recepciones", rowsRec);
    } else {
      alert("Exportación no disponible para esta sección.");
      return;
    }

    const fileName = `Control_Publicidad_${view}_${catLabel}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);

  } catch (err){
    console.error(err);
    alert("Ocurrió un error generando el Excel.");
  }
};

// ================== RESPALDO / RESTAURAR ==================
// Descarga un archivo .json con toda la BD (localStorage)
window.backupDB = function(){
  try{
    ensureDbShape();
    const payload = {
      app: "control_publicidad",
      version: "1",
      exportedAt: new Date().toISOString(),
      lsKey: LS_KEY,
      db
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `Respaldo_Control_Publicidad_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e){
    console.error(e);
    alert("No se pudo generar el respaldo.");
  }
};

// Abre selector de archivo
window.triggerRestore = function(){
  const input = document.getElementById("restoreFile");
  if(!input) return;
  input.value = "";
  input.click();
};

// Lee y restaura el respaldo seleccionado
window.handleRestoreFile = function(file){
  try{
    if(!file){
      return;
    }
    if(!/\.json$/i.test(file.name)){
      alert("Selecciona un archivo .json de respaldo.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try{
        const text = String(reader.result || "");
        const parsed = JSON.parse(text);

        // Acepta dos formatos: {db:{...}} o directamente la db
        const newDb = (parsed && parsed.db) ? parsed.db : parsed;
        if(!newDb || typeof newDb !== "object"){
          alert("El archivo no tiene un formato válido.");
          return;
        }
        if(!Array.isArray(newDb.solicitudes) || !Array.isArray(newDb.recepciones) || !Array.isArray(newDb.entregas)){
          alert("El respaldo no contiene la estructura esperada (solicitudes/recepciones/entregas).");
          return;
        }

        const ok = confirm(
          "Esto reemplazará la información actual guardada en este navegador.\n\n" +
          "¿Deseas continuar y restaurar el respaldo?"
        );
        if(!ok) return;

        db = newDb;
        ensureDbShape();
        localStorage.setItem(LS_KEY, JSON.stringify(db));

        // Re-render general
        try{ renderAll(); } catch(_){}
        alert("Respaldo restaurado correctamente.");
      } catch (err){
        console.error(err);
        alert("No se pudo leer el archivo. Verifica que sea un respaldo válido.");
      }
    };
    reader.onerror = () => alert("No se pudo leer el archivo seleccionado.");
    reader.readAsText(file);
  } catch (e){
    console.error(e);
    alert("No se pudo restaurar el respaldo.");
  }
};