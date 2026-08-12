# Product

## Register

product

Astryum tiene dos superficies: la landing pública en `/` (brand) y la app privada en `/app/*` (product, 16+ pantallas). PRODUCT.md trata la app como el register primario porque es donde vive el valor real y la mayor superficie de diseño. La landing hereda el mismo sistema visual con ajustes de densidad y motion propios de marca.

## Users

Beta abierta (aprobación por email) desde el 5-ago-2026, en XRPL + Flare Mainnet (chainId 14). Dos perfiles:

**Primario — el holder que no vive dentro de DeFi y no cede sus llaves** (el usuario objetivo declarado en `/about` y en `frontend/copy/GLOSSARY.md`): tiene XRP, firma con Xaman, no tiene wallet EVM ni quiere una. Viene por control, protección firmada y sucesión — no por «hacer que su XRP produzca».

**Secundario — el operador técnico**: conocimiento DeFi medio-alto, autocustodia con MetaMask o Xaman. No es un trader degen ni un yield farmer, es alguien protegiendo posiciones reales: supply/borrow en Kinetic, liquidez concentrada en SparkDEX, stXRP en Firelight, FXRP como puente XRP↔Flare.

Contexto de uso: revisa el estado del portfolio a diario, reacciona a triggers (Health Factor en zona watch, LP fuera de rango, precio cruzando soporte), firma transacciones preparadas por el sistema. Nunca delega la firma, nunca quiere auto-ejecución. Trabaja desde escritorio (uso principal) y consulta desde móvil.

El trabajo que necesita resuelto: ver de un vistazo si su capital está en riesgo, recibir alertas accionables antes de que ocurra una liquidación, y firmar con confianza acciones defensivas (repay, add collateral, exit LP) habiendo visto su impacto exacto en HF, LTV y gas.

## Product Purpose

Astryum es la capa de control no-custodial para capital XRP a través de XRPL y Flare, orientada a proteger capital antes que optimizar yield. Se sienta entre la wallet del usuario y el ecosistema DeFi, convirtiendo estado on-chain real en evaluación de riesgo determinística y transacciones preparadas listas para firmar.

Existe porque ninguna herramienta cubre el hueco: DeBank y Zapper muestran portfolio sin riesgo accionable, DeFi Saver hace automatización solo en Ethereum, y los risk dashboards institucionales (Gauntlet, Chaos Labs) no son operativos para un solo usuario. Flare específicamente no tiene su capa de gestión protección-first, y XRP via FAssets necesita visibilidad propia.

Éxito se ve cuando: cero liquidaciones inesperadas, cada evento de riesgo surfaceado antes de que cause pérdida, cada acción ejecutada con simulación previa y firma deliberada, IA explicando sobre datos reales nunca sustituyéndolos.

## Brand Personality

Técnica, premium, controlada.

Voz directa de ingeniero financiero senior, no de growth marketer. Cero hype, cero buzzwords, cero gamificación. Habla en números cuando hay números (HF 1.42, no "buena salud") y en contexto cuando hace falta (qué pasa si XRP cae 15%, no "todo bajo control").

Tono sereno en momentos críticos. Si un HF cruza threshold el sistema no grita, propone una acción concreta con su simulación. La calma del cockpit, no la urgencia del trading floor.

Objetivos emocionales: confianza tranquila (el sistema vigila por ti), control deliberado (cada acción es consciente y firmada por ti), claridad técnica (entiendes qué pasa porque te enseñan los números, no porque te los interpreten).

## Anti-references

**Casino crypto**: nada de neones, glow excesivo, gradientes saturados, animaciones constantes pidiendo atención. La UI no es una slot machine. Bloquea los blues eléctricos sobre fondos negros, los verdes/rojos parpadeantes en métricas, los confetti de "transaction confirmed".

**Robinhood, Coinbase Wallet**: gamificación, FOMO copy, push notifications agresivos, "you earned X today" como dopamine hit. Astryum no premia consultar, premia entender.

**Plataformas degen tipo Hyperliquid, GMX UI**: APY destacado en colores fluorescentes, métricas de ganancia en titulares, leaderboards. Aquí el riesgo va primero; el yield es contexto.

**Crypto exchanges genéricos (Binance, Bybit)**: tablas densas sin jerarquía visual, banners promocionales mezclados con datos críticos, 47 colores compitiendo por atención simultánea.

**Web3 corporate de 2020**: gradientes azul-púrpura, ilustraciones isométricas de "DeFi connected", iconografía genérica de blockchain. Astryum tiene un look propio, no el preset de Figma de hace cuatro años.

## Design Principles

1. **Protection before yield**: el riesgo se muestra antes que el rendimiento. Si hay un Health Factor crítico, no se enseña APY hasta que el usuario tenga el contexto del riesgo. Cualquier pantalla que muestre números positivos sin riesgo asociado está mal jerarquizada.

2. **Deterministic over impressive**: los motores calculan, la IA explica. Nunca un número viene sin trazabilidad on-chain (precio FTSO con timestamp, HF derivado de datos reales). Si la IA no tiene datos frescos, dice que no tiene; no inventa.

3. **Sign before commit**: ninguna acción se ejecuta sin firma explícita. Toda propuesta de acción incluye una simulación previa (nuevo HF, gas estimado, USD net impact). El botón "Sign" siempre va precedido del "Review".

4. **Real data over aesthetic placeholders**: si no hay snapshot, no se inventa uno bonito. Empty state honesto ("No portfolio snapshot yet · The portfolio engine hasn't produced a snapshot") gana siempre a placeholder estético. Mostrar `—` es más honesto que mostrar `$0.00` cuando el valor es desconocido.

5. **Density without chaos**: la app es densa por necesidad (HF, LTV, distancia liquidación, gas, slippage, USD impact, deltas, fechas). Cada número justifica su píxel. Cuando hay seis números en pantalla, hay seis pesos visuales distintos que ordenan importancia. Densidad alta requiere espaciado preciso, no agregado de chrome decorativo.

## Accessibility & Inclusion

Mínimo WCAG AA en todas las pantallas críticas (`/app/portfolio`, `/app/risk`, `/app/wallets`, `/app/intents`).

- Contraste body ≥4.5:1, large text ≥3:1. Nada de gris claro sobre fondo oscuro tinted "para elegancia".
- Datos numéricos críticos (HF, LTV, distancia liquidación, USD impact) siempre con texto y valor explícito; nunca codificados solo por color. Un usuario con daltonismo debe distinguir un HF crítico sin ver el rojo.
- `prefers-reduced-motion: reduce` respetado en toda animación. Las transiciones entre states (loading → ready, intent building → proposed) son funcionales, no decorativas; deben tener fallback instantáneo.
- Navegación 100% por teclado. Toda acción crítica (Sign, Cancel, Reject Intent) debe ser alcanzable por Tab y disparable por Enter/Space.
- Focus indicators visibles y consistentes en todos los elementos interactivos. No usar `outline: none` sin sustituto.
