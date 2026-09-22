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
let promoActiva = null;

const SYSTEM_PROMPT = `Sos ALICE, la asistente virtual de NEXXUS, un negocio de entretenimiento digital. Respondés en español rioplatense, sos amable, profesional y resolutiva. Mensajes cortos y claros, usás emojis con moderación.

SERVICIOS Y PRECIOS: Netflix Perfil $9000/mes. Netflix perfil extra $14000/mes (perfil propio, no comparte con otros, sin problemas de hogar). Max $4500/mes. Prime Video $4000/mes. Disney+ $6000/mes. Crunchyroll $2800/mes. Reels Shorts $7500/mes. YouTube Premium $2800/mes. TV Digital pack futbol: 1)Cenit TV $7000/mes 2)TV Online Plus $10000/mes 3)Argentum $12000/mes incluye YouTube Premium Spotify YouTube Music 4)TV Sin Limites $14000/mes.

MEDIOS DE PAGO: Transferencia alias RYAN.MB (Braian Gaston Medina) o efectivo coordinando con el equipo.

SORTEO MENSUAL: Todos los 01 de cada mes NEXXUS sortea 8 plataformas de streaming entre 3 ganadores. Para participar el cliente debe: 1) Haber hecho una compra en el mes 2) Tener el saldo al dia 3) Estar en el grupo de WhatsApp. El link del grupo es: https://chat.whatsapp.com/B4neyKRVL4a8VmHpa1iGsw Cuando cierres una venta siempre menciona el sorteo y el grupo.

GRUPO DE WHATSAPP: Cuando el cliente pregunte por el grupo o cuando cierres una venta compartí el link: https://chat.whatsapp.com/B4neyKRVL4a8VmHpa1iGsw y explicá que ahi se publican novedades, promociones y el sorteo mensual.

GUIA TV DIGITAL cuando compren manda esto: Para SMART TV ANDROID y FIRE STICK: 1 Abri Google Play Store en tu TV 2 Busca Downloader app naranja e instala 3 Abrila y acepta permisos 4 En Enter a URL escribi el codigo segun tu plan 5 Presiona Go y espera descarga 6 Toca Install Configuracion tilda Downloader vuelve atras Install de nuevo 7 Abri la app y avisame.

CODIGOS TV: Cenit TV 7960580 celular http://aftv.news/7960580. TV Online Plus 3342117 celular http://aftv.news/3342117. Argentum 4708062 celular https://aftv.news/4708062 extras YT Premium TV https://aftv.news/6209890 YT Celular https://aftv.news/9439903 YT Music https://aftv.news/1800407 Spotify https://aftv.news/2832034. TV Sin Limites 2630214 o 4540617.

VENTAS: 1 Saluda Hola soy Alice de NEXXUS en que puedo ayudarte 2 Pregunta que servicio le interesa 3 Informa precio 4 Si hay promo activa mencionala 5 Confirma venta 6 Pide pago a alias RYAN.MB 7 Cuando confirme pago di Genial en breve Ryan verifica y te enviamos los accesos y menciona el grupo y el sorteo 8 Si el cliente pide que le esperes en el pago pidele nombre completo y avisame con sus datos y cuando quiere pagar.

PROMOCIONES: Si el cliente pregunta por promociones y no hay promo activa en el sistema avisame para consultar. Si hay promo activa mencionala en la venta.

PROBLEMAS TECNICOS: Intenta resolver basicos. Ofrece ayuda amigablemente con instrucciones para iniciar sesion, Netflix con codigo de acceso captura y boton obtener ayuda usar contrasena, Prime Video y Disney escanear codigo. Si no puede pregunta si quiere que avise a Ryan. Si no podes resolver di Voy a avisar a Ryan en breve te contactamos. Si son las 00 o mas tarde aclara que quizas ya estoy descansando y que se soluciona al otro dia.

HOGAR NETFLIX: Si mencionan hogar, ubicacion o no les deja ver di Entiendo el problema con Netflix Hogar aviso a Ryan ahora mismo. Mientras espera explicale detalladamente por que sucede y haz enfasis en que a Netflix le conviene que cada cliente pague su propia cuenta.

PAGOS ATRASADOS: Se comprensivo nunca cortante. PAGOS EN ESPERA: Siempre preguntame antes de aceptar que un cliente espere en el pago. NUNCA des accesos sin confirmacion de Ryan.`;

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
  var msg = 'ALERTA NEXXUS\n\nCliente: ' + clientPhone + '\nProblema: ' + issue + '\n\nRyan, por favor revisa y contacta al cliente.';
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
          var msg = 'Hola ' + servicio.CLIENTES.nombre + '! Te recordamos que tu servicio vence manana. Para renovar transferi al alias RYAN.MB y avisanos. Gracias por elegirnos! - NEXXUS';
          sendWhatsAppMessage(servicio.CLIENTES.telefono, msg).catch(function(e) {
            console.error('Error recordatorio:', e.message);
          });
        }
      });
    });
}

