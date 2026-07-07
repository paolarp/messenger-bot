/**
 * panel-fallos.js — Panel simple para revisar los fallos del bot
 *
 * Agrega dos rutas protegidas con token:
 *   GET /admin/fallos?token=XXX          → página HTML con los fallos de la semana
 *   GET /admin/fallos.json?token=XXX     → lo mismo en JSON
 *
 * Requiere en Railway la variable ADMIN_TOKEN (inventa una contraseña larga).
 */

const { fallosRecientes, resumen } = require("./logger");

function escapar(texto) {
  return String(texto || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function montarPanel(app) {
  const verificar = (req, res) => {
    if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) {
      res.status(403).send("Forbidden");
      return false;
    }
    return true;
  };

  app.get("/admin/fallos.json", (req, res) => {
    if (!verificar(req, res)) return;
    const dias = parseInt(req.query.dias) || 7;
    res.json({ resumen: resumen(dias), fallos: fallosRecientes(dias) });
  });

  app.get("/admin/fallos", (req, res) => {
    if (!verificar(req, res)) return;
    const dias = parseInt(req.query.dias) || 7;
    const r = resumen(dias);
    const fallos = fallosRecientes(dias);

    const filas = fallos
      .map(
        (f) => `
      <tr>
        <td>${escapar(f.fecha)}</td>
        <td>${escapar(f.plataforma)}</td>
        <td>${escapar(f.motivo_fallo)}</td>
        <td>${escapar(f.mensaje_usuario)}</td>
        <td>${escapar(f.respuesta_bot)}</td>
      </tr>`
      )
      .join("");

    res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fallos del bot · Dermatológico Tlaquepaque</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 20px; color: #333; }
  h1 { font-size: 1.3rem; }
  .resumen { background: #fdf2f4; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; }
  td:nth-child(4), td:nth-child(5) { max-width: 320px; }
</style></head><body>
<h1>Fallos del bot · últimos ${dias} días</h1>
<div class="resumen">
  <b>${r.total || 0}</b> conversaciones · <b>${r.fallos || 0}</b> fallos ·
  tasa de fallo <b>${r.tasa_fallo_pct || 0}%</b>
</div>
<table>
<tr><th>Fecha</th><th>Plataforma</th><th>Motivo</th><th>Mensaje del usuario</th><th>Respuesta del bot</th></tr>
${filas || "<tr><td colspan='5'>Sin fallos en este periodo 🎉</td></tr>"}
</table>
</body></html>`);
  });
}

module.exports = { montarPanel };
