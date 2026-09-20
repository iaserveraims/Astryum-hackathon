#!/usr/bin/env node
/**
 * check-i18n — ¿queda alguna cadena de interfaz sin traducir?
 *
 * Dos barridos, porque la copy de esta app viaja de DOS formas y un
 * comprobador que sólo mire una es ciego a la otra. Los dos huecos se
 * descubrieron en producción (auditoría 18-19 ago 2026), no en revisión:
 *
 *   A) `t('literal')` — el caso obvio.
 *   B) `t(vault.plain)`, `t(f.value)`, `t(leg)` — la copy del CATÁLOGO viaja
 *      como DATO dentro del array de cards y se traduce en tiempo de pintado.
 *      Un checker de literales no ve ni una: así se publicaron 22 cadenas en
 *      inglés en medio de una pantalla en castellano.
 *
 * Y la trampa del diccionario: `dict.ts` mezcla TRES formas de clave —
 * `'con comillas':`, `"con dobles":` y `SinComillas:` (identificador). Buscar
 * sólo la primera da falsos «faltan», y ese falso positivo casi mete 35 claves
 * duplicadas (lo cantó tsc con TS1117, no la revisión humana).
 *
 * Uso:  npm run check:i18n        (sale con código 1 si falta algo)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DICT = path.join(ROOT, 'src/i18n/dict.ts');

/** Pantallas cuya copy DEBE estar completa. Añade aquí lo que se publique. */
const SCREENS = [
  'src/components/positions/DefiPositionsBoard.tsx',
  'src/components/positions/EmExitModal.tsx',
  'src/components/positions/EmRepayModal.tsx',
  // La puerta de cerrar del todo (29-ago): entra en la lista desde el primer
  // dia — publicar no puede ser el momento de descubrir que la copy va en ingles.
  'src/components/positions/EmCloseModal.tsx',
  'src/components/earn/EmBridgeModal.tsx',
  'src/components/earn/FlareDemoEarn.tsx',
  // El catálogo v2 (23-ago): entra en la lista desde el primer día, aunque
  // todavía viva tapado — publicar no puede ser el momento de descubrir que la
  // copy estaba en inglés.
  'src/components/earn/EarnCatalog.tsx',
  // Las columnas del catalogo (24-ago): pintan los titulos y subtitulos de
  // los grupos, que son copy de pantalla como cualquier otra.
  'src/components/earn/StrategyColumns.tsx',
  'src/components/earn/ProductPanel.tsx',
  // La pantalla del agente (2026-08-23): es una superficie publicada y nunca
  // estuvo en esta lista, así que su copy podía salir en inglés sin que el CI
  // dijera nada.
  'src/components/earn/StrategyLLMChat.tsx',
  // La pantalla de las cuentas (2026-08-24): otra superficie publicada que
  // nunca estuvo vigilada — su copy podía salir en inglés sin que nadie
  // lo notara.
  'src/components/wallet/WalletManager.tsx',
  'src/components/preflight/PreflightNotice.tsx',
  'src/app/app/page.tsx',
  // La banda de flotas del Summary (2026-08-22): es la primera pantalla que ve
  // un piloto al entrar. El FleetDeck que sustituye nunca estuvo en esta lista.
  'src/components/dashboard/FleetBand.tsx',
  'src/app/app/portfolio/page.tsx',
  'src/app/app/strategies/page.tsx',
  // La tercera puerta de Earn y su registro (2026-08-24). Entran en la lista
  // desde el primer dia, aunque vivan tapadas tras <PreviewOnly>: el precedente
  // del catalogo v2 es que publicar no puede ser el momento de descubrir que la
  // copy estaba en ingles.
  'src/components/managed/ManagedShelf.tsx',
  'src/components/managed/ManagerDirectory.tsx',
  'src/components/managed/ManagerCard.tsx',
  'src/components/managed/ManagerDesk.tsx',
  'src/components/managed/ManagerConsole.tsx',
  'src/components/managed/ManagerGovernance.tsx',
  'src/components/managed/VaultBirthPlanner.tsx',
  'src/components/managed/HowManagedVaultsWork.tsx',
  'src/components/managed/VaultDetailPanel.tsx',
  'src/components/managed/VaultEntryModal.tsx',
  'src/components/managed/ManagedVaultNotice.tsx',
  'src/components/earn/SigningWalletPicker.tsx',
  // El contacto con el sitio (28-ago): sale en la ficha ANTES de firmar y en el
  // recibo DESPUES. Entra en la lista el mismo dia que nace.
  'src/components/venue/VenueContact.tsx',
  'src/components/managed/ManagedVaultsSurface.tsx',
  // El ajuste de movimiento (2026-09-10): una fila de Settings con sus
  // probetas. Entra el mismo dia que nace.
  'src/components/settings/MotionSettings.tsx',
  // El selector de TEMA y LUZ (2026-09-13): dos filas de Settings con sus dos
  // probetas en vivo. Entra el mismo dia que nace, como la de movimiento.
  'src/components/settings/AppearanceSettings.tsx',
  // La probeta compartida por Settings y por el cuestionario de alta: pinta
  // copy real dentro de la miniatura.
  'src/components/ui/skin/SkinPreview.tsx',
  // Cierre de la auditoria de fallos silenciosos (2026-08-18/19). Estas pantallas
  // dicen lo que impide firmar dos veces; una frase suya en ingles es un fallo de
  // dinero, no de estilo. La allowlist no las miraba.
  'src/components/legacy/ProposalInbox.tsx',
  'src/components/legacy/FormalPositions.tsx',
  'src/components/legacy/LegacyActivityFeed.tsx',
  'src/components/legacy/CouncilOrderCard.tsx',
  'src/components/wallet/XamanQRModal.tsx',
  'src/components/positions/VaultWithdrawModal.tsx',
  'src/components/positions/VaultClaimModal.tsx',
  'src/components/positions/vaultModalTruth.ts',
  'src/components/moneyflows/MoneyFlowsPanel.tsx',
  'src/components/moneyflows/ScheduledPaymentCard.tsx',
  'src/components/movements/MovementsPanel.tsx',
  'src/components/strategies/StrategySection.tsx',
  'src/lib/rules/runHealth.ts',
  // Ronda del 20-ago: la ceremonia del consejo, la puerta que apaga la master
  // key, y las decisiones de firma que ahora viven en lib/ (movidas desde
  // components/positions). Todas dicen lo que impide firmar dos veces.
  'src/components/legacy/CouncilMultisigFlow.tsx',
  'src/components/legacy/CloseDoorSign.tsx',
  'src/components/settlement/UnconfirmedSignatureNotice.tsx',
  'src/components/positions/PaActionsModal.tsx',
  'src/components/positions/FtsoExitModal.tsx',
  'src/lib/errors/serverRefusal.ts',
  'src/lib/wallet/signOutcome.ts',
  'src/lib/xaman/payloadBus.ts',
  // Ronda del dinero (20-ago). `inFlightError.ts` es el caso que mas dolia:
  // ahi vive el aviso de «el dinero YA se movio, no firmes otra vez» y era un
  // canal sin vigilante — el verde del CI no decia nada sobre el.
  'src/lib/wallet/inFlightError.ts',
  'src/lib/wallet/useWalletPartner.ts',
  'src/lib/settlement/reasonText.ts',
  'src/components/legacy/CageBirthCard.tsx',
  'src/components/legacy/CouncilVaultEntry.tsx',
  'src/components/legacy/ProposeToCouncil.tsx',
  'src/components/legacy/GovernedMovements.tsx',
  'src/components/intents/SidebarIntents.tsx',
  'src/hooks/useAuthorities.ts',
  // Rail institucional (21-ago): las superficies de la demo del 21-sep. La del
  // operador pinta el DENIED de la escena 4 y las de salida dicen que el reloj
  // corre — una frase suya en ingles en medio del video es un fallo de pitch.
  'src/components/institutional/PoliciesCatalog.tsx',
  'src/components/institutional/PoteDepositModal.tsx',
  'src/components/institutional/PoteExitModal.tsx',
  'src/components/institutional/TicketsBoard.tsx',
  'src/components/institutional/OperatorConsole.tsx',
  'src/components/institutional/ClientOnboardModal.tsx',
  'src/components/institutional/CredentialCeremonyModal.tsx',
  'src/components/institutional/PoteBirthCard.tsx',
  'src/components/institutional/GuidedDemo.tsx',
  'src/components/institutional/ContractCodeCard.tsx',
  'src/components/institutional/XrpFundCard.tsx',
  'src/components/institutional/CouncilAnchorCard.tsx',
  'src/components/institutional/user/PasskeyGate.tsx',
  // El QR de depósito del cliente (14-sep), en la zona del cliente y en la mesa.
  'src/components/demo-exchange/DepositXamanQr.tsx',
  'src/components/institutional/user/UserVaultPanel.tsx',
  'src/app/app/institutional/page.tsx',
  'src/app/app/earn-passkey/page.tsx',
  'src/app/app/admin/institutional/page.tsx',
  // Demo Exchange v2 (26-ago): la demo custodial completa — exchange, cliente,
  // coreografia y evidencia. Se graba en video; una frase en ingles es un fallo.
  'src/components/demo-exchange/DemoExchangeShell.tsx',
  'src/components/demo-exchange/RunsPanel.tsx',
  'src/components/demo-exchange/ExchangeDesk.tsx',
  'src/components/demo-exchange/ClientApp.tsx',
  'src/components/demo-exchange/CurtainGraph.tsx',
  'src/components/demo-exchange/EvidencePanel.tsx',
  'src/components/demo-exchange/ReceiptRow.tsx',
  'src/components/demo-exchange/OmnibusSignDoor.tsx',
  'src/app/app/admin/demo-exchange/page.tsx',
  'src/components/demo-exchange/ExchangeSetupPanel.tsx',
  'src/app/app/admin/institutional/exchange/page.tsx',
  'src/app/app/admin/institutional/client/page.tsx',
  // El exchange PRODUCTIZADO (14-sep): la cuenta del cliente y la consola del
  // exchange. Entran el mismo día que nacen.
  'src/components/demo-exchange/client/ExchangeClientApp.tsx',
  'src/components/demo-exchange/client/useExchangeClient.ts',
  'src/components/demo-exchange/console/ExchangeConsole.tsx',
  // 18-sep: la cola de peticiones firmada por el omnibus con QR (sin autopilot).
  'src/components/demo-exchange/console/DeskRequestQueue.tsx',
  // Exchange 2.0 (18-sep): las estructuras cautivas de un tenant. Entra en la
  // lista el dia que nace — publicar no puede ser el momento de descubrir que
  // la copy estaba en ingles.
  'src/components/demo-exchange/console/StructuresPanel.tsx',
  'src/app/app/exchange/page.tsx',
  'src/app/app/exchange/operator/page.tsx',
];