setInterval(checkVencimientos, 24 * 60 * 60 * 1000);
checkVencimientos();

// Panel de administración unificado y asíncrono
async function handleOwnerCommand(from, userMessage) {
  var msg = userMessage.trim();
  var msgLower = msg.toLowerCase();

  // 1. Comando de ayuda agregado
  if (msgLower === '!ayuda' || msgLower === '!comandos') {
    var ayudaTexto = "🛠️ *Panel de Administrador - Comandos:*\\n\\n" +
                     "1️⃣ *!ayuda* o *!comandos*: Muestra esta lista.\\n" +
                     "2️⃣ *!resp [número] [mensaje]*: Responde de forma oficial.\\n" +
                     "3️⃣ *MSG [número] [mensaje]*: Envía un mensaje directo.\\n" +
                     "4️⃣ *PAUSA [número]* / *ACTIVAR [número]*: Controla chats.\\n" +
                     "5️⃣ *PROMO ACTIVA [texto]*: Activa promoción global.";
    await sendWhatsAppMessage(from, ayudaTexto);
    return true;
  }

  // 2. Comando de respuesta rápida al cliente
  if (msgLower.startsWith('!resp ')) {
    var partesResp = msg.split(' ');
    var clienteTelefono = partesResp[1];
    var mensajeRespuesta = partesResp.slice(2).join(' ');
    
    if (clienteTelefono && mensajeRespuesta) {
      await sendWhatsAppMessage(clienteTelefono, mensajeRespuesta);
      await sendWhatsAppMessage(from, "✅ Respuesta enviada con éxito al cliente " + clienteTelefono);
      return true;
    } else {
      await sendWhatsAppMessage(from, "❌ Formato incorrecto. Usa: !resp [número] [tu mensaje]");
      return true;
    }
  }
  // Comando para entregar una o varias cuentas automáticas y guardarlas en Supabase: !dar [telefono] [plataforma1, plataforma2]
  if (msgLower.startsWith('!dar ')) {
    var partesDar = msg.split(' ');
    var clienteTelefono = partesDar[1];
    var plataformasTexto = partesDar.slice(2).join(' ');

    if (!clienteTelefono || !plataformasTexto) {
      await sendWhatsAppMessage(from, "❌ Formato incorrecto. Usa: !dar [número] [plataforma1, plataforma2]\nEjemplo: !dar 549385123456 Netflix, Max");
      return true;
    }

    // Separar las plataformas por comas
    var listaPlataformas = plataformasTexto.split(',').map(function(p) { return p.trim(); });
    var mensajeFinal = "🎉 *¡Tus datos de acceso de NEXXUS!* 🎉\n\n";
    var entregasExitosas = 0;
    var fechaHoy = new Date().toISOString().split('T')[0];

    for (var i = 0; i < listaPlataformas.length; i++) {
      var plat = listaPlataformas[i];

      // Buscar una cuenta disponible en Supabase para esta plataforma
      var { data: cuentaData, error: cuentaError } = await supabase
        .from('CUENTAS')
        .select('*')
        .ilike('plataforma', '%' + plat + '%')
        .eq('estado', 'disponible')
        .limit(1)
        .single();

      if (cuentaError || !cuentaData) {
        mensajeFinal += "❌ *Plataforma " + plat + ":* Sin stock disponible actualmente.\n\n";
        continue;
      }

      // Agregar datos al mensaje consolidado
      mensajeFinal += "📺 *Plataforma:* " + cuentaData.plataforma + "\n" +
                      "📧 *Correo:* " + cuentaData.correo + "\n" +
                      "🔑 *Contraseña:* " + cuentaData.password;
      
      if (cuentaData.perfil) {
        mensajeFinal += "\n👤 *Perfil:* " + cuentaData.perfil;
      }
      if (cuentaData.pin) {
        mensajeFinal += "\n🔢 *PIN:* " + cuentaData.pin;
      }

      mensajeFinal += "\n-----------------------------------\n\n";

      // Actualizar estado, cliente_id y fecha de asignación en Supabase
      await supabase
        .from('CUENTAS')
        .update({ 
          estado: 'ocupado', 
          cliente_id: clienteTelefono,
          fecha_asignacion: fechaHoy
        })
        .eq('id', cuentaData.id);

      entregasExitosas++;
    }

    mensajeFinal += "⚠️ *Importante:* No modifiques los datos de las cuentas para evitar bloqueos. ¡Gracias por elegirnos! - NEXXUS";

    // Enviar el paquete completo al cliente
    await sendWhatsAppMessage(clienteTelefono, mensajeFinal);

    // Confirmarte a ti el resultado
    await sendWhatsAppMessage(from, "✅ Paquete enviado y registrado en Supabase (" + entregasExitosas + " cuentas) para el cliente " + clienteTelefono);
    return true;
  }

  // Comandos originales de Claude integrados
  if (msg === 'PAUSA TODOS') {
    pausedChats['TODOS'] = true;
    await sendWhatsAppMessage(from, 'Bot pausado para TODOS.');
    return true;
  }
  if (msg === 'ACTIVAR TODOS') {
    pausedChats['TODOS'] = false;
    await sendWhatsAppMessage(from, 'Bot reactivado para TODOS.');
    return true;
  }
  if (msg.startsWith('PAUSA ')) {
    var phone = msg.replace('PAUSA ', '').trim();
    pausedChats[phone] = true;
    await sendWhatsAppMessage(from, 'Bot pausado para ' + phone);
    return true;
  }
  if (msg.startsWith('ACTIVAR ')) {
    var phone = msg.replace('ACTIVAR ', '').trim();
    pausedChats[phone] = false;
    await sendWhatsAppMessage(from, 'Bot reactivado para ' + phone);
    return true;
  }
  if (msg.startsWith('MSG ')) {
    var resto = msg.replace('MSG ', '');
    var espacio = resto.indexOf(' ');
    var clientPhone = resto.substring(0, espacio);
    var clientMsg = resto.substring(espacio + 1);
    await sendWhatsAppMessage(clientPhone, clientMsg);
    await sendWhatsAppMessage(from, 'Mensaje enviado a ' + clientPhone);
    return true;
  }
  if (msg.startsWith('PASS ')) {
    var partes = msg.replace('PASS ', '').split(' ');
    var clientPhone = partes[0];
    var newPass = partes[1];
    var accessMsg = 'Tus datos actualizados:\n\nContrasena: ' + newPass + '\n\nCualquier consulta estamos a disposicion - NEXXUS';
    await sendWhatsAppMessage(clientPhone, accessMsg);
    await sendWhatsAppMessage(from, 'Contrasena enviada a ' + clientPhone);
    return true;
  }
  if (msg.startsWith('ACCESO ')) {
    var partes = msg.replace('ACCESO ', '').split(' ');
    var clientPhone = partes[0];
    var usuario = partes[1];
    var password = partes[2];
    var accessMsg = 'Tus datos de acceso:\n\nUsuario: ' + usuario + '\nContrasena: ' + password + '\n\nCualquier consulta estamos a disposicion - NEXXUS';
    await sendWhatsAppMessage(clientPhone, accessMsg);
    await sendWhatsAppMessage(from, 'Acceso enviado a ' + clientPhone);
    return true;
  }
  if (msg.startsWith('NUEVO CLIENTE ')) {
    var partes = msg.replace('NUEVO CLIENTE ', '').split(' ');
    var nombre = partes[0] + ' ' + partes[1];
    var telefono = partes[2];
    var servicio = partes[3];
    await supabase.from('CLIENTES').insert([{ nombre: nombre, telefono: telefono, notas: servicio }]);
    await sendWhatsAppMessage(from, 'Cliente ' + nombre + ' agregado correctamente.');
    return true;
  }
  if (msg.startsWith('PROMO ACTIVA ')) {
    promoActiva = msg.replace('PROMO ACTIVA ', '');
    await sendWhatsAppMessage(from, 'Promo activada: ' + promoActiva);
    return true;
  }
  if (msg === 'PROMO OFF') {
    promoActiva = null;
    await sendWhatsAppMessage(from, 'Promo desactivada.');
    return true;
  }
  if (msg.startsWith('PROMO ')) {
    var partes = msg.replace('PROMO ', '').split(' ');
    var clientPhone = partes[0];
    var promoMsg = partes.slice(1).join(' ');
    var promoText = 'Tenes suerte! Tenemos una promo especial: ' + promoMsg + ' Para aprovecharla transferi al alias RYAN.MB y avisanos 🎉';
    await sendWhatsAppMessage(clientPhone, promoText);
    await sendWhatsAppMessage(from, 'Promo enviada a ' + clientPhone);
    return true;
  }

  return false;
}

