// ============================================================
// SERVIDOR: Bot de Messenger (Facebook + Instagram) con Claude
// ============================================================
// Requisitos: Node.js 18+
// Instalar dependencias: npm install
// Iniciar: node server.js
// ============================================================

require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;
const PORT = process.env.PORT || 3000;

// Historial de conversaciones en memoria (por sender_id)
const conversationHistory = {};

// ============================================================
// PASO 1: Verificación del webhook (Meta lo llama al configurar)
// ============================================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Token de verificación incorrecto");
    res.sendStatus(403);
  }
});

// ============================================================
// PASO 2: Recibir mensajes entrantes de Facebook / Instagram
// ============================================================
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object !== "page" && body.object !== "instagram") {
    return res.sendStatus(404);
  }

  // Responder a Meta de inmediato (regla: < 20 segundos)
  res.sendStatus(200);

  for (const entry of body.entry) {
    const messagingEvents =
      entry.messaging || entry.changes?.flatMap((c) => c.value?.messages || []);

    if (!messagingEvents) continue;

    for (const event of messagingEvents) {
      // Ignorar mensajes enviados por la propia página
      if (event.message?.is_echo) continue;

      const senderId =
        event.sender?.id || event.from?.id;
      const messageText =
        event.message?.text || event.text;

      if (!senderId || !messageText) continue;

      console.log(`📩 Mensaje de ${senderId}: "${messageText}"`);

      try {
        // Mostrar indicador de "escribiendo..."
        await sendTypingIndicator(senderId, true);

        // Obtener respuesta de Claude
        const reply = await getClaudeResponse(senderId, messageText);

        // Apagar indicador y enviar respuesta
        await sendTypingIndicator(senderId, false);
        await sendMessage(senderId, reply);

        console.log(`✅ Respuesta enviada a ${senderId}`);
      } catch (error) {
        console.error(`❌ Error al procesar mensaje de ${senderId}:`, error.message);
      }
    }
  }
});

// ============================================================
// FUNCIÓN: Obtener respuesta de Claude con historial
// ============================================================
async function getClaudeResponse(userId, userMessage) {
  // Inicializar historial si no existe
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  // Agregar mensaje del usuario al historial
  conversationHistory[userId].push({
    role: "user",
    content: userMessage,
  });

  // Mantener máximo 20 mensajes en historial (10 intercambios)
  if (conversationHistory[userId].length > 20) {
    conversationHistory[userId] = conversationHistory[userId].slice(-20);
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: conversationHistory[userId],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  const assistantMessage = data.content[0].text;

  // Guardar respuesta en historial
  conversationHistory[userId].push({
    role: "assistant",
    content: assistantMessage,
  });

  return assistantMessage;
}

// ============================================================
// FUNCIÓN: Enviar mensaje al usuario via Meta Graph API
// ============================================================
async function sendMessage(recipientId, text) {
  const response = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        messaging_type: "RESPONSE",
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Meta API error: ${error}`);
  }
}

// ============================================================
// FUNCIÓN: Indicador de "escribiendo..." (typing indicator)
// ============================================================
async function sendTypingIndicator(recipientId, typing) {
  await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        sender_action: typing ? "typing_on" : "typing_off",
      }),
    }
  ).catch(() => {}); // Ignorar errores del typing indicator
}

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Bot activo en puerto ${PORT}`);
  console.log(`📡 Webhook URL: https://TU-DOMINIO.com/webhook`);
});
