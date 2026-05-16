require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;
const PORT = process.env.PORT || 3000;

const conversationHistory = {};
const userNames = {};

async function getUserName(userId) {
  if (userNames[userId]) return userNames[userId];
  try {
    const response = await fetch(
      "https://graph.facebook.com/v19.0/" + userId + "?fields=name&access_token=" + PAGE_ACCESS_TOKEN
    );
    const data = await response.json();
    if (data.name) {
      userNames[userId] = data.name.split(" ")[0];
      return userNames[userId];
    }
  } catch (e) {}
  return null;
}

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

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page" && body.object !== "instagram") {
    return res.sendStatus(404);
  }
  res.sendStatus(200);
  for (const entry of body.entry) {
    const messagingEvents = entry.messaging || entry.changes?.flatMap((c) => c.value?.messages || []);
    if (!messagingEvents) continue;
    for (const event of messagingEvents) {
      if (event.message?.is_echo) continue;
      const senderId = event.sender?.id || event.from?.id;
      const messageText = event.message?.text || event.text;
      if (!senderId || !messageText) continue;
      console.log("📩 Mensaje de " + senderId + ": \"" + messageText + "\"");
      try {
        await sendTypingIndicator(senderId, true);
        const userName = await getUserName(senderId);
        const reply = await getGeminiResponse(senderId, messageText, userName);
        await sendTypingIndicator(senderId, false);
        await sendMessage(senderId, reply);
        console.log("✅ Respuesta enviada a " + senderId);
      } catch (error) {
        console.error("❌ Error al procesar mensaje de " + senderId + ": " + error.message);
      }
    }
  }
});

async function getGeminiResponse(userId, userMessage, userName) {
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }
  conversationHistory[userId].push({ role: "user", parts: [{ text: userMessage }] });
  if (conversationHistory[userId].length > 20) {
    conversationHistory[userId] = conversationHistory[userId].slice(-20);
  }
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  const systemText = SYSTEM_PROMPT + (userName ? " El nombre del cliente es " + userName + ", úsalo para personalizar tu respuesta." : "");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: conversationHistory[userId],
      generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error("Gemini API error: " + error);
  }
  const data = await response.json();
  const assistantMessage = data.candidates[0].content.parts[0].text;
  conversationHistory[userId].push({ role: "model", parts: [{ text: assistantMessage }] });
  return assistantMessage;
}

async function sendMessage(recipientId, text) {
  const url = "https://graph.facebook.com/v19.0/me/messages?access_token=" + PAGE_ACCESS_TOKEN;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: "RESPONSE"
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error("Meta API error: " + error);
  }
}

async function sendTypingIndicator(recipientId, typing) {
  const url = "https://graph.facebook.com/v19.0/me/messages?access_token=" + PAGE_ACCESS_TOKEN;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      sender_action: typing ? "typing_on" : "typing_off"
    })
  }).catch(() => {});
}

app.listen(PORT, () => {
  console.log("🚀 Bot activo en puerto " + PORT);
  console.log("📡 Webhook URL: https://TU-DOMINIO.com/webhook");
});