/** Ficheros cuya copy viaja como DATO del catálogo. */
const CATALOGUES = [
  'src/components/earn/FlareDemoEarn.tsx',
  // El vocabulario del catalogo (24-ago). Sus title/sub viajan como DATO y se
  // pintan con t(o.title) / t(col.sub) desde el camino de filtros y desde las
  // columnas — es decir, por la via B que este script dice vigilar y que aqui
  // no estaba mirando.
  'src/lib/earn/strategyTaxonomy.ts',
  // El catálogo de políticas institucionales: title/strategyLine/exitLine se
  // pintan pasadas por t() desde las cards (mismo patrón que las de Earn).
  'src/lib/institutional/policyCatalog.ts',
  // La doc del código de los contratos: summary/title/plainExchange/plainUser
  // se pintan por t() en ContractCodeCard (el `code` NO — es Solidity literal).
  'src/lib/institutional/contractDocs.ts',
];

/** Campos del catálogo que se pintan pasados por `t()`. */
const DATA_FIELDS = ['title', 'action', 'plain', 'railLabel', 'label', 'value', 'strategyLine', 'exitLine', 'summary', 'plainExchange', 'plainUser', 'sub'];

function dictKeys() {
  const keys = new Set();
  for (const l of fs.readFileSync(DICT, 'utf8').split('\n')) {
    let m;
    if ((m = l.match(/^\s*'((?:\\.|[^'])*)'\s*:/))) keys.add(m[1].replace(/\\'/g, "'"));
    else if ((m = l.match(/^\s*"((?:\\.|[^"])*)"\s*:/))) keys.add(m[1].replace(/\\"/g, '"'));
    else if ((m = l.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/))) keys.add(m[1]);
  }
  return keys;
}

