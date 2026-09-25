const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ==========================================
// 1. CONFIGURACIONES Y CREDENCIALES
// ==========================================
const app = express();
app.use(cors());
app.use(express.json()); // Para poder leer JSON en el body

// Credenciales Supabase (Asegúrate de que sean las tuyas)
const SUPABASE_URL = process.env.SUPABASE_URL || 'TU_URL_DE_SUPABASE';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'TU_KEY_DE_SUPABASE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Credenciales Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'TU_API_KEY_GEMINI';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Tu número para recibir notificaciones (formato internacional sin el +, terminado en @c.us)
const MI_NUMERO = '5493858XXXXXX@c.us'; // ¡CAMBIA ESTO POR TU NÚMERO REAL!

// ==========================================
// 2. CONFIGURACIÓN DE ALICE (IA Y HERRAMIENTAS)
// ==========================================

// Historial de conversaciones en memoria
const chatHistory = new Map();

// Definimos la herramienta que ALICE puede usar para guardar datos
const guardarDatosTool = {
    name: "guardar_datos_cliente",
    description: "Guarda o actualiza los datos de cuenta de un cliente en la base de datos (Supabase) cuando el cliente proporciona su información faltante.",
    parameters: {
        type: "OBJECT",
        properties: {
            nombre: { type: "STRING", description: "Nombre del cliente" },
            plataforma: { type: "STRING", description: "Plataforma del servicio (ej. Netflix, Disney+, Max)" },
            correo: { type: "STRING", description: "Correo o usuario de la cuenta" },
            perfil: { type: "STRING", description: "Nombre del perfil o PIN del usuario (ej. Perfil 4, PIN 1234)" }
        },
        required: ["nombre", "plataforma", "correo"]
    }
};

// Instrucciones estrictas para ALICE
const SYSTEM_PROMPT = `
Eres ALICE, una asistente virtual de ventas y soporte para un servicio de cuentas de streaming. Eres amable, directa y eficiente.

REGLA ESTRICTA DE RECOPILACIÓN DE DATOS (SOPORTE Y PAGOS):
Tu objetivo principal como asistente es mantener la base de datos actualizada.
Debes identificar la intención del usuario. Si el usuario te contacta por:
A) Un problema técnico (ej. "no me entra la clave", "se bloqueó", "ayuda con Netflix").
B) Un pago (ej. "te mandé la plata", "acá está el comprobante").

ANTES de resolver su problema o confirmar el pago, debes pedirle sus datos para "ubicarlo en el sistema".
Responde amablemente algo similar a esto:
"¡Hola! Claro, enseguida te ayudo con eso. Para poder ubicar tu cuenta en el sistema, por favor pásame: Tu Nombre, la Plataforma (Netflix, Disney+, etc.), el Correo de la cuenta y el nombre de tu Perfil."

Una vez que el usuario te dé los datos, extraerás esa información estructurada y ejecutarás OBLIGATORIAMENTE la función "guardar_datos_cliente". 
Solo después de ejecutar esa función, continuarás con la ayuda o la confirmación del pago.

Si el usuario pregunta por precios o ventas, NO le pidas estos datos, asúmelo como cliente nuevo y ofrécele la lista de precios.
`;

const generativeModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: [guardarDatosTool] }]
});

// ==========================================
// 3. RUTAS DEL PANEL WEB (EXPRESS)
// ==========================================

