# GLOSSARY — La voz de Astryum en la web pública

> Normativo para TODO el copy de `astryum.xyz` (Home · /what-we-offer · /about y páginas futuras).
> Una voz, dos idiomas correctos. Si un texto nuevo contradice este archivo, gana este archivo
> o se cambia este archivo — nunca conviven los dos.

## 0 · El criterio (el test de Guillem)

> **"Si necesita explicación previa para entenderse, no está terminado."**

Cada frase se mide contra el usuario que holdea y no vive dentro de DeFi — el co-fundador
Guillem, y el usuario objetivo declarado en /about. No se escribe para impresionar a un juez
técnico; se escribe para que esa persona lo entienda a la primera.

## 1 · Idioma fuente

- **El español manda.** El EN es traducción profesional: misma idea, registro nativo — nunca
  palabra a palabra. (El ES es el idioma fuente de todo el producto: diccionario, prompts,
  comentarios.)
- Excepciones EN-first que se quedan en inglés en ambos idiomas:
  - El eslogan de marca: **"Financial Control. Total Clarity."**
  - Los nombres de las secciones del producto: **Summary · Earn · Portfolio · Wallets · Legacy**
    (son nombres propios de la app; el dashboard real los muestra así).

## 2 · Un concepto = un término

| Concepto | ES (siempre) | EN (siempre) | Nunca |
|---|---|---|---|
| El producto como lugar | el puesto de mando (o simplemente "Astryum") | mission control (or just "Astryum") | control plane, plano de control, platform a secas repetida |
| Las capacidades/features | piezas | pieces | instruments, instrumentos |
| Las blockchains | redes / red | networks / network | rails, raíles, chains (en copy público) |
| Construir la transacción | preparar | prepare | compilar, compile, build (user-facing) |
| Lenguaje natural → transacción | el agente lo prepara (tras "describe lo que quieres") | the agent prepares it (after "describe what you want") | el agente compila / the agent compiles |
| El objeto que se firma | la transacción sin firmar | the unsigned transaction | payload, userOp, intent (user-facing) |
| Comprobación previa | se simula antes de firmar | simulated before you sign | pre-flight |
| El final de una operación | cuando la operación se completa | once it completes | settlement / "tras liquidarse" (⚠ colisión con "liquidación" de posiciones) |
| Las estrategias de Earn | estrategias | strategies | products, instruments, vaults (en copy público) |
| La métrica de riesgo | salud (término técnico: "factor de salud", una vez) | health (technical term: "health factor", once) | HF a secas sin explicar |

## 3 · Prohibidos de cara al usuario

Jerga interna que NO aparece en la web pública: `control plane` · `compila/compiles` ·
`payload(s)` · `rails/raíles` · `userOp` · `pre-flight` · `settlement` sin explicar ·
`instruments/instrumentos` (para features).

Si alguno resulta imprescindible en un contexto nuevo, se discute aquí primero y se anota la
excepción — no se cuela.

## 4 · Técnicos que SE QUEDAN (son el territorio)

Regla de uso: **se explican UNA vez por página, en su primera aparición, en una frase — y
después se usan sin re-explicar.**

| Término | La frase de explicación (patrón) |
|---|---|
| factor de salud / health factor | "el factor de salud — la distancia de una posición a la liquidación" |
| liquidación / liquidation | "liquidación — el cierre forzoso de una posición si su garantía deja de bastar" |
| colateral / collateral | "el colateral — los activos que respaldan tu posición" |
| FXRP (FAssets) | "tu XRP entra en DeFi como FXRP (FAssets), su representación en Flare" |
| FTSO | "el oráculo nativo de precios de Flare (FTSO)" |
| no-custodial / non-custodial | "no-custodial: tus claves y tu capital nunca pasan por nosotros" |
| quórum / quorum | "un consejo con quórum (p. ej. 3 de 5 firmas)" |

## 5 · Nombres propios — no se traducen ni se tocan

Astryum · Xaman · MetaMask · Ledger · Flare · XRPL · FXRP · FAssets · FTSO · Kinetic ·
SparkDEX · DeFi · MiCA · CASP · mainnet · wallet (femenino en ES: "tu wallet") · stablecoin.

## 6 · Doctrina — reglas que el copy no puede violar

1. **NUNCA "movemos tu dinero" / "move your money".** Astryum no mueve nada. Se dice:
   "controlas tu capital", "pones tu capital a trabajar" / "you control your capital",
   "put your capital to work".
2. **"Auditado/audited" PROHIBIDO** sin informe externo publicado. El lenguaje de garantía
   ("100% seguro") es exactamente como hablan los timos — fuera.
3. **MiCA es posición propia, no hecho certificado:** "estamos estructurados para no ser un
   CASP" / "we are structured not to be a CASP" — nunca "no somos un CASP" / "we are not a
   CASP" como afirmación jurídica. (Ver `legal/00-perimetro.md` §4.4: la autoclasificación
   tajante publicada antes del dictamen es un punto de atención.) Se suaviza el verbo, no el
   contenido.
4. **Tasas y rendimientos: siempre dato del protocolo con fuente**, nunca promesa nuestra.
   Prohibido: "recomendamos", "garantizado", "gana X% con nosotros", "el agente decide",
   "real yield / rendimiento real" como reclamo.
5. **Cifras solo verificables**: nada aspiracional en stats, OG o social cards.
6. **La doctrina no-custodial se dice UNA vez con fuerza por página** (la Home la dice en el
   cierre "Tú siempre firmas."). Las demás menciones solo si añaden información NUEVA y
   distinta: llaves (dónde viven) ≠ custodia (qué no tenemos) ≠ firma (quién autoriza) ≠
   discreción (quién decide). Dos frases que dicen lo mismo = se poda una.

## 7 · Registro

- **Serio, estructurado, explicativo** — el listón es /about: sobrio, humano, verificable.
- La metáfora cósmica de marca vive en **lo visual** (starfield, sistema solar, la tarjeta
  de embarque del cierre) y en el eslogan final — **no en medio de la explicación del
  producto**. Un chip de UI o un titular de sección no "juega": informa.
- Patrón de sección: titular llano → una frase de qué es → 3 puntos concretos.
- EN nativo: sin calcos de estructura española (gerundios colgados, "in everyone's sight",
  puntuación calcada). ES nativo: sin spanglish ("tu XRP finance").
