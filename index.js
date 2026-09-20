const express = require('express');
const app = express();
app.use(express.json());

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
    if (message && message.type === 'text') {
      var from = message.from;
      var text = message.text.body;
      console.log('Mensaje de texto de:', from, 'Texto:', text);
      handleMessage(from, text).catch(function(err) {
        console.error('Error handleMessage:', err.message);
      });
    } else if (message && message.type === 'image') {
      var from = message.from;
      console.log('Imagen recibida de:', from);
      handleMessage(from, '[El cliente envio una imagen - posiblemente un comprobante de pago]').catch(function(err) {
        console.error('Error handleMessage imagen:', err.message);
      });
    } else if (message && message.type === 'audio') {
      var from = message.from;
      console.log('Audio recibido de:', from);
      handleMessage(from, '[El cliente envio un audio - pedile que escriba su consulta]').catch(function(err) {
        console.error('Error handleMessage audio:', err.message);
      });
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Bot corriendo en puerto ' + PORT);
});
