const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 10000;

// Servidor Express para mantener el servicio activo en Render
app.get('/', (req, res) => {
    res.send('Servidor web de ALICE activo y saludable');
});

app.listen(PORT, () => {
    console.log(`Servidor web corriendo en el puerto ${PORT}`);
});

// Función principal del bot de WhatsApp (Baileys)
async function connectToWhatsApp() {
    // Manejo de sesión guardada localmente
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }) // Desactiva logs ruidosos internos
    });

    sock.ev.on('creds.update', saveCreds);

    // Control de eventos de conexión y generación de QR
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('==================================================');
            console.log('ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP:');
            qrcode.generate(qr, { small: true });
            console.log('==================================================');
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`Conexión cerrada (código ${statusCode}). Reconectando: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡ALICE está 100% lista y conectada a WhatsApp con Baileys!');
        }
    });

    // Recepción y lectura de mensajes entrantes
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            // Ignorar mensajes enviados por el propio bot o estados
            if (msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') continue;

            // Extraer el texto del mensaje
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (!text) continue;

            console.log('Mensaje recibido de:', from, 'Texto:', text);

            try {
                // Respuesta de prueba automática
                await sock.sendMessage(from, { 
                    text: '¡Hola! Soy ALICE, tu asistente de NEXXUS. Recibí tu mensaje correctamente.' 
                }, { quoted: msg });
            } catch (error) {
                console.error('Error al responder el mensaje:', error);
            }
        }
    });
}

connectToWhatsApp();
