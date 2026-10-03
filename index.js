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
const SYSTEM_PROMPT = `Sos ALICE, la asistente virtual de NEXXUS, un negocio de entretenimiento digital. Respondés en español rioplatense, sos amable, profesional y resolutiva. Mensajes cortos y claros.

SERVICIOS Y PRECIOS:
- Netflix Perfil $9000/mes.
- Netflix perfil extra $14000/mes.
- Max $4500/mes.
- Prime Video $4000/mes.
- Disney+ $6000/mes.
- Crunchyroll $2800/mes.
- Reels Shorts $7500/mes.
- YouTube Premium $2800/mes.
- TV Digital pack futbol: 1) Cenit TV $7000/mes 2) TV Online Plus $10000/mes 3) Argentum $12000/mes 4) TV Sin Limites $14000/mes.

MEDIOS DE PAGO: Transferencia alias RYAN.MB (Braian Gaston Medina).

REGLAS DE ATENCIÓN ESTRICTAS:
- VENTAS Y PAGOS: Si el cliente envía un comprobante de pago o dice que pagó, pregúntale qué plataforma quiere (si no lo aclaró antes). Si ya sabes qué plataforma quiere, USA INMEDIATAMENTE la herramienta 'dar_cuenta' para entregarle el acceso. NO ESPERES A RYAN. Entrégale la cuenta en el momento.
- HERRAMIENTA DAR_CUENTA: Solo pásale la palabra clave principal a la herramienta (ej. "Netflix", "Max", "Disney"). La herramienta te devolverá los datos. DEBES ENVIARLE ESOS DATOS EXACTOS AL CLIENTE (Correo, Clave, Perfil y PIN).
- VERIFICACIÓN POST-VENTA: Después de darle la cuenta, dile textualmente: "Aquí tienes tu acceso. Ryan verificará el comprobante en breve, cualquier problema te avisamos."
- CONSULTAS DE PROMOS: Si no hay promo, dile que no hay pero los precios son los mejores. NO le envíes toda la lista de precios si ya la pasaste.
- PROBLEMAS TÉCNICOS: Pide correo y perfil afectado para que Ryan lo revise.
- HORARIO NOCTURNO: Si son pasadas las 00:00, aclara que Ryan ya debe estar descansando y resolverá problemas graves a primera hora.`;

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

        return {
            id: c.id,
            nombre: c.nombre || '',
            telefono: c.telefono || '',
            chances: c.chances || 0,
            cuenta: {
                id: cuentaObj.id || null,
                servicio_id: servicioObj.id || null,
                plataforma: cuentaObj.plataforma || servicioObj.servicio_id || '',
                correo: cuentaObj.correo || servicioObj.usuario || '',
                clave: cuentaObj.clave || servicioObj.clave || '',
                perfil: cuentaObj.perfil || servicioObj.perfil || '',
                pin: cuentaObj.pin || '',
                fecha_vencimiento: cuentaObj.fecha_vencimiento || servicioObj.fecha_vencimiento || ''
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
            totalClientes, stockDisponible, cuentasOcupadas, vencimientosProximos: proxsVencimientos,
            botPausado: !!pausedChats['TODOS'], promoActiva: promoActiva || 'Ninguna',
            clientes: fullClientes, stockCuentas: cuentas || []
        });
    } catch(e) {
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

        const ctaData = { cliente_id: clientId, plataforma: plataforma || 'Sin asignación', correo: correo || '', clave: passValue, perfil: perfil || '', pin: pin || '', fecha_vencimiento: dateClean, estado: 'ocupado' };
        const { data: existingCtas } = await supabase.from('CUENTAS').select('id').eq('cliente_id', clientId);
        if (existingCtas && existingCtas.length > 0) {
            for (const cta of existingCtas) await supabase.from('CUENTAS').update(ctaData).eq('id', cta.id);
        } else {
            await supabase.from('CUENTAS').insert([ctaData]);
        }

        const svcData = { cliente_id: clientId, servicio_id: plataforma || 'Sin asignación', usuario: correo || '', clave: passValue, perfil: perfil || '', fecha_vencimiento: dateClean, estado: 'ACTIVO' };
        const { data: existingSvcs } = await supabase.from('SERVICIOS').select('id').eq('cliente_id', clientId);
        if (existingSvcs && existingSvcs.length > 0) {
            for (const svc of existingSvcs) await supabase.from('SERVICIOS').update(svcData).eq('id', svc.id);
        } else {
            await supabase.from('SERVICIOS').insert([svcData]);
        }
        res.json({ success: true });
    } catch(e) {
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

        await supabase.from('CLIENTES').update({ nombre, telefono: telClean, chances: Number(chances || 0) }).eq('id', idNum);

        const ctaData = { cliente_id: idNum, plataforma: plataforma || 'Sin asignación', correo: correo || '', clave: passValue, perfil: perfil || '', pin: pin || '', fecha_vencimiento: dateClean, estado: 'ocupado' };
        const { data: existingCtas } = await supabase.from('CUENTAS').select('id').eq('cliente_id', idNum);
        if (existingCtas && existingCtas.length > 0) {
            for (const cta of existingCtas) await supabase.from('CUENTAS').update(ctaData).eq('id', cta.id);
        } else {
            await supabase.from('CUENTAS').insert([ctaData]);
        }

        const svcData = { cliente_id: idNum, servicio_id: plataforma || 'Sin asignación', usuario: correo || '', clave: passValue, perfil: perfil || '', fecha_vencimiento: dateClean, estado: 'ACTIVO' };
        const { data: existingSvcs } = await supabase.from('SERVICIOS').select('id').eq('cliente_id', idNum);
        if (existingSvcs && existingSvcs.length > 0) {
            for (const svc of existingSvcs) await supabase.from('SERVICIOS').update(svcData).eq('id', svc.id);
        } else {
            await supabase.from('SERVICIOS').insert([svcData]);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/enviar-mensaje-cliente', async (req, res) => {
    try {
        const telClean = cleanNumber(req.body.telefono);
        await sendWhatsAppMessage(telClean, req.body.mensaje);
        await supabase.from('messages').insert([{ phone: telClean, role: 'assistant', content: req.body.mensaje }]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// LOGICA CENTRAL DEL CHAT (PANEL WEB Y WHATSAPP)
app.post('/api/chat-bot', async (req, res) => {
    const { mensaje, historial, phone } = req.body; 
    const remitente = phone || 'PanelWeb'; 
    
    try {
        await supabase.from('messages').insert({ phone: remitente, role: 'user', content: mensaje });

        if (phone && phone !== 'PanelWeb') {
            const telefonoLimpio = String(phone).replace(/\D/g, '');
            const { data: clienteExistente } = await supabase.from('CLIENTES').select('*').eq('telefono', telefonoLimpio).single();
            if (!clienteExistente) {
                await supabase.from('CLIENTES').insert({ telefono: telefonoLimpio, nombre: `Cliente Ws (${telefonoLimpio.slice(-4)})`, chances: 0 });
            }
        }

        const fullClientes = await fetchFullClientes();
        const { data: cuentasStock } = await supabase.from('CUENTAS').select('*');
        const { data: ultimosMensajes } = await supabase.from('messages').select('*').eq('phone', remitente).order('created_at', { ascending: false }).limit(20);

        const listaClientes = fullClientes.map(c => `• ${c.nombre} (+${c.telefono}) | Servicio: ${c.cuenta.plataforma}`).join('\n') || 'Ninguno';
        const stockGeneral = cuentasStock?.map(s => `• ID: ${s.id} | ${s.plataforma} | Correo: ${s.correo} | Clave: ${s.clave} | Perfil: ${s.perfil} | PIN: ${s.pin} | Estado: ${s.estado}`).join('\n') || 'Vacío';
        
        const messagesFormatted = (historial && historial.length > 0) ? historial.map(m => ({ role: m.role, content: m.content })) : [];
        messagesFormatted.push({ role: 'user', content: mensaje });

        const tools = [
            { name: "guardar_cliente", description: "Registra un cliente manualmente.", input_schema: { type: "object", properties: { nombre: { type: "string" }, telefono: { type: "string" } }, required: ["nombre", "telefono"] } },
            { name: "dar_cuenta", description: "Busca stock y asinga cuenta. DEBES pasarle al cliente los datos devueltos.", input_schema: { type: "object", properties: { plataforma: { type: "string" }, telefono_cliente: { type: "string" } }, required: ["plataforma", "telefono_cliente"] } }
        ];

        let response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 900,
            tools: tools,
            system: SYSTEM_PROMPT + `\n\n[INFO INTERNA]\n1. CLIENTES:\n${listaClientes}\n\n2. TODAS LAS CUENTAS:\n${stockGeneral}`,
            messages: messagesFormatted
        });

        let replyText = "";

        if (response.stop_reason === "tool_use") {
            const toolUseBlock = response.content.find(block => block.type === "tool_use");
            if (toolUseBlock) {
                let toolResultContent = "";
                try {
                    if (toolUseBlock.name === "dar_cuenta") {
                        const { plataforma, telefono_cliente } = toolUseBlock.input;
                        const stockDisp = cuentasStock?.filter(s => String(s.estado || '').toLowerCase().trim() === 'disponible') || [];
                        
                        const platBuscada = plataforma.toLowerCase().trim().split(' ')[0];
                        const cuentaLibre = stockDisp.find(s => String(s.plataforma).toLowerCase().includes(platBuscada));

                        if (cuentaLibre) {
                            const { error } = await supabase.from('CUENTAS').update({ estado: 'ocupado', telefono: telefono_cliente }).eq('id', cuentaLibre.id);
                            notifyOwner(telefono_cliente, `🎉 ¡VENTA AUTOMÁTICA REALIZADA!\nALICE acaba de entregar una cuenta de ${cuentaLibre.plataforma}.\nPor favor, verificá la transferencia del cliente.`);
                            toolResultContent = !error 
                                ? `Cuenta asignada. DEBES DARLE ESTOS DATOS: Plataforma: ${cuentaLibre.plataforma} | Correo: ${cuentaLibre.correo} | Clave: ${cuentaLibre.clave || '-'} | Perfil: ${cuentaLibre.perfil || '-'} | PIN: ${cuentaLibre.pin || '-'}` 
                                : `Error DB: ${error.message}`;
                        } else {
                            toolResultContent = `No hay stock disponible de ${plataforma}.`;
                        }
                    }
                } catch (toolErr) { toolResultContent = `Error: ${toolErr.message}`; }

                messagesFormatted.push({ role: 'assistant', content: response.content });
                messagesFormatted.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: toolResultContent }] });

                const finalResponse = await client.messages.create({
                    model: 'claude-sonnet-4-6', max_tokens: 600, tools: tools,
                    system: SYSTEM_PROMPT, messages: messagesFormatted
                });
                replyText = finalResponse.content.find(block => block.type === 'text')?.text || 'Listo.';
            }
        } else {
            replyText = response.content.find(block => block.type === 'text')?.text || 'OK.';
        }

        await supabase.from('messages').insert({ phone: remitente, role: 'assistant', content: replyText });
        res.json({ success: true, reply: replyText });

    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// RUTAS PARA EL PANEL WEB (BOTONES FÍSICOS)
// ==========================================
app.delete('/api/clientes/:id', async (req, res) => { await supabase.from('CLIENTES').delete().eq('id', req.params.id); res.json({ success: true }); });
app.delete('/api/cuentas/:id', async (req, res) => { await supabase.from('CUENTAS').delete().eq('id', req.params.id); res.json({ success: true }); });
app.put('/api/cuentas/:id', async (req, res) => {
    try {
        const { plataforma, correo, clave, pin, perfil, estado, telefono } = req.body;
        let updateObj = {};
        if (plataforma !== undefined) updateObj.plataforma = plataforma;
        if (correo !== undefined) updateObj.correo = correo;
        if (clave !== undefined) updateObj.clave = clave;
        if (pin !== undefined) updateObj.pin = pin;
        if (perfil !== undefined) updateObj.perfil = perfil;
        if (estado !== undefined) updateObj.estado = estado;
        if (telefono !== undefined) updateObj.telefono = telefono;

        const { error } = await supabase.from('CUENTAS').update(updateObj).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Cuenta actualizada correctamente' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.get('/api/clientes', async (req, res) => { res.json(await fetchFullClientes()); });
app.post('/api/agregar-stock', async (req, res) => {
    const { plataforma, correo, clave, password, perfil, pin } = req.body;
    await supabase.from('CUENTAS').insert([{ plataforma: plataforma||'General', correo, clave: clave||password||'', perfil: perfil||'', pin: pin||'', estado: 'disponible' }]);
    res.json({ success: true });
});
app.post('/api/eliminar-cliente', async (req, res) => {
    const idNum = Number(req.body.clientId);
    await supabase.from('CUENTAS').delete().eq('cliente_id', idNum);
    await supabase.from('SERVICIOS').delete().eq('cliente_id', idNum);
    await supabase.from('CLIENTES').delete().eq('id', idNum);
    res.json({ success: true });
});
app.post('/api/control-bot', async (req, res) => {
    if (req.body.accion === 'pausa_global') pausedChats['TODOS'] = req.body.valor;
    if (req.body.accion === 'promo') promoActiva = req.body.valor ? req.body.valor : null;
    res.json({ success: true });
});

// ==========================================
// INTERFAZ GRÁFICA DEL PANEL WEB (COMPLETA)
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
            .modal-box { background: var(--card); padding: 25px; border-radius: 12px; max-width: 500px; width: 90%; border: 1px solid var(--border); overflow-y: auto; max-height: 90vh; }

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

        <div id="loginScreen">
            <h2>NEXXUS Panel</h2>
            <form id="formLogin">
                <input type="text" id="loginUser" placeholder="Usuario" required>
                <input type="password" id="loginPass" placeholder="Contraseña" required>
                <button type="submit" class="btn-primary">Ingresar al Sistema</button>
            </form>
        </div>

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

            <!-- TAB 3: STOCK -->
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

            <!-- TAB 4: BOT -->
            <div id="tabBot" class="tab-content">
                <h3>💬 Hablar Directamente con ALICE</h3>
                <div class="chat-container">
                    <div class="chat-messages" id="chatMessages">
                        <div class="chat-msg bot">¡Hola Ryan! ¿En qué te ayudo hoy? 😊</div>
                    </div>
                    <div class="chat-input-row">
                        <button onclick="limpiarChat()" style="background:#ef4444; color:white; border:none; border-radius:6px; cursor:pointer; width:auto; padding:0 15px;" title="Borrar memoria">🗑️</button>
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

            <!-- TAB 5: AGREGAR -->
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

        <!-- MODAL EDITAR CLIENTE (COMPLETO) -->
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

        <!-- MODAL ENVIAR MENSAJE -->
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
            let localClientes = [], localCuentas = [], botPausadoEstado = false, webChatHistory = [];

            document.getElementById('formLogin').addEventListener('submit', async (e) => {
                e.preventDefault();
                const user = document.getElementById('loginUser').value;
                const pass = document.getElementById('loginPass').value;
                try {
                    const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ user, pass }) });
                    if (res.ok) { sessionStorage.setItem('nexxus_auth', '1'); checkAuth(); } 
                    else { alert('❌ Credenciales incorrectas'); }
                } catch(error) { alert('❌ Error de conexión al servidor.'); }
            });

            function checkAuth() {
                if (sessionStorage.getItem('nexxus_auth') === '1') {
                    document.getElementById('loginScreen').style.display = 'none';
                    document.getElementById('dashboardContainer').style.display = 'block';
                    loadDashboardData();
                }
            }

            function logout() { sessionStorage.removeItem('nexxus_auth'); location.reload(); }

            function switchTab(tabId) {
                document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
                if (event) event.target.classList.add('active');
            }

            async function loadDashboardData() {
                try {
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
                } catch(e) { console.error("Error cargando dashboard:", e); }
            }

            // AQUI SE AGREGA EL ID AL LADO DEL NOMBRE PARA SABER QUIÉN ES QUIÉN
            function renderClientesTable(lista) {
                const tbody = document.getElementById('tblClientes');
                tbody.innerHTML = '';
                lista.forEach((c, index) => {
                    const cuenta = c.cuenta || {};
                    const mailPass = (cuenta.correo || cuenta.clave) 
                        ? cuenta.correo + " / " + (cuenta.clave || "-") + " / P:" + (cuenta.perfil || "-") + " (PIN:" + (cuenta.pin || "-") + ")" 
                        : 'Sin datos';
                    
                    tbody.innerHTML += "<tr>" +
                        "<td><strong>#" + c.id + " - " + c.nombre + "</strong></td>" +
                        "<td>+" + c.telefono + "</td>" +
                        "<td>" + (cuenta.plataforma || 'Sin servicio') + "</td>" +
                        "<td><small>" + mailPass + "</small></td>" +
                        "<td><strong>" + (c.chances || 0) + " 🎟️</strong></td>" +
                        "<td>" + (cuenta.fecha_vencimiento || '-') + "</td>" +
                        "<td>" +
                            "<button class='btn-edit' onclick='openEditModal(" + index + ")'>✏️ Editar</button>" +
                            "<button class='btn-msg' onclick='openMsgModal(" + index + ")'>💬 Mensaje</button>" +
                            "<button class='btn-danger' onclick='eliminarCliente(" + c.id + ")'>🗑️</button>" +
                        "</td>" +
                    "</tr>";
                });
            }

            // RESTAURAMOS EL DISEÑO HERMOSO (BARRAS VERDES Y ROJAS ACORDEON)
            function renderStockPorServicios(lista) {
                const contenedor = document.getElementById('contenedorStockPorServicio');
                contenedor.innerHTML = '';
                if (!lista || lista.length === 0) { contenedor.innerHTML = '<p style="color:var(--muted); padding:10px;">No hay cuentas.</p>'; return; }

                const plataformas = {};
                lista.forEach(s => {
                    const plat = (s.plataforma || 'General').trim();
                    if (!plataformas[plat]) plataformas[plat] = { libres: [], ocupadas: [] };
                    if (s.cliente_id || String(s.estado).toLowerCase() !== 'disponible') { plataformas[plat].ocupadas.push(s); } 
                    else { plataformas[plat].libres.push(s); }
                });

                function renderSubGrupo(cuentas, tipo) {
                    if (cuentas.length === 0) return '<p style="color:var(--muted); font-size:0.9rem; margin: 10px 0;">No hay perfiles ' + tipo + 's.</p>';
                    
                    const porCorreo = {};
                    cuentas.forEach(c => {
                        const mail = (c.correo || 'Sin correo').trim();
                        if (!porCorreo[mail]) porCorreo[mail] = [];
                        porCorreo[mail].push(c);
                    });

                    let html = '';
                    for (const [mail, listaCuentas] of Object.entries(porCorreo)) {
                        listaCuentas.sort((a, b) => {
                            const pA = String(a.perfil || ''); const pB = String(b.perfil || '');
                            return pA.localeCompare(pB, undefined, {numeric: true, sensitivity: 'base'});
                        });

                        const clave = listaCuentas[0].clave || '-';

                        html += '<div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 15px; overflow: hidden;">' +
                                    '<div style="background: #1e293b; padding: 10px 15px; font-weight: bold; font-size: 0.95rem; border-bottom: 1px solid var(--border);">' +
                                        '📧 <span style="color: var(--accent);">' + mail + '</span> <span style="color: var(--muted); font-size: 0.85rem; font-weight: normal; margin-left: 10px;">(Clave: ' + clave + ')</span>' +
                                    '</div>' +
                                    '<div style="padding: 0;">' +
                                        '<table style="margin: 0; width: 100%; border-collapse: collapse; font-size: 0.85rem; background: transparent;">' +
                                            '<thead><tr><th style="background: transparent; padding: 8px 15px;">Perfil</th><th style="background: transparent; padding: 8px 15px;">PIN</th>';
                        if (tipo === 'ocupada') { html += '<th style="background: transparent; padding: 8px 15px;">Asignado a ID</th>'; }
                        html += '<th style="background: transparent; padding: 8px 15px; text-align: right;">Acciones</th></tr></thead><tbody>';
                        
                        listaCuentas.forEach(s => {
                            const asig = s.cliente_id ? '<span style="color:#3b82f6; font-weight:bold;">#' + s.cliente_id + '</span>' : '-';
                            const id = s.id || '';
                            const safePlat = (s.plataforma || '').replace(/'/g, "\\'");
                            const safeCorr = (s.correo || '').replace(/'/g, "\\'");
                            const safeClave = (s.clave || '').replace(/'/g, "\\'");
                            const safePin = (s.pin || '').replace(/'/g, "\\'");
                            const safePerf = (s.perfil || '').replace(/'/g, "\\'");
                            
                            html += '<tr style="border-top: 1px solid #334155;">' +
                                        '<td style="padding: 8px 15px;"><strong>P: ' + safePerf + '</strong></td>' +
                                        '<td style="padding: 8px 15px;"><strong>' + safePin + '</strong></td>';
                            
                            if (tipo === 'ocupada') { html += '<td style="padding: 8px 15px;">' + asig + '</td>'; }
                            html += '<td style="padding: 8px 15px; text-align: right;">';
                            
                            if (tipo === 'libre') { html += '<button style="padding:5px 10px; font-size:0.8rem; margin-right:5px; background:#3b82f6; border:none; border-radius:4px; color:white; cursor:pointer;" onclick="abrirModalAsignar(\'' + id + '\')">👤 Asignar</button>'; }
                            
                            // NUEVO: EL BOTON EDITAR AHORA PASA TODOS LOS PARAMETROS (INCLUIDA PLATAFORMA Y CORREO)
                            html += '<button class="btn-edit" style="padding:5px 10px; font-size:0.8rem; margin-right:5px;" onclick="editarStockRapido(\'' + id + '\', \'' + safePlat + '\', \'' + safeCorr + '\', \'' + safeClave + '\', \'' + safePin + '\', \'' + safePerf + '\')">✏️ Editar</button>' +
                                    '<button class="btn-danger" style="padding:5px 10px; font-size:0.8rem;" onclick="eliminarStockRapido(\'' + id + '\')">🗑️</button>' +
                                        '</td></tr>';
                        });
                        html += '</tbody></table></div></div>';
                    }
                    return html;
                }

                for (const [plat, data] of Object.entries(plataformas)) {
                    const totalLibres = data.libres.length;
                    const totalOcupadas = data.ocupadas.length;
                    
                    let platHtml = '<div style="margin-bottom: 25px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: #0f172a;">' +
                        '<div style="background: #1e293b; padding: 15px; border-bottom: 1px solid var(--border);">' +
                            '<h3 style="color: var(--text); margin: 0; font-size: 1.2rem;">📺 ' + plat + ' <span style="font-size:0.85rem; color:var(--muted); font-weight:normal; float:right;">Total: ' + (totalLibres + totalOcupadas) + ' perfiles</span></h3>' +
                        '</div>' +
                        '<div style="padding: 15px;">' +
                            '<details style="margin-bottom: 15px; background: rgba(16, 185, 129, 0.05); border-radius: 6px; border: 1px solid #10b98140;" open>' +
                                '<summary style="padding: 12px 15px; font-weight: bold; cursor: pointer; color: #10b981; list-style: none; display: flex; justify-content: space-between; align-items: center;">' +
                                    '<span style="font-size: 1rem;">🟢 Disponibles (' + totalLibres + ')</span><span style="font-size: 0.8rem; color: var(--muted);">Tocar para Ver/Ocultar 🔽</span>' +
                                '</summary>' +
                                '<div style="padding: 15px; border-top: 1px solid #10b98140;">' + renderSubGrupo(data.libres, 'libre') + '</div>' +
                            '</details>' +
                            '<details style="background: rgba(239, 68, 68, 0.05); border-radius: 6px; border: 1px solid #ef444440;">' +
                                '<summary style="padding: 12px 15px; font-weight: bold; cursor: pointer; color: #ef4444; list-style: none; display: flex; justify-content: space-between; align-items: center;">' +
                                    '<span style="font-size: 1rem;">🔴 Ocupados (' + totalOcupadas + ')</span><span style="font-size: 0.8rem; color: var(--muted);">Tocar para Ver/Ocultar 🔽</span>' +
                                '</summary>' +
                                '<div style="padding: 15px; border-top: 1px solid #ef444440;">' + renderSubGrupo(data.ocupadas, 'ocupada') + '</div>' +
                            '</details>' +
                        '</div></div>';
                    contenedor.innerHTML += platHtml;
                }
            }

            async function abrirModalAsignar(idCuenta) {
                try {
                    const res = await fetch('/api/clientes'); const clientes = await res.json();
                    const lista = Array.isArray(clientes) ? clientes : (clientes.data || []);
                    let opciones = '<option value="">-- Seleccionar un Cliente --</option>';
                    lista.forEach(c => { opciones += '<option value="' + c.id + '">#' + c.id + ' - ' + c.nombre + ' (' + (c.telefono || 'Sin número') + ')</option>'; });

                    const modal = document.createElement('div');
                    modal.id = 'modalAsignar';
                    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; justify-content:center; align-items:center; z-index:9999;';
                    modal.innerHTML = 
                        '<div style="background:#1e293b; padding:25px; border-radius:10px; border:1px solid #3b82f6; width:90%; max-width:400px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">' +
                            '<h3 style="color:white; margin-top:0; border-bottom:1px solid #334155; padding-bottom:10px;">👤 Asignar Cuenta</h3>' +
                            '<select id="selectClienteModal" style="width:100%; padding:10px; margin-bottom:20px; border-radius:5px; background:#0f172a; color:white; border:1px solid #475569; outline:none;">' + opciones + '</select>' +
                            '<div style="display:flex; justify-content:flex-end; gap:10px;">' +
                                '<button onclick="document.getElementById(\'modalAsignar\').remove()" style="background:#475569; padding:8px 15px; border:none; border-radius:5px; color:white; cursor:pointer;">Cancelar</button>' +
                                '<button onclick="confirmarAsignacion(\'' + idCuenta + '\')" style="background:#10b981; padding:8px 15px; border:none; border-radius:5px; color:white; cursor:pointer; font-weight:bold;">✅ Confirmar</button>' +
                            '</div></div>';
                    document.body.appendChild(modal);
                } catch (e) { alert('Error al cargar clientes.'); }
            }

            async function confirmarAsignacion(idCuenta) {
                const clienteId = document.getElementById('selectClienteModal').value;
                if (!clienteId) return alert('⚠️ Seleccioná un cliente.');
                try {
                    const res = await fetch('/api/asignar-cuenta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cuenta_id: idCuenta, cliente_id: clienteId }) });
                    const data = await res.json();
                    if (data.success) { document.getElementById('modalAsignar').remove(); alert('✅ ¡Asignada!'); location.reload(); } 
                    else { alert('Error: ' + data.error); }
                } catch(e) { alert('Error de conexión.'); }
            }

            async function eliminarStockRapido(id) {
                if(confirm("⚠️ ¿Seguro que deseas eliminar esta cuenta?")) {
                    try {
                        const res = await fetch('/api/cuentas/' + id, { method: 'DELETE' });
                        if ((await res.json()).success) { alert("✅ Eliminada."); loadDashboardData(); }
                    } catch(e) { alert("❌ Error: " + e.message); }
                }
            }

            // NUEVO: ESTE BOTON AHORA TE DEJA ARREGLAR LAS PLATAFORMAS Y LOS CORREOS SUELTOS
            async function editarStockRapido(id, pPlat, pCorr, pClave, pPin, pPerf) {
                const nPlat = prompt("Plataforma oficial (Ej: Disney+, Netflix, etc):", pPlat); if (nPlat === null) return; 
                const nCorr = prompt("Correo de la cuenta:", pCorr); if (nCorr === null) return;
                const nPerf = prompt("Perfil asignado:", pPerf); if (nPerf === null) return;
                const nClave = prompt("Contraseña / Clave:", pClave); if (nClave === null) return; 
                const nPin = prompt("PIN del perfil:", pPin); if (nPin === null) return;

                try {
                    const res = await fetch('/api/cuentas/' + id, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ plataforma: nPlat, correo: nCorr, perfil: nPerf, clave: nClave, pin: nPin })
                    });
                    if ((await res.json()).success) { alert("✅ ¡Cuenta actualizada y re-agrupada con éxito!"); loadDashboardData(); } 
                } catch(e) { alert("❌ Error: " + e.message); }
            }

            function filterClientes() {
                const q = document.getElementById('searchClient').value.toLowerCase();
                renderClientesTable(localClientes.filter(c => c.nombre.toLowerCase().includes(q) || c.telefono.includes(q) || (c.cuenta?.plataforma || '').toLowerCase().includes(q)));
            }

            function openEditModal(index) {
                const clientObj = localClientes[index]; if (!clientObj) return;
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
                const btn = document.getElementById('btnSaveEdit'); btn.disabled = true; btn.textContent = 'Guardando...';
                try {
                    const res = await fetch('/api/editar-cliente-completo', {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            clientId: document.getElementById('editClientId').value, nuevoTel: document.getElementById('editTel').value,
                            nombre: document.getElementById('editNom').value, plataforma: document.getElementById('editPlat').value,
                            correo: document.getElementById('editMail').value, clave: document.getElementById('editPass').value,
                            perfil: document.getElementById('editPerfil').value, pin: document.getElementById('editPin').value,
                            chances: document.getElementById('editChances').value, fecha_vencimiento: document.getElementById('editVenc').value
                        })
                    });
                    if (res.ok) { closeEditModal(); alert('✅ Guardado'); await loadDashboardData(); }
                } catch(e) { alert('❌ Error'); } finally { btn.disabled = false; btn.textContent = 'Guardar Cambios'; }
            }

            function openMsgModal(index) {
                const c = localClientes[index]; if (!c) return;
                document.getElementById('msgTelTarget').value = c.telefono;
                document.getElementById('lblMsgDestinatario').textContent = "Para: " + c.nombre + " (+" + c.telefono + ")";
                document.getElementById('txtMsgContent').value = '';
                document.getElementById('msgModal').style.display = 'flex';
            }

            function closeMsgModal() { document.getElementById('msgModal').style.display = 'none'; }

            async function sendDirectWhatsApp() {
                const tel = document.getElementById('msgTelTarget').value;
                const mensaje = document.getElementById('txtMsgContent').value;
                if (!mensaje.trim()) return alert('Escribe un mensaje');
                try {
                    const res = await fetch('/api/enviar-mensaje-cliente', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ telefono: tel, mensaje }) });
                    if (res.ok) { alert('✅ Mensaje enviado'); closeMsgModal(); }
                } catch(e) { alert('❌ Error'); }
            }

            async function sendWebChat() {
                const input = document.getElementById('chatInputText'); const text = input.value.trim(); if (!text) return;
                const chatBox = document.getElementById('chatMessages');
                chatBox.innerHTML += "<div class='chat-msg user'>" + text + "</div>"; input.value = ''; chatBox.scrollTop = chatBox.scrollHeight;
                webChatHistory.push({ role: 'user', content: text });
                try {
                    const res = await fetch('/api/chat-bot', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ mensaje: text, historial: webChatHistory }) });
                    const data = await res.json();
                    if (data.success) {
                        webChatHistory.push({ role: 'assistant', content: data.reply });
                        chatBox.innerHTML += "<div class='chat-msg bot'>" + data.reply + "</div>"; chatBox.scrollTop = chatBox.scrollHeight;
                    }
                } catch(e) { chatBox.innerHTML += "<div class='chat-msg bot'>❌ Error conectando con ALICE.</div>"; }
            }

            document.getElementById('formAddClient').addEventListener('submit', async (e) => {
                e.preventDefault();
                await fetch('/api/guardar-cliente', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
                    telefono: document.getElementById('addTel').value, nombre: document.getElementById('addNom').value,
                    plataforma: document.getElementById('addPlat').value, fecha_vencimiento: document.getElementById('addVenc').value,
                    correo: document.getElementById('addMail').value, clave: document.getElementById('addPass').value,
                    perfil: document.getElementById('addPerfil').value, pin: document.getElementById('addPin').value, chances: document.getElementById('addChances').value
                })});
                alert('✅ Cliente registrado'); document.getElementById('formAddClient').reset(); loadDashboardData();
            });

            document.getElementById('formCargarStock').addEventListener('submit', async (e) => {
                e.preventDefault();
                await fetch('/api/agregar-stock', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
                    plataforma: document.getElementById('stkPlataforma').value, correo: document.getElementById('stkCorreo').value,
                    clave: document.getElementById('stkPass').value, perfil: document.getElementById('stkPerfil').value, pin: document.getElementById('stkPin').value
                })});
                alert('✅ Cuenta agregada'); document.getElementById('formCargarStock').reset(); loadDashboardData();
            });

            async function eliminarCliente(clientId) { if (confirm('¿Seguro que deseas eliminar este cliente?')) { await fetch('/api/eliminar-cliente', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ clientId }) }); loadDashboardData(); } }
            async function togglePausaBot() { await fetch('/api/control-bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({accion:'pausa_global', valor: !botPausadoEstado}) }); loadDashboardData(); }
            async function guardarPromo() { await fetch('/api/control-bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({accion:'promo', valor: document.getElementById('txtPromoGlobal').value}) }); alert('✅ Promo activada'); }
            async function desactivarPromo() { await fetch('/api/control-bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({accion:'promo', valor: ''}) }); alert('✅ Promo apagada'); }

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
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) { res.status(200).send(req.query['hub.challenge']); } 
    else { res.sendStatus(403); }
});

app.post('/api/asignar-cuenta', async (req, res) => {
    const { cuenta_id, cliente_id } = req.body;
    await supabase.from('CUENTAS').update({ cliente_id: cliente_id, estado: 'Ocupado' }).eq('id', cuenta_id);
    res.json({ success: true });
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

        let textMessage = '';

        if (type === 'text') {
            textMessage = message.text.body;
        } 
        else if (type === 'image') {
            const mediaId = message.image.id;
            const caption = message.image.caption || '';
            const ownerClean = cleanNumber(OWNER_PHONE);
            
            if (ownerClean) {
                await axios.post(
                    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
                    { messaging_product: 'whatsapp', to: ownerClean, type: 'image', image: { id: mediaId, caption: `📷 *Comprobante de Pago*\n👤 *De:* ${pushName}\n📞 *Tel:* +${from}\n💬 *Nota:* ${caption}` } },
                    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
                );
            }
            
            textMessage = `[El cliente acaba de enviar una IMAGEN/COMPROBANTE DE PAGO. Si no ha especificado qué servicio quiere, pregúntaselo ahora. Si ya sabes qué servicio quiere, USA LA HERRAMIENTA 'dar_cuenta' INMEDIATAMENTE para entregarle el acceso sin esperar a Ryan.]`;
        } 
        else {
            return;
        }

        if (isOwner && type === 'text') {
            const rawMsg = textMessage.trim();
            const lowerCmd = rawMsg.toLowerCase();

            if (lowerCmd.startsWith('!agregar ')) {
                const partes = rawMsg.replace('!agregar', '').trim().split('|');
                if (partes.length >= 4) {
                    const tel = cleanNumber(partes[0]);
                    const { data: existingCli } = await supabase.from('CLIENTES').select('id').eq('telefono', tel).maybeSingle();
                    let clientId = existingCli?.id;
                    if (!clientId) {
                        const { data: newCli } = await supabase.from('CLIENTES').insert([{ telefono: tel, nombre: partes[1].trim(), chances: 1 }]).select().single();
                        clientId = newCli?.id;
                    }
                    if (clientId) {
                        await supabase.from('CUENTAS').insert([{ cliente_id: clientId, plataforma: partes[2].trim(), fecha_vencimiento: partes[3].trim(), estado: 'ocupado' }]);
                    }
                    await sendWhatsAppMessage(from, `✅ Cliente cargado.`);
                }
                return;
            }
            if (rawMsg === 'PAUSA TODOS') { pausedChats['TODOS'] = true; await sendWhatsAppMessage(from, 'Bot pausado.'); return; }
            if (rawMsg === 'ACTIVAR TODOS') { pausedChats['TODOS'] = false; await sendWhatsAppMessage(from, 'Bot reactivado.'); return; }
        }

        if (pausedChats['TODOS'] || pausedChats[from]) return;

        await supabase.from('messages').insert([{ phone: from, role: 'user', content: textMessage }]);

        const { data: clienteList } = await supabase.from('CLIENTES').select('*, CUENTAS(*), SERVICIOS(*)');
        const cleanFrom = cleanNumber(from);
        const cliente = clienteList?.find(c => cleanNumber(c.telefono).endsWith(cleanFrom.slice(-8)));
        
        let contextoBD = cliente 
            ? `\n\n[INFO INTERNA]: Cliente registrado: ${cliente.nombre}.` 
            : `\n\n[INFO INTERNA]: Cliente NUEVO.`;

        const { data: cuentasStock } = await supabase.from('CUENTAS').select('*');
        const { data: history } = await supabase.from('messages').select('*').eq('phone', from).order('created_at', { ascending: false }).limit(6);
        const messagesFormatted = (history || []).reverse().map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
        messagesFormatted.push({ role: 'user', content: textMessage });

        const tools = [
            { name: "dar_cuenta", description: "Busca stock y entrega credenciales.", input_schema: { type: "object", properties: { plataforma: { type: "string" }, telefono_cliente: { type: "string" } }, required: ["plataforma", "telefono_cliente"] } }
        ];

        let response = await client.messages.create({
            model: 'claude-sonnet-4-6', max_tokens: 500, tools: tools,
            system: SYSTEM_PROMPT + contextoBD,
            messages: messagesFormatted
        });

        let botReply = "";

        if (response.stop_reason === "tool_use") {
            const toolUseBlock = response.content.find(block => block.type === "tool_use");
            if (toolUseBlock && toolUseBlock.name === "dar_cuenta") {
                const { plataforma, telefono_cliente } = toolUseBlock.input;
                const stockDisp = cuentasStock?.filter(s => String(s.estado || '').toLowerCase().trim() === 'disponible') || [];
                
                const platBuscada = plataforma.toLowerCase().trim().split(' ')[0];
                const cuentaLibre = stockDisp.find(s => String(s.plataforma).toLowerCase().includes(platBuscada));

                let toolResultContent = "";
                if (cuentaLibre) {
                    await supabase.from('CUENTAS').update({ estado: 'ocupado', telefono: telefono_cliente }).eq('id', cuentaLibre.id);
                    notifyOwner(telefono_cliente, `🎉 ¡VENTA AUTOMÁTICA REALIZADA!\nALICE acaba de entregar una cuenta de ${cuentaLibre.plataforma} a +${telefono_cliente}.\nVerificá el comprobante cuando puedas.`);
                    toolResultContent = `Cuenta encontrada y asignada en la base de datos. DEBES ENVIAR ESTOS DATOS EXACTOS AL CLIENTE: Plataforma: ${cuentaLibre.plataforma} | Correo: ${cuentaLibre.correo} | Clave: ${cuentaLibre.clave || '-'} | Perfil: ${cuentaLibre.perfil || '-'} | PIN: ${cuentaLibre.pin || '-'}`;
                } else {
                    toolResultContent = `No hay stock disponible de ${plataforma}. Avísale al cliente.`;
                }

                messagesFormatted.push({ role: 'assistant', content: response.content });
                messagesFormatted.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: toolResultContent }] });

                const finalResponse = await client.messages.create({
                    model: 'claude-sonnet-4-6', max_tokens: 400, tools: tools,
                    system: SYSTEM_PROMPT, messages: messagesFormatted
                });
                botReply = finalResponse.content.find(block => block.type === 'text')?.text || 'Procesado.';
            }
        } else {
            botReply = response.content.find(block => block.type === 'text')?.text;
        }

        if (botReply) {
            await supabase.from('messages').insert([{ phone: from, role: 'assistant', content: botReply }]);
            await sendWhatsAppMessage(from, botReply);
        }

    } catch (e) {
        console.error('Error Webhook:', e.message);
    }
});

app.listen(PORT, () => console.log(`🚀 NEXXUS ALICE corriendo en puerto ${PORT}`));
