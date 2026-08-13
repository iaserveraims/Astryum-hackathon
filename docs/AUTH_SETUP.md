# AUTH_SETUP — gate de acceso, captcha y OAuth (Google/Apple)

> Estado 2026-07-23. Este documento acompaña al hardening de acceso: gate
> server-side pre-lanzamiento, Turnstile en todos los formularios de
> credenciales, sesión corta del panel admin y OAuth Google/Apple.
> El código ya está construido y feature-flagged: **cada pieza se enciende
> poniendo sus variables de entorno**, sin tocar código.

## 0. Qué hay construido (mapa rápido)

| Pieza | Dónde vive | Se enciende con |
|---|---|---|
| Gate de acceso al dashboard | `frontend/src/lib/middleware.ts` + `/api/access-gate` | `ACCESS_GATE_CODE` + `ACCESS_GATE_SECRET` (Vercel) |
| Captcha Turnstile | `TurnstileWidget` (front) + `middleware/turnstile.ts` (back) | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Vercel) + `TURNSTILE_SECRET_KEY` (Vercel **y** Railway) |
| Rate limits de auth | `backend/src/routes/auth.ts` | siempre activos |
| Honeypot waitlist | campo `website` oculto | siempre activo |
| Sesión 2h panel admin | `POST /api/admin-panel/session` | ya activo con `ADMIN_PANEL_KEY` |
| Login Google | GIS popup → `POST /api/auth/oauth/google` | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel) + `GOOGLE_OAUTH_CLIENT_ID` (Railway) |
| Login Apple | Apple JS popup → `POST /api/auth/oauth/apple` | `NEXT_PUBLIC_APPLE_CLIENT_ID` (Vercel) + `APPLE_OAUTH_CLIENT_ID` (Railway) |
| Separación por proveedor en admin | columna/filtro Provider + "Users by provider" | automático al haber usuarios OAuth |

---

## 1. Turnstile (Cloudflare) — ~10 minutos

1. Entra en <https://dash.cloudflare.com> → **Turnstile** → *Add site*.
2. Nombre: `Astryum`. Dominios: `astryum.xyz` (o el dominio real del frontend)
   **y** `localhost` si quieres probar en local con claves reales.
3. Modo del widget: **Managed** (invisible para humanos casi siempre).
4. Copia el par de claves:
   - **Site Key** → Vercel: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   - **Secret Key** → Railway: `TURNSTILE_SECRET_KEY` **y también** Vercel:
     `TURNSTILE_SECRET_KEY` (la necesita `/api/access-gate`, que corre en el
     servidor de Next, no en Express).
5. Redeploy de ambos.

