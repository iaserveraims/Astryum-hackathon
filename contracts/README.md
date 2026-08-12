# Astryum Legacy — la jaula de código y su puente FDC (Flare)

**Qué es.** La vasija epocal de Astryum Legacy: el contrato donde el capital productivo de un
Legacy vive sin poder venderse. El código enjaula el **principal** (no existe `withdrawPrincipal()`,
ni `transferTo(arbitrary)`, ni proxy); los **frutos** los gobierna el consejo. Diseño completo y
decisiones del fundador (D1a-D7) en
`docs/context/Astryum_Legacy_Auditoria_Constitucion_Producto_2026-07-13.md`.

> ⚠️ **Inmutable e irreversible.** Un bug desplegado no se parchea: se migra a una vasija
> sucesora (30 días de timelock + continuidad verificada) o se convive con él. Recomendación
> registrada: **auditoría externa antes de que entre capital de terceros.** El capital propio del
> fundador, en importes pequeños, es el único uso previsto hasta entonces.

## El stack gobernado — "XRPL gobierna" hecho literal (bridge FDC)

Dos contratos, sin proxy, sin upgrade; **cada parámetro del constructor es eterno.** El consejo
firma en XRPL, el Flare Data Connector lo prueba, y el puente ejecuta EXACTAMENTE esos bytes contra
la jaula — cero discreción en toda la cadena.

```
El consejo XRPL firma un Payment de 1 drop (memo = keccak256(orderData))
        │  master key deshabilitada + sin RegularKey ⇒ una tx válida ES prueba del quórum
        ▼
Los proveedores del FDC atestiguan la tx validada  (on-chain solo vive la raíz Merkle)
        ▼
XrplCouncilBridge.execute(proof, orderData)        (permissionless — la autoridad es la prueba)
   verify → proofOwner==this → sourceHash==consejo → status==0 →
   memo==keccak256(orderData) → txId no consumido → nonce secuencial →
        ▼
LegacyVault.<fnDelConsejo>(...)                    (la jaula decide qué puede hacer esa llamada)
```

| Pieza | Rol |
|---|---|
| `src/XrplCouncilBridge.sol` | ES el `council` del vault. No tiene fondos ni dueño con poder: su único acto es reenviar una orden que el quórum XRPL ya firmó, tras verificar la prueba FDC `XRPPayment`. Doble candado antirreplay: `consumedTxId` + nonce secuencial. |
| `src/interfaces/IXRPPayment.sol` · `IXRPPaymentVerification.sol` | La superficie FDC (`verifyXRPPayment`). |
| `script/DeployLegacyStack.s.sol` | Despliega el stack COMPLETO en orden de nacimiento: bridge → vault(council = **el bridge**) → `bridge.bind(vault)`. Tras `bind` el deployer no tiene ningún poder. El multisig EVM espejo no existe ni un día. |
| `src/LegacyStackFactory.sol` | **Una jaula por Legacy, nacida desde XRPL.** El mismo orden de nacimiento, pero en una sola tx que **solo puede lanzar la Personal Account del propio consejo** (Flare Smart Accounts) — es decir, su quórum. Lleva el registro público `vaultOf(councilHash)`, que es como el producto responde «¿cuál es la jaula de este Legacy?» sin fiarse de una base de datos. `LegacyVaultDeployer` (nace con él, solo él lo llama) carga el bytecode del vault para que el factory no roce el techo de 24 KB. |

### Una jaula por Legacy (2026-08-05)

Hasta esta fecha la jaula se desplegaba a mano una vez y el producto la leía de
configuración, así que **todos los Legacies apuntaban a la misma**. Leerla era daño
cosmético; fondearla no: el carril de fondeo compone un mint que deposita en el vault,
y el vault no tiene ninguna función que devuelva principal a una dirección. Un segundo
consejo habría firmado su capital dentro de la jaula del primero, para siempre.

