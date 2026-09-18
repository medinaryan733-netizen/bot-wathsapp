const express = require('express');
const app = express();
app.use(express.json());

const { handleMessage } = require('./bot');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

app.get('/webhook', function(req, res) {
  var mode = req.query['hub.mode'];
  var token = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', function(req, res) {
  var body = req.body;
  if (body.object === 'whatsapp_business_account') {
    var entry = body.entry && body.entry[0];
    var changes = entry && entry.changes && entry.changes[0];
    var message = changes && changes.value && changes.value.messages && changes.value.messages[0];
    if (message && message.type === 'text') {
      var from = message.from;
      var text = message.text.body;
      handleMessage(from, text).catch(function(err) {
        console.error('Error:', err.message);
      });
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Bot corriendo en puerto ' + PORT);
});
