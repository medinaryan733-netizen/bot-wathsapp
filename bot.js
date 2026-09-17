const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const OWNER_PHONE = process.env.OWNER_PHONE;

const conversations = {};

const SYSTEM_PROMPT = `Sos un asistente de ventas llamado "Asistente" que trabaja para un negocio de cuentas de streaming. SERVICIOS QUE OFRECEMOS: Netflix, Disney+, Max, Prime Video, Paramount+, Star+. TU PERSONALIDAD: Amable, profesional y resolutivo. Respondés en español rioplatense. Mensajes cortos y claros. Usás emojis con moderación. PARA VENTAS NUEVAS: 1. Saludá cordialmente 2. Preguntá qué plataforma le interesa 3. Informá el precio y características 4. Cerrá la venta pidiendo confirmación 5. Indicá que el pago es por transferencia bancaria 6. Cuando el cliente diga que pagó o mande comprobante, avisale que vas a verificar y que en breve recibe sus datos de acceso. PARA PROBLEMAS TÉCNICOS: Escuchá el problema con empatía, intentá guiar con soluciones básicas, si no se resuelve decí que vas a avisar al equipo técnico. IMPORTANTE: Si el cliente manda un comprobante de pago responde: Gracias! Recibimos tu comprobante, vamos a verificar el pago y en breve te enviamos los datos de acceso. Si hay un problema que no podés resolver, decí que vas a escalar al equipo.`;

function sendWhatsAppMessage(to, message) {
  var toNumber = to.startsWith('whatsapp:') ? to : 'whatsapp:' + to;
  return twilioClient.messages.create({
    body: message,
    from: 'whatsapp:+14155238886',
    to: toNumber
  });
}

function notifyOwner(clientPhone, issue) {
  if (!OWNER_PHONE) return Promise.resolve();
  var msg = 'ATENCION REQUERIDA. Cliente: ' + clientPhone + '. Problema: ' + issue + '. Por favor revisa y contacta al cliente.';
  return sendWhatsAppMessage(OWNER_PHONE, msg);
}

function handleMessage(from, userMessage) {
  if (!conversations[from]) conversations[from] = [];
  conversations[from].push({ role: 'user', content: userMessage });
  if (conversations[from].length > 20) {
    conversations[from] = conversations[from].slice(-20);
  }
  return client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: conversations[from]
  }).then(function(response) {
    var botReply = response.content[0].text;
    conversations[from].push({ role: 'assistant', content: botReply });
    return sendWhatsAppMessage(from, botReply);
  }).then(function() {
    var problemKeywords = ['no funciona', 'error', 'problema', 'no puedo', 'no me deja', 'caido', 'no carga', 'contrasena', 'pin', 'hogar'];
    var hasProblem = problemKeywords.some(function(k) {
      return userMessage.toLowerCase().includes(k);
    });
    if (hasProblem) {
      return notifyOwner(from, userMessage);
    }
  });
}

module.exports = { handleMessage };