// Ruta para registrar Cliente y Servicio nuevo desde el panel
app.post('/api/servicios/agregar', async (req, res) => {
    try {
        const { nombre, telefono, nombre_servicio, usuario, clave, perfil, fecha_vencimiento, estado } = req.body;

        let clienteId = null;
        let { data: clienteExistente } = await supabase.from('CLIENTES').select('id').eq('telefono', telefono).single();

        if (clienteExistente) {
            clienteId = clienteExistente.id;
        } else {
            const { data: nuevoCliente, error: errorCliente } = await supabase.from('CLIENTES').insert([{ nombre, telefono }]).select('id').single();
            if (errorCliente) throw errorCliente;
            clienteId = nuevoCliente.id;
        }

        const { error: errorServicio } = await supabase.from('SERVICIOS').insert([{
            cliente_id: clienteId,
            servicio_id: nombre_servicio, // Recuerda que esto ahora es de tipo TEXT en tu Supabase
            usuario: usuario,
            clave: clave,
            perfil: perfil,
            fecha_vencimiento: fecha_vencimiento,
            estado: estado || 'ACTIVO'
        }]);

        if (errorServicio) throw errorServicio;
        res.json({ success: true, message: 'Cliente y Servicio registrados correctamente' });
    } catch (err) {
        console.error('Error al guardar en Supabase:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Ruta para actualizar/editar los datos desde el panel
app.post('/api/servicios/editar', async (req, res) => {
    try {
        const { cliente_id, telefono, nombre_servicio, usuario, clave, perfil, fecha_vencimiento, estado, notas } = req.body;

        await supabase.from('CLIENTES').update({ telefono, notas }).eq('id', cliente_id);
        
        const { error: errorServicio } = await supabase.from('SERVICIOS').update({
            servicio_id: nombre_servicio,
            usuario: usuario,
            clave: clave,
            perfil: perfil,
            fecha_vencimiento: fecha_vencimiento,
            estado: estado
        }).eq('cliente_id', cliente_id);

        if (errorServicio) throw errorServicio;
        res.json({ success: true, message: 'Servicio actualizado correctamente' });
    } catch (err) {
        console.error('Error al actualizar en Supabase:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 4. WHATSAPP BOT (ALICE)
// ==========================================

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('=========================================');
    console.log('Intenta escanear este QR:');
    qrcode.generate(qr, { small: true });
    console.log('=========================================');
    console.log('🚨 SI EL DIBUJO DE ARRIBA NO ESCANEA, COPIA EL TEXTO LARGO DE ABAJO:');
    console.log(qr);
    console.log('🚨 Pégalo en una página web como https://es.qr-code-generator.com/ (eligiendo la opción "Texto") para crear un QR limpio.');
    console.log('=========================================');
});

client.on('message', async (msg) => {
    // Ignorar estados, grupos o mensajes propios
    if (msg.from === 'status@broadcast' || msg.from.includes('@g.us') || msg.from === client.info.wid._serialized) return;

    const senderNumber = msg.from.split('@')[0];
    const userMessage = msg.body;

    // Inicializar chat de Gemini si no existe
    if (!chatHistory.has(senderNumber)) {
        chatHistory.set(senderNumber, generativeModel.startChat({}));
    }
    
    const chat = chatHistory.get(senderNumber);

    try {
        // Enviar mensaje a Gemini
        const result = await chat.sendMessage(userMessage);
        const response = result.response;

        // VERIFICAR SI ALICE DECIDIÓ USAR LA HERRAMIENTA DE GUARDAR DATOS
        const functionCalls = response.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            
            if (call.name === "guardar_datos_cliente") {
                const { nombre, plataforma, correo, perfil } = call.args;
                
                // --- LÓGICA DE GUARDADO AUTOMÁTICO EN SUPABASE ---
                try {
                    let clienteId = null;
                    let { data: clienteExistente } = await supabase.from('CLIENTES').select('id').eq('telefono', senderNumber).single();

                    if (clienteExistente) {
                        clienteId = clienteExistente.id;
                        await supabase.from('CLIENTES').update({ nombre: nombre }).eq('id', clienteId);
                    } else {
                        const { data: nuevoCliente } = await supabase.from('CLIENTES').insert([{ nombre: nombre, telefono: senderNumber }]).select('id').single();
                        clienteId = nuevoCliente.id;
                    }

                    // Guardar/Actualizar la cuenta en SERVICIOS
                    await supabase.from('SERVICIOS').insert([{
                        cliente_id: clienteId,
                        servicio_id: plataforma,
                        usuario: correo,
                        perfil: perfil,
                        estado: 'ACTIVO'
                    }]);

                    // Avisarte a tu WhatsApp personal
                    client.sendMessage(MI_NUMERO, `🚨 *ALICE ACTUALIZÓ UN CLIENTE*\nNúmero: +${senderNumber}\nNombre: ${nombre}\nCuenta: ${plataforma}\nCorreo: ${correo}\nPerfil: ${perfil || 'No indicó'}\n_Revisa el panel para completarle la fecha de vencimiento y contraseña._`);

                    // Devolver el resultado a ALICE para que siga hablando con el cliente
                    const toolResult = await chat.sendMessage([{
                        functionResponse: {
                            name: "guardar_datos_cliente",
                            response: { status: "OK", message: "Datos guardados en base de datos correctamente." }
                        }
                    }]);
                    
                    // Enviar la respuesta final de ALICE al cliente
                    msg.reply(toolResult.response.text());

                } catch (dbError) {
                    console.error("Error guardando datos con Tool:", dbError);
                    msg.reply("¡Gracias por los datos! Ya los estoy anotando en el sistema. Ahora dime, ¿en qué te puedo ayudar?");
                }
            }
        } else {
            // Si no usó herramientas, simplemente enviar el texto normal
            msg.reply(response.text());
        }

    } catch (error) {
        console.error('Error con Gemini:', error);
    }
});

client.initialize();

// ==========================================
// 5. INICIAR EL SERVIDOR EXPRESS (AL FINAL)
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log(`🚀 Servidor Web y Panel funcionando en el puerto ${PORT}`);
});
