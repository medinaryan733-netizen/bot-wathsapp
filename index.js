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

        // 1. Le avisamos de inmediato a Twilio que recibimos el mensaje (evita timeout 11200)
        res.sendStatus(200);

        // 2. Procesamos la respuesta en segundo plano
        if (from && userMessage) {
            handleMessage(from, userMessage).catch(err => {
                console.error('Error dentro de handleMessage:', err);
            });
        }
    } catch (err) {
        console.error('Error procesando mensaje:', err);
    }
});

app.get('/', (req, res) => {
    res.send('Bot de WhatsApp funcionando correctamente');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(Bot corriendo en puerto ${PORT});
});
