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
const OWNER_PHONE = (process.env.OWNER_PHONE || '').replace('+', '').replace('whatsapp:', '');

// INICIALIZAR ANTHROPIC Y SUPABASE
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// MEMORIA TEMPORAL PARA ESTADOS
const pausedChats = {};
let promoActiva = null;

// ==========================================
// PROMPT DEL SISTEMA (ALICE)
// ==========================================
const SYSTEM_PROMPT = `Sos ALICE, la asistente virtual de NEXXUS, un negocio de entretenimiento digital. Respondés en español rioplatense, sos amable, profesional y resolutiva. Mensajes cortos y claros, usás emojis con moderación.

SERVICIOS Y PRECIOS: Netflix Perfil $9000/mes. Netflix perfil extra $14000/mes (perfil propio, no comparte con otros, sin problemas de hogar). Max $4500/mes. Prime Video $4000/mes. Disney+ $6000/mes. Crunchyroll $2800/mes. Reels Shorts $7500/mes. YouTube Premium $2800/mes. TV Digital pack futbol: 1)Cenit TV $7000/mes 2)TV Online Plus $10000/mes 3)Argentum $12000/mes (incluye YT Premium, Spotify, YT Music) 4)TV Sin Limites $14000/mes.

MEDIOS DE PAGO: Transferencia alias RYAN.MB (Braian Gaston Medina) o efectivo.

SORTEO Y GRUPO: Sorteamos 8 plataformas cada 01 del mes. Para participar deben comprar en el mes, tener saldo al día y estar en el grupo. Link: https://chat.whatsapp.com/B4neyKRVL4a8VmHpa1iGsw (menciónalo siempre al cerrar una venta).

GUIA TV DIGITAL: Para SMART TV ANDROID/FIRE STICK: 1) App Downloader (naranja) 2) Enter URL y el código 3) Instalar. CÓDIGOS TV: Cenit 7960580, TV Online Plus 3342117, Argentum 4708062, TV Sin Limites 2630214 o 4540617.

REGLAS DE ATENCIÓN:
- CLIENTE NUEVO (Pregunta por precios/promos): Solo ofrece el catálogo, no pidas datos de cuentas, correos o perfiles porque aún no tienen servicio.
- SOPORTE TÉCNICO (Cliente con problema): Intenta resolver básicos (ej: guías de TV, escaneo de QR). Si faltan datos en el sistema y el cliente tiene un problema, pídele amablemente su nombre, correo, clave y perfil para que Ryan lo revise más rápido.
- NETFLIX HOGAR: Explica con empatía que a Netflix le conviene que cada casa pague lo suyo, por eso los bloqueos. Dile que ya avisaste a Ryan.
- AUDIOS Y LLAMADAS: Pide amablemente que te escriban en texto.
- PAGOS ATRASADOS O ESPERAS: Jamás aceptes una espera de pago ni des acceso sin confirmación de Ryan.
- HORARIO NOCTURNO: Si son pasadas las 00:00, aclara que Ryan ya debe estar descansando y que el problema se solucionará a primera hora.`;

// ==========================================
// FUNCIONES DE UTILIDAD (WHATSAPP Y NOTIFICACIONES)
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
    if (!OWNER_PHONE) return;
    const msg = `⚠️ *ALERTA NEXXUS*\n\n👤 Cliente: +${clientPhone}\n📝 Situación: ${issue}`;
    await sendWhatsAppMessage(OWNER_PHONE, msg);
}

