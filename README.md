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
   - **Paso 3: Efectos & Ritmo (Brat Engine)** — Marcador de golpes de 808 (`Tecla B`), paletas de color Brat (`Lime`, `White`, `Red`, `Blue`, `Yellow`, `Ink`), tipografía cinética con desenfoque de texto y sacudidas de pantalla sincronizadas.

3. **✨ Integración con Servidor Público LRCLIB:**
   - Consulta automática con `https://lrclib.net` para importar letras pre-sincronizadas sin necesidad de escribirlas manualmente.

4. **🌐 Compatible 1:1 con la Extensión AuraMusic:**
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
