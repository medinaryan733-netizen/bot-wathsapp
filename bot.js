const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OWNER_PHONE = process.env.OWNER_PHONE;

const conversations = {};
const pausedChats = {};

const SYSTEM_PROMPT = `Sos ALICE, la asistente virtual de NEXXUS, un negocio de entretenimiento digital. Respondés en español rioplatense, sos amable, profesional y resolutiva. Mensajes cortos y claros, usás emojis con moderación.

SERVICIOS Y PRECIOS POR PERFILES:
- Netflix Perfil: $9.000/mes
- Netflix perfil extra: $14.000/mes (explica la diferencia,haz enfasis que es un perfil,no comparte con otros clientes y el bloqueo hogar no sera problema
- Max: $4.500/mes
- Prime Video: $4.000/mes
- Disney+: $6.000/mes
- Crunchyroll: $2.800/mes
- Reels Shorts: $7.500/mes
- YouTube Premium: $2.800/mes
- TV Digital pack fútbol:
  1) Cenit TV: $7.000/mes
  2) TV Online Plus: $10.000/mes
  3) Argentum: $12.000/mes (incluye YouTube Premium, Spotify, YouTube Music)
  4) TV Sin Límites:$14.000

MEDIOS DE PAGO:
- Transferencia: Alias RYAN.MB (Braian Gastón Medina)
- Efectivo: coordinar con el equipo

GUÍA TV DIGITAL - mandá esto cuando compren:
"🔻PARA SMART TV CON ANDROID y FIRE STICK:
1️⃣ Abrí Google Play Store en tu TV
2️⃣ Buscá Downloader (app naranja) e instalala
3️⃣ Abrila y aceptá todos los permisos
4️⃣ En Enter a URL escribí el código:
[CÓDIGO SEGÚN PLAN]
5️⃣ Presioná Go y esperá la descarga
6️⃣ Tocá Install → Configuración → tildá Downloader → volvé atrás → Install
7️⃣ Abrí la app y avisame 😊"

CÓDIGOS TV:
- Cenit TV: 7960580 | celular: http://aftv.news/7960580
- TV Online Plus: 3342117 | celular: http://aftv.news/3342117
- Argentum: 4708062 | celular: https://aftv.news/4708062
  Extras: YT Premium TV: https://aftv.news/6209890 | YT Celular: https://aftv.news/9439903 | YT Music: https://aftv.news/1800407 | Spotify: https://aftv.news/2832034
- TV Sin Límites: 2630214 o 4540617

VENTAS:
1. Saludá: "¡Hola! Soy Alice de NEXXUS 👋 ¿En qué puedo ayudarte?"
2. Preguntá qué servicio le interesa
3. Informá precio
4. Confirmá venta
5. Pedí pago a alias RYAN.MB
6. Cuando confirme pago: "¡Genial! En breve Ryan verifica y te enviamos los accesos 🎉"
7. En caso que el cliente pida que le espere en el pago pidele su nombre completo y dile que espere confirmacion y me preguntas dandome detalles de su telefono y cuando quiere abonar para hacer una "promesa de pago"

PROBLEMAS TÉCNICOS:
- Intentá resolver básicos
- Siempre ofrecete preguntando amigablemente si le podes ayudar indicandole las instrucciones para iniciar sesion en las plataformas,como netflix con el codigo de acceso,diciendole que pase captura y que ponga abajo en obtener ayuda para que aparezca la opcion usar contraseña,o prime video y disney que debe escanear el codigo,en caso que el cliente intente y no pueda,le preguntas si quiere que me avise para ayudarle a iniciar sesion.
- Si no podés: "Voy a avisar a Ryan, en breve te contactamos 🙏" se amigable mientras espera,si son horas muy tarde dile que quizas ya estoy descansando que el problema se solucionara al otro dia si son las 00 o mas horas.

HOGAR NETFLIX: Si mencionan hogar, ubicación o no les deja ver: "Entiendo el problema con Netflix Hogar. Aviso a Ryan ahora mismo 🙏" (mientras espera el cliente explicale detalladamente porque sucede eso como un dato para que el cliente sepa porque sucede,haz enfasis en que a netflix le conviene que cada cliente pague una cuenta diferente en lugar de tener una sola para varios dispositivos diferentes.

PAGOS ATRASADOS: Sé comprensivo, nunca cortante.

PAGOS EN ESPERA: Preguntame a mi siempre que un cliente quiera que le espere en el pago.

function sendWhatsAppMessage(to, message) {
  return axios.post(
    'https://graph.facebook.com/v18.0/' + PHONE_NUMBER_ID + '/messages',
    {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: message }
    },
    { headers: { Authorization: 'Bearer ' + WHATSAPP_TOKEN } }
  );
}

function notifyOwner(clientPhone, issue) {
  if (!OWNER_PHONE) return Promise.resolve();
  var msg = '⚠️ ALERTA NEXXUS\n\nCliente: ' + clientPhone + '\nProblema: ' + issue + '\n\nRyan, por favor revisá y contactá al cliente.';
  return sendWhatsAppMessage(OWNER_PHONE, msg);
}

function checkVencimientos() {
  var manana = new Date();
  manana.setDate(manana.getDate() + 1);
  var fecha = manana.toISOString().split('T')[0];

  supabase
    .from('SERVICIOS')
    .select('*, CLIENTES(nombre, telefono)')
    .eq('fecha_vencimiento', fecha)
    .eq('estado', 'activo')
    .then(function(result) {
      if (result.error) return;
      result.data.forEach(function(servicio) {
        if (servicio.CLIENTES && servicio.CLIENTES.telefono) {
          var msg = '🔔 Hola ' + servicio.CLIENTES.nombre + '! Te recordamos que tu servicio *' + servicio.servicio_id + '* vence mañana.\n\nPara renovar transferí al alias *RYAN.MB* y avisanos 😊\n\n¡Gracias por elegirnos! - NEXXUS';
          sendWhatsAppMessage(servicio.CLIENTES.telefono, msg).catch(function(e) {
            console.error('Error enviando recordatorio:', e.message);
          });
        }
      });
    });
}

setInterval(checkVencimientos, 24 * 60 * 60 * 1000);
checkVencimientos();

function handleOwnerCommand(from, message) {
  var msg = message.trim();

  if (msg === 'PAUSA TODOS') {
    pausedChats['TODOS'] = true;
    return sendWhatsAppMessage(from, '✅ Bot pausado para TODOS.');
  }
  if (msg === 'ACTIVAR TODOS') {
    pausedChats['TODOS'] = false;
    return sendWhatsAppMessage(from, '✅ Bot reactivado para TODOS.');
  }
  if (msg.startsWith('PAUSA ')) {
    var phone = msg.replace('PAUSA ', '').trim();
    pausedChats[phone] = true;
    return sendWhatsAppMessage(from, '✅ Bot pausado para ' + phone);
  }
  if (msg.startsWith('ACTIVAR ')) {
    var phone = msg.replace('ACTIVAR ', '').trim();
    pausedChats[phone] = false;
    return sendWhatsAppMessage(from, '✅ Bot reactivado para ' + phone);
  }
  if (msg.startsWith('MSG ')) {
    var resto = msg.replace('MSG ', '');
    var espacio = resto.indexOf(' ');
    var clientPhone = resto.substring(0, espacio);
    var clientMsg = resto.substring(espacio + 1);
    return sendWhatsAppMessage(clientPhone, clientMsg).then(function() {
      return sendWhatsAppMessage(from, '✅ Mensaje enviado a ' + clientPhone);
    });
  }
  if (msg.startsWith('PASS ')) {
    var partes = msg.replace('PASS ', '').split(' ');
    var clientPhone = partes[0];
    var newPass = partes[1];
    var accessMsg = '🔐 Tus datos actualizados:\n\nContraseña: ' + newPass + '\n\nCualquier consulta estamos a disposición 😊 - NEXXUS';
    return sendWhatsAppMessage(clientPhone, accessMsg).then(function() {
      return sendWhatsAppMessage(from, '✅ Contraseña enviada a ' + clientPhone);
    });
  }
  if (msg.startsWith('ACCESO ')) {
    var partes = msg.replace('ACCESO ', '').split(' ');
    var clientPhone = partes[0];
    var usuario = partes[1];
    var password = partes[2];
    var accessMsg = '🎉 Tus datos de acceso:\n\n📧 Usuario: ' + usuario + '\n🔐 Contraseña: ' + password + '\n\nCualquier consulta estamos a disposición 😊 - NEXXUS';
    return sendWhatsAppMessage(clientPhone, accessMsg).then(function() {
      return sendWhatsAppMessage(from, '✅ Acceso enviado a ' + clientPhone);
    });
  }
  if (msg.startsWith('NUEVO CLIENTE ')) {
    var partes = msg.replace('NUEVO CLIENTE ', '').split(' ');
    var nombre = partes[0] + ' ' + partes[1];
    var telefono = partes[2];
    var servicio = partes[3];
    var vencimiento = partes[4];
    return supabase.from('CLIENTES').insert([{ nombre: nombre, telefono: telefono, notas: servicio }]).then(function() {
      return sendWhatsAppMessage(from, '✅ Cliente ' + nombre + ' agregado correctamente.');
    });
  }
  return null;
}

function handleMessage(from, userMessage) {
  var ownerPhone = OWNER_PHONE ? OWNER_PHONE.replace('+', '').replace('whatsapp:', '') : '';
  var isOwner = from === ownerPhone || from.includes(ownerPhone);

  if (isOwner) {
    var ownerResult = handleOwnerCommand(from, userMessage);
    if (ownerResult) return ownerResult;
  }

  if (pausedChats['TODOS'] || pausedChats[from]) {
    return Promise.resolve();
  }

  if (!conversations[from]) conversations[from] = [];

  return supabase
    .from('CLIENTES')
    .select('*, SERVICIOS(*)')
    .eq('telefono', from)
    .single()
    .then(function(result) {
      var clienteInfo = '';
      if (result.data) {
        clienteInfo = '\n\nINFO DEL CLIENTE (no menciones esto directamente):\nNombre: ' + result.data.nombre;
        if (result.data.SERVICIOS && result.data.SERVICIOS.length > 0) {
          var svc = result.data.SERVICIOS[0];
          clienteInfo += '\nServicio: ' + svc.servicio_id + '\nVence: ' + svc.fecha_vencimiento + '\nEstado: ' + svc.estado;
        }
      }

      conversations[from].push({ role: 'user', content: userMessage });
      if (conversations[from].length > 20) conversations[from] = conversations[from].slice(-20);

      return client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: SYSTEM_PROMPT + clienteInfo,
        messages: conversations[from]
      });
    })
    .then(function(response) {
      var botReply = response.content[0].text;
      conversations[from].push({ role: 'assistant', content: botReply });
      return sendWhatsAppMessage(from, botReply);
    })
    .then(function() {
      var problemKeywords = ['no funciona', 'error', 'problema', 'no puedo', 'no me deja', 'caido', 'no carga', 'contrasena', 'pin', 'hogar', 'ubicacion', 'no anda', 'no me deja ver'];
      var hasProblem = problemKeywords.some(function(k) {
        return userMessage.toLowerCase().includes(k);
      });
      if (hasProblem) return notifyOwner(from, userMessage);
    })
    .catch(function(err) {
      console.error('Error en handleMessage:', err.message);
    });
}

module.exports = { handleMessage };
