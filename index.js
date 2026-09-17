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

        if (from && userMessage) {
            await handleMessage(from, userMessage);
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('Error procesando mensaje:', err);
        res.sendStatus(500);
    }
});

app.get('/', (req, res) => {
    res.send('Bot de WhatsApp funcionando correctamente');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(Bot corriendo en puerto ${PORT});