El contrato ya decía la regla — `COUNCIL_ADDRESS_HASH` es `immutable` en el bridge, así
que un bridge obedece a un consejo y a ninguno más. El factory la convierte en el único
camino: **un Legacy, una jaula, creada por su propio quórum**.

```
El consejo firma UN Payment XRPL (memo = los calls comprometidos)
        ▼
Su Personal Account en Flare ejecuta esos calls
        ▼
LegacyStackFactory.create(councilR, params)   ← msg.sender DEBE ser esa PA
   bridge(councilHash, SOURCE_ID) → vault(council = bridge) → bind → registro
```

`predictAddresses(councilR, params)` da la dirección del vault **antes** de que exista
(CREATE2), para que una sola firma pueda crear la jaula y depositar en ella en el mismo
lote. Los params del constructor siguen siendo eternos: los elige el quórum, porque solo
el quórum puede provocar la llamada. Backend: `LEGACY_FACTORY_ADDRESS` +
`services/flare/LegacyCageResolver.ts` (registro on-chain primero; el stack de env
después, y solo para el consejo que su bridge nombra — el fundacional no migra).

```bash
FDC_SOURCE_ID=XRP MAC_FALLBACK=0x434936d47503353f06750Db1A444DBDC5F0AD37c \
  forge script script/DeployLegacyStackFactory.s.sol --rpc-url flare --broadcast
```

> ⚠️ `SOURCE_ID` es inmutable en el factory y lo heredan **todos** los bridges que nazcan
> de él. Un factory de mainnet con `testXRP` pariría bridges que no verifican ninguna
> prueba jamás, y nada podría arreglarlos. Un factory por red, y la red decide.

**Desplegado en Flare mainnet (2026-08-06,** tx `0x65b3cc8e…9acb23`**, fuentes verificadas):**

| Contrato | Dirección |
|---|---|
| `LegacyStackFactory` | `0xF93A8A0bd93e95514fF02285349b0b1c1a5a3e0a` (`SOURCE_ID = XRP`, `MAC_FALLBACK = 0x4349…D37c` — verificado vivo == registry el día del deploy) |
| `LegacyVaultDeployer` | `0x2717A6Aa5162f8c5e5D7574F112eFC9438Cb66f6` (nació con él; solo el factory puede llamarlo) |

> `script/DeployLegacyVault.s.sol` (abajo) despliega el vault solo con un council EOA/multisig EVM.
> Precede al puente FDC y se conserva de referencia; el camino **gobernado** es `DeployLegacyStack`.

**Límite del modelo de confianza (se dice, no se esconde).** El FDC atestigua *transacciones, no
estado del ledger*: ningún contrato puede probar on-chain que la cuenta del consejo es multisig-only.
Eso es un **hecho de ceremonia** — auditable por cualquiera en XRPL (`lsfDisableMaster` puesto **y**
sin RegularKey), verificado en el ensayo del consejo cada vez. Si la cuenta es multisig-only, la
validez de la tx atestiguada ES la prueba del quórum.

**El circuito off-chain (prepare-only) y la UI** viven en el backend/front, no aquí:
`backend/src/connectors/protocols/xrpl/XrplCouncilOrderService.ts`,
`backend/src/services/flare/LegacyOrderRelayService.ts` (+ `LegacyOrderStore.ts`),
rutas `POST /xrpl-defi/council-order/{prepare,relay}` + `GET …/status`, y
`frontend/src/components/legacy/CouncilOrderCard.tsx` (superficie Govern). BuildSpec y decisiones
eternas del deploy gobernado en `docs/context/Astryum_Legacy_Enforcement_FDC_BuildSpec_2026-07-16.md`
y `…_Mainnet_Deploy_Decisiones_2026-07-16.md`.

### Deploy del stack gobernado