function scanLiterals(src, keys, miss, label) {
  const re = /\bt\(\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const s = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (!s.trim()) continue;
    if (!keys.has(s)) miss.add(`${label} :: ${s}`);
  }
}

function scanCatalogue(src, keys, miss, label) {
  for (const f of DATA_FIELDS) {
    const re = new RegExp("\\b" + f + ":\\s*\\n?\\s*'((?:\\\\.|[^'])*)'", 'g');
    let m;
    while ((m = re.exec(src))) {
      const s = m[1].replace(/\\'/g, "'");
      if (s.length < 3 || !/\s/.test(s)) continue;
      if (!keys.has(s)) miss.add(`${label} [${f}] :: ${s}`);
    }
  }
  const legsRe = /legs:\s*\[([\s\S]*?)\]/g;
  let lm;
  while ((lm = legsRe.exec(src))) {
    const sre = /'((?:\\.|[^'])*)'/g;
    let sm;
    while ((sm = sre.exec(lm[1]))) {
      const s = sm[1].replace(/\\'/g, "'");
      if (s.length < 3 || !/\s/.test(s)) continue;
      if (!keys.has(s)) miss.add(`${label} [legs] :: ${s}`);
    }
  }
}

const keys = dictKeys();
const miss = new Set();
for (const rel of SCREENS) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  scanLiterals(fs.readFileSync(p, 'utf8'), keys, miss, path.basename(rel));
}
for (const rel of CATALOGUES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  scanCatalogue(fs.readFileSync(p, 'utf8'), keys, miss, path.basename(rel));
}

console.log(`claves en el diccionario: ${keys.size}`);
if (miss.size === 0) {
  console.log('✓ sin cadenas de interfaz sin traducir');
  process.exit(0);
}
console.log(`✖ SIN TRADUCIR: ${miss.size}`);
[...miss].sort().forEach((x) => console.log('  - ' + x));
process.exit(1);
