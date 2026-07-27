# Astryum — Manifiesto de la rama `demo/hackathon-mvp`

**Fecha:** 2026-07-02 · **Base:** `main@8900cb6` (incluye el fix DERISK shortfall, audit M7)

Esta rama contiene **únicamente el código que usa la demo del hackathon** (frontend + backend).
El producto completo vive en `main` — las piezas eliminadas aquí NO están perdidas: son material
del grant y siguen en `main` con su historia.

## Método (Fase 1 — mapa de dependencias)

El keep-list se construyó **desde el grafo de imports** (madge 8, resolución vía tsconfig), no a ojo:

- **Entrypoints frontend:** las 5 pantallas del nav (`/app` Summary · `/app/asset-production`
  Strategy · `/app/portfolio` + tabs · `/app/wallets` · `/app/settings`), landing (`/`),
  auth (`/login`, `/register`, `/forgot-password`), `middleware.ts`, layouts/error/not-found,
  y los proxies server-side de Xaman (`app/api/xaman/*`).
- **Entrypoints backend:** los 16 routers que la demo llama (verificado grepeando el keep-set
  del frontend, no los clientes compartidos): `auth`, `passkey`, `walletRegistry`, `portfolio`,
  `risk`, `positions`, `rules`, `alerts`, `activity`, `integrations`, `flareDemo`, `ftso`,
  `aiChat`, `securityStepUp`, `agent`, `jurisdiction` + middleware (SIWE/chainGuard/stepUp/
  rateLimit) + boot (bootGuards/prisma/FTSOClient/FlareProvider/AutomationEngine/
  IntentTriggerService/ActivityService/ProviderHealthService) + `GoalParserService` + servidor
  MCP + los 7 scripts de verificación Flare/Kinetic.
- Un test se conserva ⟺ todos sus imports resuelven dentro del keep-set (clasificador automático).

**Resultado final:** frontend 111 vivos / 456 eliminados · backend 285 vivos (210 código + 64
suites + datos runtime) / 188 eliminados · 161 archivos de raíz/docs/dirs internos fuera.
**Total: 822 archivos tocados, −186.126 líneas vs `main`.**

> **Correcciones sobre el mapa inicial (honestidad del proceso):** el grafo de madge no ve
> (1) archivos cargados por convención (se restauró `index-simple.ts`, que requiere routers
> dinámicamente y por diseño no era entrypoint), ni (2) recursos no-TS cargados en runtime
> (se restauraron `config/abis/*.json` y `kinetic.runtime.json` cuando la suite del
> control-plane los echó en falta — los consumen `CalldataBuilder` y el allowlist). Ambos
> casos los detectó la verificación por oleada (suite en rojo → restaurar → verde), que es
> exactamente para lo que estaba.

## Qué se conserva (resumen)

- **Frontend (111):** las 5 pantallas + tabs absorbidas (Capital Map / Positions / Activity),
  `FlareDemoEarn` (Strategy: NLP client-side `compileCarryPhrase` → `/flare-demo/*/prepare`),
  landing + gate de acceso, auth/sesión (SIWE + passkey), infra wallets (wagmi/AppKit,
  MetaMask, Xaman, Turnkey embedded), `portfolioMerge` (fuente única del dashboard),
  `healthScore`, i18n ES/EN, step-up, stores, y los stubs de `next.config.js`.
- **Backend (210 + 64 suites):** los 16 routers de la demo y su cierre transitivo — que
  incluye el árbol invariante (`bootGuards`, `PolicyGuard`, `CalldataBuilder`, `IntentEngine`),
  toda la maquinaria Carry FXRP (`FlareSmartAccountService`, `FlareDirectMintService`,
  `KineticIsoMath`, `KineticAdapter` ISO+primario), **los 8 adapters Flare** (ver dudas),
  los providers multichain del read-path del Portfolio (Hedera/XDC/EVM, Morpho math),
  scanners GoPlus, prisma completo (schema + migraciones), y los scripts de dry-run.
- **Raíz:** README (nuevo), CLAUDE.md (ajustado), INVARIANTS.md, DECISIONS.md, ARCHITECTURE.md,
  DESIGN.md, PRODUCT.md, Astryum_Strategy_Carry_FXRP_Spec.md,
  docs/context/{Defibro_Demos_Mainnet_Flare_Plan_2026-06-22, Astryum_BuildSpec_Carry_FXRP_2026-06-30},
  docs/regulatory/MICA_BOUNDARIES.md, docker-compose.yml + redis.conf (dev DB),
  railway/vercel configs, CI workflows, .gitleaks.toml.

## Qué se elimina y por qué