```bash
cd contracts
# Coston2 (testnet — se itera sin miedo):
export COUNCIL_R_ADDRESS=r... FDC_SOURCE_ID=testXRP \
       CONSTITUTION_REF=0x... PROTOCOL_TREASURY=0x... LINAJE_FEE_BPS=3000 DEMO_ASSETS=true
forge script script/DeployLegacyStack.s.sol --rpc-url coston2 --broadcast --private-key $DEPLOYER_KEY

# Mainnet: FDC_SOURCE_ID=XRP, sin DEMO_ASSETS, con FXRP_ADDRESS + VENUE1_TARGET/VENUE1_KIND
#          reales — y SOLO tras el gate del fundador + auditoría externa (misma política de abajo).
```

Tras `bind`, pon `LEGACY_BRIDGE_ADDRESS` / `LEGACY_VAULT_ADDRESS` / `LEGACY_ORDER_ANCHOR` /
`LEGACY_CHAIN` + `FLARE_EXECUTOR_ENABLED=true` en el env del backend → la card **Orden del consejo**
queda viva. `COUNCIL_R_ADDRESS` se hashea aquí `keccak256(bytes(r))` (FDC standard address hash).

## Qué hace cumplir el código (y qué no)

| Regla | Quién la impone |
|---|---|
| El principal solo se mueve vault ↔ venues aprobados, o a la vasija sucesora | **El código** |
| Solo el yield realizado llega a personas (payees), tras el corte del linaje | **El código** (invariante I2, fuzzeado) |
| Añadir un venue tarda 30 días y se anuncia on-chain (D1a) | **El código** |
| El rescate (`moveToVenue`/`recall`/`evacuate`) es inmediato y sin cap (D2) | **El código** |
| linajeFee: suelo 10% inmutable, tasa 10-40% (D5) · fee protocolo ≤10%, default 0 (D6) | **El código** |
| Migración: solo a un sucesor con el mismo consejo y la misma constitución (D4) | **El código** |
| Quién es payee, qué venue se aprueba, cuándo se cede la dirección | **El consejo** (quórum) |
| Que un venue no sea hackeado / que FAssets no falle | **Nadie** — por eso D2, D7 (reserva nativa) y la diversificación |

Cada mutación de gobernanza exige presentar el `constitutionRef` vigente (el SHA-256 anclado en
XRPL vía DIDSet) y lo emite en el evento: los parámetros quedan encadenados a la versión del texto
que implementan.

## Desarrollo

```bash
cd contracts
forge build
forge test          # 58 en total: 22 unit del vault + 18 del bridge + 15 del factory + 3 invariantes
forge test -vvv     # con trazas
```

Suites: `test/LegacyVault.t.sol` (el primero: *nadie, por ninguna vía, saca más que el yield*),
`test/LegacyVault.invariant.t.sol` (I1 los libros nunca están huecos · I2 las personas nunca
reciben más que el yield entrado · I3 el libro de asignaciones cuadra) y
`test/XrplCouncilBridge.t.sol` (cada guard del puente: prueba inválida, consejo/proofOwner/source
equivocados, tx fallida, memo que no casa, replay por txId, nonce fuera de orden, sin `bind`).

## Despliegue (lo ejecuta EL FUNDADOR — ninguna clave toca el repo ni el codespace)

### 0. El ritual del checklist (los params del constructor son eternos)