async function handleMessage(from, userMessage, messageType) {
  var ownerPhone = OWNER_PHONE ? OWNER_PHONE.replace('+', '').replace('whatsapp:', '') : '';
  var isOwner = from === ownerPhone || from.includes(ownerPhone);

  if (isOwner) {
    var handled = await handleOwnerCommand(from, userMessage);
    if (handled) return;
  }

  if (pausedChats['TODOS'] || pausedChats[from]) {
    return;
  }

  if (messageType === 'audio') {
    await sendWhatsAppMessage(from, 'Hola! Para poder ayudarte mejor necesito que escribas tu consulta. Los mensajes de voz no los puedo procesar todavia. Gracias! 😊');
    return;
  }

  if (messageType === 'image') {
    await notifyOwner(from, 'El cliente envio una imagen - posiblemente un comprobante de pago');
    await sendWhatsAppMessage(from, 'Recibi tu comprobante! En breve Ryan lo verifica y te enviamos los accesos 🎉\n\nMientras tanto, si no sos parte de nuestro grupo de WhatsApp te invitamos a unirte para enterarte de novedades y participar en nuestro sorteo mensual de 8 plataformas:\nhttps://chat.whatsapp.com/B4neyKRVL4a8VmHpa1iGsw');
    return;
  }

  if (!conversations[from]) conversations[from] = [];

  var promoInfo = promoActiva ? ' PROMO ACTIVA AHORA: ' + promoActiva + '. Mencionala cuando sea relevante en la conversacion.' : ' No hay promo activa. Si el cliente pregunta por promos avisame para consultar.';

  try {
    var result = await supabase
      .from('CLIENTES')
      .select('*, SERVICIOS(*)')
      .eq('telefono', from)
      .single();

    var clienteInfo = '';
    if (result.data) {
      clienteInfo = ' INFO DEL CLIENTE no menciones esto directamente: Nombre: ' + result.data.nombre;
      if (result.data.SERVICIOS && result.data.SERVICIOS.length > 0) {
        var svc = result.data.SERVICIOS[0];
        clienteInfo += ' Servicio: ' + svc.servicio_id + ' Vence: ' + svc.fecha_vencimiento + ' Estado: ' + svc.estado;
      }
    }

    conversations[from].push({ role: 'user', content: userMessage });
    if (conversations[from].length > 20) conversations[from] = conversations[from].slice(-20);

    var response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: SYSTEM_PROMPT + promoInfo + clienteInfo,
      messages: conversations[from]
    });

    var botReply = response.content[0].text;
    conversations[from].push({ role: 'assistant', content: botReply });
    await sendWhatsAppMessage(from, botReply);

    var promoKeywords = ['promo', 'promocion', 'descuento', 'oferta'];
    var hasPromo = promoKeywords.some(function(k) {
      return userMessage.toLowerCase().includes(k);
    });
    if (hasPromo && !promoActiva) {
      await notifyOwner(from, 'CONSULTA DE PROMO - Cliente ' + from + ' pregunta por promociones. Respondé: PROMO ' + from + ' [descripcion de la promo]');
    }

    var problemKeywords = ['no funciona', 'error', 'problema', 'no puedo', 'no me deja', 'caido', 'no carga', 'contrasena', 'pin', 'hogar', 'ubicacion', 'no anda', 'no me deja ver'];
    var hasProblem = problemKeywords.some(function(k) {
      return userMessage.toLowerCase().includes(k);
    });
    if (hasProblem) {
      await notifyOwner(from, userMessage);
    }

  } catch (err) {
    console.error('Error:', err.message);
  }
}

module.exports = { handleMessage };