| Grupo | Por qué |
|---|---|
| SPA legacy (`App.tsx`, `index.tsx` y su árbol: `flows/`, `sections/`, `guardian/`, `simulation/`…) | Next no la renderiza; aquí viven la mayoría de los 2242 errores TS |
| ~39 páginas fuera del nav de 5 (safe-markets, moneyflows, manager/delegación, calculators, agent console viejo, triggered/*, os, watch, stellar-swap…) | Huérfanas: ningún import ni link desde el keep-set |
| Stubs de redirect (`/app/capital`, `/app/positions`, `/app/activity`…) | Solo mantenían deep-links viejos; el nav usa `?tab=` |
| 46 routers backend no llamados por la demo (moneyflows, tx, swap, tax, goals, manager, delegation, treasury, kyc, pools, canonical, watch, xaman-backend…) | Ningún fetch desde el frontend vivo; sus mounts se editan en `index-simple.ts` |
| Servicios exclusivos de esos routers (CapitalMapService, MoneyflowActionService, TrackRecordBuilder, PoolIngestion, BundleBuilder/Watcher, ConditionalAuth, TurnkeyTreasury, contractResolvers, providers tax/swap/intent/defi no alcanzados…) | Sin importadores tras quitar sus routers |
| Módulos con **cero importadores ya en main** (ExecutionReceiptService, ConfirmationWatcherService, LegalPolicyGuard, WalletDiscovery/WalletWatchlist, Flywheel, ABIResolver, ApprovalService, deprecated FlareFinanceConnector/SparkDexConnector…) | Muertos también en el producto completo (nota para main) |
| 22 suites backend + 12 archivos de test frontend (vitest/playwright legacy) | Testean código eliminado |
| Raíz: `OUT OF DEFIBRO/`, `mobile/`, `monitoring/`, `deployment/`, `memory/`, `scripts/*.bat`, `config/*.env`, basura B6 (FIXES_SUMMARY.txt, MoneyFlow_*, tx_copy.tmp, global.css), docker-compose.prod.yml | No son la demo; algunos (k8s `secrets.yaml`, `config/*.env`) ni deben enseñarse |
| Docs internos (11 de docs/context, Defibro-Validated_Architecture.md, Astryum_Audit_Report_2026-07.md, SETUP_COMPLETO.md) | Material de estrategia/auditoría interna — vive en `main`; el informe de auditoría además señala dónde hubo secretos en la historia |

## Conservado con duda (se queda y se reporta)

1. **Los 8 adapters Flare** (incl. Enosys, Firelight, SparkDEX, **Sceptre**): el prompt los marcaba
   candidatos como "inertes", pero el grafo demuestra que `routes/positions` y `PortfolioEngine`
   registran TODOS via `registerFlareAdapters()` como **scanners de lectura** (`discoverPositions`)
   — alimentan posiciones potencialmente visibles en Portfolio (regla: no romper un balance visible).
   Sceptre NO está expuesto como venue en Strategy (verificado), solo como read-scanner.
2. **`routes/jurisdiction`**: el frontend no lo llama, pero es la superficie HTTP del interruptor
   por jurisdicción (invariante #5). 1 archivo; fuera de toda duda razonable → se queda.
3. **`GoalParserService`**: mandato explícito del prompt (capa NLP). Matiz: la UI de Strategy compila
   NLP **client-side** (`compileCarryPhrase`); `/api/agent` + MCP + GoalParser quedan como la capa
   NLP server-side aunque la demo actual no los invoque desde la UI.
4. **`accessConfig.ts`** con password hardcodeada (audit M5): gate 100% client-side; cambiarlo
   rompería el deploy en vivo (decisión de producto pendiente — así viaja a esta rama).
5. **`tools/page.tsx` + `integrations/page.tsx`**: fuera del nav de 5, pero la pantalla Settings
   los importa como sub-superficies → rutas `/app/tools` y `/app/integrations` siguen vivas.
6. **`providers multichain`** (Hedera/XDC RPC, Morpho math, sUSDS kinds): en el cierre del
   read-path del Portfolio (multi-chain en datos aunque la demo sea Flare-céntrica).
7. **`prisma/` completo**: el schema conserva tablas de features eliminadas — es capa de datos,
   inofensivo, y las migraciones deben permanecer consistentes (RLS incluida).
8. **`src/stubs/` frontend**: `next.config.js` los usa para stubbear `@walletconnect/core` (además
   de reactflow) — se quedan aunque el grafo no los vea.

## Decisiones abiertas para el founder

1. **Secretos en la historia git:** Enso/Zerion rotadas (confirmado); **el password de Supabase
   (commit `14f8fb9`) sigue sin confirmación de rotación**. El repo es PRIVADO hoy, así que pushear
   esta rama no expone nada nuevo — pero **antes de hacerla pública o compartirla**: rotar +
   decidir purga (`git filter-repo`) o variante **orphan-branch** (un commit limpio sin historia).
   Decisión del founder, no aplicada aquí.
2. **Sceptre:** no expuesto en Strategy; conservado solo como read-scanner. Si se quiere fuera
   del todo, hay que editar `registerFlareAdapters()` (cambio de registry, seguro).
3. **OOM del `next build`:** pendiente de confirmar tras la poda si el sandbox sigue sin poder
   compilar (limitación de memoria del codespace, no de código) — se contrasta con Frontend CI.
4. **Password del gate de acceso (M5)** hardcodeada en cliente: mover a env de Vercel cuando se
   decida el comportamiento del deploy.
5. **Muertos-en-main:** ExecutionReceiptService / ConfirmationWatcher / LegalPolicyGuard tienen
   cero importadores también en `main` — decidir allí si se cablean (invariante #11) o se retiran.
6. **Typecheck como bloqueante:** con el frontend a 0 errores, se puede quitar
   `ignoreBuildErrors: true` de `next.config.js` y hacer el typecheck de Frontend CI bloqueante.
   No se hizo aquí para no cambiar el comportamiento del deploy en vivo sin tu OK.
7. **`@types/react` a ^19 en frontend:** corrige la duplicación 18/19 (raíz del grueso de los
   errores residuales). Si algo del deploy de Vercel dependía del pin a 18, revisar — local y
   build verdes con 19.

## Métricas (antes → después, medidas reales)

| Métrica | Antes (main@8900cb6) | Después |
|---|---|---|
| Archivos trackeados | 1340 | **535** (−60%) |
| Archivos frontend/src | 567 | **111** (−80%) |
| Archivos backend/src | 473 | **285** (−40%) |
| LOC frontend+backend src | 224 285 | **83 936** (−63%) |
| **Errores TS frontend** | **2242** | **0** |
| Errores TS backend | 0 | **0** |
| Suites backend | 85 verdes / 845 tests | **63 verdes / 662 tests** (las 22 quitadas testeaban código eliminado) |
| Dependencias directas (root/fe/be) | 41 / 94 / 57 (=192) | **4 / 56 / 40 (=100)** |
| Paquetes en node_modules | ~1650 | **~857** (−800 en el reinstall) |
| `next build` en el sandbox | **OOM — nunca completaba** | **✓ exit 0, compila en ~2.0 min** con `NODE_OPTIONS=--max-old-space-size=2048` |
| Bundle | n/a (no compilaba local) | 14 rutas (solo demo) · First Load JS compartido 2.85 MB |

Sobre los errores TS: 2191 de los 2242 se evaporaron con el código muerto. Los 51 restantes
eran deuda **preexistente en archivos vivos compartidos** (duplicación @types/react 18/19 con
react 19, conflictos `declare global Window.ethereum` vs @reown/appkit, tipos de metadata
incompletos, métodos muertos internos) — cero errores `TS2307 cannot find module`, lo que
confirma que el mapeo vivo/muerto fue correcto. Se arreglaron con cambios types-only /
borrado de código muerto interno, sin tocar lógica de builders (detalle en el commit
`prune(frontend)`). `ignoreBuildErrors: true` sigue en `next.config.js` como estaba — decisión
abierta activarlo como bloqueante ahora que hay 0.

Sobre el OOM: la nota de la auditoría queda **confirmada como limitación del sandbox, no del
código** — con la poda + heap acotado el build completa localmente; sin el cap, el OOM-killer
del codespace (2 vCPU / 8 GB) lo mata igual. CI no tiene ese límite.

## Confirmación del invariante en la rama podada

- `bootGuards.assertNoCustodialKeys` intacto y en el boot; PolicyGuard/CalldataBuilder/
  IntentEngine (árbol invariante) intactos — **ni una línea de los builders testeados cambió**
  (los 662 tests que quedan pasan sin modificación, salvo los 12 nuevos del fix M7 previo).
- Smoke sobre el server arrancado: `/api/flare-demo/*` responde **401 sin sesión SIWE** (nada
  se firma ni se broadcasted; el server ni siquiera tiene claves), `/health` y `/api/status`
  200, rutas podadas 404, `/api/ftso` lee FTSO en vivo.
- Scan de secretos (gitleaks 8.24.3 + `.gitleaks.toml` del repo) sobre el árbol trackeado:
  **0 hallazgos**.

## Cómo correr la rama

Ver [README.md](README.md) (reescrito para esta rama). Resumen: `npm install` en la raíz;
backend: copiar `.env.example` → `.env` (DATABASE_URL + `FLARE_DEFI_ENABLED=true`),
`npx prisma generate && npx prisma migrate deploy`, `npm run dev` (:3001); frontend: copiar
`.env.example` → `.env.local`, `npm run dev` (:3000). Build de producción del frontend en
máquinas pequeñas: `NODE_OPTIONS=--max-old-space-size=2048 npx next build`.

---

### Frontend — eliminados por directorio
- `frontend/src/hooks` — 36 archivos
- `frontend/src/components/strategy` — 35 archivos
- `frontend/src/services` — 25 archivos
- `frontend/src/flows/nodes/types` — 20 archivos
- `frontend/src/types` — 19 archivos
- `frontend/src/utils` — 16 archivos
- `frontend/src/components/ui` — 16 archivos
- `frontend/src/components/charts` — 13 archivos
- `frontend/src/components/os` — 11 archivos
- `frontend/src/lib/wallet` — 9 archivos
- `frontend/src/flows/components` — 9 archivos
- `frontend/src/flows/canvas` — 8 archivos
- `frontend/src/components/wallet` — 8 archivos
- `frontend/src/providers` — 7 archivos
- `frontend/src/flows/templates` — 7 archivos
- `frontend/src/components/forms` — 7 archivos
- `frontend/src/sections` — 6 archivos
- `frontend/src/lib/utils` — 6 archivos
- `frontend/src/flows/simulation` — 6 archivos
- `frontend/src/flows/execution` — 6 archivos
- `frontend/src/stores` — 5 archivos
- `frontend/src/lib/storage` — 5 archivos
- `frontend/src/lib/defi` — 5 archivos
- `frontend/src/lib/blockchain` — 5 archivos
- `frontend/src/lib/api` — 5 archivos
- `frontend/src/hooks/wallet` — 5 archivos
- `frontend/src/flows/validation` — 5 archivos
- `frontend/src/components/portfolio` — 5 archivos
- `frontend/src/components/instance` — 5 archivos
- `frontend/src/components/dashboard` — 5 archivos
- `frontend/src/hooks/websocket` — 4 archivos
- `frontend/src/flows/nodes` — 4 archivos
- `frontend/src/components/notifications` — 4 archivos
- `frontend/src/components/layout` — 4 archivos
- `frontend/src/components/defi` — 4 archivos
- `frontend/src/components/calculators` — 4 archivos
- `frontend/src/__tests__/components` — 4 archivos
- `frontend/src/simulation` — 3 archivos
- `frontend/src/lib/types` — 3 archivos
- `frontend/src/flows/nodes/components` — 3 archivos
- `frontend/src/flows` — 3 archivos
- `frontend/src/config` — 3 archivos
- `frontend/src/components/workspace` — 3 archivos
- `frontend/src/components/partners` — 3 archivos
- `frontend/src/components` — 3 archivos
- `frontend/src/app/os` — 3 archivos
- `frontend/src/__tests__/hooks` — 3 archivos
- `frontend/src/__tests__/e2e` — 3 archivos
- `frontend/src/wallet` — 2 archivos
- `frontend/src/validation` — 2 archivos
- `frontend/src/styles` — 2 archivos
- `frontend/src/lib` — 2 archivos
- `frontend/src/data` — 2 archivos
- `frontend/src/components/signing` — 2 archivos
- `frontend/src/components/positions` — 2 archivos
- `frontend/src/components/bundles` — 2 archivos
- `frontend/src/app/app/trading` — 2 archivos
- `frontend/src/app/app/swap` — 2 archivos
- `frontend/src/app/app/strategies` — 2 archivos
- `frontend/src/app/app/risk` — 2 archivos
- `frontend/src/app/app/ai` — 2 archivos
- `frontend/src` — 2 archivos
- `frontend/src/services/__tests__` — 1 archivos
- `frontend/src/lib/protocols` — 1 archivos
- `frontend/src/guardian` — 1 archivos
- `frontend/src/context` — 1 archivos
- `frontend/src/components/v11` — 1 archivos
- `frontend/src/components/triggers` — 1 archivos
- `frontend/src/components/transfers` — 1 archivos
- `frontend/src/components/security` — 1 archivos
- `frontend/src/components/flows` — 1 archivos
- `frontend/src/components/debug` — 1 archivos
- `frontend/src/app/xaman-login` — 1 archivos
- `frontend/src/app/watch` — 1 archivos
- `frontend/src/app/moneyflows` — 1 archivos
- `frontend/src/app/app/watchlist` — 1 archivos
- `frontend/src/app/app/triggered/strategy` — 1 archivos
- `frontend/src/app/app/triggered/send` — 1 archivos
- `frontend/src/app/app/triggered/buy-sell` — 1 archivos
- `frontend/src/app/app/triggered` — 1 archivos
- `frontend/src/app/app/trigger-rules` — 1 archivos
- `frontend/src/app/app/transactions` — 1 archivos
- `frontend/src/app/app/tax` — 1 archivos
- `frontend/src/app/app/stellar-swap` — 1 archivos
- `frontend/src/app/app/send` — 1 archivos
- `frontend/src/app/app/safe-markets` — 1 archivos
- `frontend/src/app/app/rules` — 1 archivos
- `frontend/src/app/app/positions` — 1 archivos
- `frontend/src/app/app/points` — 1 archivos
- `frontend/src/app/app/moneyflows` — 1 archivos
- `frontend/src/app/app/marketplace` — 1 archivos
- `frontend/src/app/app/mandates` — 1 archivos
- `frontend/src/app/app/managers/[id]` — 1 archivos
- `frontend/src/app/app/manager-dashboard` — 1 archivos
- `frontend/src/app/app/manager-apply` — 1 archivos
- `frontend/src/app/app/intents` — 1 archivos
- `frontend/src/app/app/goals/[id]/proposals` — 1 archivos
- `frontend/src/app/app/goals` — 1 archivos
- `frontend/src/app/app/earn-positions` — 1 archivos
- `frontend/src/app/app/delegate/[id]` — 1 archivos
- `frontend/src/app/app/capital` — 1 archivos
- `frontend/src/app/app/calculators` — 1 archivos
- `frontend/src/app/app/asset-info` — 1 archivos
- `frontend/src/app/app/alerts` — 1 archivos
- `frontend/src/app/app/agent` — 1 archivos
- `frontend/src/app/app/activity` — 1 archivos
- `frontend/src/__tests__` — 1 archivos

### Backend — eliminados por directorio
- `backend/src/routes` — 46 archivos
- `backend/src/services` — 33 archivos
- `backend/src/services/__tests__` — 15 archivos
- `backend/src/services/contractResolvers` — 9 archivos
- `backend/src/config/abis` — 8 archivos
- `backend/src/middleware` — 5 archivos
- `backend/src/integrations/providers/tax` — 5 archivos
- `backend/src/connectors/protocols` — 5 archivos
- `backend/src/websocket/channels` — 4 archivos
- `backend/src/validation/validators` — 4 archivos
- `backend/src/simulation/simulators` — 4 archivos
- `backend/src/websocket` — 3 archivos
- `backend/src/types/schemas` — 3 archivos
- `backend/src/services/walletRouting` — 3 archivos
- `backend/src/connectors/protocols/examples` — 3 archivos
- `backend/src/connectors/base` — 3 archivos
- `backend/src/canonical/types` — 3 archivos
- `backend/src/validation` — 2 archivos
- `backend/src/types/domain` — 2 archivos
- `backend/src/types` — 2 archivos
- `backend/src/simulation` — 2 archivos
- `backend/src/services/partners/adapters/__tests__` — 2 archivos
- `backend/src/integrations/providers/swap` — 2 archivos
- `backend/src/integrations/providers/intent` — 2 archivos
- `backend/src/integrations/providers/defi` — 2 archivos
- `backend/src/integrations/interfaces` — 2 archivos
- `backend/src/database` — 2 archivos
- `backend/src/control-plane/policy` — 2 archivos
- `backend/src/connectors/oracles/utils` — 2 archivos
- `backend/src/services/websocket` — 1 archivos
- `backend/src/services/walletRouting/__tests__` — 1 archivos
- `backend/src/services/wallet/__tests__` — 1 archivos
- `backend/src/services/wallet` — 1 archivos
- `backend/src/services/partners/adapters` — 1 archivos
- `backend/src/services/evm` — 1 archivos
- `backend/src/runtime` — 1 archivos
- `backend/src/integrations/providers/tax/__tests__` — 1 archivos
- `backend/src/integrations/providers/intent/__tests__` — 1 archivos
- `backend/src/integrations` — 1 archivos
- `backend/src/flare/ftso` — 1 archivos
- `backend/src/flare` — 1 archivos
- `backend/src/engines/execution/__tests__` — 1 archivos
- `backend/src/engines/execution` — 1 archivos
- `backend/src/control-plane` — 1 archivos
- `backend/src/connectors/oracles` — 1 archivos
- `backend/src/config` — 1 archivos
- `backend/src/canonical` — 1 archivos
- `backend/src` — 1 archivos
<details><summary>Frontend — lista completa (454 del mapa; +2 en verificación: PortfolioContext.tsx y types/portfolio.ts, par vestigial sin consumidores)</summary>

    frontend/src/App.tsx
    frontend/src/__tests__/MoneyFlowsBuilderTest.ts
    frontend/src/__tests__/components/Inspector.test.tsx
    frontend/src/__tests__/components/MoneyFlows.improved.test.tsx
    frontend/src/__tests__/components/MoneyFlows.test.tsx
    frontend/src/__tests__/components/NodePalette.test.tsx
    frontend/src/__tests__/e2e/execution.spec.ts
    frontend/src/__tests__/e2e/flow-creation.spec.ts
    frontend/src/__tests__/e2e/node-interaction.spec.ts
    frontend/src/__tests__/hooks/useFlowSimulation.test.tsx
    frontend/src/__tests__/hooks/useWallet.test.ts
    frontend/src/__tests__/hooks/useWebSocket.test.ts
    frontend/src/app/app/activity/page.tsx
    frontend/src/app/app/agent/page.tsx
    frontend/src/app/app/ai/_self.tsx
    frontend/src/app/app/ai/page.tsx
    frontend/src/app/app/alerts/page.tsx
    frontend/src/app/app/asset-info/page.tsx
    frontend/src/app/app/calculators/page.tsx
    frontend/src/app/app/capital/page.tsx
    frontend/src/app/app/delegate/[id]/page.tsx
    frontend/src/app/app/earn-positions/page.tsx
    frontend/src/app/app/goals/[id]/proposals/page.tsx
    frontend/src/app/app/goals/page.tsx
    frontend/src/app/app/intents/page.tsx
    frontend/src/app/app/manager-apply/page.tsx
    frontend/src/app/app/manager-dashboard/page.tsx
    frontend/src/app/app/managers/[id]/page.tsx
    frontend/src/app/app/mandates/page.tsx
    frontend/src/app/app/marketplace/page.tsx
    frontend/src/app/app/moneyflows/page.tsx
    frontend/src/app/app/points/page.tsx
    frontend/src/app/app/positions/page.tsx
    frontend/src/app/app/risk/_self.tsx
    frontend/src/app/app/risk/page.tsx
    frontend/src/app/app/rules/page.tsx
    frontend/src/app/app/safe-markets/page.tsx
    frontend/src/app/app/send/page.tsx
    frontend/src/app/app/stellar-swap/page.tsx
    frontend/src/app/app/strategies/_self.tsx
    frontend/src/app/app/strategies/page.tsx
    frontend/src/app/app/swap/_self.tsx
    frontend/src/app/app/swap/page.tsx
    frontend/src/app/app/tax/page.tsx
    frontend/src/app/app/trading/_self.tsx
    frontend/src/app/app/trading/page.tsx
    frontend/src/app/app/transactions/page.tsx
    frontend/src/app/app/trigger-rules/page.tsx
    frontend/src/app/app/triggered/buy-sell/page.tsx
    frontend/src/app/app/triggered/page.tsx
    frontend/src/app/app/triggered/send/page.tsx
    frontend/src/app/app/triggered/strategy/page.tsx
    frontend/src/app/app/watchlist/page.tsx
    frontend/src/app/moneyflows/page.tsx
    frontend/src/app/os/error.tsx
    frontend/src/app/os/layout.tsx
    frontend/src/app/os/page.tsx
    frontend/src/app/watch/page.tsx
    frontend/src/app/xaman-login/page.tsx
    frontend/src/components/ErrorBoundary.tsx
    frontend/src/components/LoadingSpinner.tsx
    frontend/src/components/ProtectedRoute.tsx
    frontend/src/components/bundles/BundleProgressBar.tsx
    frontend/src/components/bundles/EcosystemMissingModal.tsx
    frontend/src/components/calculators/ApyBreakdownCalculator.tsx
    frontend/src/components/calculators/ConcentratedRangeCalculator.tsx
    frontend/src/components/calculators/HealthFactorCalculator.tsx
    frontend/src/components/calculators/ImpermanentLossCalculator.tsx
    frontend/src/components/charts/GasChart.tsx
    frontend/src/components/charts/GasSpentChart.tsx
    frontend/src/components/charts/HealthFactorChart.tsx
    frontend/src/components/charts/HealthFactorGauge.tsx
    frontend/src/components/charts/ILChart.tsx
    frontend/src/components/charts/PerformanceChart.tsx
    frontend/src/components/charts/PortfolioChart.tsx
    frontend/src/components/charts/PriceChart.tsx
    frontend/src/components/charts/RiskDistributionChart.tsx
    frontend/src/components/charts/SlippageChart.tsx
    frontend/src/components/charts/StrategyComparisonChart.tsx
    frontend/src/components/charts/VolumeChart.tsx
    frontend/src/components/charts/index.ts
    frontend/src/components/dashboard/DeFibroDashboard.tsx
    frontend/src/components/dashboard/PortfolioOverview.tsx
    frontend/src/components/dashboard/QuickActions.tsx
    frontend/src/components/dashboard/StrategyCards.tsx
    frontend/src/components/dashboard/WorkspaceGrid.tsx
    frontend/src/components/debug/CanvasTest.tsx
    frontend/src/components/defi/DeFiCard.tsx
    frontend/src/components/defi/IntentAuthorizationModal.tsx
    frontend/src/components/defi/LiquidStakingCard.tsx
    frontend/src/components/defi/SwapPreparationModal.tsx
    frontend/src/components/flows/IntentReviewModal.tsx
    frontend/src/components/forms/AddressInput.tsx
    frontend/src/components/forms/AmountInput.tsx
    frontend/src/components/forms/ChainSelector.tsx
    frontend/src/components/forms/CronBuilder.tsx
    frontend/src/components/forms/DynamicForm.tsx
    frontend/src/components/forms/PercentageSlider.tsx
    frontend/src/components/forms/TokenSelector.tsx
    frontend/src/components/instance/HistoryTab.tsx
    frontend/src/components/instance/MonitorTab.tsx
    frontend/src/components/instance/RulesTab.tsx
    frontend/src/components/instance/SettingsTab.tsx
    frontend/src/components/instance/StrategyTab.tsx
    frontend/src/components/layout/AIFloatingChat.tsx
    frontend/src/components/layout/Header.tsx
    frontend/src/components/layout/ModeSwitch.tsx
    frontend/src/components/layout/Sidebar.tsx
    frontend/src/components/notifications/AlertBadge.tsx
    frontend/src/components/notifications/NotificationCenter.tsx
    frontend/src/components/notifications/NotificationSettings.tsx
    frontend/src/components/notifications/Toast.tsx
    frontend/src/components/os/AstryumOS.tsx
    frontend/src/components/os/CapitalCanvas.tsx
    frontend/src/components/os/CapitalNode.tsx
    frontend/src/components/os/CopilotRail.tsx
    frontend/src/components/os/Dock.tsx
    frontend/src/components/os/Panel.tsx
    frontend/src/components/os/SystemBar.tsx
    frontend/src/components/os/apps.tsx
    frontend/src/components/os/graph.ts
    frontend/src/components/os/panels.tsx
    frontend/src/components/os/useViewport.ts
    frontend/src/components/partners/MoonPayBuyPanel.tsx
    frontend/src/components/partners/MoonPayModal.tsx
    frontend/src/components/partners/MoonPaySellPanel.tsx
    frontend/src/components/portfolio/AssetCard.tsx
    frontend/src/components/portfolio/Portfolio.tsx
    frontend/src/components/portfolio/PortfolioOverview.tsx
    frontend/src/components/portfolio/TokenList.tsx
    frontend/src/components/portfolio/WalletGroupingControls.tsx
    frontend/src/components/positions/FlareOnChainScan.tsx
    frontend/src/components/positions/ImportedPositionBanner.tsx
    frontend/src/components/security/ReadLockOverlay.tsx
    frontend/src/components/signing/SwapIntentModal.tsx
    frontend/src/components/signing/WalletSignTab.tsx
    frontend/src/components/strategy/AIRecommendationEngine.tsx
    frontend/src/components/strategy/BacktestingEngine.tsx
    frontend/src/components/strategy/BenchmarkComparison.tsx
    frontend/src/components/strategy/CrossWorkspaceView.tsx
    frontend/src/components/strategy/DragDropContainer.tsx
    frontend/src/components/strategy/EmbeddedYieldCalculator.tsx
    frontend/src/components/strategy/EmptyStates.README.md
    frontend/src/components/strategy/EmptyStates.examples.tsx
    frontend/src/components/strategy/EmptyStates.tsx
    frontend/src/components/strategy/ExportOptions.tsx
    frontend/src/components/strategy/ImportDialog.tsx
    frontend/src/components/strategy/ImportExport.tsx
    frontend/src/components/strategy/IntelligentAlerts.tsx
    frontend/src/components/strategy/MoneyFlowCanvasView.tsx
    frontend/src/components/strategy/MoneyFlowCard.tsx
    frontend/src/components/strategy/MoneyFlowCardExample.tsx
    frontend/src/components/strategy/MoneyFlowCreator.tsx
    frontend/src/components/strategy/PerformanceAnalytics.tsx
    frontend/src/components/strategy/README.md
    frontend/src/components/strategy/StrategyComparator.tsx
    frontend/src/components/strategy/StrategyDocumentation.tsx
    frontend/src/components/strategy/StrategyFolderCreator.tsx
    frontend/src/components/strategy/StrategyMap.tsx
    frontend/src/components/strategy/StrategyOverview.tsx
    frontend/src/components/strategy/StrategySharing.tsx
    frontend/src/components/strategy/StrategySidebar.improved.tsx
    frontend/src/components/strategy/StrategySidebar.tsx
    frontend/src/components/strategy/StrategyTemplates.tsx
    frontend/src/components/strategy/TemplateCard.tsx
    frontend/src/components/strategy/TemplatePreview.tsx
    frontend/src/components/strategy/WalletsDrawer.tsx
    frontend/src/components/strategy/YieldCalculator.tsx
    frontend/src/components/strategy/YieldCalculatorTable.tsx
    frontend/src/components/strategy/YieldComparison.tsx
    frontend/src/components/strategy/YieldProjections.tsx
    frontend/src/components/transfers/TransferModal.tsx
    frontend/src/components/triggers/TriggerNotificationBanner.tsx
    frontend/src/components/ui/DefibroLoader.tsx
    frontend/src/components/ui/ErrorBoundary.tsx
    frontend/src/components/ui/LoadingSkeleton.tsx
    frontend/src/components/ui/Modal.tsx
    frontend/src/components/ui/NotificationSystem.tsx
    frontend/src/components/ui/label.tsx
    frontend/src/components/ui/progress.tsx
    frontend/src/components/ui/radio-group.tsx
    frontend/src/components/ui/select.tsx
    frontend/src/components/ui/separator.tsx
    frontend/src/components/ui/skeleton.tsx
    frontend/src/components/ui/slider.tsx
    frontend/src/components/ui/switch.tsx
    frontend/src/components/ui/textarea.tsx
    frontend/src/components/ui/toast.tsx
    frontend/src/components/ui/tooltip.tsx
    frontend/src/components/v11/PolicyBlockedModal.tsx
    frontend/src/components/wallet/QRWalletDialog.tsx
    frontend/src/components/wallet/SignatureRequest.tsx
    frontend/src/components/wallet/WalletBalance.tsx
    frontend/src/components/wallet/WalletConnector.tsx
    frontend/src/components/wallet/WalletModal.tsx
    frontend/src/components/wallet/WalletRequired.tsx
    frontend/src/components/wallet/WalletSelector.tsx
    frontend/src/components/wallet/XamanLoginButton.tsx
    frontend/src/components/workspace/CoordinationView.tsx
    frontend/src/components/workspace/InstanceGrid.tsx
    frontend/src/components/workspace/WorkspaceControls.tsx
    frontend/src/config/strategyConfig.ts
    frontend/src/config/tokens.ts
    frontend/src/config/websocket.ts
    frontend/src/context/StrategyContext.tsx
    frontend/src/data/data.ts
    frontend/src/data/strategyTemplates.ts
    frontend/src/flows/canvas/CanvasControls.tsx
    frontend/src/flows/canvas/EmptyState.tsx
    frontend/src/flows/canvas/FlowCanvas.tsx
    frontend/src/flows/canvas/GridBackground.tsx
    frontend/src/flows/canvas/MiniMapCustom.tsx
    frontend/src/flows/canvas/NodePalette.tsx
    frontend/src/flows/canvas/QuickAddButton.tsx
    frontend/src/flows/canvas/SelectionBox.tsx
    frontend/src/flows/components/ExecutionControls.tsx
    frontend/src/flows/components/ExecutionTimeline.tsx
    frontend/src/flows/components/FlowMetrics.tsx
    frontend/src/flows/components/Inspector.tsx
    frontend/src/flows/components/NodeConfigurations.tsx
    frontend/src/flows/components/NotificationCenter.tsx
    frontend/src/flows/components/OnboardingTour.tsx
    frontend/src/flows/components/SimulationPanel.tsx
    frontend/src/flows/components/TemplateGallery.tsx
    frontend/src/flows/execution/ExecutionControls.tsx
    frontend/src/flows/execution/ExecutionTimeline.tsx
    frontend/src/flows/execution/compensationHandler.ts
    frontend/src/flows/execution/executionEngine.ts
    frontend/src/flows/execution/transactionManager.ts
    frontend/src/flows/execution/useFlowExecution.ts
    frontend/src/flows/index.ts
    frontend/src/flows/nodes.tsx
    frontend/src/flows/nodes/Inspector.tsx
    frontend/src/flows/nodes/NodeHandle.tsx
    frontend/src/flows/nodes/NodeStatus.tsx
    frontend/src/flows/nodes/NodeWrapper.tsx
    frontend/src/flows/nodes/components/NodeHeader.tsx
    frontend/src/flows/nodes/components/NodeStatus.tsx
    frontend/src/flows/nodes/components/NodeWrapper.tsx
    frontend/src/flows/nodes/types/BorrowNode.tsx
    frontend/src/flows/nodes/types/BridgeNode.tsx
    frontend/src/flows/nodes/types/BudgetNode.tsx
    frontend/src/flows/nodes/types/CalcNode.tsx
    frontend/src/flows/nodes/types/ConditionNode.tsx
    frontend/src/flows/nodes/types/DataNode.tsx
    frontend/src/flows/nodes/types/GuardNode.tsx
    frontend/src/flows/nodes/types/LPAddNode.tsx
    frontend/src/flows/nodes/types/LPRemoveNode.tsx
    frontend/src/flows/nodes/types/LendNode.tsx
    frontend/src/flows/nodes/types/NotifyNode.tsx
    frontend/src/flows/nodes/types/RepayNode.tsx
    frontend/src/flows/nodes/types/StakeNode.tsx
    frontend/src/flows/nodes/types/SubflowNode.tsx
    frontend/src/flows/nodes/types/SwapNode.tsx
    frontend/src/flows/nodes/types/TransferNode.tsx
    frontend/src/flows/nodes/types/TriggerNode.tsx
    frontend/src/flows/nodes/types/UnstakeNode.tsx
    frontend/src/flows/nodes/types/WalletNode.tsx
    frontend/src/flows/nodes/types/WebhookNode.tsx
    frontend/src/flows/simulation/SimulationPanel.tsx
    frontend/src/flows/simulation/SimulationResults.tsx
    frontend/src/flows/simulation/gasSimulator.ts
    frontend/src/flows/simulation/priceSimulator.ts
    frontend/src/flows/simulation/riskSimulatior.ts
    frontend/src/flows/simulation/useFlowSimulation.ts
    frontend/src/flows/templates/TemplateCard.tsx
    frontend/src/flows/templates/TemplateLibrary.tsx
    frontend/src/flows/templates/arbitrage-templates.ts
    frontend/src/flows/templates/dca-templates.ts
    frontend/src/flows/templates/hedge-templates.ts
    frontend/src/flows/templates/templates.ts
    frontend/src/flows/templates/yield-templates.ts
    frontend/src/flows/types.ts
    frontend/src/flows/validation/constraintValidator.ts
    frontend/src/flows/validation/flowValidator.ts
    frontend/src/flows/validation/nodeValidators.ts
    frontend/src/flows/validation/riskValidator.ts
    frontend/src/flows/validation/schemaValidator.ts
    frontend/src/guardian/EmergencyGuardian.ts
    frontend/src/hooks/useAIChat.ts
    frontend/src/hooks/useAuthStore.ts
    frontend/src/hooks/useBundleSocket.ts
    frontend/src/hooks/useCanonicalBridge.ts
    frontend/src/hooks/useClipboard.ts
    frontend/src/hooks/useDebounce.ts
    frontend/src/hooks/useDragAndDrop.ts
    frontend/src/hooks/useFlowExecution.ts
    frontend/src/hooks/useFlowExecutionV1.ts
    frontend/src/hooks/useFlowSimulation.ts
    frontend/src/hooks/useFlowStorage.ts
    frontend/src/hooks/useFlowValidation.ts
    frontend/src/hooks/useInstances.ts
    frontend/src/hooks/useIntersectionObserver.ts
    frontend/src/hooks/useInterval.ts
    frontend/src/hooks/useKeyboardNavigation.ts
    frontend/src/hooks/useLocalStorage.ts
    frontend/src/hooks/useMediaQuery.ts
    frontend/src/hooks/useMobileOptimization.ts
    frontend/src/hooks/useOrchestrator.ts
    frontend/src/hooks/usePerformanceOptimization.tsx
    frontend/src/hooks/usePortfolioData.ts
    frontend/src/hooks/usePositionScan.ts
    frontend/src/hooks/useProgress.ts
    frontend/src/hooks/useRealTimeData.ts
    frontend/src/hooks/useStrategies.ts
    frontend/src/hooks/useStrategyAnalytics.ts
    frontend/src/hooks/useStrategyComparison.ts
    frontend/src/hooks/useStrategyData.ts
    frontend/src/hooks/useStrategyDragDrop.ts
    frontend/src/hooks/useToast.ts
    frontend/src/hooks/useUndoRedo.ts
    frontend/src/hooks/useVirtualization.ts
    frontend/src/hooks/useWeb3.ts
    frontend/src/hooks/useWebSocket.ts
    frontend/src/hooks/useYieldCalculator.ts
    frontend/src/hooks/wallet/useSIWE.ts
    frontend/src/hooks/wallet/useSessionKeys.ts
    frontend/src/hooks/wallet/useTransactionStatus.ts
    frontend/src/hooks/wallet/useWallet.ts
    frontend/src/hooks/wallet/useWalletBalance.ts
    frontend/src/hooks/websocket/useFlowEvents.ts
    frontend/src/hooks/websocket/useNotifications.ts
    frontend/src/hooks/websocket/usePriceUpdates.ts
    frontend/src/hooks/websocket/useWebSocket.ts
    frontend/src/index.tsx
    frontend/src/lib/api/client.ts
    frontend/src/lib/api/executionApi.ts
    frontend/src/lib/api/flowsApi.ts
    frontend/src/lib/api/simulationApi.ts
    frontend/src/lib/api/webhooksApi.ts
    frontend/src/lib/blockchain/chains.ts
    frontend/src/lib/blockchain/contracts.ts
    frontend/src/lib/blockchain/gasEsyimator.ts
    frontend/src/lib/blockchain/tokens.ts
    frontend/src/lib/blockchain/transactionBuilder.ts
    frontend/src/lib/constants.ts
    frontend/src/lib/defi/apy.ts
    frontend/src/lib/defi/concentratedRange.ts
    frontend/src/lib/defi/healthFactor.ts
    frontend/src/lib/defi/impermanentLoss.ts
    frontend/src/lib/defi/index.ts
    frontend/src/lib/logger.ts
    frontend/src/lib/protocols/ProtocolDescriptor.ts
    frontend/src/lib/storage/backupManager.ts
    frontend/src/lib/storage/flowStorage.ts
    frontend/src/lib/storage/importExport.ts
    frontend/src/lib/storage/migrationManager.ts
    frontend/src/lib/storage/versionManager.ts
    frontend/src/lib/types/api.ts
    frontend/src/lib/types/blockchain.ts
    frontend/src/lib/types/index.ts
    frontend/src/lib/utils/constants.ts
    frontend/src/lib/utils/errors.ts
    frontend/src/lib/utils/format.ts
    frontend/src/lib/utils/formatters.ts
    frontend/src/lib/utils/performance.ts
    frontend/src/lib/utils/validation.ts
    frontend/src/lib/wallet/WalletSigning.ts
    frontend/src/lib/wallet/ecosystemTypes.ts
    frontend/src/lib/wallet/useAptosWalletPartner.ts
    frontend/src/lib/wallet/useBlend.ts
    frontend/src/lib/wallet/useSigningSession.ts
    frontend/src/lib/wallet/useSolanaWalletPartner.ts
    frontend/src/lib/wallet/useStellarSwap.ts
    frontend/src/lib/wallet/useStellarWalletPartner.ts
    frontend/src/lib/wallet/useWalletRouting.ts
    frontend/src/providers/AnalyticsProvider.tsx
    frontend/src/providers/AuthProvider.tsx
    frontend/src/providers/QueryProvider.tsx
    frontend/src/providers/RealTimeProvider.tsx
    frontend/src/providers/ThemeProvider.tsx
    frontend/src/providers/ToastProvider.tsx
    frontend/src/providers/index.tsx
    frontend/src/sections/Dashboard.tsx
    frontend/src/sections/MoneyFlows.tsx
    frontend/src/sections/Portfolio.full.tsx
    frontend/src/sections/Portfolio.tsx
    frontend/src/sections/Settings.tsx
    frontend/src/sections/Strategies.tsx
    frontend/src/services/ErrorHandlingService.ts
    frontend/src/services/RealTimeDataService.ts
    frontend/src/services/__tests__/intentClient.test.ts
    frontend/src/services/aggregationService.ts
    frontend/src/services/aiStrategyService.ts
    frontend/src/services/alertService.ts
    frontend/src/services/analyticsService.ts
    frontend/src/services/authService.ts
    frontend/src/services/backtestingService.ts
    frontend/src/services/benchmarkService.ts
    frontend/src/services/documentationService.ts
    frontend/src/services/enhancedPortfolioService.ts
    frontend/src/services/importExportService.ts
    frontend/src/services/index.ts
    frontend/src/services/instanceService.ts
    frontend/src/services/instancesService.ts
    frontend/src/services/intentClient.ts
    frontend/src/services/notificationService.ts
    frontend/src/services/portfolioService.ts
    frontend/src/services/priceService.ts
    frontend/src/services/sharingService.ts
    frontend/src/services/strategiesService.ts
    frontend/src/services/strategyService.ts
    frontend/src/services/templateService.ts
    frontend/src/services/workspaceService.ts
    frontend/src/services/yieldService.ts
    frontend/src/simulation/ExecutionControls.tsx
    frontend/src/simulation/ExecutionTimeLine.tsx
    frontend/src/simulation/SignatureModal.tsx
    frontend/src/stores/index.ts
    frontend/src/stores/portfolioStore.ts
    frontend/src/stores/realTimeStore.ts
    frontend/src/stores/uiStore.ts
    frontend/src/stores/workspaceStore.ts
    frontend/src/styles/dragDropAnimations.css
    frontend/src/styles/reactflow-override.css
    frontend/src/types/AutoBudgetNode.tsx
    frontend/src/types/BridgeNode.tsx
    frontend/src/types/BudgetNode.tsx
    frontend/src/types/ConditionNode.tsx
    frontend/src/types/GuardNode.tsx
    frontend/src/types/IntentPayload.ts
    frontend/src/types/LendNode.tsx
    frontend/src/types/NotifyNode.tsx
    frontend/src/types/SubflowNode.tsx
    frontend/src/types/SwapNode.tsx
    frontend/src/types/TriggerNode.tsx
    frontend/src/types/WalletNode.tsx
    frontend/src/types/defi.ts
    frontend/src/types/global.d.ts
    frontend/src/types/index.ts
    frontend/src/types/react-types.d.ts
    frontend/src/types/strategy.ts
    frontend/src/types/web3.d.ts
    frontend/src/types/yield.ts
    frontend/src/utils/accessibility.ts
    frontend/src/utils/animations.ts
    frontend/src/utils/api.ts
    frontend/src/utils/chartUtils.ts
    frontend/src/utils/dragDropUtils.ts
    frontend/src/utils/index.ts
    frontend/src/utils/moneyFlowNavigation.ts
    frontend/src/utils/moneyflowBugfixTests.ts
    frontend/src/utils/navigationIntegration.ts
    frontend/src/utils/performanceUtils.ts
    frontend/src/utils/scopeUtils.ts
    frontend/src/utils/strategySync.ts
    frontend/src/utils/strategyUtils.ts
    frontend/src/utils/testing.ts
    frontend/src/utils/touchSupport.ts
    frontend/src/utils/yieldUtils.ts
    frontend/src/validation/flowValidator.ts
    frontend/src/validation/schemaValidator.ts
    frontend/src/wallet/TurnkeyProvider.tsx
    frontend/src/wallet/TurnkeyWalletProvider.ts

</details>

<details><summary>Backend — lista completa (199 del mapa; 11 restaurados en verificación: index-simple.ts, config/abis/*.json, kinetic.runtime.json, flare/ftso/README.md → 188 netos)</summary>

    backend/src/canonical/ChainCapabilities.ts
    backend/src/canonical/types/ExecutionReceipt.ts
    backend/src/canonical/types/RewardEvent.ts
    backend/src/canonical/types/index.ts
    backend/src/config/abis/AAVE_V3_POOL.json
    backend/src/config/abis/COMPOUND_V3_COMET.json
    backend/src/config/abis/ERC4626.json
    backend/src/config/abis/ETHERFI_LIQUIDITY_POOL.json
    backend/src/config/abis/LIDO.json
    backend/src/config/abis/MORPHO_BLUE.json
    backend/src/config/abis/ROCKET_POOL_DEPOSIT.json
    backend/src/config/abis/SCEPTRE.json
    backend/src/config/kinetic.runtime.json
    backend/src/connectors/base/WalletSigning.ts
    backend/src/connectors/base/wallet-signing.example.json
    backend/src/connectors/base/wallet-signing.schema.json
    backend/src/connectors/oracles/OracleClient.ts
    backend/src/connectors/oracles/utils/DerivationChecker.ts
    backend/src/connectors/oracles/utils/FreshnessValidator.ts
    backend/src/connectors/protocols/ProtocolConnector.ts
    backend/src/connectors/protocols/ProtocolDescriptor.ts
    backend/src/connectors/protocols/SparkDexConnector.ts
    backend/src/connectors/protocols/SquidRouterConnector.ts
    backend/src/connectors/protocols/examples/tapp-exchange.protocol.json
    backend/src/connectors/protocols/examples/uniswap-v2.protocol.json
    backend/src/connectors/protocols/examples/xrpl-payment.protocol.json
    backend/src/connectors/protocols/protocol.schema.json
    backend/src/control-plane/AssetMismatchDetector.ts
    backend/src/control-plane/policy/MandateRepository.ts
    backend/src/control-plane/policy/RiskImpactValidator.ts
    backend/src/database/DatabaseManager.ts
    backend/src/database/schema.sql
    backend/src/engines/execution/ExecutionEngine.ts
    backend/src/engines/execution/__tests__/ExecutionEngine.test.ts
    backend/src/flare/ftso/README.md
    backend/src/flare/index.ts
    backend/src/index-simple.ts
    backend/src/integrations/interfaces/IDataProvider.ts
    backend/src/integrations/interfaces/IWalletProvider.ts
    backend/src/integrations/providers/defi/BlendProvider.ts
    backend/src/integrations/providers/defi/SoroswapLPProvider.ts
    backend/src/integrations/providers/intent/AcrossProtocolProvider.ts
    backend/src/integrations/providers/intent/UniswapXProvider.ts
    backend/src/integrations/providers/intent/__tests__/ERC7683Providers.test.ts
    backend/src/integrations/providers/swap/OneInchSwapProvider.ts
    backend/src/integrations/providers/swap/SwapsXyzProvider.ts
    backend/src/integrations/providers/tax/BlockpitTaxProvider.ts
    backend/src/integrations/providers/tax/ITaxReportProvider.ts
    backend/src/integrations/providers/tax/KoinlyDeepLinkProvider.ts
    backend/src/integrations/providers/tax/__tests__/TaxReportProvider.test.ts
    backend/src/integrations/providers/tax/jurisdictions.ts
    backend/src/integrations/providers/tax/taxReportRegistry.ts
    backend/src/integrations/signatureWebSocket.ts
    backend/src/middleware/allowlistMiddleware.ts
    backend/src/middleware/auth.ts
    backend/src/middleware/cors.ts
    backend/src/middleware/errorHandler.ts
    backend/src/middleware/rateLimit.ts
    backend/src/routes/addressBook.ts
    backend/src/routes/admin.ts
    backend/src/routes/adminProtocols.ts
    backend/src/routes/aiV1.ts
    backend/src/routes/authorizationSession.ts
    backend/src/routes/blend.ts
    backend/src/routes/bundles.ts
    backend/src/routes/canonical.ts
    backend/src/routes/capital.ts
    backend/src/routes/data.ts
    backend/src/routes/delegation.ts
    backend/src/routes/devices.ts
    backend/src/routes/execution.ts
    backend/src/routes/flows.ts
    backend/src/routes/goals.ts
    backend/src/routes/hypernativeWebhook.ts
    backend/src/routes/intents.ts
    backend/src/routes/kyc.ts
    backend/src/routes/manager.ts
    backend/src/routes/mandates.ts
    backend/src/routes/moneyflowsCompat.ts
    backend/src/routes/notificationsV1.ts
    backend/src/routes/partners.ts
    backend/src/routes/points.ts
    backend/src/routes/policy.ts
    backend/src/routes/pools.ts
    backend/src/routes/protocols.ts
    backend/src/routes/referralPublic.ts
    backend/src/routes/rewards.ts
    backend/src/routes/security.ts
    backend/src/routes/signatures.ts
    backend/src/routes/simulate.ts
    backend/src/routes/strategies.ts
    backend/src/routes/swap.ts
    backend/src/routes/tax.ts
    backend/src/routes/transactions.ts
    backend/src/routes/transfer.ts
    backend/src/routes/treasury.ts
    backend/src/routes/triggerRules.ts
    backend/src/routes/tx.ts
    backend/src/routes/v1Execution.ts
    backend/src/routes/walletBindings.ts
    backend/src/routes/walletWatchlist.ts
    backend/src/routes/watch.ts
    backend/src/routes/watchlist.ts
    backend/src/routes/xaman.ts
    backend/src/runtime/ExecutionService.ts
    backend/src/services/ABIResolver.ts
    backend/src/services/ApprovalService.ts
    backend/src/services/BackupStrategyService.ts
    backend/src/services/BatchProposalService.ts
    backend/src/services/CapitalMapService.ts
    backend/src/services/ConditionalAuthService.ts
    backend/src/services/ConditionalIntentService.ts
    backend/src/services/ConfirmationWatcherService.ts
    backend/src/services/CrossmintKYCProvider.ts
    backend/src/services/ExecutionReceiptService.ts
    backend/src/services/FeasibilityAnalyzer.ts
    backend/src/services/FlywheelService.ts
    backend/src/services/GoalRequestRouter.ts
    backend/src/services/InstanceService.ts
    backend/src/services/LegalPolicyGuard.ts
    backend/src/services/ManagerApplicationService.ts
    backend/src/services/ManagerProfileService.ts
    backend/src/services/ManagerProposalService.ts
    backend/src/services/MoneyflowActionService.ts
    backend/src/services/PartnerExecutionSessionService.ts
    backend/src/services/PersonaKYCProvider.ts
    backend/src/services/PoolIngestionService.ts
    backend/src/services/ProposalAcceptanceService.ts
    backend/src/services/ReferralAttributionService.ts
    backend/src/services/RewardsService.ts
    backend/src/services/SwapService.ts
    backend/src/services/TaxEventService.ts
    backend/src/services/TrackRecordBuilder.ts
    backend/src/services/TransferService.ts
    backend/src/services/WalletDiscoveryService.ts
    backend/src/services/WalletIntentService.ts
    backend/src/services/WalletSigningService.ts
    backend/src/services/WalletWatchlistService.ts
    backend/src/services/__tests__/ABIResolver.test.ts
    backend/src/services/__tests__/ApprovalService.test.ts
    backend/src/services/__tests__/CapitalMapService.test.ts
    backend/src/services/__tests__/ConditionalIntentService.test.ts
    backend/src/services/__tests__/ConfirmationWatcherService.test.ts
    backend/src/services/__tests__/ExecutionReceiptService.test.ts
    backend/src/services/__tests__/FlywheelService.test.ts
    backend/src/services/__tests__/LegalPolicyGuard.test.ts
    backend/src/services/__tests__/MoneyflowActionService.test.ts
    backend/src/services/__tests__/PartnerAndTax.test.ts
    backend/src/services/__tests__/PartnerExecutionSessionService.test.ts
    backend/src/services/__tests__/RewardsService.test.ts
    backend/src/services/__tests__/TierAResolvers.test.ts
    backend/src/services/__tests__/WalletDiscoveryService.test.ts
    backend/src/services/__tests__/WalletWatchlistService.test.ts
    backend/src/services/contractResolvers/aaveV2Resolver.ts
    backend/src/services/contractResolvers/aaveV3Resolver.ts
    backend/src/services/contractResolvers/index.ts
    backend/src/services/contractResolvers/morphoBlueResolver.ts
    backend/src/services/contractResolvers/rocketPoolResolver.ts
    backend/src/services/contractResolvers/simpleResolvers.ts
    backend/src/services/contractResolvers/types.ts
    backend/src/services/contractResolvers/uniswapV3Resolver.ts
    backend/src/services/contractResolvers/unknownResolver.ts
    backend/src/services/evm/ERC20.ts
    backend/src/services/partners/adapters/MoonPayPartnerAdapter.ts
    backend/src/services/partners/adapters/__tests__/MoonPayPartnerAdapter.test.ts
    backend/src/services/partners/adapters/__tests__/MoonPaySellSession.test.ts
    backend/src/services/wallet/TurnkeyTreasuryService.ts
    backend/src/services/wallet/__tests__/TurnkeyTreasuryService.test.ts
    backend/src/services/walletRouting/BundleBuilder.ts
    backend/src/services/walletRouting/BundleStatusWatcher.ts
    backend/src/services/walletRouting/WalletRouter.ts
    backend/src/services/walletRouting/__tests__/BundleBuilder.test.ts
    backend/src/services/websocket/WebSocketManager.ts
    backend/src/simulation/FlowSimulator.ts
    backend/src/simulation/SimulationService.ts
    backend/src/simulation/simulators/BridgeSimulator.ts
    backend/src/simulation/simulators/GasEstimator.ts
    backend/src/simulation/simulators/LendingSimulator.ts
    backend/src/simulation/simulators/SwapSimulator.ts
    backend/src/types/domain/Automation.ts
    backend/src/types/domain/Chain.ts
    backend/src/types/express.d.ts
    backend/src/types/index.ts
    backend/src/types/schemas/automation.schema.ts
    backend/src/types/schemas/intent.schema.ts
    backend/src/types/schemas/position.schema.ts
    backend/src/validation/ValidationReports.ts
    backend/src/validation/ValidationService.ts
    backend/src/validation/validators/ConstraintValidator.ts
    backend/src/validation/validators/DomainValidator.ts
    backend/src/validation/validators/RiskValidator.ts
    backend/src/validation/validators/StructuralValidator.ts
    backend/src/websocket/channels/alertsChannel.ts
    backend/src/websocket/channels/flowsChannel.ts
    backend/src/websocket/channels/pricesChannel.ts
    backend/src/websocket/channels/txChannel.ts
    backend/src/websocket/duplication.ts
    backend/src/websocket/messageHandler.ts
    backend/src/websocket/server.ts

</details>
