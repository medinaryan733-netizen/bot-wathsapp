const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

// ==========================================
// CONFIGURACIÓN DE ENTORNO Y CREDENCIALES
// ==========================================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'NEXXUS_ALICE_SECRET';
const OWNER_PHONE = process.env.OWNER_PHONE || '';

const ADMIN_USER = 'Ryan98730';
const ADMIN_PASS = 'Sol12345';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
// WHATSAPP HELPER & CRON
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

async function fetchFullClientes() {
    const { data: clientes, error: errCli } = await supabase.from('CLIENTES').select('*, CUENTAS(*), SERVICIOS(*)').order('id', { ascending: true });
    if (errCli) return [];

    return (clientes || []).map(c => {
        const ctas = c.CUENTAS || [];
        const cuentaObj = ctas.length > 0 ? ctas[ctas.length - 1] : {};

        const svcs = c.SERVICIOS || [];
        const servicioObj = svcs.length > 0 ? svcs[svcs.length - 1] : {};

        const plataforma = cuentaObj.plataforma || servicioObj.servicio_id || '';
        const correo = cuentaObj.correo || servicioObj.usuario || '';
        const clave = cuentaObj.clave || servicioObj.clave || '';
        const perfil = cuentaObj.perfil || servicioObj.perfil || '';
        const pin = cuentaObj.pin || '';
        const fecha_vencimiento = cuentaObj.fecha_vencimiento || servicioObj.fecha_vencimiento || '';

        return {
            id: c.id,
            nombre: c.nombre || '',
            telefono: c.telefono || '',
            chances: c.chances || 0,
            cuenta: {
                id: cuentaObj.id || null,
                servicio_id: servicioObj.id || null,
                plataforma,
                correo,
                clave,
                perfil,
                pin,
                fecha_vencimiento
            }
        };
    });
}

// ==========================================
// ENDPOINTS DE LA API DEL PANEL WEB
// ==========================================
app.post('/api/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }
});

