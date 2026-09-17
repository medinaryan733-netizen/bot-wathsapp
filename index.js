const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const { handleMessage } = require('./bot');

app.post('/webhook', async (req, res) => {
    try {
        const from = req.body.From;
        const userMessage = req.body.Body;

        console.log('Mensaje recibido:', from, userMessage);

        res.sendStatus(200);

        if (from && userMessage) {
            handleMessage(from, userMessage).catch(function(err) {
                console.error('Error dentro de handleMessage:', err);
            });
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
    console.log('Bot corriendo en el puerto ' + PORT);
});
