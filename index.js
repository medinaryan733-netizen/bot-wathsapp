const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const { handleMessage } = require('./bot');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

app.get('/webhook', function(req, res) {
  var mode = req.query['hub.mode'];
  var token = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];
  console.log('Verificacion webhook - mode:', mode, 'token:', token);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    console.log('Token incorrecto');
    res.sendStatus(403);
  }
});

app.post('/webhook', function(req, res) {
  console.log('Mensaje recibido:', JSON.stringify(req.body));
  var body = req.body;

  if (body.object === 'whatsapp_business_account') {
    var entry = body.entry && body.entry[0];
    var changes = entry && entry.changes && entry.changes[0];
    var message = changes && changes.value && changes.value.messages && changes.value.messages[0];
    var contact = changes && changes.value && changes.value.contacts && changes.value.contacts[0];

    if (message) {
      // Guarda el nombre de perfil si Meta lo envía
      if (contact && contact.profile) {
        message.pushName = contact.profile.name;
      }

      var from = message.from;
      var messageType = message.type;

      if (messageType === 'text') {
        var text = message.text ? message.text.body : '';
        console.log('Texto de:', from, ':', text);
        handleMessage(from, text, 'text', message).catch(function(err) {
          console.error('Error:', err.message);
        });
      } else if (messageType === 'image') {
        console.log('Imagen de:', from);
        handleMessage(from, '[imagen]', 'image', message).catch(function(err) {
          console.error('Error:', err.message);
        });
      } else if (messageType === 'audio') {
        console.log('Audio de:', from);
        handleMessage(from, '[audio]', 'audio', message).catch(function(err) {
          console.error('Error:', err.message);
        });
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  // Ruta para guardar cliente y servicio completo en Supabase desde el panel web
app.post('/api/servicios/agregar', async (req, res) => {
  try {
    const { nombre, telefono, nombre_servicio, usuario, clave, perfil, fecha_vencimiento, estado } = req.body;

    const { data, error } = await supabase
      .from('SERVICIOS')
      .upsert([
        {
          telefono,
          nombre,
          nombre_servicio,
          usuario,
          clave,
          perfil,
          fecha_vencimiento,
          estado: estado || 'ACTIVO'
        }
      ], { onConflict: 'telefono' });

    if (error) throw error;

    res.json({ success: true, message: 'Servicio registrado correctamente' });
  } catch (err) {
    console.error('Error al guardar en Supabase:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});
  console.log('Servidor corriendo en el puerto', PORT);
});