app.get('/api/dashboard-data', async (req, res) => {
    try {
        const fullClientes = await fetchFullClientes();
        const { data: cuentas } = await supabase.from('CUENTAS').select('*');
        
        const totalClientes = fullClientes.length;
        const stockDisponible = cuentas?.filter(c => String(c.estado).toLowerCase() === 'disponible').length || 0;
        const cuentasOcupadas = fullClientes.filter(c => c.cuenta.plataforma !== '').length;
        
        const hoy = new Date();
        const proxsVencimientos = fullClientes.filter(c => {
            if (!c.cuenta.fecha_vencimiento) return false;
            const diffDays = Math.ceil((new Date(c.cuenta.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24));
            return diffDays >= 0 && diffDays <= 3;
        }).length;

        res.json({
            totalClientes,
            stockDisponible,
            cuentasOcupadas,
            vencimientosProximos: proxsVencimientos,
            botPausado: !!pausedChats['TODOS'],
            promoActiva: promoActiva || 'Ninguna',
            clientes: fullClientes,
            stockCuentas: cuentas || []
        });
    } catch(e) {
        console.error('Error en /api/dashboard-data:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/guardar-cliente', async (req, res) => {
    const { telefono, nombre, plataforma, fecha_vencimiento, correo, clave, password, perfil, pin, chances } = req.body;
    const telClean = cleanNumber(telefono);
    const passValue = clave || password || '';
    const dateClean = (fecha_vencimiento && String(fecha_vencimiento).trim() !== '') ? fecha_vencimiento : null;
    const numChances = chances ? Number(chances) : 1;

    try {
        let clientId = null;
        const { data: existingCli } = await supabase.from('CLIENTES').select('id, chances').eq('telefono', telClean).maybeSingle();
        
        if (existingCli) {
            clientId = existingCli.id;
            await supabase.from('CLIENTES').update({ nombre, telefono: telClean, chances: (existingCli.chances || 0) + numChances }).eq('id', clientId);
        } else {
            const { data: newCli, error: errNew } = await supabase.from('CLIENTES').insert([{ nombre, telefono: telClean, chances: numChances }]).select().single();
            if (errNew) throw new Error('Error al crear cliente: ' + errNew.message);
            clientId = newCli.id;
        }

        const ctaData = {
            cliente_id: clientId,
            plataforma: plataforma || 'Sin asignación',
            correo: correo || '',
            clave: passValue,
            perfil: perfil || '',
            pin: pin || '',
            fecha_vencimiento: dateClean,
            estado: 'ocupado'
        };

        const { data: existingCtas } = await supabase.from('CUENTAS').select('id').eq('cliente_id', clientId);
        if (existingCtas && existingCtas.length > 0) {
            for (const cta of existingCtas) {
                await supabase.from('CUENTAS').update(ctaData).eq('id', cta.id);
            }
        } else {
            await supabase.from('CUENTAS').insert([ctaData]);
        }

        const svcData = {
            cliente_id: clientId,
            servicio_id: plataforma || 'Sin asignación',
            usuario: correo || '',
            clave: passValue,
            perfil: perfil || '',
            fecha_vencimiento: dateClean,
            estado: 'ACTIVO'
        };

        const { data: existingSvcs } = await supabase.from('SERVICIOS').select('id').eq('cliente_id', clientId);
        if (existingSvcs && existingSvcs.length > 0) {
            for (const svc of existingSvcs) {
                await supabase.from('SERVICIOS').update(svcData).eq('id', svc.id);
            }
        } else {
            await supabase.from('SERVICIOS').insert([svcData]);
        }

        res.json({ success: true });
    } catch(e) {
        console.error('Error en /api/guardar-cliente:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/editar-cliente-completo', async (req, res) => {
    const { clientId, nuevoTel, nombre, plataforma, correo, clave, password, perfil, pin, fecha_vencimiento, chances } = req.body;
    try {
        const idNum = Number(clientId);
        const telClean = cleanNumber(nuevoTel);
        const passValue = clave || password || '';
        const dateClean = (fecha_vencimiento && String(fecha_vencimiento).trim() !== '') ? fecha_vencimiento : null;
        const numChances = Number(chances || 0);

        await supabase.from('CLIENTES').update({ nombre, telefono: telClean, chances: numChances }).eq('id', idNum);

        const ctaData = {
            cliente_id: idNum,
            plataforma: plataforma || 'Sin asignación',
            correo: correo || '',
            clave: passValue,
            perfil: perfil || '',
            pin: pin || '',
            fecha_vencimiento: dateClean,
            estado: 'ocupado'
        };

        const { data: existingCtas } = await supabase.from('CUENTAS').select('id').eq('cliente_id', idNum);
        if (existingCtas && existingCtas.length > 0) {
            for (const cta of existingCtas) {
                await supabase.from('CUENTAS').update(ctaData).eq('id', cta.id);
            }
        } else {
            await supabase.from('CUENTAS').insert([ctaData]);
        }

        const svcData = {
            cliente_id: idNum,
            servicio_id: plataforma || 'Sin asignación',
            usuario: correo || '',
            clave: passValue,
            perfil: perfil || '',
            fecha_vencimiento: dateClean,
            estado: 'ACTIVO'
        };

        const { data: existingSvcs } = await supabase.from('SERVICIOS').select('id').eq('cliente_id', idNum);
        if (existingSvcs && existingSvcs.length > 0) {
            for (const svc of existingSvcs) {
                await supabase.from('SERVICIOS').update(svcData).eq('id', svc.id);
            }
        } else {
            await supabase.from('SERVICIOS').insert([svcData]);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Error en /api/editar-cliente-completo:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/enviar-mensaje-cliente', async (req, res) => {
    const { telefono, mensaje } = req.body;
    try {
        const telClean = cleanNumber(telefono);
        await sendWhatsAppMessage(telClean, mensaje);
        await supabase.from('messages').insert([{ phone: telClean, role: 'assistant', content: mensaje }]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/chat-bot', async (req, res) => {
    const { mensaje, historial } = req.body;
    try {
        const fullClientes = await fetchFullClientes();
        const { data: cuentasStock } = await supabase.from('CUENTAS').select('*');
        
        // Historial reciente de la tabla messages
        const { data: ultimosMensajes } = await supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(30);

                const listaClientes = fullClientes.map(c => 
            `• ${c.nombre} (+${c.telefono}) | Servicio: ${c.cuenta.plataforma || 'Sin asignación'} | Correo: ${c.cuenta.correo || '-'} | PIN: ${c.cuenta.pin || '-'} | Chances: ${c.chances}`
        ).join('\n') || 'No hay clientes registrados.';

        const stockDisp = (cuentasStock || []).filter(s => String(s.estado || '').toLowerCase().trim() === 'disponible');
        const listaStock = stockDisp.map(s => 
            `• ${s.plataforma} | Correo: ${s.correo} | Clave: ${s.clave || '-'} | Perfil: ${s.perfil || '-'} | PIN: ${s.pin || '-'}`
        ).join('\n') || 'No hay stock disponible actualmente.';

        const historialConversacion = (ultimosMensajes || []).reverse().map(m => 
            `[Tel: ${m.phone} | Rol: ${m.role}]: ${m.content}`
        ).join('\n') || 'No hay mensajes recientes en la base de datos.';

        let accionRealizada = '';

        // Detectar si Ryan quiere guardar una cuenta múltiple con formato:
        // !nuevostock plataforma | correo | clave | perfil1,pin1 | perfil2,pin2 | perfil3,pin3 ...
        if (mensaje.startsWith('!nuevostock ')) {
            const partes = mensaje.replace('!nuevostock ', '').split('|').map(p => p.trim());
            const plataforma = partes[0];
            const correo = partes[1];
            const clave = partes[2];
            const perfilesData = partes.slice(3); // Todo lo que sigue son los perfiles con sus pines

            if (plataforma && correo && perfilesData.length > 0) {
                const registrosAInsertar = [];

                for (let item of perfilesData) {
                    const subPartes = item.split(',').map(s => s.trim());
                    const perfil = subPartes[0] || '';
                    const pin = subPartes[1] || '';

                    registrosAInsertar.push({
                        plataforma: plataforma,
                        correo: correo,
                        clave: clave || '',
                        perfil: perfil,
                        pin: pin,
                        estado: 'disponible'
                    });
                }

                const { error: insertError } = await supabase.from('CUENTAS').insert(registrosAInsertar);

                if (!insertError) {
                    accionRealizada = \n\n[ACCIÓN EJECUTADA]: Cuenta de ${plataforma} (${correo}) cargada exitosamente con ${registrosAInsertar.length} perfiles en la base de datos.;
                } else {
                    accionRealizada = \n\n[ERROR AL GUARDAR]: No se pudieron guardar los perfiles: ${insertError.message};
                }
            } else {
                accionRealizada = \n\n[ERROR]: Faltan datos obligatorios o el formato no es correcto. Usá: !nuevostock Plataforma | Correo | Clave | Perfil1,Pin1 | Perfil2,Pin2;
            }
        }
        const messagesFormatted = (historial || []).map(m => ({ role: m.role, content: m.content }));
        messagesFormatted.push({ role: 'user', content: mensaje });

        const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 600,
            system: SYSTEM_PROMPT + `\n\n[INFO INTERNA DEL PANEL WEB]: Estás conversando con RYAN (tu dueño).\n\n1. CLIENTES CARGADOS:\n${listaClientes}\n\n2. STOCK DISPONIBLE:\n${listaStock}\n\n3.
HISTORIAL RECIENTE DE MENSAJES:\n${historialConversacion}${accionRealizada}\n\nSi Ryan quiere cargar cuentas enteras con varios perfiles, recordale que use el comando: '!nuevostock Plataforma | Correo | Clave | Perfil 1,PIN | Perfil 2,PIN'.`,
            messages: messagesFormatted
        });

        res.json({ success: true, reply: response.content[0].text });
    } catch (e) {
        console.error('Error en /api/chat-bot:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/agregar-stock', async (req, res) => {
    const { plataforma, correo, clave, password, perfil, pin } = req.body;
    const passValue = clave || password || '';
    await supabase.from('CUENTAS').insert([{
        plataforma: plataforma || 'General',
        correo,
        clave: passValue,
        perfil: perfil || '',
        pin: pin || '',
        estado: 'disponible'
    }]);
    res.json({ success: true });
});

app.post('/api/eliminar-cliente', async (req, res) => {
    const { clientId } = req.body;
    try {
        const idNum = Number(clientId);
        await supabase.from('CUENTAS').delete().eq('cliente_id', idNum);
        await supabase.from('SERVICIOS').delete().eq('cliente_id', idNum);
        await supabase.from('CLIENTES').delete().eq('id', idNum);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/control-bot', async (req, res) => {
    const { accion, valor } = req.body;
    if (accion === 'pausa_global') pausedChats['TODOS'] = valor;
    if (accion === 'promo') promoActiva = valor ? valor : null;
    res.json({ success: true });
});

// ==========================================
// INTERFAZ GRÁFICA DEL PANEL WEB
// ==========================================
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Panel NEXXUS - Control ALICE</title>
        <style>
            :root { --bg: #0f172a; --card: #1e293b; --accent: #10b981; --text: #f8fafc; --muted: #94a3b8; --border: #334155; }
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
            body { background: var(--bg); color: var(--text); padding: 20px; min-height: 100vh; }
            
            #loginScreen { max-width: 400px; margin: 80px auto; background: var(--card); padding: 30px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            #loginScreen h2 { margin-bottom: 20px; text-align: center; color: var(--accent); }

            #dashboardContainer { max-width: 1200px; margin: 0 auto; display: none; }
            header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }

            .tabs { display: flex; gap: 10px; margin-bottom: 20px; overflow-x: auto; }
            .tab-btn { background: var(--card); color: var(--muted); border: 1px solid var(--border); padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.2s; white-space: nowrap; }
            .tab-btn.active, .tab-btn:hover { background: var(--accent); color: #000; border-color: var(--accent); }

            .tab-content { display: none; background: var(--card); padding: 25px; border-radius: 12px; border: 1px solid var(--border); }
            .tab-content.active { display: block; }

            .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
            .metric-card { background: #0f172a; padding: 20px; border-radius: 8px; border: 1px solid var(--border); text-align: center; }
            .metric-card h3 { font-size: 2rem; color: var(--accent); margin-bottom: 5px; }
            .metric-card p { color: var(--muted); font-size: 0.9rem; }

            input, select, textarea, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 6px; border: 1px solid var(--border); background: #0f172a; color: var(--text); font-size: 0.95rem; }
            button.btn-primary { background: var(--accent); color: #000; font-weight: bold; border: none; cursor: pointer; transition: 0.2s; }
            button.btn-primary:hover { opacity: 0.9; }
            button.btn-danger { background: #ef4444; color: #fff; border: none; cursor: pointer; padding: 6px 12px; width: auto; border-radius: 4px; }
            button.btn-edit { background: #3b82f6; color: #fff; border: none; cursor: pointer; padding: 6px 12px; width: auto; border-radius: 4px; margin-right: 5px; }
            button.btn-msg { background: #8b5cf6; color: #fff; border: none; cursor: pointer; padding: 6px 12px; width: auto; border-radius: 4px; margin-right: 5px; }

            table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 25px; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
            th { background: #0f172a; color: var(--accent); }
            h4.stock-section-title { color: var(--accent); margin-top: 20px; margin-bottom: 5px; border-left: 4px solid var(--accent); padding-left: 10px; }

            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 100; justify-content: center; align-items: center; }
            .modal-box { background: var(--card); padding: 25px; border-radius: 12px; max-width: 500px; width: 90%; border: 1px solid var(--border); }

            .chat-container { display: flex; flex-direction: column; height: 400px; background: #0f172a; border-radius: 8px; border: 1px solid var(--border); padding: 15px; }
            .chat-messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
            .chat-msg { max-width: 80%; padding: 10px 14px; border-radius: 8px; font-size: 0.95rem; }
            .chat-msg.user { align-self: flex-end; background: var(--accent); color: #000; font-weight: 500; }
            .chat-msg.bot { align-self: flex-start; background: #334155; color: #fff; }
            .chat-input-row { display: flex; gap: 10px; }
            .chat-input-row input { flex: 1; margin: 0; }
            .chat-input-row button { width: auto; margin: 0; padding: 0 20px; }
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

        <!-- DASHBOARD CONTAINER -->
        <div id="dashboardContainer">
            <header>
                <h2>⚡ NEXXUS Control Panel</h2>
                <button onclick="logout()" style="width:auto; background:#ef4444; color:#fff; border:none; padding:8px 15px; cursor:pointer; border-radius:6px;">Cerrar Sesión</button>
            </header>

            <div class="tabs">
                <button class="tab-btn active" onclick="switchTab('tabResumen')">1. 📊 Resumen</button>
                <button class="tab-btn" onclick="switchTab('tabClientes')">2. 👥 Clientes</button>
                <button class="tab-btn" onclick="switchTab('tabStock')">3. 📦 Stock / Cuentas</button>
                <button class="tab-btn" onclick="switchTab('tabBot')">4. 🤖 Chat & Control Bot</button>
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
                            <th>Correo / Clave / Perfil / PIN</th>
                            <th>Chances 🎟️</th>
                            <th>Vencimiento</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="tblClientes"></tbody>
                </table>
            </div>

            <!-- TAB 3: STOCK CUENTAS SEPARADO POR SERVICIOS -->
            <div id="tabStock" class="tab-content">
                <h3>Cargar Nueva Cuenta al Stock Disponible</h3>
                <form id="formCargarStock" style="margin-bottom:25px;">
                    <input type="text" id="stkPlataforma" placeholder="Plataforma (Ej: Netflix, Disney+, Max)" required>
                    <input type="text" id="stkCorreo" placeholder="Correo electrónico" required>
                    <input type="text" id="stkPass" placeholder="Contraseña / Clave" required>
                    <input type="text" id="stkPerfil" placeholder="Perfil (Opcional)">
                    <input type="text" id="stkPin" placeholder="PIN (Opcional)">
                    <button type="submit" class="btn-primary">Guardar en Stock</button>
                </form>

                <h3 style="margin-top:20px;">📦 Inventario Organizado por Servicios</h3>
                <div id="contenedorStockPorServicio"></div>
            </div>

            <!-- TAB 4: CHAT DIRECTO CON ALICE & CONTROL BOT -->
            <div id="tabBot" class="tab-content">
                <h3>💬 Hablar Directamente con ALICE</h3>
                <p style="color:var(--muted); font-size:0.85rem; margin-bottom:10px;">Podés consultarle dudas o pedirle información sobre tus clientes y chances de sorteo.</p>
                <div class="chat-container">
                    <div class="chat-messages" id="chatMessages">
                        <div class="chat-msg bot">¡Hola Ryan! ¿En qué te ayudo hoy? Conozco tus clientes y stock. 😊</div>
                    </div>
                    <div class="chat-input-row">
                        <input type="text" id="chatInputText" placeholder="Escribí un mensaje para ALICE..." onkeydown="if(event.key==='Enter') sendWebChat()">
                        <button onclick="sendWebChat()" class="btn-primary">Enviar</button>
                    </div>
                </div>

                <hr style="border-color:var(--border); margin:25px 0;">

                <h3>⚙️ Ajustes del Bot</h3>
                <br>
                <p><strong>Estado del Bot:</strong> <span id="lblBotPausa">Activo</span></p>
                <button onclick="togglePausaBot()" class="btn-primary" style="max-width:250px; margin-top:10px;">Cambiar Estado Bot</button>
                <br><br>
                <h3>Promoción Global Activa</h3>
                <input type="text" id="txtPromoGlobal" placeholder="Texto de la promo (Ej: 2x1 este finde en Disney+)">
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
                    <input type="number" id="addChances" placeholder="Chances para el sorteo (Por defecto: 1)" value="1">
                    <button type="submit" class="btn-primary">Registrar Cliente en Supabase</button>
                </form>
            </div>

        </div>

        <!-- MODAL EDITAR COMPLETO -->
        <div id="editModal" class="modal">
            <div class="modal-box">
                <h3>✏️ Editar Datos del Cliente</h3>
                <input type="hidden" id="editClientId">
                <label style="font-size:0.8rem; color:var(--muted);">Nombre del Cliente:</label>
                <input type="text" id="editNom" placeholder="Nombre">
                <label style="font-size:0.8rem; color:var(--muted);">Teléfono WhatsApp:</label>
                <input type="text" id="editTel" placeholder="Teléfono">
                <label style="font-size:0.8rem; color:var(--muted);">Servicio / Plataforma:</label>
                <input type="text" id="editPlat" placeholder="Plataforma">
                <label style="font-size:0.8rem; color:var(--muted);">Correo:</label>
                <input type="text" id="editMail" placeholder="Correo">
                <label style="font-size:0.8rem; color:var(--muted);">Contraseña / Clave:</label>
                <input type="text" id="editPass" placeholder="Contraseña">
                <label style="font-size:0.8rem; color:var(--muted);">Perfil y PIN:</label>
                <div style="display:flex; gap:10px;">
                    <input type="text" id="editPerfil" placeholder="Perfil">
                    <input type="text" id="editPin" placeholder="PIN">
                </div>
                <label style="font-size:0.8rem; color:var(--muted);">Chances para el Sorteo 🎟️:</label>
                <input type="number" id="editChances" placeholder="Chances">
                <label style="font-size:0.8rem; color:var(--muted);">Fecha de Vencimiento:</label>
                <input type="date" id="editVenc">
                <button id="btnSaveEdit" onclick="saveEditClienteCompleto()" class="btn-primary">Guardar Cambios</button>
                <button onclick="closeEditModal()" style="background:#ef4444; color:#fff; border:none; padding:12px; width:100%; border-radius:6px; cursor:pointer; margin-top:5px;">Cancelar</button>
            </div>
        </div>

        <!-- MODAL ENVIAR MENSAJE WHATSAPP -->
        <div id="msgModal" class="modal">
            <div class="modal-box">
                <h3>💬 Enviar WhatsApp al Cliente</h3>
                <p id="lblMsgDestinatario" style="color:var(--accent); font-weight:bold; margin-top:5px;"></p>
                <input type="hidden" id="msgTelTarget">
                <textarea id="txtMsgContent" rows="4" placeholder="Escribí tu mensaje acá..." style="resize:vertical;"></textarea>
                <button onclick="sendDirectWhatsApp()" class="btn-primary">Enviar por WhatsApp</button>
                <button onclick="closeMsgModal()" style="background:#ef4444; color:#fff; border:none; padding:12px; width:100%; border-radius:6px; cursor:pointer; margin-top:5px;">Cancelar</button>
            </div>
        </div>

        <script>
            let localClientes = [];
            let localCuentas = [];
            let botPausadoEstado = false;
            let webChatHistory = [];

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

            function switchTab(tabId) {
                document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
                event.target.classList.add('active');
            }

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
                renderStockPorServicios(localCuentas);
            }

            function renderClientesTable(lista) {
                const tbody = document.getElementById('tblClientes');
                tbody.innerHTML = '';
                lista.forEach((c, index) => {
                    const cuenta = c.cuenta || {};
                    const mailPass = (cuenta.correo || cuenta.clave) 
                        ? \`\${cuenta.correo || '-'} / \${cuenta.clave || '-'} / P:\${cuenta.perfil || '-'} (PIN:\${cuenta.pin || '-'})\` 
                        : 'Sin datos';
                    tbody.innerHTML += \`
                        <tr>
                            <td><strong>\${c.nombre}</strong></td>
                            <td>+\${c.telefono}</td>
                            <td>\${cuenta.plataforma || 'Sin servicio'}</td>
                            <td><small>\${mailPass}</small></td>
                            <td><strong>\${c.chances || 0} 🎟️</strong></td>
                            <td>\${cuenta.fecha_vencimiento || '-'}</td>
                            <td>
                                <button class="btn-edit" onclick="openEditModal(\${index})">✏️ Editar</button>
                                <button class="btn-msg" onclick="openMsgModal(\${index})">💬 Mensaje</button>
                                <button class="btn-danger" onclick="eliminarCliente(\${c.id})">🗑️</button>
                            </td>
                        </tr>
                    \`;
                });
            }

            // RENDERIZAR STOCK SEPARADO POR PLATAFORMAS
            function renderStockPorServicios(lista) {
                const contenedor = document.getElementById('contenedorStockPorServicio');
                contenedor.innerHTML = '';

                // Agrupar por plataforma
                const grupos = {};
                lista.forEach(s => {
                    const plat = (s.plataforma || 'General').trim();
                    if (!grupos[plat]) grupos[plat] = [];
                    grupos[plat].push(s);
                });

                if (Object.keys(grupos).length === 0) {
                    contenedor.innerHTML = '<p style="color:var(--muted); padding:10px;">No hay cuentas en el inventario.</p>';
                    return;
                }

                for (const [plat, cuentas] of Object.entries(grupos)) {
                    let rowsHtml = cuentas.map(s => \`
                        <tr>
                            <td>\${s.correo} / \${s.clave || '-'}</td>
                            <td>Perfil: \${s.perfil || '-'} / PIN: \${s.pin || '-'}</td>
                            <td>\${String(s.estado).toLowerCase() === 'disponible' ? '🟢 Disponible' : '🔴 Ocupado'}</td>
                            <td>\${s.cliente_id ? 'Asignado (ID: ' + s.cliente_id + ')' : 'Libre'}</td>
                        </tr>
                    \`).join('');

                    contenedor.innerHTML += \`
                        <h4 class="stock-section-title">📺 \${plat} (\${cuentas.length} cuentas)</h4>
                        <table>
                            <thead>
                                <tr>
                                    <th>Correo / Clave</th>
                                    <th>Perfil / PIN</th>
                                    <th>Estado</th>
                                    <th>Asignado a</th>
                                </tr>
                            </thead>
                            <tbody>\${rowsHtml}</tbody>
                        </table>
                    \`;
                }
            }

            function filterClientes() {
                const q = document.getElementById('searchClient').value.toLowerCase();
                const filtered = localClientes.filter(c => 
                    c.nombre.toLowerCase().includes(q) || 
                    c.telefono.includes(q) || 
                    (c.cuenta?.plataforma || '').toLowerCase().includes(q)
                );
                renderClientesTable(filtered);
            }

            function openEditModal(index) {
                const clientObj = localClientes[index];
                if (!clientObj) return;
                const cuenta = clientObj.cuenta || {};

                document.getElementById('editClientId').value = clientObj.id;
                document.getElementById('editNom').value = clientObj.nombre || '';
                document.getElementById('editTel').value = clientObj.telefono || '';
                document.getElementById('editPlat').value = cuenta.plataforma || '';
                document.getElementById('editMail').value = cuenta.correo || '';
                document.getElementById('editPass').value = cuenta.clave || '';
                document.getElementById('editPerfil').value = cuenta.perfil || '';
                document.getElementById('editPin').value = cuenta.pin || '';
                document.getElementById('editChances').value = clientObj.chances || 0;
                document.getElementById('editVenc').value = cuenta.fecha_vencimiento || '';
                
                document.getElementById('editModal').style.display = 'flex';
            }

            function closeEditModal() { document.getElementById('editModal').style.display = 'none'; }

            async function saveEditClienteCompleto() {
                const btn = document.getElementById('btnSaveEdit');
                btn.disabled = true;
                btn.textContent = 'Guardando...';

                const body = {
                    clientId: document.getElementById('editClientId').value,
                    nuevoTel: document.getElementById('editTel').value,
                    nombre: document.getElementById('editNom').value,
                    plataforma: document.getElementById('editPlat').value,
                    correo: document.getElementById('editMail').value,
                    clave: document.getElementById('editPass').value,
                    perfil: document.getElementById('editPerfil').value,
                    pin: document.getElementById('editPin').value,
                    chances: document.getElementById('editChances').value,
                    fecha_vencimiento: document.getElementById('editVenc').value
                };

                try {
                    const res = await fetch('/api/editar-cliente-completo', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(body)
                    });
                    const data = await res.json();

                    if (res.ok && data.success) {
                        closeEditModal();
                        alert('✅ Guardado correctamente en Supabase');
                        await loadDashboardData();
                    } else {
                        alert('❌ Error al guardar en Supabase: ' + (data.error || 'Verifica los campos'));
                    }
                } catch(e) {
                    alert('❌ Error de conexión: ' + e.message);
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Guardar Cambios';
                }
            }

            function openMsgModal(index) {
                const clientObj = localClientes[index];
                if (!clientObj) return;
                document.getElementById('msgTelTarget').value = clientObj.telefono;
                document.getElementById('lblMsgDestinatario').textContent = \`Para: \${clientObj.nombre} (+\${clientObj.telefono})\`;
                document.getElementById('txtMsgContent').value = '';
                document.getElementById('msgModal').style.display = 'flex';
            }

            function closeMsgModal() { document.getElementById('msgModal').style.display = 'none'; }

            async function sendDirectWhatsApp() {
                const tel = document.getElementById('msgTelTarget').value;
                const mensaje = document.getElementById('txtMsgContent').value;
                if (!mensaje.trim()) return alert('Escribe un mensaje');

                const res = await fetch('/api/enviar-mensaje-cliente', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ telefono: tel, mensaje })
                });

                if (res.ok) {
                    alert('✅ Mensaje enviado exitosamente');
                    closeMsgModal();
                } else {
                    alert('❌ Error al enviar el mensaje');
                }
            }

            async function sendWebChat() {
                const input = document.getElementById('chatInputText');
                const text = input.value.trim();
                if (!text) return;

                const chatBox = document.getElementById('chatMessages');
                chatBox.innerHTML += \`<div class="chat-msg user">\${text}</div>\`;
                input.value = '';
                chatBox.scrollTop = chatBox.scrollHeight;

                const res = await fetch('/api/chat-bot', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ mensaje: text, historial: webChatHistory })
                });

                const data = await res.json();
                if (data.success) {
                    webChatHistory.push({ role: 'user', content: text });
                    webChatHistory.push({ role: 'assistant', content: data.reply });
                    chatBox.innerHTML += \`<div class="chat-msg bot">\${data.reply}</div>\`;
                    chatBox.scrollTop = chatBox.scrollHeight;
                }
            }

            document.getElementById('formAddClient').addEventListener('submit', async (e) => {
                e.preventDefault();
                const body = {
                    telefono: document.getElementById('addTel').value,
                    nombre: document.getElementById('addNom').value,
                    plataforma: document.getElementById('addPlat').value,
                    fecha_vencimiento: document.getElementById('addVenc').value,
                    correo: document.getElementById('addMail').value,
                    clave: document.getElementById('addPass').value,
                    perfil: document.getElementById('addPerfil').value,
                    pin: document.getElementById('addPin').value,
                    chances: document.getElementById('addChances').value
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
                    clave: document.getElementById('stkPass').value,
                    perfil: document.getElementById('stkPerfil').value,
                    pin: document.getElementById('stkPin').value
                };
                await fetch('/api/agregar-stock', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
                alert('✅ Cuenta agregada al Stock');
                document.getElementById('formCargarStock').reset();
                loadDashboardData();
            });

            async function eliminarCliente(clientId) {
                if (confirm('¿Seguro que deseas eliminar este cliente?')) {
                    await fetch('/api/eliminar-cliente', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ clientId }) });
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

                if (restOfMessage.includes('\n') || restOfMessage.toLowerCase().includes('correo') || restOfMessage.toLowerCase().includes('contraseña') || restOfMessage.toLowerCase().includes('clave')) {
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
                        .maybeSingle();

                    if (!cuentaData) {
                        await sendWhatsAppMessage(from, `❌ No hay stock disponible de ${plataformaBuscada} en Supabase.`);
                        return;
                    }

                    let msgCliente = `🎉 *¡Tus datos de acceso de NEXXUS!* 🎉\n\n📺 *Plataforma:* ${cuentaData.plataforma}\n📧 *Correo:* ${cuentaData.correo}\n🔑 *Contraseña:* ${cuentaData.clave}`;
                    if (cuentaData.perfil) msgCliente += `\n👤 *Perfil:* ${cuentaData.perfil}`;
                    if (cuentaData.pin) msgCliente += `\n🔢 *PIN:* ${cuentaData.pin}`;
                    msgCliente += `\n\n⚠️ *Importante:* No modifiques los datos. ¡Gracias por elegirnos! - NEXXUS`;

                    const { data: clientObj } = await supabase.from('CLIENTES').select('id, chances').eq('telefono', targetPhone).maybeSingle();
                    if (clientObj) {
                        await supabase.from('CUENTAS').update({ estado: 'ocupado', cliente_id: clientObj.id }).eq('id', cuentaData.id);
                        await supabase.from('CLIENTES').update({ chances: (clientObj.chances || 0) + 1 }).eq('id', clientObj.id);
                    }
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

                    const { data: existingCli } = await supabase.from('CLIENTES').select('id, chances').eq('telefono', tel).maybeSingle();
                    let clientId = existingCli?.id;

                    if (clientId) {
                        await supabase.from('CLIENTES').update({ nombre: nom, chances: (existingCli.chances || 0) + 1 }).eq('id', clientId);
                    } else {
                        const { data: newCli } = await supabase.from('CLIENTES').insert([{ telefono: tel, nombre: nom, chances: 1 }]).select().single();
                        clientId = newCli?.id;
                    }

                    if (clientId) {
                        await supabase.from('CUENTAS').insert([{ cliente_id: clientId, plataforma: serv, fecha_vencimiento: fec, estado: 'ocupado' }]);
                        await supabase.from('SERVICIOS').insert([{ cliente_id: clientId, servicio_id: serv, fecha_vencimiento: fec, estado: 'ACTIVO' }]);
                    }
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

        if (type === 'audio') {
            await sendWhatsAppMessage(from, "Hola! Por ahora solo puedo procesar mensajes de texto. ¿Podrías escribirme tu consulta? 😊");
            return;
        }

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

            const { data: clienteList } = await supabase.from('CLIENTES').select('*, CUENTAS(*), SERVICIOS(*)');
            const cleanFrom = cleanNumber(from);
            const cliente = clienteList?.find(c => cleanNumber(c.telefono).endsWith(cleanFrom.slice(-8)) || cleanFrom.endsWith(cleanNumber(c.telefono).slice(-8)));
            
            let contextoBD = '';
            if (cliente) {
                contextoBD = `\n\n[INFO INTERNA - YA ES CLIENTE]: Se llama ${cliente.nombre}. `;
                const cuentaObj = cliente.CUENTAS?.[0] || cliente.SERVICIOS?.[0];
                if (cuentaObj) {
                    const fechaVenc = cuentaObj.fecha_vencimiento;
                    const plat = cuentaObj.plataforma || cuentaObj.servicio_id;
                    if (fechaVenc) {
                        const faltanDias = Math.ceil((new Date(fechaVenc) - new Date()) / (1000 * 60 * 60 * 24));
                        contextoBD += `Tiene ${plat}. Vence el ${fechaVenc} (Faltan ${faltanDias} días). `;
                        if (faltanDias <= 5 && faltanDias >= 0) {
                            contextoBD += `[INSTRUCCIÓN OBLIGATORIA: Como el servicio vence en ${faltanDias} días, recuérdale con mucha amabilidad antes de despedirte que puede ir renovando al alias RYAN.MB para evitar cortes de servicio].`;
                        }
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
