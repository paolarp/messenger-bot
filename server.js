require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.status(200).send("OK"));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;
const PORT = process.env.PORT || 3000;

const conversationHistory = {};
const userNames = {};

async function getUserName(userId, token, platform) {
  if (userNames[userId]) return userNames[userId];
  try {
    const baseUrl = platform === "instagram"
      ? "https://graph.instagram.com/v22.0/"
      : "https://graph.facebook.com/v19.0/";
    const response = await fetch(
      baseUrl + userId + "?fields=name&access_token=" + token
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
  res.sendStatus(200);

  // Facebook Messenger
  if (body.object === "page") {
    for (const entry of body.entry) {
      const messagingEvents = entry.messaging || [];
      for (const event of messagingEvents) {
        if (event.message?.is_echo) continue;
        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        if (!senderId || !messageText) continue;
        console.log("📩 [Messenger] Mensaje de " + senderId + ": \"" + messageText + "\"");
        try {
          await sendTypingIndicator(senderId, true, PAGE_ACCESS_TOKEN, "messenger");
          const userName = await getUserName(senderId, PAGE_ACCESS_TOKEN, "messenger");
          const reply = await getGeminiResponse(senderId, messageText, userName);
          await sendTypingIndicator(senderId, false, PAGE_ACCESS_TOKEN, "messenger");
          await sendMessage(senderId, reply, PAGE_ACCESS_TOKEN, "messenger");
          console.log("✅ [Messenger] Respuesta enviada a " + senderId);
        } catch (error) {
          console.error("❌ [Messenger] Error: " + error.message);
        }
      }
    }
  }

  // Instagram
  if (body.object === "instagram") {
    for (const entry of body.entry) {
      const messagingEvents = entry.messaging || [];
      for (const event of messagingEvents) {
        if (event.message?.is_echo) continue;
        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        if (!senderId || !messageText) continue;
        console.log("📩 [Instagram] Mensaje de " + senderId + ": \"" + messageText + "\"");
        try {
          await sendTypingIndicator(senderId, true, INSTAGRAM_ACCESS_TOKEN, "instagram");
          const userName = await getUserName(senderId, INSTAGRAM_ACCESS_TOKEN, "instagram");
          const reply = await getGeminiResponse(senderId, messageText, userName);
          await sendTypingIndicator(senderId, false, INSTAGRAM_ACCESS_TOKEN, "instagram");
          await sendMessage(senderId, reply, INSTAGRAM_ACCESS_TOKEN, "instagram");
          console.log("✅ [Instagram] Respuesta enviada a " + senderId);
        } catch (error) {
          console.error("❌ [Instagram] Error: " + error.message);
        }
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

async function sendMessage(recipientId, text, token, platform) {
  const MAX_LENGTH = 1900;
  const parts = [];
  while (text.length > 0) {
    if (text.length <= MAX_LENGTH) {
      parts.push(text);
      break;
    }
    let cutIndex = text.lastIndexOf("\n", MAX_LENGTH);
    if (cutIndex === -1) cutIndex = text.lastIndexOf(" ", MAX_LENGTH);
    if (cutIndex === -1) cutIndex = MAX_LENGTH;
    parts.push(text.substring(0, cutIndex));
    text = text.substring(cutIndex).trim();
  }
  const baseUrl = platform === "instagram"
    ? "https://graph.instagram.com/v22.0/me/messages?access_token="
    : "https://graph.facebook.com/v19.0/me/messages?access_token=";
  const url = baseUrl + token;
  for (const part of parts) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: part },
        messaging_type: "RESPONSE"
      })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error("Meta API error: " + error);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function sendTypingIndicator(recipientId, typing, token, platform) {
  const baseUrl = platform === "instagram"
    ? "https://graph.instagram.com/v22.0/me/messages?access_token="
    : "https://graph.facebook.com/v19.0/me/messages?access_token=";
  const url = baseUrl + token;
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