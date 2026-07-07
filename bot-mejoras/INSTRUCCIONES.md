# Mejoras del bot — Prompt versionado + registro de fallos

Dos mejoras en un solo paquete. Tiempo estimado, 20-30 minutos.

---

## PARTE 1 · Mover el prompt de Railway al repo (versionado)

Hoy tu prompt vive en la variable `SYSTEM_PROMPT` de Railway y cada edición
borra la anterior sin dejar rastro. Al moverlo a un archivo del repo, cada
cambio queda como commit en GitHub, con fecha, y puedes regresar a cualquier
versión.

### Paso 1. Crear el archivo del prompt

En la carpeta de tu bot en tu Mac (la de `messenger-bot`), crea un archivo
llamado `prompt-sistema.md` y pega ahí el contenido actual de tu variable
`SYSTEM_PROMPT` de Railway (cópialo desde Railway → Variables antes de nada).

### Paso 2. Cargarlo desde index.js

En tu `index.js`, busca la línea donde usas `process.env.SYSTEM_PROMPT`
y reemplázala. Arriba del archivo (junto a los otros require) agrega,

```js
const fs = require("fs");
const SYSTEM_PROMPT = fs.readFileSync(
  require("path").join(__dirname, "prompt-sistema.md"),
  "utf8"
);
```

Y donde antes decía `process.env.SYSTEM_PROMPT`, ahora usa `SYSTEM_PROMPT`.

### Paso 3. Limpiar

Cuando confirmes que funciona, borra la variable `SYSTEM_PROMPT` de Railway
para que no haya dos fuentes de verdad.

**Desde hoy, para cambiar el prompt** editas `prompt-sistema.md` (puede ser
directo en GitHub desde el navegador), haces commit, y Railway redespliega
solo. El historial de commits es tu historial de versiones del prompt.

---

## PARTE 2 · Registro de conversaciones y fallos

### Paso 1. Crear el volumen en Railway

Los archivos en Railway se borran con cada despliegue, por eso la base de
datos necesita un volumen persistente,

1. En Railway, abre tu servicio del bot
2. Click derecho (o botón ⋯) → **Attach Volume**
3. Mount path, escribe exactamente `/data`
4. Guarda, Railway redesplegará

### Paso 2. Copiar los archivos al repo

Copia `logger.js` y `panel-fallos.js` (incluidos en este paquete) a la
carpeta del bot, junto a tu `index.js`.

### Paso 3. Verificar la versión de Node

El logger usa el SQLite integrado de Node.js, no hay nada que instalar,
pero necesita Node 22 o superior. En tu `package.json`, agrega (o verifica
que exista) esta sección para que Railway use la versión correcta,

```json
"engines": {
  "node": ">=22"
}
```

### Paso 4. Conectar en index.js

**a)** Arriba, junto a los otros require,

```js
const { registrar } = require("./logger");
const { montarPanel } = require("./panel-fallos");
```

**b)** Después de crear tu `app` de Express (después de `const app = express()`
y sus middlewares), agrega,

```js
montarPanel(app);
```

**c)** En el punto donde el bot ya generó la respuesta de Gemini y la envió
al usuario (dentro de tu función de procesamiento, después del envío exitoso),
agrega,

```js
registrar({
  plataforma,          // "messenger" o "instagram", según tu variable
  senderId,            // el ID del remitente que ya tienes
  mensajeUsuario: textoDelUsuario,   // ajusta al nombre de tu variable
  respuestaBot: respuestaDeGemini,   // ajusta al nombre de tu variable
});
```

**d)** En tu bloque `catch` de errores (donde hoy haces `console.error`),
agrega,

```js
registrar({
  plataforma,
  senderId,
  mensajeUsuario: textoDelUsuario,
  respuestaBot: null,
  huboError: true,
});
```

Si me pegas tu `index.js` actual en el chat, te devuelvo el archivo ya
integrado con los nombres exactos de tus variables.

### Paso 5. Crear el token del panel

En Railway → Variables, agrega,

```
ADMIN_TOKEN=una-contraseña-larga-que-inventes
```

### Paso 6. Subir y probar

```bash
git add .
git commit -m "Prompt versionado + registro de fallos"
git push
```

Cuando Railway termine de desplegar, abre en tu navegador,

```
https://messenger-bot-production-87fe.up.railway.app/admin/fallos?token=TU-TOKEN
```

Manda un mensaje de prueba a la página que el bot no pueda responder
(algo como "¿cuánto cuesta un trasplante de riñón?") y recarga el panel,
debería aparecer marcado como fallo.

---

## Qué detecta como fallo

- **Errores técnicos**, Gemini caído, token inválido, etc.
- **Bot sin información**, respuestas con frases tipo "no tengo esa
  información" o "te recomiendo llamar"
- **Usuario frustrado**, mensajes tipo "no me entendiste", "ya te dije",
  "quiero hablar con una persona" (marcan que la respuesta anterior falló)

Las listas de frases están al inicio de `logger.js`, agrégales las que
veas aparecer en tu panel.

## Privacidad

- El ID de Meta del usuario se guarda **hasheado**, no se puede rastrear
  a la persona desde la base
- Los registros se borran solos a los **90 días**
- El panel solo abre con tu token

## Tu rutina semanal (5 minutos)

Abre el panel una vez por semana, revisa los fallos, y las preguntas que
el bot no supo responder se convierten en líneas nuevas de
`prompt-sistema.md`. Commit, push, y el bot mejora. Ese es el ciclo
completo, y ahora cada mejora queda versionada.