**Claves de test oficiales** (para dev, siempre pasan):
sitekey `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

**Comportamiento sin configurar:** el widget no se renderiza y el backend no
exige token. Así el repo funciona en local sin red. En cuanto el secret existe,
el backend rechaza cualquier POST sin token válido (`403 captcha_required`).

⚠️ **Coherencia**: si pones el secret en el backend pero NO la sitekey en el
frontend, bloquearás a todo el mundo (el form no genera token). Ponlas siempre
en pareja.

## 2. Gate de acceso pre-lanzamiento (Vercel)

El viejo gate (usuario `admin` / contraseña `astryum2026`) **iba dentro del
bundle público y está quemado** — cualquiera pudo leerlo. El nuevo gate se
verifica en servidor y viaja como cookie httpOnly firmada que el middleware
comprueba en `/app/*`, `/login`, `/register` y `/forgot-password`.

En Vercel → Project Settings → Environment Variables (Production):

```
ACCESS_GATE_CODE=<código nuevo, p.ej. 4-5 palabras: "orbita-carbono-914-vela">
ACCESS_GATE_SECRET=<openssl rand -hex 32>
```

- El **código** es lo único que compartes con jueces/beta testers (la puerta
  oculta sigue igual: 5 clics en el logo o Ctrl+Shift+L → modal → código).
- El **secret** no se comparte con nadie: firma la cookie.
- **Sin estas envs en producción el gate queda CERRADO** (fail-closed): nadie
  entra hasta que las siembres. En dev local sin envs, abierto.
- Rotar el código = cambiar la env + redeploy. Las cookies ya emitidas siguen
  siendo válidas hasta 7 días; para invalidarlas todas, rota **el secret**.
- **Día de lanzamiento**: `ACCESS_GATE_OPEN=1` (o `true` / `yes` / `on`) en
  Vercel y el gate entero se aparta. Comprobación desde fuera, sin cookies:
  `curl -s https://astryum.xyz/api/access-gate` → `{"access":true,"open":true}`.
  Si devuelve `open:false`, el interruptor **no** está puesto y los seis CTAs
  dorados de la landing rebotan a la portada (2026-08-07: parecía "el botón no
  funciona en el móvil" — el escritorio del fundador aún tenía la cookie).

## 3. Panel admin — qué cambió y cómo entrar

- Tecleas la `ADMIN_PANEL_KEY` **una vez** (con captcha). El backend la cambia
  por un **token de sesión de 2 horas**; la key cruda ya no se guarda en el
  navegador ni viaja en cada request.
- 10 intentos fallidos por IP / 15 min → `429` antes de comparar nada.
- A las 2h el panel vuelve a la tarjeta de login con "Session expired".
- La puerta `x-admin-key` sigue funcionando para `curl` (misma protección de
  intentos), y la puerta futura `ADMIN_EMAILS` no se ha tocado.
- Anti-phishing práctico: la key solo se teclea en `/app/admin` (que además
  queda detrás del gate del §2 — doble puerta), el panel sigue respondiendo
  404 si no está configurado, y lo robable a posteriori es un token que expira
  en 2h con scope solo-lectura del panel. Marca la URL real en favoritos y
  teclea la key únicamente ahí.

## 4. Google Sign-In — paso a paso

**Consola (una vez):**

1. <https://console.cloud.google.com> → crea el proyecto `astryum` (o reutiliza).
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** → App name `Astryum`, soporte y dominio
     `astryum.xyz`, logo opcional.
   - Scopes: solo los no sensibles por defecto (`email`, `profile`, `openid`).
   - Publica la app (*In production*). Sin verificación extra para estos scopes.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**. Name: `Astryum Web`.
   - **Authorized JavaScript origins**:
     - `https://astryum.xyz` (el dominio real del frontend)
     - `http://localhost:3000` (dev)
   - Redirect URIs: **ninguna** (usamos el popup de Google Identity Services,
     no redirect de servidor).
4. Copia el **Client ID** (`…apps.googleusercontent.com`).

**Envs:**

```
Vercel  → NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client id>
Railway → GOOGLE_OAUTH_CLIENT_ID=<el MISMO client id>
```

(El client id es público por diseño; el **client secret de Google no se usa**
— verificamos el id_token por firma JWKS, no hacemos intercambio de código.)

**Validación paso a paso:**

1. Redeploy front y back. En `/login` el botón placeholder de Google pasa a
   ser el botón oficial "Continue with Google" (oscuro).
2. Click → popup de Google → elige cuenta.
3. Deberías caer en `/app` con sesión. Si falla:
   - `origin_mismatch` en el popup → falta tu dominio en *Authorized
     JavaScript origins* (espera ~5 min tras añadirlo).
   - `503 oauth_not_configured` → falta `GOOGLE_OAUTH_CLIENT_ID` en Railway.
   - `401 oauth_token_invalid` → el client id de Railway no coincide con el
     de Vercel (audiencia distinta).
4. Panel admin → pestaña **Users**: el usuario nuevo sale con badge **Google**
   y cuenta en **Users by provider**.
5. En local: `http://localhost:3000` funciona si lo añadiste como origin.

## 5. Sign in with Apple — paso a paso

Requisitos: **Apple Developer Program de pago** (99 €/año) y **dominio real
con HTTPS** (Apple no permite `localhost` — valida en el deploy de Vercel o
con un túnel https tipo ngrok añadiendo ese dominio temporal).

**Portal (una vez), en <https://developer.apple.com/account>:**

1. **Certificates, Identifiers & Profiles → Identifiers → + → App ID**:
   - Type App, Bundle ID p.ej. `xyz.astryum.app`, marca la capability
     **Sign in with Apple** → Register.
2. **Identifiers → + → Services ID**:
   - Identifier p.ej. `xyz.astryum.web` ← **este string es tu client id**.
   - Regístralo, luego edítalo → marca **Sign in with Apple** → *Configure*:
     - Primary App ID: el App ID del paso 1.
     - **Domains**: `astryum.xyz` (dominio del frontend, sin scheme).
     - **Return URLs**: `https://astryum.xyz/login` — **exactamente** la URL
       que usará el widget (por defecto `<origin>/login`).
3. No necesitas crear la key `.p8`: el flujo es popup con `id_token` directo,
   sin intercambio servidor de `code` (eso solo hace falta para refresh tokens
   de Apple, que no usamos — emitimos sesión propia).

**Envs:**

```
Vercel  → NEXT_PUBLIC_APPLE_CLIENT_ID=xyz.astryum.web
          NEXT_PUBLIC_APPLE_REDIRECT_URI=https://astryum.xyz/login   (si difiere del default)
Railway → APPLE_OAUTH_CLIENT_ID=xyz.astryum.web
```

**Validación paso a paso:**

1. Redeploy. En `/login` (en el dominio real, no localhost) → botón Apple →
   popup de Apple → Face ID / contraseña de Apple ID.
2. Apple ofrece "Hide My Email": funciona igual — el relay
   `…@privaterelay.appleid.com` es un email verificado y la cuenta se crea
   con él.
3. Deberías caer en `/app`. Si falla:
   - `invalid_client` en el popup → el Services ID no coincide o el dominio /
     Return URL no está registrado tal cual (revisa https y path exactos).
   - `503 oauth_not_configured` → falta `APPLE_OAUTH_CLIENT_ID` en Railway.
   - Popup que se cierra sin más → revisa que el dominio esté en **Domains**
     del Services ID.
4. Panel admin → Users: badge **Apple**. El nombre solo llega en la PRIMERA
   autorización (Apple no lo repite); si el usuario lo denegó, queda el alias
   derivado del email.

## 6. Checklist de validación completa (tras sembrar envs)

- [ ] `/app` sin cookie → rebota a `/` (gate cerrado).
- [ ] Logo ×5 → modal → código nuevo + captcha → entra a `/login`.
- [ ] Código incorrecto ×9 → `429` (throttle del gate).
- [ ] `admin`/`astryum2026` en el login → "Credenciales inválidas" (ya no es puerta).
- [ ] Crear cuenta con captcha → entra; sin captcha resuelto el submit avisa.
- [ ] `POST /api/auth/login` por curl sin token → `403 captcha_required`.
- [ ] Waitlist: alta normal OK; el campo oculto `website` relleno → éxito fake sin fila nueva.
- [ ] Panel admin: key + captcha → entra; a las 2h pide key otra vez.
- [ ] Google y Apple: login end-to-end + badge correcto en Users.
- [ ] `npm test` en `backend/` en verde.

## 7. Día de lanzamiento

1. Vercel: `ACCESS_GATE_OPEN=1` (el gate se aparta; login/registro quedan
   protegidos por captcha + rate limits, que se quedan para siempre).
   **Verifica que prendió** antes de anunciar nada:
   `curl -s https://astryum.xyz/api/access-gate` debe decir `"open":true`, y
   `curl -sI https://astryum.xyz/login` debe dar `200`, no `307`. Tu navegador
   no sirve de prueba: si alguna vez tecleaste el código llevas la cookie
   `astryum_gate` (se auto-renueva cada visita) y entrarás igual con el gate
   cerrado. Prueba en incógnito o desde el móvil.
2. Decide si `TRIAL_WALLET_CAP_USD` entra en juego (hoy: invite-only).
3. Considera retirar la puerta `x-admin-key` dejando solo `ADMIN_EMAILS`.

## 8. Recordatorio de despliegue pendiente (ya existente + nuevo)

- `prisma migrate deploy` sigue pendiente en los DOS entornos, y ahora incluye
  la migración `20260723000000_oauth_identity` (authProvider/oauthSub/
  emailVerified). Sin ella, el login OAuth y el overview del panel fallarán.
- Envs nuevas: las de este documento. Ninguna es `NEXT_PUBLIC_` salvo las
  sitekeys/client-ids, que son públicas por diseño (invariante §2 intacto).
