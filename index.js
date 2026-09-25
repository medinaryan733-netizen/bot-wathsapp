const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

// ==========================================
// CONFIGURACIÓN DE ENTORNO
// ==========================================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'NEXXUS_ALICE_SECRET';
const OWNER_PHONE = process.env.OWNER_PHONE || '';

// CREDENCIALES DEL PANEL WEB
const ADMIN_USER = 'Ryan98730';
const ADMIN_PASS = 'Sol12345';

// INICIALIZAR ANTHROPIC Y SUPABASE
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// MEMORIA TEMPORAL PARA ESTADOS
const pausedChats = {};
let promoActiva = null;

function cleanNumber(num) {
    return String(num || '').replace(/\D/g, '');
}

function checkIsOwner(phone) {
    const ownerClean = cleanNumber(OWNER_PHONE);
    const phoneClean = cleanNumber(phone);
    if (!ownerClean || !phoneClean) return false;
    return phoneClean === ownerClean || 
           phoneClean.endsWith(ownerClean.slice(-8)) || 
           ownerClean.endsWith(phoneClean.slice(-8));
}

// ==========================================
// PROMPT DEL SISTEMA (ALICE)
// ==========================================
const SYSTEM_PROMPT = `Sos ALICE, la asistente virtual de NEXXUS, un negocio de entretenimiento digital. Respondés en español rioplatense, sos amable, profesional y resolutiva. Mensajes cortos y claros, usás emojis con moderación.

SERVICIOS Y PRECIOS:
- Netflix Perfil $9000/mes.
- Netflix perfil extra $14000/mes (perfil propio, no comparte con otros, sin problemas de hogar).
- Max $4500/mes.
- Prime Video $4000/mes.
- Disney+ $6000/mes.
- Crunchyroll $2800/mes.
- Reels Shorts $7500/mes.
- YouTube Premium $2800/mes.
- TV Digital pack futbol: 1) Cenit TV $7000/mes 2) TV Online Plus $10000/mes 3) Argentum $12000/mes (incluye YT Premium, Spotify, YT Music) 4) TV Sin Limites $14000/mes.

MEDIOS DE PAGO: Transferencia alias RYAN.MB (Braian Gaston Medina) o efectivo.

SORTEO Y GRUPO: Sorteamos 8 plataformas cada 01 del mes. Para participar deben comprar en el mes, tener saldo al día y estar en el grupo. Link: https://chat.whatsapp.com/B4neyKRVL4a8VmHpa1iGsw (menciónalo siempre al cerrar una venta).

GUIA TV DIGITAL: Para SMART TV ANDROID/FIRE STICK: 1) App Downloader (naranja) 2) Enter URL y el código 3) Instalar. CÓDIGOS TV: Cenit 7960580, TV Online Plus 3342117, Argentum 4708062, TV Sin Limites 2630214 o 4540617.

REGLAS DE ATENCIÓN Y PROMOCIONES:
- CONSULTA DE PROMOCIONES: Si el cliente pregunta por promociones, ofertas o descuentos:
  * Si NO hay promo activa actualmente, NO vuelvas a mandar la lista completa de precios si ya la diste. Responde: "Por el momento no tenemos promociones activas vigentes, pero nuestros precios son los más accesibles del mercado. ¡Recordá que con tu compra participás del sorteo mensual!"
  * Si HAY promo activa, menciónala con claridad.
- CLIENTE NUEVO: Ofrécele el catálogo de forma limpia. No pidas datos de cuentas, correos o perfiles porque aún no tienen servicio.
- SOPORTE TÉCNICO (Cliente con problema): Intenta resolver básicos (ej: guías de TV, escaneo de QR). Si faltan datos en el sistema y el cliente tiene un problema, pídele amablemente su nombre, correo, clave y perfil para que Ryan lo revise más rápido.
- NETFLIX HOGAR: Explica con empatía que a Netflix le conviene que cada casa pague lo suyo, por eso los bloqueos. Dile que ya avisaste a Ryan.
- AUDIOS Y LLAMADAS: Pide amablemente que te escriban en texto.
- PAGOS ATRASADOS O ESPERAS: Jamás aceptes una espera de pago ni des acceso sin confirmación de Ryan.
- HORARIO NOCTURNO: Si son pasadas las 00:00, aclara que Ryan ya debe estar descansando y que el problema se solucionará a primera hora.`;

// ==========================================
// FUNCIONES DE WHATSAPP Y CRON
// ==========================================
async function sendWhatsAppMessage(to, text) {
    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
            { messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } },
            { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
    } catch (e) {
        console.error('Error enviando WhatsApp:', e.response?.data || e.message);
    }
}

