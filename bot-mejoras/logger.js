/**
 * logger.js — Registro de conversaciones del bot Dermatológico Tlaquepaque
 *
 * Guarda cada intercambio (mensaje de usuario + respuesta del bot) en SQLite
 * y marca automáticamente los "fallos", casos donde el bot no supo responder
 * bien, para que Paola los revise y mejore el prompt.
 *
 * Sin dependencias, usa el SQLite integrado de Node.js (requiere Node 22.13+)
 * Requiere en Railway: un Volume montado en /data (ver INSTRUCCIONES.md)
 */

const { DatabaseSync } = require("node:sqlite");
const crypto = require("crypto");
const path = require("path");

// En Railway el volumen se monta en /data. En tu Mac usa la carpeta local.
const DB_PATH = process.env.RAILWAY_ENVIRONMENT
  ? "/data/conversaciones.db"
  : path.join(__dirname, "conversaciones.db");

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS conversaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    plataforma TEXT NOT NULL,            -- 'messenger' | 'instagram'
    usuario_hash TEXT NOT NULL,          -- ID anonimizado, nunca el ID real
    mensaje_usuario TEXT NOT NULL,
    respuesta_bot TEXT,
    fallo INTEGER NOT NULL DEFAULT 0,    -- 1 si se detectó un fallo
    motivo_fallo TEXT                    -- por qué se marcó como fallo
  );
  CREATE INDEX IF NOT EXISTS idx_fallo ON conversaciones(fallo, fecha);
`);

// -----------------------------------------------------------------
// Detección de fallos, heurísticas simples y ajustables
// -----------------------------------------------------------------

// Frases que delatan que el bot no tenía la información
const FRASES_SIN_RESPUESTA = [
  "no tengo esa información",
  "no cuento con esa información",
  "no puedo ayudarte con eso",
  "no estoy seguro",
  "no tengo acceso",
  "te recomiendo llamar",
  "te sugiero comunicarte",
  "lo siento, no",
];

// Señales de frustración del usuario (se evalúan sobre SU mensaje,
// indican que la respuesta ANTERIOR falló)
const FRASES_FRUSTRACION = [
  "no me entendiste",
  "no me entiendes",
  "eso no fue lo que pregunté",
  "no es eso",
  "ya te dije",
  "otra vez",
  "hablar con una persona",
  "hablar con alguien",
  "no sirves",
];

function detectarFallo({ mensajeUsuario, respuestaBot, huboError }) {
  if (huboError) {
    return { fallo: 1, motivo: "error_tecnico" };
  }
  const respuesta = (respuestaBot || "").toLowerCase();
  for (const frase of FRASES_SIN_RESPUESTA) {
    if (respuesta.includes(frase)) {
      return { fallo: 1, motivo: `sin_informacion: "${frase}"` };
    }
  }
  const mensaje = (mensajeUsuario || "").toLowerCase();
  for (const frase of FRASES_FRUSTRACION) {
    if (mensaje.includes(frase)) {
      return { fallo: 1, motivo: `usuario_frustrado: "${frase}"` };
    }
  }
  return { fallo: 0, motivo: null };
}

// -----------------------------------------------------------------
// API del módulo
// -----------------------------------------------------------------

const insertar = db.prepare(`
  INSERT INTO conversaciones
    (plataforma, usuario_hash, mensaje_usuario, respuesta_bot, fallo, motivo_fallo)
  VALUES (@plataforma, @usuario_hash, @mensaje_usuario, @respuesta_bot, @fallo, @motivo_fallo)
`);

/**
 * Registrar un intercambio. Llamar después de enviar (o intentar enviar)
 * cada respuesta del bot.
 */
function registrar({ plataforma, senderId, mensajeUsuario, respuestaBot, huboError = false }) {
  try {
    const { fallo, motivo } = detectarFallo({ mensajeUsuario, respuestaBot, huboError });
    // Se guarda un hash del ID, suficiente para agrupar conversaciones
    // de la misma persona sin almacenar su identidad de Meta
    const usuario_hash = crypto
      .createHash("sha256")
      .update(String(senderId))
      .digest("hex")
      .slice(0, 12);

    insertar.run({
      plataforma,
      usuario_hash,
      mensaje_usuario: String(mensajeUsuario || "").slice(0, 2000),
      respuesta_bot: String(respuestaBot || "").slice(0, 4000),
      fallo,
      motivo_fallo: motivo,
    });
    if (fallo) console.log(`⚠️ FALLO registrado (${motivo})`);
  } catch (err) {
    // El logging nunca debe tumbar al bot
    console.error("Error al registrar conversación:", err.message);
  }
}

/** Fallos recientes, para el panel de revisión */
function fallosRecientes(dias = 7) {
  return db
    .prepare(
      `SELECT fecha, plataforma, usuario_hash, mensaje_usuario, respuesta_bot, motivo_fallo
       FROM conversaciones
       WHERE fallo = 1 AND fecha >= datetime('now', 'localtime', ?)
       ORDER BY fecha DESC LIMIT 200`
    )
    .all(`-${dias} days`);
}

/** Resumen rápido, totales y tasa de fallo */
function resumen(dias = 7) {
  return db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(fallo) AS fallos,
              ROUND(100.0 * SUM(fallo) / MAX(COUNT(*), 1), 1) AS tasa_fallo_pct
       FROM conversaciones
       WHERE fecha >= datetime('now', 'localtime', ?)`
    )
    .get(`-${dias} days`);
}

/** Borrar registros con más de N días (privacidad, correr al arrancar) */
function purgarAntiguos(dias = 90) {
  const r = db
    .prepare(`DELETE FROM conversaciones WHERE fecha < datetime('now', 'localtime', ?)`)
    .run(`-${dias} days`);
  if (r.changes > 0) console.log(`🧹 Purgados ${r.changes} registros de más de ${dias} días`);
}

purgarAntiguos();

module.exports = { registrar, fallosRecientes, resumen, purgarAntiguos };