// ==========================================
// CRON: RECORDATORIOS DE VENCIMIENTO DIARIOS
// ==========================================
async function checkVencimientos() {
    try {
        const manana = new Date();
        manana.setDate(manana.getDate() + 1);
        const fecha = manana.toISOString().split('T')[0];
        
        const { data: servicios, error } = await supabase
            .from('CUENTAS')
            .select('*, CLIENTES(nombre, telefono)')
            .eq('fecha_vencimiento', fecha)
            .eq('estado', 'ocupado');

        if (error || !servicios) return;

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
// PANEL WEB (FRONTEND Y BACKEND)
// ==========================================
app.get('/', async (req, res) => {
    // Consulta a Supabase para mostrar en el panel
    const { data: clients, error } = await supabase.from('CLIENTES').select('*, CUENTAS(*)');
    const clientesLista = clients || [];

    const rows = clientesLista.map(c => {
        const cuentaInfo = (c.CUENTAS && c.CUENTAS.length > 0) 
            ? `${c.CUENTAS[0].plataforma} (Vence: ${c.CUENTAS[0].fecha_vencimiento})` 
            : 'Sin servicio asignado';
        return `<tr><td style="padding:10px;">${c.nombre}</td><td style="padding:10px;">${c.telefono}</td><td style="padding:10px;">${cuentaInfo}</td></tr>`;
    }).join('');

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>Panel NEXXUS ALICE</title>
        <style>
            body { font-family: sans-serif; background: #121212; color: #fff; padding: 20px; }
            .card { background: #1e1e1e; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            input, button { width: 100%; padding: 10px; margin: 5px 0 15px; box-sizing: border-box; background: #2a2a2a; color: #fff; border: 1px solid #444;}
            button { background: #00e676; color: #000; font-weight: bold; cursor: pointer; }
            table { width: 100%; border-collapse: collapse; }
            th { text-align: left; border-bottom: 2px solid #00e676; padding: 10px;}
        </style>
    </head>
    <body>
        <div class="card">
            <h2>NEXXUS Dashboard</h2>
            <p>Estado del Servidor y Webhook: ONLINE</p>
        </div>
        <div class="card">
            <h3>Agregar / Actualizar Cliente Manualmente</h3>
            <form id="formAgregarCliente">
                <input type="text" id="cliTelefono" placeholder="Teléfono (ej: 549385...)" required>
                <input type="text" id="cliNombre" placeholder="Nombre completo" required>
                <input type="text" id="cliPlataforma" placeholder="Servicio/Plataforma (Ej: Netflix Extra)" required>
                <input type="date" id="cliVencimiento" required>
                <button type="submit" id="btnGuardar">Guardar en Supabase</button>
            </form>
        </div>
        <div class="card">
            <h3>Base de Clientes en Supabase</h3>
            <table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Servicio Actual</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">Sin clientes</td></tr>'}</tbody></table>
        </div>
        <script>
            // Lógica frontend enviando datos al backend
            document.getElementById('formAgregarCliente').addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = document.getElementById('btnGuardar');
                btn.disabled = true; btn.textContent = 'Guardando...';
                
                const data = {
                    telefono: document.getElementById('cliTelefono').value,
                    nombre: document.getElementById('cliNombre').value,
                    plataforma: document.getElementById('cliPlataforma').value,
                    fecha_vencimiento: document.getElementById('cliVencimiento').value
                };
                
                try {
                    const res = await fetch('/api/agregar-panel', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
                    if(res.ok) { alert('✅ Guardado con éxito'); location.reload(); } 
                    else { alert('❌ Error al guardar'); }
                } catch(e) { alert('❌ Problema de conexión'); }
                btn.disabled = false; btn.textContent = 'Guardar en Supabase';
            });
        </script>
    </body>
    </html>`;
    res.send(html);
});

// Endpoint que recibe el formulario del Panel Web y guarda en Supabase
app.post('/api/agregar-panel', async (req, res) => {
    const { telefono, nombre, plataforma, fecha_vencimiento } = req.body;
    await supabase.from('CLIENTES').upsert({ telefono, nombre }, { onConflict: 'telefono' });
    await supabase.from('CUENTAS').insert([{ cliente_id: telefono, plataforma, fecha_vencimiento, estado: 'ocupado' }]);
    res.json({ success: true });
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
        const isOwner = from === OWNER_PHONE || from.includes(OWNER_PHONE);

        const textMessage = type === 'text' ? message.text.body : '';

        // 1. MANEJO DE COMANDOS DEL DUEÑO
        if (isOwner && type === 'text') {
            const msgCmd = textMessage.trim();
            const lowerCmd = msgCmd.toLowerCase();

            if (lowerCmd === '!ayuda' || lowerCmd === '!comandos') {
                const ayuda = `🛠️ *Panel Admin NEXXUS:*\n!ayuda\n!historial [num]\n!resp [num] [msj]\n!agregar [tel] | [nom] | [serv] | [aaaa-mm-dd]\n!dar [num] [plataformas]\nPAUSA [num] / ACTIVAR [num]\nMSG [num] [msj]\nPROMO ACTIVA [texto] / PROMO OFF\nNUEVO CLIENTE [nom] [tel] [serv]`;
                return await sendWhatsAppMessage(from, ayuda);
            }
            if (lowerCmd.startsWith('!historial ')) {
                const num = msgCmd.split(' ')[1];
                const { data: logs } = await supabase.from('messages').select('*').eq('phone', num).order('created_at', { ascending: false }).limit(10);
                const txt = logs?.length ? `📜 *Historial +${num}:*\n` + logs.reverse().map(m => `• *${m.role}:* ${m.content}`).join('\n') : `Sin datos para ${num}`;
                return await sendWhatsAppMessage(from, txt);
            }
            if (lowerCmd.startsWith('!resp ')) {
                const parts = msgCmd.split(' ');
                await sendWhatsAppMessage(parts[1], parts.slice(2).join(' '));
                return await sendWhatsAppMessage(from, `✅ Respondido a ${parts[1]}`);
            }
            if (msgCmd.startsWith('PAUSA TODOS')) { pausedChats['TODOS'] = true; return await sendWhatsAppMessage(from, 'Bot pausado para TODOS.'); }
            if (msgCmd.startsWith('ACTIVAR TODOS')) { pausedChats['TODOS'] = false; return await sendWhatsAppMessage(from, 'Bot reactivado para TODOS.'); }
            if (msgCmd.startsWith('PAUSA ')) { pausedChats[msgCmd.split(' ')[1]] = true; return await sendWhatsAppMessage(from, 'Pausado para ' + msgCmd.split(' ')[1]); }
            if (msgCmd.startsWith('ACTIVAR ')) { pausedChats[msgCmd.split(' ')[1]] = false; return await sendWhatsAppMessage(from, 'Activado para ' + msgCmd.split(' ')[1]); }
            if (msgCmd.startsWith('PROMO ACTIVA ')) { promoActiva = msgCmd.replace('PROMO ACTIVA ', ''); return await sendWhatsAppMessage(from, 'Promo global activada.'); }
            if (msgCmd === 'PROMO OFF') { promoActiva = null; return await sendWhatsAppMessage(from, 'Promo global desactivada.'); }
            
            // ... (Puedes seguir usando el resto de comandos aquí directamente a la API)
        }

        // SI EL BOT ESTÁ PAUSADO, NO RESPONDER
        if (pausedChats['TODOS'] || pausedChats[from]) return;

        // 2. MANEJO DE IMÁGENES / COMPROBANTES (CLIENTE)
        if (type === 'image') {
            const mediaId = message.image.id;
            const caption = message.image.caption || '';
            
            // Reenvía automáticamente a ti
            if (OWNER_PHONE) {
                await axios.post(
                    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
                    { messaging_product: 'whatsapp', to: OWNER_PHONE, type: 'image', image: { id: mediaId, caption: `📷 *Cliente:* ${pushName}\n📞 *Teléfono:* +${from}\n💬 *Nota:* ${caption}` } },
                    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
                );
            }
            
            // Guarda la interacción
            await supabase.from('messages').insert([{ phone: from, role: 'user', content: '[Envío de Imagen/Comprobante]' }]);
            
            // Responde al cliente proactivamente
            await sendWhatsAppMessage(from, "📲 Recibí tu imagen correctamente. Ryan la está revisando ahora mismo. \n\nSi es por un problema técnico y aún no me pasaste los datos, ¿me confirmas tu correo, clave y el perfil con el que tienes el inconveniente para agilizar la solución?");
            return;
        }

        // 3. RECHAZO DE AUDIOS
        if (type === 'audio') {
            await sendWhatsAppMessage(from, "Hola! Por ahora solo puedo procesar mensajes de texto. ¿Podrías escribirme tu consulta? 😊");
            return;
        }

        // 4. FILTRO DE ALERTAS CRÍTICAS
        if (type === 'text') {
            const lowerUserText = textMessage.toLowerCase();
            const palabrasCriticas = ['codigo', 'código', 'hogar', 'viaje', 'comprobante', 'pago', 'error', 'asesor', 'humano', 'no me deja'];
            if (palabrasCriticas.some(p => lowerUserText.includes(p))) {
                await notifyOwner(from, `Mencionó palabra crítica: "${textMessage}"`);
            }

            // GUARDAR MENSAJE USUARIO
            await supabase.from('messages').insert([{ phone: from, role: 'user', content: textMessage }]);

            // BUSCAR CONTEXTO DEL CLIENTE EN SUPABASE
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

            const promoContext = promoActiva ? `\n\n[PROMO ACTIVA AHORA]: ${promoActiva}. Ofrécela.` : '';

            // RECUPERAR HISTORIAL DEL CHAT PARA CLAUDE
            const { data: history } = await supabase.from('messages').select('*').eq('phone', from).order('created_at', { ascending: false }).limit(8);
            const messagesFormatted = (history || []).reverse().map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
            
            // Agregar el mensaje actual con su contexto por detrás
            messagesFormatted.push({ role: 'user', content: textMessage });

            // LLAMADA A ANTHROPIC CLAUDE
            const response = await client.messages.create({
                model: 'claude-3-5-sonnet-latest',
                max_tokens: 500,
                system: SYSTEM_PROMPT + contextoBD + promoContext,
                messages: messagesFormatted
            });

            const botReply = response.content[0].text;
            
            // GUARDAR Y ENVIAR RESPUESTA
            await supabase.from('messages').insert([{ phone: from, role: 'assistant', content: botReply }]);
            await sendWhatsAppMessage(from, botReply);
        }

    } catch (e) {
        console.error('Error en Webhook:', e.message);
    }
});

app.listen(PORT, () => console.log(`🚀 NEXXUS ALICE corriendo en puerto ${PORT}`));
