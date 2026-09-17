const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const { handleMessage } = require('./bot');

app.post('/webhook', function(req, res) {
    try {
        const from = req.body.From;
        const userMessage = req.body.Body;

        console.log('Mensaje recibido:', from, userMessage);

        // Responde 200 a Twilio de inmediato para evitar el error de tiempo (11200)
        res.sendStatus(200);

        if (from && userMessage) {
            handleMessage(from, userMessage);
        }
    } catch (err) {
        console.error('Error procesando mensaje:', err);
    }
});

app.get('/', function(req, res) {
    res.send('Bot de WhatsApp funcionando correctamente');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, function() {
    console.log('Bot corriendo en puerto ' + PORT);
});