- [ ] `FXRP_ADDRESS` — resuelto EN VIVO: `AssetManagerFXRP.fAsset()` vía el FlareContractRegistry
      (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` → `getContractAddressByName("AssetManagerFXRP")`).
      Jamás de un doc o un chat.
- [ ] `COUNCIL_ADDRESS` — para el **dry-run**: tu EOA. Para el Legacy real: el multisig EVM del
      consejo. ⚠️ La disponibilidad de Safe{Wallet} en Flare mainnet NO está verificada
      (2026-07-13): compruébala en app.safe.global antes; si no está, alternativas: contratos Safe
      desplegados a mano, u otro multisig mínimo auditado. El vault solo necesita una dirección,
      y `transferCouncil` (2 pasos) permite pasar de EOA→multisig después.
- [ ] `CONSTITUTION_REF` — el SHA-256 (0x + 64 hex) de la versión de la constitución YA anclada
      en XRPL (página Legacy → La constitución). El mismo dígito, verificado dos veces.
- [ ] `PROTOCOL_TREASURY` — el Safe/treasury de Astryum. `address(0)` = el hook D6 queda
      inutilizable en esta vasija PARA SIEMPRE.
- [ ] `LINAJE_FEE_BPS` — 3000 (decisión D5). Suelo 1000 / techo 4000 los impone el constructor.
- [ ] `VENUE1_TARGET`/`VENUE1_KIND` — venues de nacimiento (activos de inmediato: el set de
      nacimiento es parte de estos params revisados). Kinetic kFXRP = kind 1 (CompoundV2),
      Firelight stXRP = kind 0 (ERC4626). Direcciones verificadas on-chain ese mismo día, y
      capacidad/TVL revisada (¿aguanta tu importe sin ser >X% del venue?).

### 1. Dry-run (fork local, cero gas)

```bash
cd contracts
export FXRP_ADDRESS=0x... COUNCIL_ADDRESS=0x... CONSTITUTION_REF=0x... \
       PROTOCOL_TREASURY=0x... LINAJE_FEE_BPS=3000
forge script script/DeployLegacyVault.s.sol --rpc-url flare   # SIN --broadcast: simula y loguea
```

Lee el log entero. Cada línea del checklist, contra el log.

### 2. Mainnet

```bash
forge script script/DeployLegacyVault.s.sol --rpc-url flare --broadcast \
  --private-key $DEPLOYER_KEY        # una clave puntual financiada con FLR para gas
```

### 3. Post-deploy (mismo día)

1. **Verificar el código fuente** en el explorer (Flarescan es Routescan):
   ```bash
   forge verify-contract <ADDR> src/LegacyVault.sol:LegacyVault \
     --verifier-url 'https://api.routescan.io/v2/network/mainnet/evm/14/etherscan' \
     --etherscan-api-key "verifyContract" --num-of-optimizations 200 \
     --compiler-version 0.8.24 \
     --constructor-args $(cast abi-encode "constructor(address,address,bytes32,address,uint16,(address,uint8)[])" ...)
   ```
   (Alternativa Blockscout: `https://flare-explorer.flare.network/api`.) Sin fuente verificada no
   hay carpeta de supervivencia: la familia debe poder LEER la jaula.
2. Leer `feeSchedule()` y `constitutionRef()` desde el explorer y compararlos con lo esperado.
3. **Anclar la dirección del vault en la constitución** (enmienda DIDSet v+1 firmada por el
   quórum) y añadirla a `docs/legacy/CARPETA_SUPERVIVENCIA.md` §5.
4. Primer capital: importe pequeño propio vía el carril 0xFE (o un `deposit` directo con FXRP).
   Primer `harvest()` cuando haya yield; comprobar el split contra la constitución.

## El mapa del contrato

```
src/LegacyVault.sol       — la vasija (una sola pieza, sin adapters externos)
  Capital:    deposit (permissionless) · directTo (director/consejo, cap D2, delay D1a)
  Rescate:    recall · moveToVenue · evacuate (consejo, inmediatos, sin cap)
  Frutos:     harvest (permissionless) → linaje capitaliza + fee protocolo + payees · claim (pull)
  Gobierno:   proposeVenue(+30d) · retireVenue · setMaxVenueBps · setLinajeFeeBps ·
              setProtocolFeeBps · setPayees · cede/endCession · setConstitutionRef ·
              transferCouncil (2 pasos)
  Sucesión:   proposeSuccessor(+30d, continuidad) · cancelSuccessor · migrate
  Lecturas:   totalValue · venueValue · idlePrincipal · feeSchedule (F-3)
```

Venues soportados v0 (verificados contra el repo 2026-07-13): **ERC-4626** (Firelight stXRP —
`asset()==FXRP` verificado on-chain 2026-07-10; earnXRP) y **Compound-v2-fork** (Kinetic kFXRP —
`mint`/`redeemUnderlying` con código de error, `exchangeRateStored`).