async function notifyOwner(clientPhone, issue) {
    const ownerClean = cleanNumber(OWNER_PHONE);
    if (!ownerClean) return;
    const msg = `⚠️ *ALERTA NEXXUS*\n\n👤 Cliente: +${clientPhone}\n📝 Situación: ${issue}`;
    await sendWhatsAppMessage(ownerClean, msg);
}

async function checkVencimientos() {
    try {
        const manana = new Date();
        manana.setDate(manana.getDate() + 1);
        const fecha = manana.toISOString().split('T')[0];
        
        const { data: servicios } = await supabase
            .from('CUENTAS')
            .select('*, CLIENTES(nombre, telefono)')
            .eq('fecha_vencimiento', fecha)
            .eq('estado', 'ocupado');

        if (!servicios) return;

        for (const svc of servicios) {
            const telefono = svc.CLIENTES?.telefono || svc.cliente_id;
            const nombre = svc.CLIENTES?.nombre || 'Cliente';
            if (telefono) {
                const msg = `¡Hola ${nombre}! Te recordamos que tu servicio de ${svc.plataforma || 'streaming'} vence mañana. Para renovar transferí al alias RYAN.MB y avisanos. ¡Gracias por elegir NEXXUS!`;
                await sendWhatsAppMessage(telefono, msg);
            }
        }
    } catch (error) {
        console.error('Error en recordatorios:', error.message);
    }
}
setInterval(checkVencimientos, 24 * 60 * 60 * 1000);

// ==========================================
// ENDPOINTS API PARA EL PANEL WEB
// ==========================================
app.post('/api/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        res.json({ success: true, token: 'NEXXUS_SESSION_ACTIVE' });
    } else {
        res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }
});

