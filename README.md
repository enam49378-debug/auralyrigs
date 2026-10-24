# 🟢 AuraLyrics Studio 2.0

> **Editor visual de letras sincronizadas, karaoke palabra por palabra, ritmo y efectos visuales cinemáticos Brat para AuraMusic y YouTube Music.**

![AuraLyrics Studio](https://img.shields.io/badge/AuraLyrics-v2.0-8acf00?style=for-the-badge&logo=youtube&logoColor=black)
![AuraMusic Compatible](https://img.shields.io/badge/AuraMusic-Compatible-black?style=for-the-badge)
![License MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## ✨ Características Principales

1. **📚 Biblioteca de Canciones con Tarjetas (Cards Menu):**
   - Menú inicial con vista de tarjetas y foto de portada automática de YouTube.
   - Botón `[ + ]` para agregar nuevas canciones desde cualquier enlace de YouTube Music.

2. **⚡ Flujo de Edición Guiado en 3 Pasos:**
   - **Paso 1: Versos** — Sincronización en vivo de cada verso con la barra espaciadora (`Spacebar`), o búsqueda automática con **LRCLIB**.
   - **Paso 2: Frases & Palabras** — Afinación precisa palabra por palabra para el barrido karaoke fluido, distribución silábica automática y selector de tipo `Vocal (🎤)` vs `Spoken/Rap (🗣️)`.
   - **Paso 3: Efectos & Ritmo (Brat Engine)** — Marcador de golpes de 808 (`Tecla B`), paletas de color Brat (`Lime`, `White`, `Red`, `Blue`, `Yellow`, `Ink`), disposición, variantes y animación de entrada elegidas en el inspector. Los golpes decoran el fondo sin escalar las letras.

3. **✨ Integración con Servidor Público LRCLIB:**
   - Consulta automática con `https://lrclib.net` para importar letras pre-sincronizadas sin necesidad de escribirlas manualmente.

4. **🌐 Formato de letras para AuraMusic:**
   - Servidor local en `localhost:3000` con los endpoints `/api/status` y `/api/lyrics/get`.
   - Exportación de archivos JSON directamente para la base de datos comunitaria de GitHub (`database/`).

---

## 🚀 Inicio Rápido

### Requisitos
- [Node.js](https://nodejs.org/) (v18 o superior)

### Ejecutar Localmente
```bash
# Iniciar el servidor local en el puerto 3000
npm start
```

Abre tu navegador en:
```
http://localhost:3000
```

---

## 🎹 Controles y Teclas Rápidas

| Tecla | Acción |
| :--- | :--- |
| **Barra Espaciadora** | Marcar inicio de verso en el tiempo actual (Paso 1) / Play & Pausa |
| **Tecla B** | Marcar golpe de bajo 808 / Beat (Paso 3) |
| **Flecha Izquierda (←)** | Retroceder 3 segundos |
| **Flecha Derecha (→)** | Avanzar 3 segundos |

---

## 📦 Estructura del Proyecto

```
auralyrics/
├── database/                # Base de datos comunitaria de canciones sincronizadas
│   ├── charli_xcx_360.json  # Canción demo con estética Brat y golpes 808
│   └── milo_j_m_a_i.json    # Canción demo de trap/vocal en español
├── index.html               # Interfaz del Studio y Biblioteca
├── studio.css               # Estilos, efectos Brat y diseño glassmorphism
├── studio.js                # Motor de sincronización, YouTube Iframe API y LRCLIB
├── server.js                # Servidor local Node.js (API REST para AuraMusic)
└── package.json             # Manifiesto del proyecto
```

---

## 👨‍💻 Autor y Créditos
- Desarrollado por **Jesuluto** (`@enam49378-debug`)
- Diseñado para complementar el ecosistema de **AuraMusic**

## Revisión del editor Brat

- Preview con más altura y botón **Ampliar vista previa**. Escape vuelve al editor. El texto se reajusta al tamaño de la escena.
- Las canciones nuevas comienzan con una sola escena neutra. Solo el botón de generación por secciones crea una secuencia de escenas.
- Se admiten las seis paletas del inspector, cuatro disposiciones, variantes de fuente, entradas de palabras y golpes 808. Los antiguos fondos de gradiente, colores personalizados, desenfoque y escalas configurables se descartan del formato de efectos.
- Los borradores antiguos conservan sus letras y tiempos. Un borrador local tiene prioridad sobre la versión publicada. Cambiar de canción descarta las respuestas atrasadas de la anterior.
- Guardar, copiar y descargar JSON usan el mismo formato y conservan keyframes, entradas y el estado de los golpes. GitHub Pages guarda en este navegador; para actualizar la biblioteca pública hay que publicar el JSON en el repositorio.
- El servidor local conserva la marca de revisión humana, devuelve errores de JSON válidos y sirve únicamente los recursos públicos. Escucha en 127.0.0.1.

### Código y comprobaciones

`brat-effects.js` contiene el contrato de efectos compartido por el servidor y el editor. `editor-layout.css` concentra la adaptación del editor y el preview ampliado. `studio.js` gestiona las selecciones, reproducción y exportación.

Ejecuta `npm test`. Las pruebas de navegador usan Chrome local y Node.js 22 o posterior, con respuestas de YouTube simuladas; no reproducen ni publican música. Puedes configurar `AURALYRICS_CHROME` para indicar otro ejecutable.

Los keyframes quedan guardados en el proyecto y el JSON. Su aplicación en AuraMusic depende de que la versión instalada de la extensión consuma esos campos; este editor no actualiza automáticamente el motor de la extensión.

## Precisión con audio real

`tools/analyze-audio.cjs` ajusta los tiempos con un archivo de audio que tengas en tu PC (requiere ffmpeg). Detecta los ataques reales de voz e instrumentos, mueve cada palabra al ataque más cercano (±0,12 s, sin romper el orden) y coloca los golpes de bajo 808.

```bash
node tools/analyze-audio.cjs cancion.mp3 database/artista_cancion.json          # vista previa
node tools/analyze-audio.cjs cancion.mp3 database/artista_cancion.json --write  # guarda
```

Opciones: `--beats-only`, `--words-only`, `--window 0.12`. La ficha debe tener la letra guardada. Sin ese audio, los tiempos siguen siendo estimaciones.