app.get('/api/dashboard-data', async (req, res) => {
    const { data: clientes } = await supabase.from('CLIENTES').select('*, CUENTAS(*)');
    const { data: cuentas } = await supabase.from('CUENTAS').select('*');
    
    const totalClientes = clientes?.length || 0;
    const stockDisponible = cuentas?.filter(c => c.estado === 'disponible').length || 0;
    const cuentasOcupadas = cuentas?.filter(c => c.estado === 'ocupado').length || 0;
    
    // Próximos vencimientos (dentro de los próximos 3 días)
    const hoy = new Date();
    const proxsVencimientos = cuentas?.filter(c => {
        if (!c.fecha_vencimiento || c.estado !== 'ocupado') return false;
        const diffDays = Math.ceil((new Date(c.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= 3;
    }) || [];

    res.json({
        totalClientes,
        stockDisponible,
        cuentasOcupadas,
        vencimientosProximos: proxsVencimientos.length,
        botPausado: !!pausedChats['TODOS'],
        promoActiva: promoActiva || 'Ninguna',
        clientes: clientes || [],
        stockCuentas: cuentas || []
    });
});

app.post('/api/guardar-cliente', async (req, res) => {
    const { telefono, nombre, plataforma, fecha_vencimiento, correo, password, perfil, pin } = req.body;
    const telClean = cleanNumber(telefono);

    await supabase.from('CLIENTES').upsert({ telefono: telClean, nombre }, { onConflict: 'telefono' });
    await supabase.from('CUENTAS').insert([{
        cliente_id: telClean,
        plataforma,
        fecha_vencimiento,
        correo: correo || '',
        password: password || '',
        perfil: perfil || '',
        pin: pin || '',
        estado: 'ocupado'
    }]);

    res.json({ success: true });
});

app.post('/api/actualizar-cuenta', async (req, res) => {
    const { id, plataforma, correo, password, perfil, pin, fecha_vencimiento, estado } = req.body;
    await supabase.from('CUENTAS').update({
        plataforma, correo, password, perfil, pin, fecha_vencimiento, estado
    }).eq('id', id);

    res.json({ success: true });
});

app.post('/api/agregar-stock', async (req, res) => {
    const { plataforma, correo, password, perfil, pin } = req.body;
    await supabase.from('CUENTAS').insert([{
        plataforma,
        correo,
        password,
        perfil: perfil || '',
        pin: pin || '',
        estado: 'disponible'
    }]);

    res.json({ success: true });
});

app.post('/api/eliminar-cliente', async (req, res) => {
    const { telefono } = req.body;
    await supabase.from('CUENTAS').delete().eq('cliente_id', telefono);
    await supabase.from('CLIENTES').delete().eq('telefono', telefono);
    res.json({ success: true });
});

app.post('/api/control-bot', async (req, res) => {
    const { accion, valor } = req.body;
    if (accion === 'pausa_global') pausedChats['TODOS'] = valor;
    if (accion === 'promo') promoActiva = valor ? valor : null;
    res.json({ success: true });
});

// ==========================================
// INTERFAZ GRÁFICA COMPLETA DEL PANEL WEB
// ==========================================
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Panel de Control NEXXUS - ALICE</title>
        <style>
            :root { --bg: #0f172a; --card: #1e293b; --accent: #10b981; --text: #f8fafc; --muted: #94a3b8; --border: #334155; }
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
            body { background: var(--bg); color: var(--text); padding: 20px; min-height: 100vh; }
            
            /* LOGIN SCREEN */
            #loginScreen { max-width: 400px; margin: 80px auto; background: var(--card); padding: 30px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            #loginScreen h2 { margin-bottom: 20px; text-align: center; color: var(--accent); }

            /* DASHBOARD CONTAINER */
            #dashboardContainer { max-width: 1200px; margin: 0 auto; display: none; }
            header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }

            /* NAV TABS */
            .tabs { display: flex; gap: 10px; margin-bottom: 20px; overflow-x: auto; }
            .tab-btn { background: var(--card); color: var(--muted); border: 1px solid var(--border); padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.2s; white-space: nowrap; }
            .tab-btn.active, .tab-btn:hover { background: var(--accent); color: #000; border-color: var(--accent); }

            /* TAB CONTENT */
            .tab-content { display: none; background: var(--card); padding: 25px; border-radius: 12px; border: 1px solid var(--border); }
            .tab-content.active { display: block; }

            /* METRIC CARDS */
            .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
            .metric-card { background: #0f172a; padding: 20px; border-radius: 8px; border: 1px solid var(--border); text-align: center; }
            .metric-card h3 { font-size: 2rem; color: var(--accent); margin-bottom: 5px; }
            .metric-card p { color: var(--muted); font-size: 0.9rem; }

            /* FORMS & INPUTS */
            input, select, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 6px; border: 1px solid var(--border); background: #0f172a; color: var(--text); font-size: 0.95rem; }
            button.btn-primary { background: var(--accent); color: #000; font-weight: bold; border: none; cursor: pointer; transition: 0.2s; }
            button.btn-primary:hover { opacity: 0.9; }
            button.btn-danger { background: #ef4444; color: #fff; border: none; cursor: pointer; padding: 6px 12px; width: auto; border-radius: 4px; }
            button.btn-edit { background: #3b82f6; color: #fff; border: none; cursor: pointer; padding: 6px 12px; width: auto; border-radius: 4px; margin-right: 5px; }

            /* TABLES */
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
            th { background: #0f172a; color: var(--accent); }

            /* MODAL EDITAR */
            #editModal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 100; justify-content: center; align-items: center; }
            .modal-box { background: var(--card); padding: 25px; border-radius: 12px; max-width: 500px; width: 90%; border: 1px solid var(--border); }
        </style>
    </head>
    <body>

        <!-- LOGIN -->
        <div id="loginScreen">
            <h2>NEXXUS Panel</h2>
            <form id="formLogin">
                <input type="text" id="loginUser" placeholder="Usuario" required>
                <input type="password" id="loginPass" placeholder="Contraseña" required>
                <button type="submit" class="btn-primary">Ingresar al Sistema</button>
            </form>
        </div>

        <!-- DASHBOARD PRINCIPAL -->
        <div id="dashboardContainer">
            <header>
                <h2>⚡ NEXXUS Control Panel</h2>
                <button onclick="logout()" style="width:auto; background:#ef4444; color:#fff; border:none; padding:8px 15px; cursor:pointer; border-radius:6px;">Cerrar Sesión</button>
            </header>

            <!-- TABS NAVIGATION -->
            <div class="tabs">
                <button class="tab-btn active" onclick="switchTab('tabResumen')">1. 📊 Resumen</button>
                <button class="tab-btn" onclick="switchTab('tabClientes')">2. 👥 Clientes</button>
                <button class="tab-btn" onclick="switchTab('tabStock')">3. 📦 Stock / Cuentas</button>
                <button class="tab-btn" onclick="switchTab('tabBot')">4. 🤖 Control Bot</button>
                <button class="tab-btn" onclick="switchTab('tabAgregar')">5. ➕ Agregar Cliente</button>
            </div>

            <!-- TAB 1: RESUMEN -->
            <div id="tabResumen" class="tab-content active">
                <div class="metrics-grid">
                    <div class="metric-card"><h3 id="mClientes">0</h3><p>Clientes Totales</p></div>
                    <div class="metric-card"><h3 id="mCuentasOcup">0</h3><p>Cuentas Activas</p></div>
                    <div class="metric-card"><h3 id="mStockDisp">0</h3><p>Stock Disponible</p></div>
                    <div class="metric-card"><h3 id="mVencProxs">0</h3><p>Vencen en 3 Días</p></div>
                </div>
            </div>

            <!-- TAB 2: CLIENTES -->
            <div id="tabClientes" class="tab-content">
                <input type="text" id="searchClient" placeholder="🔎 Buscar por nombre, teléfono o servicio..." onkeyup="filterClientes()">
                <table>
                    <thead>
                        <tr>
                            <th>Nombre</th>
                            <th>Teléfono</th>
                            <th>Servicio</th>
                            <th>Correo / Clave / Perfil</th>
                            <th>Vencimiento</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="tblClientes"></tbody>
                </table>
            </div>

            <!-- TAB 3: STOCK CUENTAS -->
            <div id="tabStock" class="tab-content">
                <h3>Cargar Nueva Cuenta al Stock Disponible</h3>
                <form id="formCargarStock" style="margin-bottom:25px;">
                    <input type="text" id="stkPlataforma" placeholder="Plataforma (Ej: Netflix, Disney+)" required>
                    <input type="text" id="stkCorreo" placeholder="Correo electrónico" required>
                    <input type="text" id="stkPass" placeholder="Contraseña" required>
                    <input type="text" id="stkPerfil" placeholder="Perfil (Opcional)">
                    <input type="text" id="stkPin" placeholder="PIN (Opcional)">
                    <button type="submit" class="btn-primary">Guardar en Stock</button>
                </form>

                <h3>Inventario de Cuentas Cargadas</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Plataforma</th>
                            <th>Correo / Clave</th>
                            <th>Perfil / PIN</th>
                            <th>Estado</th>
                            <th>Asignado a</th>
                        </tr>
                    </thead>
                    <tbody id="tblStock"></tbody>
                </table>
            </div>

            <!-- TAB 4: CONTROL BOT -->
            <div id="tabBot" class="tab-content">
                <h3>Estado y Configuración de ALICE</h3>
                <br>
                <p><strong>Pausa Global del Bot:</strong> <span id="lblBotPausa">Activo</span></p>
                <button onclick="togglePausaBot()" class="btn-primary" style="max-width:250px; margin-top:10px;">Cambiar Estado Bot</button>
                <hr style="border-color:var(--border); margin:20px 0;">
                
                <h3>Promoción Global Activa</h3>
                <input type="text" id="txtPromoGlobal" placeholder="Escribe el texto de la promo (Ej: 2x1 en Disney este finde)">
                <button onclick="guardarPromo()" class="btn-primary" style="max-width:250px;">Activar Promo</button>
                <button onclick="desactivarPromo()" style="max-width:250px; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:6px; cursor:pointer;">Apagar Promo</button>
            </div>

            <!-- TAB 5: AGREGAR CLIENTE -->
            <div id="tabAgregar" class="tab-content">
                <h3>Agregar / Registrar Nuevo Cliente</h3>
                <form id="formAddClient">
                    <input type="text" id="addTel" placeholder="Teléfono WhatsApp (Ej: 549385...)" required>
                    <input type="text" id="addNom" placeholder="Nombre Completo" required>
                    <input type="text" id="addPlat" placeholder="Servicio (Ej: Netflix Perfil Extra)" required>
                    <input type="date" id="addVenc" required>
                    <input type="text" id="addMail" placeholder="Correo asignado (Opcional)">
                    <input type="text" id="addPass" placeholder="Contraseña asignada (Opcional)">
                    <input type="text" id="addPerfil" placeholder="Perfil asignado (Opcional)">
                    <input type="text" id="addPin" placeholder="PIN asignado (Opcional)">
                    <button type="submit" class="btn-primary">Registrar Cliente en Supabase</button>
                </form>
            </div>

        </div>

        <!-- MODAL EDITAR CUENTA -->
        <div id="editModal">
            <div class="modal-box">
                <h3>✏️ Editar Datos del Cliente / Cuenta</h3>
                <input type="hidden" id="editCuentaId">
                <input type="text" id="editPlat" placeholder="Plataforma">
                <input type="text" id="editMail" placeholder="Correo">
                <input type="text" id="editPass" placeholder="Contraseña">
                <input type="text" id="editPerfil" placeholder="Perfil">
                <input type="text" id="editPin" placeholder="PIN">
                <input type="date" id="editVenc">
                <button onclick="saveEditCuenta()" class="btn-primary">Guardar Cambios</button>
                <button onclick="closeEditModal()" style="background:#ef4444; color:#fff; border:none; padding:12px; width:100%; border-radius:6px; cursor:pointer; margin-top:5px;">Cancelar</button>
            </div>
        </div>

        <script>
            let localClientes = [];
            let localCuentas = [];
            let botPausadoEstado = false;

            // LOGIN
            document.getElementById('formLogin').addEventListener('submit', async (e) => {
                e.preventDefault();
                const user = document.getElementById('loginUser').value;
                const pass = document.getElementById('loginPass').value;
                
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ user, pass })
                });
                
                if (res.ok) {
                    sessionStorage.setItem('nexxus_auth', '1');
                    checkAuth();
                } else {
                    alert('❌ Credenciales incorrectas');
                }
            });

            function checkAuth() {
                if (sessionStorage.getItem('nexxus_auth') === '1') {
                    document.getElementById('loginScreen').style.display = 'none';
                    document.getElementById('dashboardContainer').style.display = 'block';
                    loadDashboardData();
                }
            }

            function logout() {
                sessionStorage.removeItem('nexxus_auth');
                location.reload();
            }

            // TABS SWITCH
            function switchTab(tabId) {
                document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
                event.target.classList.add('active');
            }

            // LOAD DATA
            async function loadDashboardData() {
                const res = await fetch('/api/dashboard-data');
                const data = await res.json();
                
                document.getElementById('mClientes').textContent = data.totalClientes;
                document.getElementById('mCuentasOcup').textContent = data.cuentasOcupadas;
                document.getElementById('mStockDisp').textContent = data.stockDisponible;
                document.getElementById('mVencProxs').textContent = data.vencimientosProximos;
                document.getElementById('lblBotPausa').textContent = data.botPausado ? '🔴 PAUSADO' : '🟢 ACTIVO';
                botPausadoEstado = data.botPausado;

                localClientes = data.clientes;
                localCuentas = data.stockCuentas;

                renderClientesTable(localClientes);
                renderStockTable(localCuentas);
            }

            // RENDER CLIENTES
            function renderClientesTable(lista) {
                const tbody = document.getElementById('tblClientes');
                tbody.innerHTML = '';
                lista.forEach(c => {
                    const cuenta = c.CUENTAS && c.CUENTAS.length > 0 ? c.CUENTAS[0] : {};
                    const mailPass = (cuenta.correo || cuenta.password) ? \`\${cuenta.correo || '-'} / \${cuenta.password || '-'} / P:\${cuenta.perfil || '-'} (PIN:\${cuenta.pin || '-'})\` : 'Sin datos';
                    tbody.innerHTML += \`
                        <tr>
                            <td><strong>\${c.nombre}</strong></td>
                            <td>+\${c.telefono}</td>
                            <td>\${cuenta.plataforma || 'Sin servicio'}</td>
                            <td><small>\${mailPass}</small></td>
                            <td>\${cuenta.fecha_vencimiento || '-'}</td>
                            <td>
                                \${cuenta.id ? \`<button class="btn-edit" onclick="openEditModal(\${cuenta.id}, '\${cuenta.plataforma}', '\${cuenta.correo||''}', '\${cuenta.password||''}', '\${cuenta.perfil||''}', '\${cuenta.pin||''}', '\${cuenta.fecha_vencimiento||''}')">✏️ Editar</button>\` : ''}
                                <button class="btn-danger" onclick="eliminarCliente('\${c.telefono}')">🗑️</button>
                            </td>
                        </tr>
                    \`;
                });
            }

            // RENDER STOCK
            function renderStockTable(lista) {
                const tbody = document.getElementById('tblStock');
                tbody.innerHTML = '';
                lista.forEach(s => {
                    tbody.innerHTML += \`
                        <tr>
                            <td><strong>\${s.plataforma}</strong></td>
                            <td>\${s.correo} / \${s.password}</td>
                            <td>Perfil: \${s.perfil || '-'} / PIN: \${s.pin || '-'}</td>
                            <td>\${s.estado === 'disponible' ? '🟢 Disponible' : '🔴 Ocupado'}</td>
                            <td>\${s.cliente_id ? '+' + s.cliente_id : 'N/A'}</td>
                        </tr>
                    \`;
                });
            }

            function filterClientes() {
                const q = document.getElementById('searchClient').value.toLowerCase();
                const filtered = localClientes.filter(c => 
                    c.nombre.toLowerCase().includes(q) || 
                    c.telefono.includes(q) || 
                    (c.CUENTAS?.[0]?.plataforma || '').toLowerCase().includes(q)
                );
                renderClientesTable(filtered);
            }

            // FORMS HANDLERS
            document.getElementById('formAddClient').addEventListener('submit', async (e) => {
                e.preventDefault();
                const body = {
                    telefono: document.getElementById('addTel').value,
                    nombre: document.getElementById('addNom').value,
                    plataforma: document.getElementById('addPlat').value,
                    fecha_vencimiento: document.getElementById('addVenc').value,
                    correo: document.getElementById('addMail').value,
                    password: document.getElementById('addPass').value,
                    perfil: document.getElementById('addPerfil').value,
                    pin: document.getElementById('addPin').value,
                };
                await fetch('/api/guardar-cliente', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
                alert('✅ Cliente registrado en Supabase');
                document.getElementById('formAddClient').reset();
                loadDashboardData();
            });

            document.getElementById('formCargarStock').addEventListener('submit', async (e) => {
                e.preventDefault();
                const body = {
                    plataforma: document.getElementById('stkPlataforma').value,
                    correo: document.getElementById('stkCorreo').value,
                    password: document.getElementById('stkPass').value,
                    perfil: document.getElementById('stkPerfil').value,
                    pin: document.getElementById('stkPin').value
                };
                await fetch('/api/agregar-stock', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
                alert('✅ Cuenta agregada al Stock');
                document.getElementById('formCargarStock').reset();
                loadDashboardData();
            });

            // EDIT MODAL
            function openEditModal(id, plat, mail, pass, perfil, pin, venc) {
                document.getElementById('editCuentaId').value = id;
                document.getElementById('editPlat').value = plat;
                document.getElementById('editMail').value = mail;
                document.getElementById('editPass').value = pass;
                document.getElementById('editPerfil').value = perfil;
                document.getElementById('editPin').value = pin;
                document.getElementById('editVenc').value = venc;
                document.getElementById('editModal').style.display = 'flex';
            }

            function closeEditModal() { document.getElementById('editModal').style.display = 'none'; }

            async function saveEditCuenta() {
                const body = {
                    id: document.getElementById('editCuentaId').value,
                    plataforma: document.getElementById('editPlat').value,
                    correo: document.getElementById('editMail').value,
                    password: document.getElementById('editPass').value,
                    perfil: document.getElementById('editPerfil').value,
                    pin: document.getElementById('editPin').value,
                    fecha_vencimiento: document.getElementById('editVenc').value,
                    estado: 'ocupado'
                };
                await fetch('/api/actualizar-cuenta', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
                closeEditModal();
                alert('✅ Datos actualizados');
                loadDashboardData();
            }

            async function eliminarCliente(tel) {
                if (confirm('¿Seguro que deseas eliminar este cliente?')) {
                    await fetch('/api/eliminar-cliente', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({telefono: tel}) });
                    loadDashboardData();
                }
            }

            async function togglePausaBot() {
                await fetch('/api/control-bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({accion:'pausa_global', valor: !botPausadoEstado}) });
                loadDashboardData();
            }

            async function guardarPromo() {
                const promo = document.getElementById('txtPromoGlobal').value;
                await fetch('/api/control-bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({accion:'promo', valor: promo}) });
                alert('✅ Promo activada');
            }

            async function desactivarPromo() {
                await fetch('/api/control-bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({accion:'promo', valor: ''}) });
                alert('✅ Promo apagada');
            }

            checkAuth();
        </script>
    </body>
    </html>`;
    res.send(html);
});

// ==========================================
// RUTAS DE WHATSAPP (WEBHOOK META)
// ==========================================
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.status(200).send('EVENT_RECEIVED');

    try {
        const body = req.body;
        if (!body.object) return;

        const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!message) return;

        const from = message.from;
        const pushName = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || 'Cliente';
        const type = message.type;
        const isOwner = checkIsOwner(from);

        const textMessage = type === 'text' ? message.text.body : '';

        // COMANDOS DEL DUEÑO
        if (isOwner && type === 'text') {
            const rawMsg = textMessage.trim();
            const lowerCmd = rawMsg.toLowerCase();

            if (lowerCmd === '!ayuda' || lowerCmd === '!comandos') {
                const ayuda = `🛠️ *Panel Admin NEXXUS:*\n\n` +
                    `🔹 *!dar [teléfono] [datos o plataforma]*: Envía acceso al cliente.\n` +
                    `🔹 *!agregar [tel] | [nombre] | [servicio] | [aaaa-mm-dd]*: Registra servicio.\n` +
                    `🔹 *!historial [tel]*: Muestra últimos mensajes.\n` +
                    `🔹 *!resp [tel] [mensaje]*: Responde directo al cliente.\n` +
                    `🔹 *PAUSA [tel]* / *ACTIVAR [tel]*: Controla el bot.\n` +
                    `🔹 *PAUSA TODOS* / *ACTIVAR TODOS*: Pausa global.\n` +
                    `🔹 *PROMO ACTIVA [texto]* / *PROMO OFF*: Promociones.`;
                await sendWhatsAppMessage(from, ayuda);
                return;
            }

            if (lowerCmd.startsWith('!dar')) {
                const firstLine = rawMsg.split('\n')[0];
                const parts = firstLine.split(' ');
                const targetPhone = parts[1] ? cleanNumber(parts[1]) : null;

                if (!targetPhone) {
                    await sendWhatsAppMessage(from, "❌ Falta el número de teléfono. Uso: !dar [número] [detalles]");
                    return;
                }

                const restOfMessage = rawMsg.substring(rawMsg.indexOf(parts[1]) + parts[1].length).trim();

                if (restOfMessage.includes('\n') || restOfMessage.toLowerCase().includes('correo') || restOfMessage.toLowerCase().includes('contraseña')) {
                    const mensajeEnviar = `🎉 *¡Tus datos de acceso de NEXXUS!* 🎉\n\n${restOfMessage}\n\n⚠️ *Importante:* No modifiques los datos de las cuentas para evitar bloqueos. ¡Gracias por elegirnos! - NEXXUS`;
                    await sendWhatsAppMessage(targetPhone, mensajeEnviar);
                    await sendWhatsAppMessage(from, `✅ Acceso enviado con éxito al cliente +${targetPhone}`);
                    return;
                } else {
                    const plataformaBuscada = restOfMessage || 'General';
                    const { data: cuentaData } = await supabase
                        .from('CUENTAS')
                        .select('*')
                        .ilike('plataforma', `%${plataformaBuscada}%`)
                        .eq('estado', 'disponible')
                        .limit(1)
                        .single();

                    if (!cuentaData) {
                        await sendWhatsAppMessage(from, `❌ No hay stock disponible de ${plataformaBuscada} en Supabase.`);
                        return;
                    }

                    let msgCliente = `🎉 *¡Tus datos de acceso de NEXXUS!* 🎉\n\n📺 *Plataforma:* ${cuentaData.plataforma}\n📧 *Correo:* ${cuentaData.correo}\n🔑 *Contraseña:* ${cuentaData.password}`;
                    if (cuentaData.perfil) msgCliente += `\n👤 *Perfil:* ${cuentaData.perfil}`;
                    if (cuentaData.pin) msgCliente += `\n🔢 *PIN:* ${cuentaData.pin}`;
                    msgCliente += `\n\n⚠️ *Importante:* No modifiques los datos. ¡Gracias por elegirnos! - NEXXUS`;

                    await supabase.from('CUENTAS').update({ estado: 'ocupado', cliente_id: targetPhone }).eq('id', cuentaData.id);
                    await sendWhatsAppMessage(targetPhone, msgCliente);
                    await sendWhatsAppMessage(from, `✅ Cuenta de ${cuentaData.plataforma} entregada desde Supabase a +${targetPhone}`);
                    return;
                }
            }

            if (lowerCmd.startsWith('!agregar ')) {
                const partes = rawMsg.replace('!agregar', '').trim().split('|');
                if (partes.length >= 4) {
                    const tel = cleanNumber(partes[0]);
                    const nom = partes[1].trim();
                    const serv = partes[2].trim();
                    const fec = partes[3].trim();

                    await supabase.from('CLIENTES').upsert({ telefono: tel, nombre: nom }, { onConflict: 'telefono' });
                    await supabase.from('CUENTAS').insert([{ cliente_id: tel, plataforma: serv, fecha_vencimiento: fec, estado: 'ocupado' }]);
                    await sendWhatsAppMessage(from, `✅ Cliente cargado en Supabase:\n👤 ${nom}\n📱 +${tel}\n📦 ${serv}\n📅 Vence: ${fec}`);
                }
                return;
            }

            if (lowerCmd.startsWith('!historial ')) {
                const num = cleanNumber(rawMsg.split(' ')[1]);
                const { data: logs } = await supabase.from('messages').select('*').eq('phone', num).order('created_at', { ascending: false }).limit(10);
                const txt = logs?.length ? `📜 *Historial +${num}:*\n` + logs.reverse().map(m => `• *${m.role}:* ${m.content}`).join('\n') : `Sin datos para +${num}`;
                await sendWhatsAppMessage(from, txt);
                return;
            }

            if (lowerCmd.startsWith('!resp ')) {
                const parts = rawMsg.split(' ');
                const targetPhone = cleanNumber(parts[1]);
                const textToSend = parts.slice(2).join(' ');
                await sendWhatsAppMessage(targetPhone, textToSend);
                await sendWhatsAppMessage(from, `✅ Mensaje enviado a +${targetPhone}`);
                return;
            }

            if (rawMsg === 'PAUSA TODOS') { pausedChats['TODOS'] = true; await sendWhatsAppMessage(from, 'Bot pausado para TODOS.'); return; }
            if (rawMsg === 'ACTIVAR TODOS') { pausedChats['TODOS'] = false; await sendWhatsAppMessage(from, 'Bot reactivado para TODOS.'); return; }
            if (rawMsg.startsWith('PAUSA ')) { const p = cleanNumber(rawMsg.split(' ')[1]); pausedChats[p] = true; await sendWhatsAppMessage(from, `Pausado para +${p}`); return; }
            if (rawMsg.startsWith('ACTIVAR ')) { const p = cleanNumber(rawMsg.split(' ')[1]); pausedChats[p] = false; await sendWhatsAppMessage(from, `Activado para +${p}`); return; }
            if (rawMsg.startsWith('PROMO ACTIVA ')) { promoActiva = rawMsg.replace('PROMO ACTIVA ', ''); await sendWhatsAppMessage(from, 'Promo global activada.'); return; }
            if (rawMsg === 'PROMO OFF') { promoActiva = null; await sendWhatsAppMessage(from, 'Promo global desactivada.'); return; }
        }

        if (pausedChats['TODOS'] || pausedChats[from]) return;

        // MANEJO DE IMÁGENES
        if (type === 'image') {
            const mediaId = message.image.id;
            const caption = message.image.caption || '';
            const ownerClean = cleanNumber(OWNER_PHONE);
            
            if (ownerClean) {
                await axios.post(
                    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
                    { messaging_product: 'whatsapp', to: ownerClean, type: 'image', image: { id: mediaId, caption: `📷 *Comprobante/Imagen recibida*\n👤 *Cliente:* ${pushName}\n📞 *Teléfono:* +${from}\n💬 *Nota:* ${caption}` } },
                    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
                );
            }
            
            await supabase.from('messages').insert([{ phone: from, role: 'user', content: '[Envío de Imagen/Comprobante]' }]);
            await sendWhatsAppMessage(from, "📲 Recibí tu imagen correctamente. Ryan la está revisando ahora mismo. \n\nSi es por un problema técnico y aún no me pasaste los datos, ¿me confirmás tu correo, clave y el perfil con el que tenés el inconveniente para agilizar la solución?");
            return;
        }

        // RECHAZO DE AUDIOS
        if (type === 'audio') {
            await sendWhatsAppMessage(from, "Hola! Por ahora solo puedo procesar mensajes de texto. ¿Podrías escribirme tu consulta? 😊");
            return;
        }

        // ATENCIÓN CON CLAUDE
        if (type === 'text') {
            const lowerUserText = textMessage.toLowerCase();

            const promoKeywords = ['promo', 'promocion', 'promoción', 'descuento', 'oferta'];
            if (promoKeywords.some(k => lowerUserText.includes(k)) && !promoActiva) {
                await notifyOwner(from, `CONSULTA DE PROMO: El cliente +${from} está preguntando por promociones.`);
            }

            const palabrasCriticas = ['codigo', 'código', 'hogar', 'viaje', 'comprobante', 'pago', 'error', 'asesor', 'humano', 'no me deja'];
            if (palabrasCriticas.some(p => lowerUserText.includes(p))) {
                await notifyOwner(from, `Mensaje crítico: "${textMessage}"`);
            }

            await supabase.from('messages').insert([{ phone: from, role: 'user', content: textMessage }]);

            const { data: cliente } = await supabase.from('CLIENTES').select('*, CUENTAS(*)').eq('telefono', from).single();
            
            let contextoBD = '';
            if (cliente) {
                contextoBD = `\n\n[INFO INTERNA - YA ES CLIENTE]: Se llama ${cliente.nombre}. `;
                if (cliente.CUENTAS && cliente.CUENTAS.length > 0) {
                    const svc = cliente.CUENTAS[0];
                    const faltanDias = Math.ceil((new Date(svc.fecha_vencimiento) - new Date()) / (1000 * 60 * 60 * 24));
                    contextoBD += `Tiene ${svc.plataforma}. Vence el ${svc.fecha_vencimiento} (Faltan ${faltanDias} días). `;
                    
                    if (faltanDias <= 5 && faltanDias >= 0) {
                        contextoBD += `[INSTRUCCIÓN OBLIGATORIA: Como el servicio vence en ${faltanDias} días, recuérdale con mucha amabilidad antes de despedirte que puede ir renovando al alias RYAN.MB para evitar cortes de servicio].`;
                    }
                }
            } else {
                contextoBD = `\n\n[INFO INTERNA]: Este usuario NO ESTÁ en la base de datos. Trátalo como CLIENTE NUEVO. Ofrécele catálogo, no pidas datos de acceso porque no tiene.`;
            }

            const promoContext = promoActiva 
                ? `\n\n[PROMO ACTIVA AHORA]: "${promoActiva}". Menciónala.` 
                : `\n\n[PROMO ACTIVA]: NO hay promociones activas en este momento. Si el cliente pregunta por promos, dile amablemente que no hay promos vigentes pero que los precios son súper accesibles. NO vuelvas a enviarle el catálogo completo si ya se lo diste.`;

            const { data: history } = await supabase.from('messages').select('*').eq('phone', from).order('created_at', { ascending: false }).limit(8);
            const messagesFormatted = (history || []).reverse().map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
            
            messagesFormatted.push({ role: 'user', content: textMessage });

            const response = await client.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 500,
                system: SYSTEM_PROMPT + contextoBD + promoContext,
                messages: messagesFormatted
            });

            const botReply = response.content[0].text;
            
            await supabase.from('messages').insert([{ phone: from, role: 'assistant', content: botReply }]);
            await sendWhatsAppMessage(from, botReply);
        }

    } catch (e) {
        console.error('Error en Webhook:', e.message);
    }
});

app.listen(PORT, () => console.log(`🚀 NEXXUS ALICE corriendo en puerto ${PORT}`));
