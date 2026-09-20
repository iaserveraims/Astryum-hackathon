/**
 * Platform log — the "noticiero" behind the Summary's Orbit System card.
 * RULES (v2, founder 2026-07-26: "no quiero que dé tanto detalle"):
 *
 *   - Append a new entry (TOP of the array) with every user-visible release,
 *     bumping the version — PLATFORM_VERSION is DERIVED from the newest entry,
 *     so the card's chip bumps with it automatically.
 *   - DETAIL ONLY FOR DEFI: items of kind 'defi' (new capabilities or DeFi
 *     improvements — what the platform can now DO with the user's capital)
 *     carry their own es/en line. Everything else — performance, behaviour,
 *     visual, security — is listed WITHOUT text: the card renders one generic
 *     line per kind ("Mejoras de rendimiento", …). The user only needs to
 *     know the ship improved; the specifics live in git, not in their face.
 *   - Real, shipped features only — never roadmap, never promises, never
 *     yields (copy invariant §9). Write both languages on defi items.
 */

export type ChangeKind = 'defi' | 'performance' | 'behavior' | 'visual' | 'security';

export interface ChangeItem {
  kind: ChangeKind;
  /** Required for 'defi' items; ignored for every other kind. */
  es?: string;
  en?: string;
}

export interface ChangelogEntry {
  version: string;
  /** ISO date the release landed. */
  date: string;
  items: ChangeItem[];
}

/** The generic line each non-DeFi kind collapses into. */
export const KIND_LABEL: Record<Exclude<ChangeKind, 'defi'>, { es: string; en: string }> = {
  performance: { es: 'Mejoras de rendimiento', en: 'Performance improvements' },
  behavior: { es: 'Mejoras de comportamiento', en: 'Behaviour improvements' },
  visual: { es: 'Mejoras estéticas', en: 'Visual polish' },
  security: { es: 'Refuerzos de seguridad', en: 'Security hardening' },
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    // Fundador 2026-09-20, revisión de lo publicado: la mesa del partner de KYC
    // (/app/partner) respondía por URL a cualquier sesión. No es un paso del
    // alta del gestor ni de la del exchange: es la herramienta de quien
    // administra un registro KYC y aprueba clientes. Queda para los fundadores
    // —veredicto del servidor— con su puerta en Admin → Herramientas, y su ruta
    // de backend pide lo mismo.
    version: '0.9.233',
    date: '2026-09-20',
    items: [{ kind: 'security' }],
  },
  {
    // Fundador 2026-09-19: «haz bien el destello de la última página o
    // directamente quítalo» y «cuando se entra en el legacy, el personal tiene
    // animado el texto y artefactos como aparición pero el legacy no».
    //
    // El destello se quita como FORMA y se queda como LUZ. La mancha con
    // silueta —el hueco del arco recortado en la sombra— se rechazó dos veces en
    // dos ejecuciones distintas, y falla por escala: para leerse como proyección
    // tiene que ser grande, y una silueta grande con canto duro sobre un
    // paramento plano se lee como una pegatina. En su sitio, un frente de sombra
    // con una rampa MÁS LARGA QUE EL MURO, así que no existe ningún fotograma
    // con un borde de sombra dentro del cuadro: la piedra se enciende por arriba
    // a la derecha y ya está. Regla que deja: si la mancha tiene canto es un
    // objeto, si tiene rampa es luz. Y como el frente ahora se retira ENTERO, el
    // paramento pasa a tener su propio tono con `--volt-deep` —`--volt` es un
    // periwinkle claro en este mundo y no puede hacer de sombra—.
    //
    // La entrada: el mundo Legacy montaba de golpe, con todo puesto en el
    // fotograma uno, mientras Personal entra escalonado. Ahora el distintivo, el
    // titular, la entradilla y la escena entran con los mismos tiempos que
    // `HeroContent`. Sin `scale` a propósito: la cámara de la escena mide el SVG
    // con `getBoundingClientRect` y un ancestro escalado le daría un ancho falso
    // que el ResizeObserver no corrige nunca.
    version: '0.9.232',
    date: '2026-09-19',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-19: «el puente cruza recto por debajo, no sube por
    // encima» y «que los puntos que representan el quórum sean lo que sustenta
    // el puente». El puente de lomo de asno se cae: ahora es de TABLERO
    // INFERIOR. El arco queda entero y libre por encima, con su ojo abierto; el
    // paso cruza RECTO a la cota de los dos labios; y lo que lo sostiene son
    // cinco péndolas colgadas del intradós —los cinco asientos del consejo—,
    // que se tienden en el MISMO fotograma en que se encienden las cinco celdas
    // de la lámina del quórum. El cierre, además, amanece en índigo en vez de en
    // crema (el crema es el día de Personal) y su hueco de luz pasa a ser un
    // arco sobre dos jambas en vez de un medio disco cruzando la pantalla.
    version: '0.9.231',
    date: '2026-09-19',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-19: «el rombo que cruza el puente tiene que pasar por el
    // puente no por el arco, no se entiende sino» y «quita el destello de la
    // estrella y pon un artefacto que siga la línea de narrativa del legacy».
    // No había puente: había una línea de un punto siguiendo el trasdós, o sea
    // que la vasija iba por el lomo del arco. Ahora hay relleno de tímpano con
    // hiladas, calzada con canto, imposta volada y pretil con albardilla, y la
    // vasija se dibuja ENTRE la calzada y el pretil: la oclusión es lo que dice
    // que va por el puente. Y el cierre deja de ser un astro dorado —el color
    // del producto de al lado— para ser la cartela del propio puente, con sus
    // términos labrados, la línea de Astryum vacía a propósito, y la luz
    // entrando por el ojo del arco que se acaba de construir.
    version: '0.9.230',
    date: '2026-09-19',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-19: «quiero que lleves el recorrido de Legacy a nivel
    // profesional». Medido en captura antes de esta pasada: el arco ocupaba el
    // 28 % del cuadro abajo a la derecha, el tajo era un rectángulo del ancho
    // del arco con un panel claro y cinco rayas dentro (una puerta de garaje),
    // la cimbra era un abanico de pelos y las dovelas colocadas flotaban.
    // Ahora: una sola luz con regla de cara iluminada por pieza, sillería con
    // filo labrado y marcas de cantero, estribos a hiladas trabadas, cimbra de
    // madera que se descimbra por capas empezando por las cuñas, traza del
    // cantero antes de la primera piedra, garganta que se abre al bajar con dos
    // planos de fondo, y las cuatro láminas leyéndose CON el scroll en el mismo
    // fotograma que la escena. El cierre, que no tenía frase, la tiene.
    version: '0.9.229',
    date: '2026-09-19',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-18, con el QR del omnibus delante y otra cuenta
    // conectada en Xaman: «crea el payload… QR». El pago ya lleva el omnibus
    // fijado; ahora la puerta crea el QR para esa cuenta sin pedir que se
    // cambie la cuenta conectada.
    version: '0.9.228',
    date: '2026-09-18',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-18: «el autopilot hay que sacarlo no visible y que se
    // haga a través de QR». El autopilot firmaba con una llave del servidor que
    // solo abría UN omnibus, y el de un exchange nuevo vive en la Xaman de su
    // dueño. Ahora la consola enseña «Peticiones de tus clientes»: cada una la
    // firma el omnibus con un QR, por el importe que pidió el cliente; el KYC
    // son dos QR (la raíz emite, el omnibus acepta); y el cliente ve «Con el
    // exchange» y luego «Hecho» en vez de «Rechazada».
    version: '0.9.227',
    date: '2026-09-18',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-18: «no me aparece el modal de crear una cuenta dentro de
    // un exchange… cuando crea una cuenta a un exchange es al que ha pedido
    // acceso y le han dado la verificación». Su passkey ya era cliente de otro
    // exchange y «Crear una cuenta de cliente» lo metía en esa cuenta sin decir
    // nada. Ahora ser cliente es por exchange: la misma passkey pide acceso a
    // cada uno (su tag, su KYC), «Crear» enseña los exchanges a los que aún
    // puede pedirlo y «Entrar» deja elegir entre sus cuentas.
    version: '0.9.226',
    date: '2026-09-18',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-18, captura de la estación 7 del alta del exchange: una
    // raíz fundada ese mismo día decía «ya tiene historia de otra vida — elige
    // una cuenta NUEVA», y crear la mesa enseñaba «NOT_AN_ADMIN» a secas. La
    // jaula nace en la estación 4 y la mesa en la 7, y la regla era «jaula sin
    // mesa». Ahora la jaula es de esta vida si el alta vio la raíz sin jaula,
    // vio nacerla, o la raíz designó a su omnibus en el ledger; y la puerta de
    // operador se dice en frase, con el paso que la abre.
    version: '0.9.225',
    date: '2026-09-18',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-17: «no me deja cerrar un lend en Upshift… me dice que
    // conecte mi XRPL wallet cuando ya está conectada. No quiero dejar más
    // huecos». La wallet estaba ENLAZADA, no conectada en ese navegador, y
    // diez pantallas exigían la sesión aunque el pago ya llevara la cuenta
    // firmante dentro. Ahora cualquier pago con su cuenta fijada firma sin
    // sesión —el QR del servidor pide esa cuenta en Xaman— en retiradas,
    // cobros, salidas de pote, envíos, préstamos y acciones de la Smart
    // Account; conectar solo hace falta si la sesión viva es OTRA cuenta.
    version: '0.9.224',
    date: '2026-09-17',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-17: «he puesto tokens en el vault de un gestor, el
    // gestor los ha puesto a trabajar, me he vuelto a cambiar de cuenta y no me
    // aparecen en En marcha». Estaban en la cadena y se podían sacar; la
    // estantería enseñaba la lectura de la cuenta ANTERIOR: la instantánea de
    // posiciones gestionadas vivía en el navegador y solo se releía si nunca
    // se había leído. Ahora es de la cuenta en sesión, se olvida al salir o
    // cambiar de cuenta, y se relee pasado un minuto.
    version: '0.9.223',
    date: '2026-09-17',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-17, en el pote gestionado: «me pone la wallet de
    // MetaMask por defecto», «no aparece la barrita para elegir la cantidad» y
    // «me hace escanear un QR para conectar Xaman cuando ya está en la
    // cuenta». Xaman manda por defecto si está enlazada; la cantidad se
    // desliza como en los demás vaults; y una cuenta de firma única firma por
    // el QR del servidor, sin conectar antes — un solo QR, el de la firma.
    version: '0.9.222',
    date: '2026-09-17',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-15: «tengo un vault que trabaja con FXRP y no me permite
    // poner FXRP» — XRPL_WALLET_PARTNER_NOT_CONNECTED. La ventana de entrada
    // preparaba el pago (ocupando el asiento de nonce cinco minutos) y luego
    // fallaba porque la cuenta elegida, enlazada a la cuenta, no tenía sesión
    // de Xaman en ese navegador. Ahora, sin sesión, no se prepara nada: se
    // pide conectar Xaman con ESA cuenta, en la propia ventana, y se sigue.
    version: '0.9.221',
    date: '2026-09-15',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-15: «me chirría que te deje firmar dos veces el mismo
    // tema… si el usuario ya ha firmado una vez, que no pueda volver a
    // hacerlo». El nacimiento de la jaula: tras firmar, la estación volvía a
    // ofrecer el botón mientras la red probaba la jaula. Ahora el servidor
    // recuerda el nacimiento firmado en vuelo, se niega a componer otro, y la
    // estación lo dice —«una firma es un nacimiento, no se cobra nada más»—
    // con el enlace a la firma en el ledger; y mientras el ledger valida una
    // firma (constitución, jaula) el botón de firmar desaparece.
    version: '0.9.220',
    date: '2026-09-15',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-15: «no entiendo por qué no me acepta el KYC… he
    // conectado las dos wallets de MetaMask que tengo a Astryum». La estación
    // Título solo miraba la sesión viva de MetaMask, que se guarda por
    // dominio: en el preview decía «sin wallet EVM» con las dos enlazadas. La
    // atestación de Coinbase se busca por dirección, así que ahora vale una
    // EVM enlazada a la cuenta (se elige si hay varias); solo la firma pide
    // conectarla, y la estación abre el conector y lo dice.
    version: '0.9.219',
    date: '2026-09-15',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-15, grabando el recorrido entero (wallets → cuenta →
    // managed vault) con una cuenta corriente: al pegar el link en la estación
    // Título salía «NOT_AN_ADMIN». La licencia de DEMO del notario solo la podía
    // pedir un fundador; el jurado se quedaba en esa estación sin llegar al
    // pote. Ahora la pide cualquier cuenta con sesión, para una wallet propia y
    // con tope por cuenta y por día. Sigue siendo rodaje: el link viaja como
    // evidencia y quien confíe lo comprueba.
    version: '0.9.218',
    date: '2026-09-15',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-15: «cuando se abre la configuración, se abre primero
    // en formato popup… en pequeñito… el popup no cambia demasiado de tamaño,
    // pero sí el fondo». Todas las operaciones flotaban en la misma caja de
    // 42×44 rem. Las ceremonias (Legacy, gestor, exchange, la mesa) tienen
    // ahora una caja propia que crece con la pantalla —hasta 84 rem de ancho
    // y 72 rem de alto— y el raíl de estaciones se pone al lado en cuanto
    // cabe, como en la página. Las demás operaciones no cambian.
    version: '0.9.217',
    date: '2026-09-15',
    items: [{ kind: 'visual' }],
  },
  {
    // Fundador 2026-09-15: «los popups que aparecen para informar que una
    // acción ya está configurada/terminada… molestan bastante». Era un modal
    // con fondo oscuro para un dato que no pide nada, y en un Legacy ya
    // constituido saltaba en todas las estaciones. El hecho (esta estación
    // está hecha, esto se leyó) vive ahora en una franja dentro de la
    // estación, con «por qué cuenta» desplegable y el salto a la primera
    // pendiente; el evento (has retomado más allá de la primera) es una
    // notificación temporal arriba a la derecha, una vez por apertura. En
    // las tres ceremonias: Legacy, gestor y exchange.
    version: '0.9.216',
    date: '2026-09-15',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-15: «el proceso de configuración de una account como
    // manager se ha perdido». La ventana del alta miraba solo la sesión viva
    // de Xaman de ESTE navegador; con la cuenta gestora enlazada pero sin
    // sesión, enseñaba «créala en Xaman» en vez de las seis estaciones ya
    // hechas — y no dejaba elegir otra. La ceremonia sigue ahora la misma
    // regla que la mesa (conectadas Y enlazadas), la primera estación elige
    // entre todas, y «Renovar» desde Operar aterriza en la estación Título.
    version: '0.9.215',
    date: '2026-09-15',
    items: [{ kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-15: «el log de updates que hay en el home… se abre y
    // demás, pero no funciona el scroll». Desde la 0.9.176 ninguna versión
    // llevaba un hito DeFi, y la regla de aglomerar «entre hitos» plegó 38
    // versiones en UNA fila: nada que leer, nada que desplazar — y la rueda,
    // sin nada que mover dentro, movía la página y cerraba el panel bajo la
    // mano. La bitácora se pliega ahora por día (y por hito), enseña el log
    // entero, la rueda no sale del panel, y en pantallas cortas el panel se
    // encoge a lo que cabe debajo del botón.
    version: '0.9.214',
    date: '2026-09-15',
    items: [{ kind: 'behavior' }],
  },
  {
    // Founder 2026-09-14: «desde la wallet que marca como managed no puedo
    // acceder» a la mesa del gestor. La mesa solo miraba la sesión viva de
    // Xaman de ESTE navegador; ahora gobierna desde las XRPL enlazadas a la
    // cuenta, y Xaman pide esa cuenta al firmar. Y reconectar una Xaman ya
    // enlazada dice «conectada de nuevo», no «nada cambió».
    version: '0.9.213',
    date: '2026-09-14',
    items: [{ kind: 'behavior' }],
  },
  {
    // Founder 2026-09-14: «en el preview tengo una wallet legacy conectada y
    // en production no me aparece ninguna» — misma base de datos, distinto
    // navegador. La marca local de «quitado» del sábado escondía también los
    // Legacies que el servidor tenía activos. Ahora frena solo lo automático;
    // lo que el registro tiene, se enseña, y se quita quitándolo.
    version: '0.9.212',
    date: '2026-09-14',
    items: [{ kind: 'behavior' }],
  },
  {
    // Signing in stops repeating itself (founder 2026-09-14): the setup
    // questionnaire — language, goal, tours — now rides the ACCOUNT, so a
    // second browser no longer asks again; and the page no longer freezes
    // after signing, a ghost overlay that never unmounted. The legal
    // signature already lived on the account: it is only re-presented when a
    // document changes, which is the promise both documents make.
    version: '0.9.211',
    date: '2026-09-14',
    items: [{ kind: 'behavior' }, { kind: 'security' }],
  },
  {
    // Fundador 2026-09-14, segunda vuelta del tema: «al cambiar de tema se
    // queda la página en gris bugeada… haz alguna especie de barrido para
    // cuando se cambia el tema… en el tema normal todo carga súper rápido».
    // Reproducido y medido en un navegador sin cabeza: al cambiar de material
    // framer devolvía a «oculto» toda propiedad que desapareciera del objetivo
    // nuevo (opacidad 0.35 residual; recorte cerrado al volver). Ahora cambiar
    // de tema es un barrido: la página vuelve a entrar en el lenguaje del tema
    // nuevo bajo una banda de luz de su acento. Y en Astryum vuelven el
    // tempo de recharts (1500 ms, no 400) y la entrada de primera visita tras
    // el velo; los anillos, la curva, el calibre y las cifras arrancan cuando
    // cae la cortina, no detrás de ella.
    version: '0.9.210',
    date: '2026-09-14',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Founder 2026-09-14, al ver «Lend your RLUSD» en producción: «este no está
    // probado, así que no hay que meterlo en producción hasta que esté
    // probado». Nadie lo publicó: una variable de entorno clonada se hizo
    // efectiva con el primer deploy del backend que construyó. Desde hoy lo
    // que se ve en producción lo decide una lista en código (ADR-014).
    version: '0.9.209',
    date: '2026-09-14',
    items: [{ kind: 'security' }, { kind: 'behavior' }],
  },
  {
    // Fundador 2026-09-14: «con el nuevo estilo gráfico institucional no
    // tiene animación de inicio el portfolio, aparecen todos los cuadros sin
    // más… el tema me gusta mucho, pero quiero que se infiltre todavía más».
    // La lámina gana su propia entrada (los bloques se imprimen, los filetes
    // se trazan), los gráficos su material (paleta de tinta, tramado en vez
    // de resplandor, calibre graduado en vez de planeta) y las páginas sus
    // grabados (globo de meridianos, sello con firmas) donde aún montaban
    // escenas de espacio con el bronce encima.
    version: '0.9.208',
    date: '2026-09-14',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Founder 2026-09-13: «estoy haciendo un Legacy y a cada paso que hago me
    // aparece el popup del paso hecho; el popup viene bien para cuando estás
    // en un proceso en el que ya hay pasos hechos, no cuando estoy haciendo
    // cada paso». El aviso se disparaba en la TRANSICIÓN a «hecha», así que
    // felicitaba por lo que acababas de firmar.
    version: '0.9.207',
    date: '2026-09-13',
    items: [
      {
        kind: 'behavior',
        es: 'El aviso de «esta estación ya estaba hecha» vuelve a ser lo que prometía: sale al ENTRAR en un paso que el ledger ya tenía resuelto, y ya no cuando eres tú quien acaba de resolverlo. Mientras constituyes un Legacy —o cualquier otra ceremonia por estaciones— ya no salta un popup detrás de cada firma. Sigue estando a un clic en el pie de la barra de pasos, por si quieres releer qué se leyó para darlo por hecho.',
        en: 'The «this station was already done» notice is what it promised again: it appears when you ARRIVE at a step the ledger had already settled, and no longer when you are the one who just settled it. Constituting a Legacy — or any other station ceremony — no longer pops a dialog after every signature. It is still one click away at the foot of the step rail, in case you want to re-read what was checked.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // Founder 2026-09-13, segunda vuelta: «la firma y demás funciona, pero no
    // se borra la wallet, no desaparece de la account». Se borraba la fila Y la
    // entrada del registro, y la cuenta volvía igual: cada carga del registro
    // VUELCA los punteros locales del navegador y la daba de alta otra vez. El
    // comentario de ese volcado lo decía sin darse cuenta — «localStorage nunca
    // se borra» es un diseño que da por hecho que nadie quita nada.
    version: '0.9.206',
    date: '2026-09-13',
    items: [
      {
        kind: 'behavior',
        es: 'Quitar una cuenta de tu lista ahora se queda quitado. Antes, la sincronización que mantiene tus Legacies al día volvía a darla de alta en la siguiente lectura, así que la cuenta reaparecía aunque el borrado hubiera ido bien. Ahora una dirección que quitaste no vuelve por ningún camino automático —ni por esa sincronización, ni por la wallet conectada, ni por el auto-registro— y desaparece a la vez de Wallets, de Home y de tus Legacies. Vuelve cuando la añades otra vez, que es lo único que levanta la marca.',
        en: 'Removing an account from your list now sticks. Until today the sync that keeps your Legacies up to date registered it again on the next read, so the account came back even though the deletion had worked. An address you removed no longer returns through any automatic path — not that sync, not the connected wallet, not auto-registration — and it disappears from Wallets, Home and your Legacies at once. It comes back when you add it again, which is the only thing that lifts the mark.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // Founder 2026-09-13: «tengo una wallet legacy que no puedo eliminar de la
    // cuenta; en Manage no aparece el botón de remove, ni la papelera, ni
    // cuando entro en Govern aparece ninguna opción». Dos fallos encadenados:
    // el bloque de borrado entero vivía dentro de un `{!council && …}`, y
    // aunque se hubiera pintado, borrar sólo la fila dejaba vivos el puntero
    // del registro y la sesión conectada, así que la cuenta volvía.
    version: '0.9.205',
    date: '2026-09-13',
    items: [
      {
        kind: 'behavior',
        es: 'Una cuenta gobernada por un consejo ya se puede quitar de tu lista: el botón de quitar aparece también en su panel, y ahora se borra todo lo que la traía —la fila, el puntero del registro y, si es la wallet conectada, esa conexión— para que no vuelva sola en la siguiente lectura. Antes de borrar nada se abre una confirmación que dice qué se quita y qué NO se toca: la cuenta, su consejo y su capital siguen en XRPL exactamente igual, y no se firma nada.',
        en: 'An account governed by a council can now be removed from your list: the remove button shows in its panel too, and everything that brought it back is now cleared — the row, the registry pointer and, when it is the connected wallet, that connection — so it does not reappear on the next read. Before anything is deleted a confirmation says what goes and what is NOT touched: the account, its council and its capital stay on XRPL exactly as they are, and nothing is signed.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // Los grabados del tema Institucional se disolvian cuando se montaban
    // pequenos: un trazo monolinea por debajo de medio pixel de CSS lo reparte
    // el antialias entre dos columnas y llega al ojo como neblina. Dolia justo
    // en la probeta con la que se ELIGE el tema (0,23 px). El grosor y la
    // tinta compensan ahora el tamano de pintado, sin tocar los montajes
    // grandes. Y la balanza de 26px sale de la probeta: ningun grosor salva un
    // dibujo de esa densidad a ese tamano. Hallazgo de la sesion astryum-27,
    // rasterizando los marks a sus tamanos reales.
    version: '0.9.204',
    date: '2026-09-13',
    items: [{ kind: 'visual' }],
  },
  {
    // El sello del tema Institucional se pintaba roto: dos de las tres vueltas
    // de la roseta de guilloché eran RAYAS planas, no filigranas. La causa era
    // R = 2r, el punto donde el hipotrocoide degenera en elipse (par de Tusi),
    // y dos curvas mas se salian de su caja. Lo cazo la sesion paralela
    // astryum-27 ejecutando la formula. Arreglado, y la regla queda fijada en
    // una prueba (ui/__tests__/skinMarks.test.ts) que rechaza los cinco
    // triples viejos: un comentario no impide que el proximo vuelva a ser una
    // raya. De paso, el periodo se calcula con gcd y el trazo sale liso — el
    // segmento mas largo baja de 6,9 px a 0,99 px.
    version: '0.9.203',
    date: '2026-09-13',
    items: [{ kind: 'visual' }],
  },
  {
    // El TEMA deja de ser un interruptor de color (fundador 2026-09-13: «algo
    // disruptivo y que se note, no un simple cambio de colores y ya»). Ahora
    // hay dos temas: Astryum, que es todo lo de siempre sin mover un pixel, e
    // Institucional, que cambia el material entero — bronce en vez de oro,
    // esquinas cuadradas, titulares en serif, filetes en vez de sombras, el
    // rayado de seguridad en vez del campo de estrellas y grabados (roseta de
    // guilloché, balanza, pórtico) en vez de escenas. La luz (claro/oscuro)
    // pasa a ser un eje aparte, y el tema viaja con la CUENTA, no con el
    // navegador. Se elige con dos probetas en vivo, en Ajustes y en el
    // segundo paso del cuestionario de alta.
    version: '0.9.202',
    date: '2026-09-13',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Founder 2026-09-13: «voy a añadir una wallet y la página no entiende y
    // se queda tonta». Adding a wallet could end in three different places
    // without saying which — already in your list, or an account governed by
    // a council (which production's list FILTERS OUT, so the row was really
    // written server-side and then vanished from the screen). Now the add
    // looks first, asks when it must, and always says how it ended.
    version: '0.9.201',
    date: '2026-09-13',
    items: [
      {
        kind: 'behavior',
        es: 'Añadir una wallet ya no acaba en silencio: antes de escribir nada se mira qué es la dirección. Si ya la tenías, se dice. Si el ledger prueba que sus firmas son de un consejo, se avisa con su quórum y se pregunta si quieres añadirla igualmente — y se anuncia que aterriza en el estante Legacy, en solo lectura. Si la lectura del ledger falla, se dice que falló en vez de suponer que la cuenta está limpia. Al terminar, la pantalla nombra la wallet y el estante donde la encontrarás.',
        en: 'Adding a wallet no longer ends in silence: before writing anything, the address is inspected. If you already had it, it says so. If the ledger proves its signatures come from a council, it warns you with the quorum and asks whether to add it anyway — and announces that it lands on the Legacy shelf, read-only. If the ledger read fails, it says so instead of assuming the account is plain. When it ends, the screen names the wallet and the shelf where you will find it.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // The Xaman cube is back in every Xaman wallet's chip, and its colours
    // now dress the card (founder 2026-09-13): the account's public avatar,
    // fetched through our own server and declared in the privacy notice
    // (revision 2026-09-13, re-presented once), with its dominant colour as
    // the card's default — «Follow the Xaman avatar» in Manage, on by
    // default; pick a swatch to choose your own.
    version: '0.9.200',
    date: '2026-09-13',
    items: [{ kind: 'visual' }, { kind: 'behavior' }, { kind: 'security' }],
  },
  {
    // Founder 2026-09-13, «arréglalo todo»: a second account created in the
    // same browser inherited the first one's wallets, Legacy, photo and
    // skipped the first-run wizard — because entering/creating an account
    // only released MetaMask while signing out cleared everything, and the
    // photo, the wizard and the tours lived per browser. And the legal
    // ceremony learns why it appears, asks only for what changed, shows a
    // receipt, reads in your language, and Settings keeps your signatures.
    version: '0.9.200',
    date: '2026-09-13',
    items: [
      {
        kind: 'security',
        es: 'Entrar o crear una cuenta empieza ahora con una sesión limpia, igual que salir: sin la wallet conectada, sin la lista de wallets ni el Legacy de la cuenta anterior, y sin su autoridad activa, sus ventanas ni sus chats cuando la cuenta cambia. Una respuesta tardía de la sesión anterior ya no puede colar sus wallets en la nueva.',
        en: 'Entering or creating an account now starts with a clean session, just like signing out: no connected wallet, no wallet list or Legacy from the previous account, and no active authority, windows or chats when the account changes. A late answer from the previous session can no longer slip its wallets into the new one.',
      },
      {
        kind: 'behavior',
        es: 'La foto y el nombre locales se buscan por cuenta, no por dirección de wallet; el asistente inicial y los tours son por cuenta: una cuenta nueva en el mismo navegador los ve, y la de siempre no los repite.',
        en: 'Local photo and name are looked up per account, not per wallet address; the first-run wizard and tours are per account: a new account in the same browser sees them, the usual one does not repeat them.',
      },
      {
        kind: 'behavior',
        es: 'La firma legal, mejor hecha: la puerta del panel dice por qué aparece, pide releer solo el documento que cambió, se lee en ES o EN desde la propia ceremonia y enseña el recibo al firmar. Una cuenta creada con la ceremonia ya no la ve dos veces. Ajustes tiene «Tus firmas» con versión, fecha y los textos para releer.',
        en: 'The legal signature, done better: the dashboard gate says why it appears, asks to re-read only the document that changed, reads in ES or EN from the ceremony itself and shows a receipt on signing. An account created through the ceremony no longer sees it twice. Settings has “Your signatures” with version, date and the texts to re-read.',
      },
    ],
  },
  {
    // Managed vaults look like every other Earn menu again (founder
    // 2026-09-13, second pass: «se ven achatados y pequeñitos… deberían verse
    // como todas las estrategias del Earn»): the same hand / shelf / list as
    // the other two menus, with what yesterday's pass asked for kept inside
    // the card — the money first (in the vault, yours) and the manager's
    // image small.
    version: '0.9.199',
    date: '2026-09-13',
    items: [{ kind: 'visual' }],
  },
  {
    // Founder 2026-09-13: creating an account must make you READ and SIGN the
    // two legal documents — the text in front of you, scrolled to the end,
    // and the signature as a Xaman-style slide. The two checkboxes with two
    // links nobody opened are gone, on both doors (sign-up and the first
    // dashboard entry). One ceremony, one copy of each text.
    version: '0.9.198',
    date: '2026-09-13',
    items: [
      {
        kind: 'security',
        es: 'Crear cuenta pide ahora leer y FIRMAR: las condiciones de uso y el aviso de privacidad aparecen enteros, hay que bajar hasta el final de los dos, y la firma es deslizar una flecha hacia la derecha, como en Xaman. Se registra con la versión del texto y la fecha.',
        en: 'Creating an account now asks you to read and SIGN: the terms of use and the privacy notice appear in full, you must scroll to the end of both, and signing is a slide of the arrow to the right, like in Xaman. Recorded with the text version and the date.',
      },
      {
        kind: 'behavior',
        es: 'La misma ceremonia sustituye a las dos casillas de la puerta del panel, y el texto que firmas es el MISMO componente que publica /demo-terms y /privacy: una sola fuente, nunca dos copias que se separan.',
        en: 'The same ceremony replaces the two checkboxes on the dashboard gate, and the text you sign is the SAME component that publishes /demo-terms and /privacy: one source, never two copies that drift apart.',
      },
    ],
  },
  {
    // CAPITAL NEVER GOES MUTE (founder 2026-09-13: opened a Legacy's Capital
    // room and saw an empty screen — «¿por qué me aparece vacío entonces?»).
    // Two holes, both silent by construction: LegacyVaultCard returned bare
    // `null` when the cage state was missing AND when the account is a
    // reinforced personal quorum, so the room rendered nothing at all and a
    // read that failed looked exactly like «there is nothing here» — the one
    // thing this codebase promises never to do. Both now speak: «could not be
    // read» says so and offers a retry, and a reinforced wallet says it has no
    // cage ON PURPOSE (without offering the one-way door). And the room gained
    // what it never showed: the XRP sitting ON the XRPL account itself, with
    // its spendable-after-reserves line — the other half of the patrimony,
    // invisible in Govern until today.
    version: '0.9.197',
    date: '2026-09-13',
    items: [
      {
        kind: 'behavior',
        es: 'La sala Capital de un Legacy ya no se queda en blanco: dice si la jaula no se pudo leer (que no es lo mismo que esté vacía), dice cuándo una cuenta reforzada no lleva jaula a propósito, y enseña por fin el XRP que hay en la propia cuenta.',
        en: 'A Legacy\u2019s Capital room no longer goes blank: it says when the cage could not be read (which is not the same as empty), says when a reinforced account has no cage on purpose, and finally shows the XRP sitting on the account itself.',
      },
    ],
  },
  {
    // Founder 2026-09-13, on the manager desk's Operate room, after the
    // bridge redesign of the same day: «sigue sin gustarme — el mismo rollo»
    // (the same as the catalogue: better distributed, money leading, image
    // secondary, not everything horizontal). The room is now a two-column
    // mosaic: a vertical box on the left with the vaults stacked, the chosen
    // one's money in large figures and the three doors in a column; the
    // wide boxes on the right carry the chosen tab.
    version: '0.9.196',
    date: '2026-09-13',
    items: [
      {
        kind: 'visual',
        es: 'Mesa del gestor, Operar: la sala pasa a un mosaico de dos columnas. A la izquierda, un recuadro vertical con tus bóvedas apiladas, la elegida con su dinero en grande (en la bóveda, desplegable, trabajando, suelo) y las tres puertas —Capital, Constitución, Identidad— en columna. A la derecha, en recuadros anchos, la pestaña elegida. La imagen queda pequeña.',
        en: 'Manager desk, Operate: the room becomes a two-column mosaic. On the left, a vertical box with your vaults stacked, the chosen one’s money in large figures (in the vault, deployable, working, floor) and the three doors — Capital, Constitution, Identity — in a column. On the right, in wide boxes, the chosen tab. The picture becomes a small mark.',
      },
    ],
  },
  {
    // The manager's Operate room becomes a BRIDGE (founder 2026-09-11: «sigue
    // un pelín complicado y caótico… algo con lo que flipar»): one command
    // strip (account, title, refresh, new vault), one header per vault, and
    // the capital as ONE animated bar — what works at each destination, what
    // is deployable today, the untouchable floor — with named destinations,
    // what each does and today's rate; Identity (image, share link, public
    // page) gets its own tab. Facts of the contract only; no yield promises.
    version: '0.9.195',
    date: '2026-09-13',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Founder 2026-09-13, two asks in one afternoon. Managed vaults: the
    // catalogue was one horizontal hand of look-alike cards with the
    // manager's picture presiding; now a mosaic (tall, square and wide
    // boxes) where the money leads — what the vault holds and what is
    // yours — and the picture is a small mark. My Legacies: each Legacy is
    // the SAME credit-card the Wallets screen paints, and removing one is
    // no longer a bare X — it is armed, explained and acknowledged.
    version: '0.9.194',
    date: '2026-09-13',
    items: [
      {
        kind: 'visual',
        es: 'Bóvedas con gestor: el catálogo pasa a un mosaico de recuadros altos, cuadrados y anchos. En cada uno manda el dinero: cuánto hay en la bóveda y cuánto es tuyo, sumado en todas tus wallets. La imagen del gestor queda pequeña en la esquina.',
        en: 'Managed vaults: the catalogue becomes a mosaic of tall, square and wide boxes. Money leads in each: what the vault holds and what is yours, summed across all your wallets. The manager’s picture becomes a small mark in the corner.',
      },
      {
        kind: 'visual',
        es: 'Mis Legacies: cada Legacy es ahora la misma tarjeta que en Wallets — índigo, corona, sello, y el dorso con las direcciones. Debajo, el estado del consejo y la puerta de Constituir.',
        en: 'My Legacies: each Legacy is now the same card as on Wallets — indigo, crown, seal, and the back with the addresses. Beneath it, the council’s standing and the Constitute door.',
      },
      {
        kind: 'behavior',
        es: 'Quitar un Legacy de la lista ya no es una X: desde Gestionar, «Quitar…» arma y explica, y hay que marcar que la cuenta y su consejo siguen en XRPL antes de poder quitarlo.',
        en: 'Removing a Legacy from the list is no longer a bare X: from Manage, “Remove…” arms and explains, and you must acknowledge that the account and its council stay on XRPL before it can be removed.',
      },
    ],
  },
  {
    // Two marks at once when stepping into Legacy (founder 2026-09-13): the
    // page loader's comet and the crossing's comet. Now there is ONE: the
    // page loader, which takes the colour of the authority you are entering
    // — indigo for Legacy, gold coming home. The crossing keeps only a soft
    // colour wash, so the step is still felt when the page is cached.
    version: '0.9.193',
    date: '2026-09-13',
    items: [
      {
        kind: 'visual',
        es: 'Un solo cometa al cambiar de sitio: el de carga de la página, que se tiñe de índigo al entrar al Legacy y de oro al volver. El cruce deja solo un lavado de color suave.',
        en: 'One comet when changing place: the page loader, which turns indigo entering Legacy and gold coming home. The crossing keeps only a soft colour wash.',
      },
    ],
  },
  {
    // Removing a wallet took one click (founder 2026-09-13, a Legacy gone
    // by accident). Now it takes two: the first arms and says exactly what
    // happens — only tracking stops; the account and its capital stay on
    // the ledger, nothing is signed — and the second, on the red button,
    // removes. A Legacy also asks you to tick that you understand it stays
    // on XRPL.
    version: '0.9.192',
    date: '2026-09-13',
    items: [
      {
        kind: 'behavior',
        es: 'Wallets: quitar una wallet ya no es un clic — el primero arma y dice qué pasa (solo se deja de seguir; nada se firma), el segundo quita. Un Legacy pide además marcar que se entiende que sigue en el ledger.',
        en: 'Wallets: removing a wallet is no longer one click — the first arms and says what happens (only tracking stops; nothing is signed), the second removes. A Legacy also asks you to tick that you understand it stays on the ledger.',
      },
    ],
  },
  {
    // The Personal↔Legacy crossing comet is now small and short (founder
    // 2026-09-12: «más chiquitita y sutil… más cortita»): 56 px, one second,
    // a touch translucent — a signal of passage, not a wait.
    version: '0.9.191',
    date: '2026-09-12',
    items: [{ kind: 'visual' }],
  },
  {
    // Legacy has a home again (founder 2026-09-12, with the hackathon hub):
    // /app/legacy without a destination shows your constituted Legacies as
    // cards, «Constitute a new Legacy», and — with nothing constituted — the
    // empty state that leads into the assistant; «back» from the workshop
    // returns there. And the Personal→Legacy crossing is now the house comet
    // in Legacy indigo (gold on the way home) instead of the two tiles.
    version: '0.9.190',
    date: '2026-09-12',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Wallet cards react to the mouse again (founder 2026-09-12: «antes
    // reaccionaban a la ubicación del ratón en tiempo real… sin desactivar
    // nada de lo nuevo»): a 3D tilt toward the cursor and a light in the
    // card's own tint that follows it across the face, on top of the flip
    // invite and the flight shadow. Calm keeps the cursor effects everywhere
    // but with a lag — the card spotlight included; Minimal stays still.
    version: '0.9.189',
    date: '2026-09-12',
    items: [{ kind: 'visual' }],
  },
  {
    // One template for every setup ceremony (founder 2026-09-12): the
    // window Constitute a Legacy already had — pinnable, minimizable, the
    // stations beside the content — now hosts the manager setup and the
    // exchange setup too, each living exactly once. The desks open them
    // through a door instead of embedding a copy; a hub at /app/setup
    // gathers the three doors. The Legacy ceremony carries the same
    // station rail as the others.
    version: '0.9.189',
    date: '2026-09-12',
    items: [
      {
        kind: 'behavior',
        es: 'Configuraciones unificadas: la ventana de Constituir un Legacy es ahora la plantilla de todas las ceremonias — el alta del gestor y la del exchange se abren en esa misma ventana, cada una vive una sola vez, y las mesas las abren por una puerta. Un hub en /app/setup reúne las tres. El Legacy lleva el mismo raíl de estaciones que las demás.',
        en: 'Unified setups: the Constitute a Legacy window is now the template for every ceremony — the manager setup and the exchange setup open in that same window, each lives exactly once, and the desks open them through a door. A hub at /app/setup gathers the three. The Legacy ceremony carries the same station rail as the others.',
      },
    ],
  },
  {
    // The hackathon hub (founder 2026-09-12: «que cuando un juez se conecte no
    // tenga que pelearse con la página»): a separate «Hackathon exclusives»
    // group at the end of the sidebar — Legacy, Manager desk and (for
    // founders, while its page stays in preview) Exchange — with its own
    // header, its XRPL tag, its icons in the collapsed rail and its own group
    // in ⌘K. One env switch (NEXT_PUBLIC_HACKATHON_HUB=false) dissolves it.
    version: '0.9.188',
    date: '2026-09-12',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Wallets by function, at a glance (founder 2026-09-12): the three
    // shelves — personal, manager and Legacy — share one inline head (icon
    // in its ring, the name in its colour, the count, the rule in one line,
    // a door to the desk where it belongs) over a colour rail down the
    // left, instead of bands cutting the page.
    version: '0.9.187',
    date: '2026-09-12',
    items: [
      {
        kind: 'visual',
        es: 'Wallets: los tres estantes — personal, gestor y Legacy — comparten la misma cabecera en línea y un raíl de color a la izquierda, en vez de bandas que parten la página.',
        en: 'Wallets: the three shelves — personal, manager and Legacy — share one inline head and a colour rail down the left, instead of bands cutting the page.',
      },
    ],
  },
  {
    // «Reading catalogue from chain» for ever (founder 2026-09-12): the
    // council sweep, the slow part, still ran INSIDE the catalogue read, so
    // under the node's rate limit the read took tens of minutes and every
    // request kept answering «warming». Now the catalogue is served in
    // seconds with the councils already known, and the sweep runs behind —
    // one per factory, paced to the node, saving its progress — so the
    // missing council names fill in on the next read.
    version: '0.9.186',
    date: '2026-09-12',
    items: [
      {
        kind: 'performance',
        es: 'Bóvedas gestionadas: el catálogo sale en segundos con los consejos que ya se conocen; el escaneo lento corre por detrás al ritmo del nodo y los nombres que falten aparecen en la siguiente lectura.',
        en: 'Managed vaults: the catalogue is served in seconds with the councils already known; the slow sweep runs behind at the node\'s pace and the missing names fill in on the next read.',
      },
    ],
  },
  {
    // Still «The catalogue could not be read» (founder 2026-09-12, after a
    // hard refresh). Measured against the catalogue's RPC: 45 of 48 event
    // windows came back 429 «call rate limit exhausted, retry in 10s». The
    // scanner treated a persistent 429 as «no events» — councils lost in
    // silence, a sweep to the last block on failed windows, minutes per
    // read — and the client sat on its 60-second cap. Now the scanner
    // recognises the rate limit, waits what the node asks, slows the rest
    // of the sweep, keeps its partial progress (persisted) and never fakes
    // «read». And while the catalogue is warming, the server answers «still
    // reading» at once instead of hanging: the page shows the comet and asks
    // again every few seconds.
    version: '0.9.185',
    date: '2026-09-12',
    items: [
      {
        kind: 'performance',
        es: 'Bóvedas gestionadas: el escaneo del catálogo entiende el límite de peticiones del nodo (espera lo que pide, baja el ritmo, guarda el progreso a medias) y, mientras se calienta tras un arranque, la pantalla espera con el cometa en vez de romperse a los 60 segundos.',
        en: 'Managed vaults: the catalogue sweep understands the node\'s rate limit (waits what it asks, slows down, keeps partial progress) and, while it warms after a start, the page waits with the comet instead of breaking at 60 seconds.',
      },
    ],
  },
  {
    // Managed vaults kept loading for too long and ended in «The catalogue
    // could not be read right now» (founder 2026-09-12). The council cache
    // the catalogue depends on lived in the server's memory, and every
    // deploy — every push to the branch — emptied it, so the first reader
    // after a deploy paid a full event scan. Now that cache persists in the
    // database and resumes from the last scanned block, and the server
    // warms the catalogue on boot and every 20 minutes, so nobody pays the
    // cold read when opening Earn.
    version: '0.9.184',
    date: '2026-09-12',
    items: [
      {
        kind: 'performance',
        es: 'Bóvedas gestionadas: el catálogo ya no se enfría con cada deploy — la caché de consejos persiste en la base de datos y el servidor lo calienta al arrancar y cada 20 minutos.',
        en: 'Managed vaults: the catalogue no longer goes cold with every deploy — the council cache persists in the database and the server warms it on boot and every 20 minutes.',
      },
    ],
  },
  {
    // Two fixes from the founder (2026-09-12). The exchange desk gets the
    // rail on the side, as if docked: one left column holds the station
    // rail and, under it, the guided tour, both pinned while you scroll;
    // the desk sits on the right. And closing an operation: the first click
    // on the X arms it (red, with its notice beside) and a second click on
    // the X itself — or on the notice — closes; no more sliding the mouse
    // to the left. The manager desk now asks the same confirmation as the
    // Earn strategies.
    version: '0.9.183',
    date: '2026-09-12',
    items: [
      {
        kind: 'visual',
        es: 'Mesa del exchange: el raíl de estaciones y el tour van en la columna lateral, pegados arriba, como si estuviera anclada; la mesa a la derecha.',
        en: 'Exchange desk: the station rail and the tour sit in the side column, pinned at the top, as if docked; the desk on the right.',
      },
      {
        kind: 'behavior',
        es: 'Cerrar una operación: el primer clic en la X la arma (roja, con el aviso al lado) y el segundo clic en la misma X, o en el aviso, cierra — ya no hay que mover el ratón a la izquierda. La mesa del gestor confirma igual que las estrategias.',
        en: 'Closing an operation: the first click on the X arms it (red, notice beside) and a second click on the X itself, or on the notice, closes — no more sliding the mouse to the left. The manager desk confirms like the strategies do.',
      },
    ],
  },
  {
    // The station rail now follows the BOX, not the screen (founder
    // 2026-09-12: in the dockable window «the usable field on the right gets
    // too small»). In a floating window or a narrow dock the strip sits on
    // top of the content; widen the dock — its limit grows from 720 to
    // 1120px, as far as the screen allows — and the rail returns to the
    // side. Same piece, same names, nothing at the bottom.
    version: '0.9.182',
    date: '2026-09-12',
    items: [
      {
        kind: 'visual',
        es: 'El raíl de estaciones sigue a la caja, no a la pantalla: en una ventana flotante o un anclaje estrecho va arriba como tira; ensancha el anclaje (ahora llega hasta 1120 px, o hasta donde quepa) y vuelve al lado.',
        en: 'The station rail follows the box, not the screen: in a floating window or a narrow dock it sits on top as a strip; widen the dock (now up to 1120 px, or as far as fits) and it returns to the side.',
      },
    ],
  },
  {
    // The station bar moves to the SIDE and changes shape (founder
    // 2026-09-12: «not at the bottom — it forces the eye down; change where
    // it lives, and its form and interaction»). On wide screens the manager
    // setup and the exchange setup carry a vertical rail beside the content,
    // pinned while you scroll: every station with its NAME in view, the
    // current one lit, the done ones with a check, a click to jump, Back and
    // Next inside the rail, and «Why done?» right under the current station.
    // Where there is no free side (the Legacy ceremony, the vault creator,
    // the exchange desk beside the tour) the same piece is a strip pinned at
    // the top with the navigation inside. Nothing lives at the bottom.
    version: '0.9.181',
    date: '2026-09-12',
    items: [
      {
        kind: 'visual',
        es: 'La barra de estaciones deja el pie: en el alta del gestor y en la del exchange es un raíl lateral pegado arriba, con el nombre de cada estación a la vista, la actual encendida, las hechas con su check, Atrás/Siguiente dentro y «¿Por qué hecha?» bajo la actual. Donde no hay lado (Legacy, creador de bóvedas, mesa del exchange) la misma pieza es una tira arriba con la navegación dentro.',
        en: 'The station bar leaves the bottom: in the manager and exchange setups it is a side rail pinned at the top, with every station\'s name in view, the current one lit, the done ones checked, Back/Next inside and «Why done?» under the current one. Where there is no free side (Legacy, the vault creator, the exchange desk) the same piece is a strip at the top with the navigation inside.',
      },
    ],
  },
  {
    // The station bar becomes THE FOOT (founder 2026-09-12: «change where the
    // progress bar lives and how it is handled, in every menu that has
    // one»): one piece pinned to the bottom edge while you scroll — Back,
    // the track, Next — in the Legacy constitution, the manager setup, the
    // vault creator, the exchange setup and the exchange desk. And when you
    // enter a station that is already done, a notice says why: the ledger
    // is per account, here is what was read, jump to the first pending.
    version: '0.9.180',
    date: '2026-09-12',
    items: [
      {
        kind: 'behavior',
        es: 'Las ceremonias por estaciones (Legacy, gestor, creador de bóvedas, exchange) llevan la barra de progreso como PIE: Atrás, la pista y Siguiente en una pieza pegada al borde inferior mientras haces scroll. Y al entrar en una estación ya hecha, un aviso explica por qué (el ledger es por cuenta, qué se leyó) y ofrece saltar a la primera pendiente.',
        en: 'Station ceremonies (Legacy, manager, vault creator, exchange) carry the progress bar as THE FOOT: Back, the track and Next in one piece pinned to the bottom edge while you scroll. And when you enter a station that is already done, a notice explains why (the ledger is per account, what was read) and offers to jump to the first pending one.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // A root with a history (founder 2026-09-12, screenshot: the manager's
    // account picked as exchange root, so constitution, cage and pote showed
    // green — true for that account, wrong for an exchange). One council
    // governs one cage, for ever: a root that already governs a cage without
    // a desk profile of this exchange is another life. The setup now says
    // so, keeps station 1 pending and refuses to advance on that account.
    version: '0.9.179',
    date: '2026-09-12',
    items: [
      {
        kind: 'behavior',
        es: 'Exchange: una raíz que ya gobierna una jaula de otra vida (la del gestor, por ejemplo) no puede ser la raíz del exchange — el alta lo dice, deja la primera estación pendiente y no avanza sobre esa cuenta.',
        en: 'Exchange: a root that already governs a cage from another life (the manager\'s, for instance) cannot be the exchange root — the setup says so, keeps the first station pending and does not advance on that account.',
      },
    ],
  },
  {
    // The operator's setup bar turned stations green without merit (founder
    // 2026-09-12): with the ledger gate off, the gate answered ok without any
    // credential, and "Meet the authority" was green just because a take
    // existed. Now Credentials is green only when both legs are in force in
    // the ledger, E0 is green once the chain facts have been read, and every
    // station says what was read to call it done — or why it is pending.
    version: '0.9.178',
    date: '2026-09-12',
    items: [
      {
        kind: 'behavior',
        es: 'Exchange: la barra del alta ya no pone verde lo que no está hecho — credenciales solo con las dos patas vigentes en el ledger, y cada estación dice de dónde sale su check (o por qué sigue pendiente).',
        en: 'Exchange: the setup bar no longer turns green what is not done — credentials only with both legs in force in the ledger, and every station says where its check comes from (or why it is still pending).',
      },
    ],
  },
  {
    // Two sites, one per person (founder 2026-09-11): the CLIENT site in the
    // menu — warm, in the house's own look, where a user signs up with Face
    // ID, picks their exchange once and gets their tag (their slice of the
    // exchange's omnibus), and where they can create, pick or connect the
    // XRPL wallet their withdrawals go to; and the OPERATOR desk, hidden but
    // one click away (admin panel, or the foot of the client site), plain
    // and functional. The operator's setup now asks for TWO new accounts up
    // front — the root that governs and the omnibus for the users — and
    // hides itself once complete, leaving a green chip to review it.
    version: '0.9.177',
    date: '2026-09-11',
    items: [
      {
        kind: 'behavior',
        es: 'Exchange: dos sitios, uno por persona. El del cliente vive en el menú: te das de alta con Face ID, eliges tu exchange una vez y recibes tu tag (tu trocito del ómnibus), y puedes crear, elegir o conectar la wallet XRPL de tus retiradas. La mesa del operador queda aparte (panel de admin, o el pie del sitio del cliente); su alta pide las dos cuentas nuevas —raíz y ómnibus— y se esconde sola al terminar.',
        en: 'Exchange: two sites, one per person. The client site lives in the menu: sign up with Face ID, pick your exchange once and get your tag (your slice of the omnibus), and create, pick or connect the XRPL wallet your withdrawals go to. The operator desk sits apart (admin panel, or the foot of the client site); its setup asks for the two new accounts — root and omnibus — and hides itself once complete.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // The exchange desk gets its own row in the menu (founder 2026-09-11):
    // the whole custodial-exchange interface in one place, founders only.
    // Three rooms — Set up (become a tenant, station by station: root
    // account, credentials, constitution, KYC registry, cage, pote, gate,
    // desk), Operate (the v2 take with a guided tour beside it, one station
    // at a time, notes folded behind a button, a free path for whoever
    // knows), and the first generation kept for the record. Nobody enters
    // without an XRPL account chosen as theirs: create one in Xaman, pick one
    // already in Astryum, or connect a new one. Every "done" is read from the
    // ledger; the tour never marks anything by itself.
    version: '0.9.176',
    date: '2026-09-11',
    items: [
      {
        kind: 'behavior',
        es: 'Exchange: la mesa entera del exchange custodial tiene fila propia en el menú (solo fundadores). Configurar = nacer como tenant, estación a estación; Operar = la toma de punta a punta con un tour guiado al lado, una estación a la vez y las notas plegadas tras un botón; y la primera generación, como acta. Nadie entra sin elegir su cuenta XRPL: crearla en Xaman, elegir una ya en Astryum o conectar una nueva.',
        en: 'Exchange: the whole custodial-exchange desk gets its own row in the menu (founders only). Set up = become a tenant, station by station; Operate = the take end to end with a guided tour beside it, one station at a time and the notes folded behind a button; and the first generation, kept for the record. Nobody enters without choosing their XRPL account: create one in Xaman, pick one already in Astryum, or connect a new one.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // The community paints at once (founder 2026-09-11: «llevo dos minutos
    // esperando»): it no longer waits for the on-chain catalogue with
    // per-council credential reads — profiles and support show first, vault
    // counts arrive from the shared cached list, and «Verified» refines last.
    // And a manager's public card tells a self-issued credential from a
    // verification: «Auto-emitida — no es una verificación», never a tick.
    version: '0.9.175',
    date: '2026-09-11',
    items: [{ kind: 'performance' }, { kind: 'behavior' }],
  },
  {
    // One progress bar on screen (founder 2026-09-11: «se ven dos progress
    // bar»): inside the account setup the vault creator no longer draws its
    // own bar under the six-station one — its step reads as a line; the
    // creator's bar only appears when it opens on its own from Operate.
    version: '0.9.174',
    date: '2026-09-11',
    items: [{ kind: 'visual' }],
  },
  {
    // Chain reads served from cache (founder 2026-09-11, after the manager
    // desk felt slow and Running showed «the chain could not be read»). The
    // catalogue, each vault's state and a council's cage were re-read from
    // Flare in full on every request, and every screen asked twice (the shell
    // and the shelf at once; the desk, its console and its governance three
    // times for one vault). Against the public RPC, which limits per IP, that
    // burst ended in 429 and the 429 in the warning. Now the backend serves
    // the last known read at once and recomputes behind it, concurrent
    // readers share one chain read, and one ethers provider is reused with a
    // fixed network instead of re-detecting it per request. On the client,
    // positions and pending tickets come from ONE shared pass instead of two,
    // the catalogue is fetched once per screen, reads have a timeout, and a
    // vault whose read failed is now COUNTED and said — an empty list no
    // longer pretends to be the truth.
    version: '0.9.173',
    date: '2026-09-11',
    items: [
      {
        kind: 'performance',
        es: 'Las lecturas de cadena se sirven al instante desde lo último conocido y se recalculan por detrás; la mesa del gestor, la estantería de bóvedas gestionadas y el contador de salidas pendientes comparten una sola pasada en vez de pedir lo mismo por duplicado.',
        en: 'Chain reads are served at once from the last known state and recomputed behind; the manager desk, the managed-vaults shelf and the pending-exits counter share one pass instead of asking for the same thing twice.',
      },
      {
        kind: 'behavior',
        es: 'Running: si alguna bóveda no se pudo leer, se dice — antes una lectura fallida dejaba la lista vacía como si no tuvieras ninguna. Las lecturas tienen tope de espera.',
        en: 'Running: if a vault could not be read, it says so — a failed read used to leave the list empty as if you had none. Reads now have a timeout.',
      },
    ],
  },
  {
    // From a colleague's screenshot on a smaller screen (founder
    // 2026-09-11). Home: the dashboard column was pinned to the viewport
    // height, so on short screens the donut rings were clipped instead of
    // scrolling — now the column grows and the page scrolls. The Home
    // wallets band no longer lists Flare Smart Accounts (their value still
    // counts in the net worth; the band shows the keys you hold). Wallets:
    // the separate «Manager» shelf is gone — a manager wallet stays with the
    // rest of Personal and wears a small briefcase mark instead, and while
    // the aggregate is still reading, a breathing chip counts the wallets
    // already valued, so «all loaded» is a fact you can see.
    version: '0.9.172',
    date: '2026-09-11',
    items: [
      {
        kind: 'visual',
        es: 'Home: los anillos ya no se recortan en pantallas bajas — la columna crece y la página hace scroll. La banda de wallets del Home ya no lista las Smart Accounts de Flare (su valor sigue contando).',
        en: 'Home: the rings are no longer clipped on short screens — the column grows and the page scrolls. The Home wallets band no longer lists Flare Smart Accounts (their value still counts).',
      },
      {
        kind: 'behavior',
        es: 'Wallets: la wallet de gestor se queda entre las personales con un sello «Gestor» en vez de en un estante aparte, y mientras se siguen leyendo las wallets un chip cuenta cuántas están ya valoradas.',
        en: 'Wallets: a manager wallet stays among your personal ones with a «Manager» mark instead of a separate shelf, and while wallets are still being read a chip counts how many are already valued.',
      },
    ],
  },
  {
    // Home reads positions without the wait (founder 2026-09-11). Two
    // causes. On the server, a wallet whose cache had expired — or whose last
    // scan had lost a slow adapter — made every reader sit through the full
    // protocol sweep again (up to the 15s deadline of the slowest adapter);
    // now the last known snapshot is served at once and the sweep runs
    // behind, coalesced, so the wait is paid once per wallet and never
    // again. On the client, each wallet held its positions until history
    // AND risk had also answered; the snapshot now paints the moment it
    // lands and the curve and the risk fill in after. Slow adapters are
    // named in the logs, so the next round can aim.
    version: '0.9.171',
    date: '2026-09-11',
    items: [
      {
        kind: 'defi',
        es: 'El Home lee las posiciones sin esperar: el servidor sirve al instante el último snapshot conocido y recalcula por detrás, y cada wallet pinta sus posiciones en cuanto llegan — la curva y el riesgo se rellenan después.',
        en: 'Home reads positions without the wait: the server serves the last known snapshot at once and recomputes behind it, and each wallet paints its positions the moment they land — the curve and the risk fill in after.',
      },
      { kind: 'performance' },
    ],
  },
  {
    // The sidebar's «To sign» becomes a notification zone (founder
    // 2026-09-11: «no quiero que te lo avise cuando no hay nada pendiente»):
    // at rest, one muted line that marks where things will appear; when a
    // signature, claim or proposal needs you, the card pops into that spot
    // with a breathing dot next to its title; while an operation settles,
    // its card takes the same space.
    version: '0.9.170',
    date: '2026-09-11',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Each destination of a managed vault now shows the rate its protocol
    // publishes right now — with source and hour, the same live read Earn's
    // cards use — and the sheet says why a managed vault has no single APY
    // (founder 2026-09-11: «quiero que el usuario sepa dónde está metiendo el
    // dinero»). No figure when the protocol gives none; a link to check it.
    version: '0.9.169',
    date: '2026-09-11',
    items: [
      {
        kind: 'defi',
        es: 'Cada destino de una bóveda gestionada enseña el tipo que su protocolo publica ahora mismo, con su fuente y su hora — la cifra del protocolo, nunca una promesa — y la ficha explica por qué una bóveda gestionada no tiene un único APY. Sin lectura, sin número: el enlace para comprobarlo allí.',
        en: 'Each destination of a managed vault shows the rate its protocol publishes right now, with source and hour — the protocol’s figure, never a promise — and the sheet explains why a managed vault has no single APY. No reading, no number: a link to check it there.',
      },
    ],
  },
  {
    // A managed vault now says what happens to your tokens (founder
    // 2026-09-11: «que se sepa qué te da dejar los tokens en ese vault»):
    // not a loan, no collateral — you deposit, get shares, the manager can
    // only move the pool into the listed destinations, what they produce
    // stays pro-rata, the fee touches only that, and each destination says
    // what it does (lending market, staking vault) — as a mechanism, never
    // a number. The catalogue line names the destinations instead of
    // counting them, and «How it works» opens with the same fact.
    version: '0.9.168',
    date: '2026-09-11',
    items: [
      {
        kind: 'defi',
        es: 'Cada bóveda gestionada explica qué pasa con tus tokens: ni préstamo ni colateral — depositas, recibes participaciones, el gestor solo puede llevar el capital común a los destinos listados, y cada destino dice qué hace con él (mercado de préstamo, vault de staking). Lo que producen queda en la bóveda a prorrata; la comisión solo toca eso. Sin cifras prometidas.',
        en: 'Each managed vault explains what happens to your tokens: not a loan, no collateral — you deposit, receive shares, the manager can only move the pooled capital into the listed destinations, and each destination says what it does (lending market, staking vault). What they produce stays in the vault pro-rata; the fee touches only that. No promised numbers.',
      },
    ],
  },
  {
    // One face for every wait (founder 2026-09-11: «si está algo cargando
    // tiene que aparecer el logo… homogéneo en todas las páginas»): every
    // section that is still reading its data shows the Astryum comet with
    // its line — positions, timeline, intents, capital map, rules, tabs.
    // Skeletons stay where the shape is already known, spinners stay for
    // actions in progress; the rule lives in AstryumLoader.
    version: '0.9.167',
    date: '2026-09-11',
    items: [{ kind: 'visual' }],
  },
  {
    // A vault you just signed for now shows up by itself (founder
    // 2026-09-11: «parece que no se guarda el vault»): after the relay the
    // creator checks the cage every 15 s until the new vault exists (up to
    // ten minutes, with the clock visible) instead of one blind reload at
    // 30 s; the form is a draft that survives changing station, folding the
    // window or reloading, and dies the moment the order is signed; the
    // Operate gallery gains a Refresh.
    version: '0.9.166',
    date: '2026-09-11',
    items: [{ kind: 'behavior' }],
  },
  {
    // The share symbol is no longer typed (founder 2026-09-10: «nada de
    // texto»): it derives from the vault name, with the asset behind it, and
    // the manager picks one of the variants as a chip.
    version: '0.9.165',
    date: '2026-09-10',
    items: [{ kind: 'behavior' }],
  },
  {
    // Robustness pass over the whole manager flow (founder 2026-09-10: «todo
    // está medio bug»), after a multi-angle review: after every signature the
    // ledger is re-read until the station flips (no more double anchoring);
    // a Xaman request that fails can be retried in place; a relay that
    // refuses is reported, never announced as sent; the desk says which
    // vaults it could not read instead of hiding them and decides the room
    // only on a real read; the Title station never paints «in force» without
    // the gate's verdict; votes and image picks recover from network errors
    // and update in place; the vault creator opens only when the gate allows
    // it and gains an image choice, presets and quick values; a position held
    // in the Personal Account shows without a Flare wallet.
    version: '0.9.164',
    date: '2026-09-10',
    items: [
      { kind: 'behavior' },
      {
        kind: 'defi',
        es: 'El creador de bóvedas es personalizable: elige la imagen de la carta (emblema, tu foto o ninguna), parte de un ajuste rápido (Líquida, Equilibrada, Paciente) y fija tope y comisión con un toque. Y antes de abrir, te dice si el ledger te dejará.',
        en: 'The vault creator is customisable: pick the card image (an emblem, your photo or none), start from a preset (Liquid, Balanced, Patient) and set the cap and fee with one tap. And before opening, it tells you whether the ledger will let you.',
      },
    ],
  },
  {
    // An operation window that fails after a reload closes itself instead of
    // wedging the dashboard on every refresh (founder 2026-09-10: «he
    // refrescado con un QR en pantalla y se ha quedado como pillado»); a
    // persisted window of a kind this build does not know is dropped.
    version: '0.9.163',
    date: '2026-09-10',
    items: [{ kind: 'behavior' }],
  },
  {
    // The cage station says BEFORE you press that the ledger will refuse the
    // birth while the Title station is incomplete, and takes you there
    // (founder 2026-09-10: pressed «Compose the birth» and got
    // MANAGER_CREDENTIAL_REQUIRED for a self-issued AIFM).
    version: '0.9.162',
    date: '2026-09-10',
    items: [{ kind: 'behavior' }],
  },
  {
    // The constitution template of a managed vault is now a full document
    // (founder 2026-09-10: «una constitución como Dios manda»): preamble
    // and twelve articles — object, the manager, limits of the mandate,
    // depositors' rights, fees, transparency, conflicts, delegation,
    // amendments, wind-down, applicable law, anchoring — with blanks the
    // manager fills, in the interface language.
    version: '0.9.161',
    date: '2026-09-10',
    items: [{ kind: 'behavior' }],
  },
  {
    // A valid credential from an issuer the gate does not accept (e.g.
    // self-issued) now says exactly that on its row, names the accepted
    // issuers and marks each tray row as counting or not; the notary's
    // legs already in force read neutral instead of as warnings (founder
    // 2026-09-10: «tengo válido el AIFM y el KYC pero el botón me sigue
    // dando error»).
    version: '0.9.160',
    date: '2026-09-10',
    items: [{ kind: 'behavior' }],
  },
  {
    // The Manager desk is in plain sight for the XRPL hackathon (founder
    // 2026-09-10: «se tiene que poder acceder fácilmente por ahora»): a
    // sidebar row and ⌘K entry for everyone, and the named button in Earn →
    // Managed vaults for everyone too. One env switch
    // (NEXT_PUBLIC_MANAGER_DESK_OPEN=false) puts it back behind the manager
    // flag afterwards. The manager declaration itself is unchanged.
    version: '0.9.159',
    date: '2026-09-10',
    items: [{ kind: 'behavior' }],
  },
  {
    // Wallet cards, second pass (founder 2026-09-10: «cuando giran se queda
    // la sombra en color iluminada por detrás, no me acaba»). The tinted aura
    // was a hover state, so it stayed lit behind the flipped card. It is now
    // the shadow of the FLIGHT: full only while the card turns, a hint under
    // the cursor, off at rest — and it follows the real angle, narrowing when
    // the card is edge-on and shifting toward the receding side.
    version: '0.9.158',
    date: '2026-09-10',
    items: [{ kind: 'visual' }],
  },
  {
    // Wallet cards learn to invite the turn (founder 2026-09-10: «que no sea
    // un simple botón que aparece, algo más complejo… que se vea generalmente
    // mejor cada card, y seguir diferenciando la normal de la legacy»). On
    // hover the card BEGINS its flip — a few degrees toward where it will go —
    // while a tab unfolds from circle to pill (arc traces, icon half-turns,
    // the word appears), the watermark drifts against the tilt and a tinted
    // flight aura lights underneath: indigo for a council, the provider's ink
    // for a personal card. Matte body pass too: top hairline light, grave
    // bottom shading (indigo on councils), the chip sits engraved, and the
    // back's magnetic band goes indigo with the seal on Legacy. A council
    // moves statelier (smaller angle, heavier spring); Calm halves the tempo;
    // Minimal stays still.
    version: '0.9.157',
    date: '2026-09-10',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Portfolio curve (founder 2026-09-10: «parece que baja mucho por poco
    // cambio… más sutil, pero no plano»): the y-axis is now dynamic — it
    // spans at least 5% of the value and grows with the real variation, so a
    // small move looks small and a big one fills the chart. And the header no
    // longer shifts the page when scrubbing: every row keeps its height.
    version: '0.9.156',
    date: '2026-09-10',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Motion level, third pass (founder 2026-09-10: «el modo calm lo has
    // dejado sin animaciones, quiero que lo animes» + «en minimal los
    // interrogantes no funcionan»). Calm gains its own slow pulse: emblems
    // that turn and breathe, shelf cards that settle in and lift a touch,
    // a halo that breathes, tabs that glide without bounce, ambient scenes
    // at a third of their speed. Minimal's list rows no longer clip the
    // help-dot balloon.
    version: '0.9.155',
    date: '2026-09-10',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Manager desk fields follow the theme (founder 2026-09-10: a text entry
    // «looked dark» — they used a fixed white-5% ground; now ink tokens),
    // and the Title station gains «Step by step: set up Coinbase» — eight
    // screens with our own captures/videos and Coinbase's official links,
    // the Legacy Multisign tutorial pattern.
    version: '0.9.154',
    date: '2026-09-10',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // The sidebar is yours even with something pinned (founder 2026-09-10).
    // Pinning an operation still folds the menu into the icon rail by
    // default, but on a wide screen the full menu fits beside it — so both
    // the rail and the full sidebar now carry a toggle, and the choice is
    // remembered. The change of costume is one tuned motion: the panel's
    // width and the content's margin travel together on the same 500ms
    // curve, and what goes inside the panel settles in a beat later, from
    // the left. Under the Minimal motion level, none of it animates.
    version: '0.9.153',
    date: '2026-09-10',
    items: [
      {
        kind: 'defi',
        es: 'Con una operación anclada, la barra lateral se pliega al raíl por defecto — pero ahora puedes abrirla entera al lado si tu pantalla lo permite, y la elección se recuerda. Abrir y cerrar es un solo movimiento afinado.',
        en: 'With an operation pinned, the sidebar folds into the rail by default — but you can now open it fully beside it if your screen allows, and the choice is remembered. Opening and closing is one tuned motion.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Motion level, second pass (founder 2026-09-10: «no quiero solo que se
    // desactiven las animaciones, quiero estilos nuevos y distintos» — and no
    // «System» option). Calm and Minimal are now two visual languages of
    // their own: engraved emblems on the Earn doors and a flat shelf of route
    // cards (Calm); doors and routes as lists, outline primary button,
    // underlined tabs, shadowless cards (Minimal). The selector offers the
    // three levels only; a device asking for reduced motion only decides the
    // very first choice.
    version: '0.9.152',
    date: '2026-09-10',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // Motion level (founder 2026-09-10: «se me generan problemas de
    // concentración con las animaciones de los botones del Earn»): Settings
    // gains a Motion row — Full / Calm / Minimal, or follow the device — that
    // every screen obeys (stores/motionStore.ts). Calm stops everything that
    // moves on its own (the Earn doors' scenes, the hand's tilt and spread,
    // breathing dots, cursor sheens) and keeps only the short response to
    // what the user does; Minimal is the reduced-motion grid.
    version: '0.9.151',
    date: '2026-09-10',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The manager desk leaves the sidebar (founder 2026-09-10): it opens from
    // Earn → Managed vaults as an operation window — floating, pinnable to the
    // right, minimisable, surviving a reload — the same shell Govern uses.
    // The Title station is rebuilt top-down: what it is and how many you hold,
    // one row per required credential with its ledger state, ONE action for
    // the notary, the signature card, and everything else folded.
    version: '0.9.150',
    date: '2026-09-10',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The Title station puts the signature first (founder 2026-09-09: «no me
    // gusta que aparezca abajo… que se pueda ver mejor la petición de
    // firmar»): credentials waiting for your acceptance render at the top of
    // the tray as a highlighted card, the Xaman QR opens right there and
    // scrolls into view, the notary's two legs (KYC / AIFM) each show their
    // own verdict and colour, and gate and tray refresh each other — issue →
    // the tray shows it; accept → the gate re-reads.
    version: '0.9.145',
    date: '2026-09-09',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The «MetaMask connected» strip on Wallets stops overstaying (founder
    // 2026-09-09). It was never a message that expires: it was a status strip
    // tied to the extension's session — alive as long as MetaMask stayed
    // connected, i.e. always. Its job is to offer «add this wallet»; once
    // the wallet is in the list, the header's «Add Wallet» already covers
    // connecting another account. So it now shows only while there is
    // something to do, and carries an X that closes it for the tab.
    version: '0.9.149',
    date: '2026-09-09',
    items: [{ kind: 'behavior' }],
  },
  {
    // Operation windows survive a page refresh (founder 2026-09-09: pinned or
    // open, a refresh wiped the «in progress» window while the operation was
    // still settling). The list of open operations, which one is unfolded
    // and whether it was pinned now persist per account in this browser and
    // come back on reload, until you close them. And a window that had
    // signed something readopts its own settlement — the pending record now
    // carries the window's key — so it reopens straight in «in progress»,
    // not on a blank form. Logging out clears them.
    version: '0.9.148',
    date: '2026-09-09',
    items: [
      {
        kind: 'defi',
        es: 'Las ventanas de operación sobreviven a la recarga — abiertas o ancladas, vuelven donde estaban hasta que las cierres; y una que había firmado reabre directamente en «en proceso», siguiendo su liquidación.',
        en: 'Operation windows survive a refresh — open or pinned, they come back where they were until you close them; and one that had signed reopens straight in «in progress», following its settlement.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // A settled operation now reaches the Home and the Portfolio on its own
    // (founder 2026-09-09: an earnXRP vault deposit showed up nowhere and the
    // earning ring did not move). Two root causes, both fixed. Nothing
    // refreshed after settlement: the backend snapshot lives 5 minutes in
    // cache and the client aggregate a minute more, so the new position did
    // not exist for Home or the ring until a reload much later — now settling
    // forces a fresh snapshot of every wallet and every surface reloads. And
    // the vault reader swallowed any RPC error as a ZERO balance, making the
    // position vanish silently — and that hollow snapshot was cached the
    // full five minutes; a read error is an error now, and a snapshot missing
    // a protocol is cached for seconds, not minutes.
    version: '0.9.147',
    date: '2026-09-09',
    items: [
      {
        kind: 'defi',
        es: 'Una operación asentada llega sola al Home y al Portfolio: al asentar se fuerza un snapshot fresco y todo recarga. Y una lectura fallida de una bóveda ya no se disfraza de saldo cero ni se cachea cinco minutos.',
        en: 'A settled operation reaches Home and the Portfolio on its own: settling forces a fresh snapshot and everything reloads. And a failed vault read no longer masquerades as a zero balance, nor gets cached for five minutes.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // Manager KYC without pasting anything (founder 2026-09-09: «siempre que
    // se pueda reducir el proceso, hacerlo»). The notary now finds the
    // Coinbase «Verified Account» attestation of the EVM wallet you have
    // connected (EAS indexer as a hint, the Base chain as the truth), you sign
    // one challenge with that wallet and the credential lands in your Xaman
    // tray. Pasting the easscan link stays as a folded fallback. Nothing
    // changes legally: public chain facts only, your signature binds, your
    // Xaman accepts.
    version: '0.9.144',
    date: '2026-09-09',
    items: [{ kind: 'behavior' }],
  },
  {
    // The logo in code IS the logo now (founder 2026-09-09: "sigue fallando
    // algo de la forma… se nota"): hand-tracing is out — Logo.tsx v3 is a
    // pixel-faithful trace of the original asteroid PNG (marching squares
    // per colour layer + RDP, deterministic script kept at
    // frontend/scripts/trace-logo.mjs). The loader animates the authentic
    // pieces — the art's four trails, the real rocky outline and shadow,
    // all seven craters and both highlight crescents — and the original's
    // FILLED bumpy ring is revealed by a sweep mask, since a band cannot
    // dash-draw. Same art in the static mark everywhere.
    version: '0.9.144',
    date: '2026-09-09',
    items: [{ kind: 'visual' }],
  },
  {
    // Managed vault cards show the manager's real photo at card size and the
    // token they use with its logo and symbol (founder 2026-09-08: «que se
    // vean bien las imágenes de los perfiles y el token»); the Community
    // door is now a visible button on the Managed vaults page, the Manager
    // desk header and the Settings profile card.
    version: '0.9.143',
    date: '2026-09-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The settled loader reads clean at small sizes (founder 2026-09-08,
    // third pass: "se ve un poco raro… tal vez los boquetes o el color"):
    // the halo tinted the rock↔ring gap brown (opacity halved, blur wider),
    // the ring glow eased, the two dot-craters — noise below 120px — are
    // pruned from the loader (the mark keeps all seven), and the dark rim
    // thins so the white face breathes.
    version: '0.9.146',
    date: '2026-09-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The loader now animates the REAL logo (founder 2026-09-08, second
    // pass: "no has respetado para nada la imagen original"). Logo.tsx v2 is
    // a calibrated vectorization of the actual asteroid PNG — overlay-checked
    // against it over four rounds — and AstryumLoader animates exactly those
    // pieces: the five speed lines streak in, the ROCK FALLS along their
    // diagonal and settles with a bounce (a comet falls, it doesn't draw),
    // the golden ring traces itself around the landed rock, the craters land
    // like shards, and the loop keeps a tilted-orbit mote and a breathing
    // halo. Same art in the static mark everywhere.
    version: '0.9.145',
    date: '2026-09-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The community of managed vaults (founder 2026-09-08). Every vault card
    // can carry an image chosen by its manager — a house emblem, the
    // manager's profile photo, or none (the question mark) — and never looks
    // empty. Manager profiles now say whether the account is run by a person
    // or an AI agent, can reuse the account's own photo, and are shown with
    // that photo everywhere (catalogue, vault sheet, desk, community). New
    // /app/community page (reached from Earn, Settings and any profile — not
    // the sidebar): who runs vaults, verified or not, with vault counts and
    // the support other users gave them (one vote per account, counted on the
    // server), plus a page per actor. Support orders only when the viewer
    // picks that sort; Astryum never ranks or vouches.
    // (Renumerada 142→144 el mismo día: reutilizaba el 142 ya publicado y
    // quedaba por debajo del 143 — el número de plataforma retrocedía.)
    version: '0.9.144',
    date: '2026-09-08',
    items: [
      {
        kind: 'defi',
        es: 'Managed vaults gana comunidad: cada bóveda lleva la imagen que elige su gestor (emblema, su foto o ninguna), cada perfil dice si lo lleva una persona o un agente de IA, y una página de comunidad enseña quién lleva bóvedas —verificado o no— con el apoyo que le han dado otros usuarios. El orden por apoyos solo aparece si tú lo eliges: Astryum no ordena ni avala.',
        en: 'Managed vaults gain a community: each vault carries the image its manager chose (an emblem, their photo or none), each profile says whether a person or an AI agent runs it, and a community page shows who runs vaults — verified or not — with the support other users gave them. Ordering by support appears only when you pick it: Astryum neither ranks nor vouches.',
      },
    ],
  },
  {
    // The boot animation plays WHOLE (founder 2026-09-08: "quiero que la
    // animación se vea fluida y entera"): access verification is near-
    // instant, so the asteroid's birth was getting beheaded mid-stroke. The
    // boot veil now holds until the act completes (~1.9s) and lifts with a
    // fade — and the dashboard MOUNTS UNDERNEATH it meanwhile, so portfolio
    // and wallet reads start during the ceremony: no real time is lost.
    // Reduced motion skips the hold. The manager desk's and managed shelf's
    // section waits switch to the brand loader too.
    version: '0.9.143',
    date: '2026-09-08',
    items: [{ kind: 'visual' }],
  },
  {
    // Loading gets a face (founder 2026-09-08: "animación como tal no hay…
    // una animación currada, sencilla pero compleja, con el logo"). The
    // audit found plain text on black at boot and 292 generic spinners.
    // AstryumLoader animates the actual brand mark in two acts: the BIRTH
    // runs once (comet trail streaks in, the asteroid draws itself, craters
    // land with a bounce, the halo blooms) and the ORBIT loops calmly (halo
    // breathing, trail glinting, one mote circling) so long waits breathe
    // instead of restarting. Pure SVG+CSS from Logo.tsx's own geometry — no
    // Lottie, no deps. Mounted at the access gate and as /app's first
    // route-level loading screen.
    version: '0.9.142',
    date: '2026-09-08',
    items: [
      {
        kind: 'defi',
        es: 'Cargar ya tiene cara: el asteroide de Astryum se dibuja a sí mismo mientras esperas — estela, cráteres y halo, con una mota en órbita en las esperas largas — en la verificación de acceso y las transiciones de ruta.',
        en: 'Loading has a face now: the Astryum asteroid draws itself while you wait — trail, craters and halo, with an orbiting mote on longer waits — at access verification and route transitions.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Station ceremonies read as ONE progress bar (founder 2026-09-08: «a
    // row of numbers is not progress»): Constitute/Reinforce a Legacy and the
    // manager's account setup share components/ui/StationProgress — a slim
    // bar pinned to the top while you scroll, one clickable segment per
    // station to jump back or forward, and «3/6 · station · 2 done» in one
    // line. The numbered circles and their label row are gone; done states
    // still come from the ledger.
    version: '0.9.141',
    date: '2026-09-08',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // The manager desk stops repeating itself (founder 2026-09-08: «the
    // process is tedious and repetitive»). Setup resumes at the first pending
    // station the ledger reports instead of always starting at «Account»; the
    // vault creator is stitched into the setup rail (one navigation footer,
    // not two nested wizards); each station says whether the ledger requires
    // it; the credential gate and tray are mounted once (the Title station)
    // and Operate shows the title as one line; the selected vault reads in
    // two panes (Capital / Constitution) instead of ten stacked cards.
    version: '0.9.140',
    date: '2026-09-08',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The Activity export is the screen now (founder 2026-09-07: the JSON came
    // out empty while the page showed operations). Two root causes: the old
    // engine downloaded one file PER wallet in a loop, and a browser grants a
    // single download per gesture — with «All wallets» only the first file
    // landed (the EVM one, often empty) while the Xaman one, holding the
    // operations on screen, was silently blocked; and it re-fetched from the
    // backend with different parameters than the page. Now it exports
    // exactly the rendered list — same wallets, dates and types — as ONE
    // file, CSV or JSON. What you see is what you get, by construction. If a
    // wallet did not answer or Flare was blind, the JSON says so and the
    // filename carries PARTIAL; an empty window refuses to produce a file.
    version: '0.9.139',
    date: '2026-09-07',
    items: [
      {
        kind: 'defi',
        es: 'Exportar Actividad entrega exactamente lo que ves — mismas wallets, fechas y tipos — en UN fichero CSV o JSON. Antes llegaba solo el primero de varios y podía salir vacío; ahora lo que ves es lo que te llevas, y si falta algo, el fichero lo dice.',
        en: 'Exporting Activity delivers exactly what you see — same wallets, dates and types — as ONE CSV or JSON file. Before, only the first of several landed and could be empty; now what you see is what you get, and if anything is missing the file says so.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // The "?" dots become visible (founder 2026-09-07, with screenshot: "no
    // se ven… se tienen que mostrar en el botón"): v1 baked `relative` into
    // HelpDot's own classes, so the door's `absolute` lost the CSS cascade
    // and the dot ended up half-guillotined at each card's left edge — the
    // mystery "(" arcs. HelpDot is now two layers (outer = consumer's
    // positioning, inner = the tooltip anchor; utility conflicts impossible)
    // and lives IN the button, right beside Open, its bubble opening upward
    // in the house sans.
    version: '0.9.138',
    date: '2026-09-07',
    items: [{ kind: 'visual' }],
  },
  {
    // The Portfolio chart grows up (founder 2026-09-07: it looked a bit
    // cheap). Taller, a glow under the curve, a dotted baseline at the
    // window's start so the shape reads as «better or worse than when this
    // window began», a live pulsing dot on the latest reading, a proper
    // tooltip with the difference, a sparse compact axis — and SCRUB: run the
    // cursor along the curve and the big figure above follows it (that day's
    // value, its delta vs the start), snapping back to the live total when
    // you leave. And the Structures band leaves the Portfolio: since a
    // structure is a scope in the «Wallet» selector, the band repeated the
    // list one line lower.
    version: '0.9.137',
    date: '2026-09-07',
    items: [
      {
        kind: 'defi',
        es: 'El gráfico del Portfolio se hace mayor: resplandor, línea base del arranque de la ventana, punto vivo y tooltip con la diferencia — y al recorrerlo, la cifra grande sigue al cursor. La banda de estructuras se retira: ya viven en el selector de wallet.',
        en: 'The Portfolio chart grows up: glow, a baseline at the window start, a live dot and a tooltip with the difference — and scrubbing it makes the big figure follow the cursor. The Structures band leaves: they live in the wallet selector now.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Structures stop teleporting you (founder 2026-09-07: clicking one on
    // the Portfolio threw you onto the Wallets screen). A structure is now a
    // SCOPE like any wallet: touching its row filters the page to it and you
    // stay reading what you came to read, with a Govern door that opens the
    // ceremony over the page instead of navigating. They also read as
    // Legacies inside the scope selector at last — indigo plaque and real
    // name — because the Portfolio was synthesizing council rows bare while
    // Wallets synthesized the same account with its identity. Two fixes came
    // out of the investigation: picking a wallet whose confirmation had not
    // landed yet silently loaded EVERY wallet under that one wallet's label,
    // and the Positions lens ignored the scope entirely, so its total was
    // mislabelled the moment a filter was on.
    version: '0.9.136',
    date: '2026-09-07',
    items: [
      {
        kind: 'defi',
        es: 'Tocar una estructura ya no te echa a Wallets: acota el Portfolio a ella y te quedas donde estabas, con «Gobernar» abriéndose encima. Y las estructuras se leen por fin como Legacies en el selector — placa índigo y su nombre.',
        en: 'Touching a structure no longer throws you to Wallets: it scopes the Portfolio to it and you stay put, with «Govern» opening over the page. And structures finally read as Legacies in the selector — indigo plaque and their real name.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // The Earn hub sheds its weight (founder 2026-09-07: "los botones se ven
    // sobrecargados… reduce el texto de manera importante"): each door keeps
    // ONE short line, and the full explanation moves into a small "?" dot —
    // always visible, never repeating itself — that opens on hover (and on
    // keyboard focus). The agent bar joins in: its rule now lives in the
    // same dot. New shared HelpDot primitive (pure-CSS tooltip), one line to
    // adopt anywhere.
    version: '0.9.135',
    date: '2026-09-07',
    items: [{ kind: 'visual' }],
  },
  {
    // The Portfolio's scope collapses into two labelled selectors (founder
    // 2026-09-07). The open chip row grew with every wallet you linked and
    // ate a whole line on every lens; now «Wallet: …» and «Network: …» sit
    // beside the tabs, open on hover AND on click (pinned once clicked, so
    // picking never depends on not moving the mouse), and each wallet wears
    // its own face — colour and glyph — inside the panel. The label leads
    // the button so it says what it filters instead of leaving a bare chip
    // to be guessed. Keyboard navigation included: arrows, Home/End, Enter,
    // Escape, focus returned.
    version: '0.9.134',
    date: '2026-09-07',
    items: [
      {
        kind: 'defi',
        es: 'El alcance del Portfolio cabe ahora en dos selectores junto a las pestañas —«Wallet» y «Network»— que se abren al pasar el ratón y al pulsar: una línea entera de vuelta para el contenido, y cada wallet con su cara.',
        en: 'The Portfolio scope now fits two selectors beside the tabs — «Wallet» and «Network» — opening on hover and on click: a whole line handed back to the content, and every wallet wearing its own face.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // A partial total now SAYS it is partial (founder 2026-09-07: "me
    // aparecía muy poco dinero y absolutamente nada cargando… puede
    // asustar"). The cold load always painted wallet by wallet, but no
    // surface looked at `loading` once there was a figure to show. One
    // shared badge — pulsing, with a read/total count — sits beside the
    // money on Home's net worth, Portfolio's total and the Wallets list
    // while wallets are still being read, and folds away on its own.
    version: '0.9.133',
    date: '2026-09-07',
    items: [
      {
        kind: 'defi',
        es: 'Mientras quedan wallets por leer, la cifra lo dice: un indicador «aún leyendo tus wallets» con el recuento acompaña al dinero en Home, Portfolio y Wallets, y desaparece solo al completarse.',
        en: 'While wallets are still being read, the figure says so: a "still reading your wallets" indicator with a count sits beside the money on Home, Portfolio and Wallets, and folds away when complete.',
      },
    ],
  },
  {
    // The Legacy card's second crown fitting (founder 2026-09-05: "puede
    // mejorar bastante"): the first cut read washed-out — now the crown is
    // taller with full-ink seal and word, the quorum anchors right after it
    // (lit dots + M/N) instead of floating, the body turns decisively indigo
    // (38% wash — 26% still read grey), the flight shadow becomes an indigo
    // AURA, and the watermark seal doubles its presence.
    version: '0.9.132',
    date: '2026-09-05',
    items: [{ kind: 'visual' }],
  },
  {
    // Three founder asks of 2026-09-05 in one visual pass: the Manager desk
    // joins the house theme (staggered entrances, rooms that hand over with
    // the app's transition instead of a hard cut, the armillary emblem
    // presiding the empty desk and reacting to the cursor, a live-beat dot
    // on the account strip, vault cards that lift); Legacy cards get their
    // CROWN — an indigo header band with seal, word and quorum dots, plus a
    // deeper indigo body — so a council never reads like a personal blue
    // wallet again; and Govern joins the council card's FRONT as a tinted
    // corner chip, no flip needed.
    version: '0.9.131',
    date: '2026-09-05',
    items: [
      {
        kind: 'defi',
        es: 'Las cuentas Legacy llevan ahora su corona — banda índigo con el sello y el quórum — y el botón de Gobernar en el anverso de la tarjeta; la mesa del gestor estrena el tema de la casa, con salas que entran y salen animadas.',
        en: "Legacy accounts now wear their crown — an indigo band with seal and quorum — plus a Govern button on the card's front; the manager desk joins the house theme with animated room transitions.",
      },
      { kind: 'visual' },
    ],
  },
  {
    // GOVERN IN FIVE ROOMS (founder 2026-08-30, second pass: "sigue estando
    // bastante complicado... añade más menús para tener menor contenido en
    // cada pantalla"). "Info" was carrying FIVE heavy blocks at once —
    // identity, capital, yield, activity and the whole council with its
    // emergencies and amendments — while "Proposals" carried three. Now each
    // tab answers ONE question and holds one or two blocks: Capital (what is
    // inside and what it produces) · Council (who commands, with which
    // quorum) · Orders (compose what the quorum will sign) · Inbox (sign what
    // is already composed) · Activity (what happened, with its proof).
    // Composing and signing were the same screen and are two different
    // gestures — often by two different people. The account strip now rides
    // every room as orientation, each room states its purpose under the tabs
    // (the twin of Constitute's station header), and the footer tells the
    // truth of the room you are in. `proposals` keeps its id so every "sign
    // in the inbox" link still lands right. The CSS-order trick from this
    // morning is gone: with one or two blocks per room the DOM order is
    // already correct.
    version: '0.9.130',
    date: '2026-08-30',
    items: [
      {
        kind: 'behavior',
        es: 'Gobernar un Legacy se reparte en cinco salas —Capital · Consejo · Órdenes · Bandeja · Actividad—, cada una con una pregunta y uno o dos bloques: componer una orden y firmarla ya no comparten pantalla.',
        en: 'Governing a Legacy is split into five rooms — Capital · Council · Orders · Inbox · Activity — each with one question and one or two blocks: composing an order and signing it no longer share a screen.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Wallet pickers wear the wallets' own faces (founder 2026-08-30). Every
    // selector in the app was a native <select>, and an <option> cannot be
    // styled — so the identity you set in Wallets (your colour, your glyph,
    // your nickname) vanished exactly where it matters most: choosing which
    // wallet signs. They are now a proper listbox with the same identity
    // recipe as the Wallets cards — chip, colour wash, brand mark or your
    // personal glyph, a council's square indigo plaque — across signing,
    // send, receive, destination and both position-holder pickers. Keyboard
    // navigation came along with it: arrows, Home/End, Enter, Escape.
    version: '0.9.129',
    date: '2026-08-30',
    items: [
      {
        kind: 'defi',
        es: 'Los selectores de wallet muestran ahora la cara de cada wallet —su color, su marca o tu glifo, como en la pantalla de Wallets— en firma, envío, recepción, destino y las posiciones: reconoces la tuya de un vistazo antes de firmar.',
        en: 'Wallet pickers now show each wallet\'s own face — its colour, its mark or your glyph, just like the Wallets screen — across signing, send, receive, destination and positions: you recognise yours at a glance before signing.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // GOVERNING A LEGACY IS AN OPERATION TOO (founder 2026-08-30). Three
    // moves in one pass: (1) the Legacy card's Movements door opens its
    // modal RIGHT ON /app/wallets — no more loading the Legacy screen to
    // show a floating dialog (GovernedMovementsModal, extracted, one piece
    // both mounts); (2) Govern opens as the dockable bubble — GovernOperation
    // in the global multi-op host, twin of Constitute, indigo inside/gold
    // outside, "sign in the inbox" jumps straight to Proposals; (3) the
    // govern hub is REORDERED for clarity — capital first, then yield and
    // activity, the council last (CSS order; the Constitute stations keep
    // their DOM order) — and the Wallets tab DIED: /app/wallets is the one
    // home of accounts, the embedded copy was the confusion.
    version: '0.9.128',
    date: '2026-08-30',
    items: [
      {
        kind: 'behavior',
        es: 'La tarjeta del Legacy ya no te saca de Wallets: Movimientos abre su modal ahí mismo y Gobernar se abre como burbuja anclable — con el hub reordenado (capital primero, consejo al final) y sin la pestaña Wallets duplicada.',
        en: 'The Legacy card no longer pulls you out of Wallets: Movements opens its modal right there and Govern opens as the dockable bubble — with the hub reordered (capital first, council last) and the duplicated Wallets tab gone.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Card numbers line up across neighbours (founder 2026-08-29: "no están
    // a la misma altura ambos hash"): the token-logo rail above the money now
    // always reserves its height, so a wallet with no holdings no longer
    // pulls its number lower than the card next to it.
    version: '0.9.127',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // Wallet cards go MATTE (founder 2026-08-29: "no me gusta el toque
    // brillante… como antes pero mejor"): the specular band dies the day it
    // was born; instead the chip gains its engraved contact pads and the
    // card sits on the house's double shadow (contact + flight) — better
    // through craft, not shine.
    version: '0.9.126',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // The history clock finds its true home (founder 2026-08-30: it floated
    // at the hero card's top-right, over the artwork, far from everything).
    // It now lives INSIDE the command bar, next to the send arrow — chrome
    // of the agent, not of the card — as a quiet ghost icon; the hero card
    // dropped its overflow clipping so the panel can hang freely below.
    version: '0.9.125',
    date: '2026-08-30',
    items: [{ kind: 'visual' }],
  },
  {
    // THE VAULT CREATOR AS AN EXPERIENCE (founder 2026-08-30: «muy
    // interactivo y dinámico», plus a founder tunnel to reach it). Creating
    // a vault stops being a console micro-form: five stations (identity →
    // the two immutable promises → rules → destinations → review & open)
    // beside a LIVE catalog card — the exact CardFace clients will see in
    // Earn, assembling with every keystroke — and a promise sheet that
    // writes itself line by line as you decide. The capital bar shows the
    // untouchable floor against what works, springing under the slider.
    // Same prepare-only rails as CageConsole (birth + create-pote); the
    // console stays below as the advanced path (dry-run, eternal list,
    // director). VaultBirthPlanner is absorbed (kept unmounted). The
    // TUNNEL: /app/manager?tunnel=1, wrapped in PreviewOnly (server-side
    // isAdmin, fail-closed), renders the whole creator with signing
    // disabled — founders iterate the design with no flag, no wallet, no
    // chain; nobody else sees a thing.
    version: '0.9.124',
    date: '2026-08-30',
    items: [
      {
        kind: 'defi',
        es: 'Crear una bóveda es ahora una experiencia de cinco estaciones: la card que verán tus clientes se monta EN VIVO mientras decides, y la hoja de promesas se escribe sola — mismas órdenes de siempre, tú firmas todo.',
        en: 'Creating a vault is now a five-station experience: the card your clients will see assembles LIVE as you decide, and the promise sheet writes itself — same orders as always, you sign everything.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Wallet cards, fifth cut (founder 2026-08-29): each address strip on
    // the back now wears its account's EMBLEM — the personal glyph or the
    // provider's mark for the wallet, Flare's logo for the Smart Account —
    // so the two codes tell apart at a glance; the holder's name is
    // engraved on the magnetic stripe, and the front catches the light
    // with a fixed specular band.
    version: '0.9.123',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // Two founder notes (2026-08-30). The Portfolio's Tokens lens shows the
    // full picture again — chain, wallet, quantity and price returned to the
    // row (they left with the Overview box in the facelift), the wide table
    // scrolling in its own rail; price stays unmasked on purpose: it is
    // public protocol data, the private parts are quantity and value. And
    // the agent's history opens WITHOUT an open chat: a small clock on the
    // Earn hero lists the saved conversations — touching one opens the
    // agent pinned and already restored to it. One shared list feeds both
    // doors (the in-chat clock and the hero's), so they can never diverge.
    version: '0.9.122',
    date: '2026-08-30',
    items: [
      {
        kind: 'defi',
        es: 'La lente Tokens del Portfolio vuelve a enseñarlo todo — chain, wallet, cantidad y precio — y el historial del agente se abre sin chat: el relojito del héroe de Earn restaura cualquier conversación en el agente anclado.',
        en: 'The Portfolio Tokens lens shows everything again — chain, wallet, quantity and price — and the agent history opens without a chat: the little clock on the Earn hero restores any conversation into the pinned agent.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // CERTIFICATION IS A REFERRAL, NOT A FORM (founder 2026-08-30, after
    // regulatory research: «no podemos tener la creación ni custodia de
    // estos documentos»). The manager KYC form died whole — fields, document
    // attach, and even the LOCAL draft slice in managerStore (a PII draft in
    // localStorage is still custody), purged by a store migration in every
    // browser that saved one. In its place, one card in both mounts
    // (Settings and the desk): the circuit explained, and a button straight
    // to the independent certifying company — env-driven
    // (NEXT_PUBLIC_CERT_PARTNER_URL/_NAME), disabled with the honest reason
    // while no company is chosen. Astryum will only ever READ the verdict
    // from the ledger (the colleague's rail).
    version: '0.9.121',
    date: '2026-08-30',
    items: [
      {
        kind: 'behavior',
        es: 'La certificación del gestor ya no se rellena en Astryum: ni creamos ni custodiamos esos documentos. Te certificas directamente en la empresa certificadora — el botón que lleva a ella se enciende en cuanto esté elegida.',
        en: 'Manager certification is no longer filled in at Astryum: we neither create nor custody those documents. You get certified directly at the certifying company — the button to it lights up as soon as one is chosen.',
      },
    ],
  },
  {
    // The copilot concentrates on the Earn hub (founder 2026-08-29, fifth
    // pass: three placements inside the strategy menus all got in the way —
    // that screen is for COMPARING cards). The agent now opens the hub as a
    // full-width hero: its constellation, its invitation, the command line
    // and the prompt ideas always in view; the first-visit tour starts
    // there. The menus are clean again — no bar, no bubble — and the door
    // copy stopped claiming an agent lives inside them. Also recovered: the
    // earn typology's Spanish section line, which had silently fallen back
    // to English (the dynamic t(ty.sub) is invisible to the i18n audit).
    version: '0.9.120',
    date: '2026-08-29',
    items: [
      {
        kind: 'defi',
        es: 'El copiloto concentra su presencia en Earn: un héroe a lo ancho con sus ideas de prompt a la vista — y los menús de estrategias quedan limpios para comparar. Él compila; tú firmas.',
        en: 'The copilot concentrates on Earn: a full-width hero with its prompt ideas in view — and the strategy menus are clean again for comparing. It compiles; you sign.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // MANAGER MODE FOLLOWS THE ACCOUNT (founder 2026-08-30: same account in
    // a fresh Brave profile arrived with the desk switched off). The
    // declaration now persists server-side on the user record
    // (User.preferences.managerMode — the `legal` rail): the toggle POSTs
    // /auth/manager-mode and every browser adopts GET /auth/me's verdict on
    // boot, server wins. The per-user localStorage copy stays as boot cache
    // and offline net; if the POST fails the switch reverts and says so —
    // a toggle that only looks saved was exactly the reported bug. KYC
    // draft and endorsements stay local on purpose (PII and the public
    // tally wait for their rails).
    version: '0.9.119',
    date: '2026-08-30',
    items: [
      {
        kind: 'behavior',
        es: 'El modo gestor ya sigue a tu CUENTA: actívalo en un navegador y tu mesa aparece en todos — antes vivía solo en el navegador donde lo encendiste.',
        en: 'Manager mode now follows your ACCOUNT: switch it on in one browser and your desk appears in all of them — it used to live only in the browser where you flipped it.',
      },
    ],
  },
  {
    // The agent bubble inside the strategy menus is FIXED for real now
    // (founder 2026-08-29, fourth pass: it kept sliding to the very bottom
    // when a strategy sheet opened). v3's sticky died against the shell's
    // transformed wrappers, leaving the bubble at its flow position; it now
    // portals to <body> — the house rule for everything fixed — raised off
    // the edge and aligned to where the content starts (rail or sidebar),
    // under a floating modal's veil on purpose: signing must cover it.
    version: '0.9.118',
    date: '2026-08-29',
    items: [{ kind: 'behavior' }],
  },
  {
    // Nine defects from this session's adversarial multi-agent review (six
    // dimensions, every finding verified by two refute-by-default lenses; 15
    // confirmed deduping to 9, 9 candidates refuted). The fixes shipped
    // inside e7c1d541 (shared-index accident — they rode the other builder's
    // managed-catalog commit; this entry is their record): folding an
    // operation now folds its body-portalled sub-modals too instead of
    // leaving them full-screen holding the scroll lock; a phrase typed at
    // the bar while the agent is mid-reply queues instead of vanishing;
    // switching or starting a conversation clears the inherited
    // amount/target/HF (no more tables computed from an abandoned chat's
    // 10,000 XRP), aborts the in-flight stream, and closing mid-reply still
    // saves the turn to the local history; that history is now per-account
    // and wiped on logout; the language rule finally covers the FIRST turn
    // (it only rode along once a metrics table existed); the governed
    // no-borrow note stopped reaching the screen in Spanish with a
    // model-instruction inside — the UI's own localized note shows instead;
    // and conversation twelve no longer dies with a 400 (history now travels
    // filtered of empty turns and capped like the backend already trimmed).
    version: '0.9.117',
    date: '2026-08-29',
    items: [{ kind: 'behavior' }],
  },
  {
    // THE VAULT CATALOGUE IS A STRATEGY MENU (founder 2026-08-29: "tiene que
    // estar igual que los otros dos menús con estrategias, pero hay que darle
    // a cada estrategia un toque distintivo"). Managed vaults now deal the
    // same overlapping HAND as Earn's two menus, with the detail unfolding as
    // a column beside it — the 27-ago grid is gone. The distinctive touch is
    // the MANAGER: every card wears their avatar (deterministic from their
    // XRPL account — no invented aliases) and their name, and their profile
    // opens from the card's detail: the vaults they run, the capital inside,
    // their accreditation, a community-support vote, and a shareable profile
    // link so a manager can bring their own clients. Vaults with no
    // third-party manager wear the house "Astryum made" profile, worded as a
    // DEMO vault — Astryum never manages anyone's capital (#1/#8). Support is
    // a user gesture kept locally until the public tally rail exists, and it
    // will only ever surface managers through a sort the user picks — never a
    // default ranking, never an Astryum endorsement (#9).
    version: '0.9.116',
    date: '2026-08-29',
    items: [
      {
        kind: 'defi',
        es: 'Las bóvedas con gestor se reparten como los demás menús de estrategias —la misma mano de cards con su ficha al lado—, y cada una lleva la cara y el nombre de su gestor: desde ahí se abre su perfil con sus bóvedas, su acreditación, el apoyo de la comunidad y su enlace para captar clientes.',
        en: 'Managed vaults are now dealt like the other strategy menus — the same hand of cards with its detail beside it — and each one wears its manager’s face and name: their profile opens from there, with their vaults, their accreditation, community support and their link for bringing in clients.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Two founder notes (2026-08-29, late). Inside a strategy menu the agent
    // stops sliding away: opening a strategy pushed the input bar to the very
    // bottom of a long page, so it becomes a small BUBBLE pinned to the
    // bottom edge — folded it covers nothing, and hovering or tapping it
    // unfolds the full bar with its prompt ideas above (bottom-left, clear of
    // the pill row). The hub keeps its bar in flow. And the nav row «At Work»
    // is now «Running» / «En marcha»: the old label read as a place to START
    // putting money to work, which is Earn's job — this one says the motion
    // already exists (it also un-collides from the Portfolio's per-asset
    // "Working" status, which shared the Spanish word).
    version: '0.9.115',
    date: '2026-08-29',
    items: [{ kind: 'behavior' }],
  },
  {
    // Scene reactions, calmed (founder 2026-08-29: "too much... más lenta",
    // and the mouse-out reset "es molesto"): boost layers now exist paused
    // and only PLAY under the cursor, so leaving freezes them in place — no
    // snap back to 0°; every hover tempo roughly halves. And the managed
    // door sheds its ship's wheel ("parece un volante de un barco"): the
    // graduated wall stays, but inside it an ARMILLARY sphere — two tilted
    // rings precessing around the capital, the steward star riding one —
    // says "steered by instruments", not "boat". HelmWheelScene stays in
    // the tree, unmounted, per the house rule.
    version: '0.9.114',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // PROFILE FOLLOWS THE ACCOUNT (2026-08-29): the avatar/name card in
    // Settings froze whatever it saw at mount, so on a fresh browser it
    // showed initials while the account photo was arriving — and its Save
    // always sent BOTH fields, so saving a name there wiped the account
    // avatar ('' clears it server-side). Now the card follows /auth/me
    // hydration for untouched fields, PATCHes only what you touched, and
    // says so when the account copy could not be updated (the write-through
    // used to fail silently). Stale "stored on this device only" copy fixed.
    version: '0.9.113',
    date: '2026-08-29',
    items: [{ kind: 'behavior' }],
  },
  {
    // MANAGED VAULTS BY PERSONA (founder 2026-08-29): Earn keeps only the
    // client's side — the vault catalogue, chosen like any other strategy
    // (the "strategy" of a managed vault belongs to its manager). The
    // manager's desk moved to /app/manager with a sidebar entry that only
    // appears for declared managers (same mechanism as the Admin row); you
    // declare yourself in a subtle onboarding sub-step after picking
    // "Manage", or any time from Settings → Professional profile, where the
    // certification (KYC → auditor → their chain → FDC → XRPL) is also
    // filled — the KYC card ships covered (PreviewOnly) until the backend
    // rail exists, and while covered it only ever saves a local draft and
    // says so. The KYC-partner desk (the auditing company) left every menu:
    // /app/partner answers by URL only. Home's tour gains a manager step
    // when the flag is on. The manager flag is keyed PER USER (the 08-26
    // account-mixing lesson).
    version: '0.9.112',
    date: '2026-08-29',
    items: [
      {
        kind: 'defi',
        es: 'Managed vaults por persona: en Earn queda solo el catálogo de bóvedas (eliges bóveda como eliges estrategia); la mesa del gestor vive ahora en su propia página del menú lateral — visible solo si te declaras gestor en el cuestionario inicial o en Ajustes.',
        en: 'Managed vaults by persona: Earn keeps only the vault catalogue (you choose a vault like you choose a strategy); the manager desk now lives on its own sidebar page — visible only if you declare yourself a manager in the initial questionnaire or in Settings.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // The door scenes, fourth cut (founder 2026-08-29: "simples líneas no me
    // gusta"): SYSTEM reactions, not drawing lines. Orbits, rims and the helm
    // carry additive boost layers that spin up under the cursor (from 0°, no
    // phase jump); grains actually TRAVEL the infall, the beam and the chain
    // (native animateMotion, lit when watched); the sun, capital and padlock
    // swell on a spring; the helm's graduation ignites tick by tick in a
    // sweep, with a sentry mote patrolling inside the wall.
    version: '0.9.111',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // The agent closes in one click (founder 2026-08-29: the two-step
    // confirm guards operations mid-signature — a conversation is not one),
    // and it remembers: a LOCAL history, 30 days in this browser and then
    // self-deleted, never on a server. The clock in the chat header lists
    // past conversations (restore, delete, start fresh); only the text is
    // kept — cards with live numbers are not restored, fresh figures are
    // asked for again. The storage truth is printed right in the panel.
    version: '0.9.110',
    date: '2026-08-29',
    items: [
      {
        kind: 'defi',
        es: 'El agente cierra a la primera y gana memoria: un historial de conversaciones de 30 días, guardado solo en tu navegador y borrado solo — con restaurar, borrar y empezar de nuevo desde el relojito del chat.',
        en: 'The agent closes in one click and gains memory: a 30-day conversation history, kept only in your browser and self-deleted — restore, delete or start fresh from the little clock in the chat.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // Agent polish, second round (founder 2026-08-29). The bar now answers
    // the mouse: the spark wakes, the frame glows, and prompt ideas unfold
    // beneath it — tuned per surface, one tap sends them. The options card
    // beneath a reply speaks the dashboard's language at last (its labels
    // were server-built Spanish; now the client composes them, and the one
    // composed note travels with your language). Streamed replies flow
    // smoothly again — constant-rate reveal over rendered markdown instead
    // of chunk pops. And the big one: pinning, unpinning or minimizing ANY
    // operation no longer rebuilds its inside — the window is one persistent
    // structure that changes clothes, so the agent's conversation (and any
    // ceremony's state) survives every mode switch untouched.
    version: '0.9.109',
    date: '2026-08-29',
    items: [
      {
        kind: 'defi',
        es: 'La barra del agente responde al ratón con ideas de prompt por menú; la tarjeta de opciones habla tu idioma; el texto fluye suave; y anclar/soltar/minimizar ya no reinicia ninguna operación — la ventana se transforma sin tocar lo de dentro.',
        en: 'The agent bar answers the mouse with per-menu prompt ideas; the options card speaks your language; text flows smoothly; and pinning/unpinning/minimizing no longer resets any operation — the window changes clothes without touching what is inside.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // The Legacy card's back also carries its Smart Account (founder
    // 2026-08-29: "la wallet de legacy también tiene smart account"). The
    // council's Flare leg is folded as a row, so the compact card now reads
    // it from the same resolver the Legacy tab uses (useSmartAccountsOf) —
    // both labelled addresses, both copyable, personal and governed alike.
    version: '0.9.108',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // Wallet cards, fourth cut (founder 2026-08-29): bigger (~300px floor),
    // opaque faces with a gradient body instead of the translucent wash,
    // Movements pinned on the FRONT corner (no flip needed for the everyday
    // action), and the back now carries TWO labelled copyable addresses —
    // the wallet's and its Flare Smart Account's. The colour picker gains
    // four presets, Xaman's deep blue among them.
    version: '0.9.107',
    date: '2026-08-29',
    items: [
      {
        kind: 'defi',
        es: 'Tarjetas de wallet más grandes y con más cuerpo: Movements en el anverso, el dorso copia la dirección de la wallet Y la de su Smart Account (etiquetadas), y la paleta de colores suma cuatro tonos — incluido el azul profundo de Xaman.',
        en: "Bigger, richer wallet cards: Movements on the front, the back copies both the wallet's and its Smart Account's labelled addresses, and the colour palette gains four tones — Xaman's deep blue included.",
      },
      { kind: 'visual' },
    ],
  },
  {
    // The Earn door scenes, third cut (founder 2026-08-29: "the landing is
    // god-level and these fall short"). Same figurative story, landing-grade
    // craft: a star-field backdrop, real blurred halos, layers in counter-
    // rotation, and every scene now answers the mouse two or three ways —
    // the harvest sun flares and its corona wakes while the infall spiral
    // draws itself; the collateral's keyhole ignites, the beam's live core
    // draws over its glow and the coin-star grows with its rim spinning
    // against it; the managed wall's graduation lights up while the signed-
    // limits arc sweeps inside and the steward runs its counter-track.
    version: '0.9.106',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // The wallet-card grid re-counts its columns only once the panel's width
    // SETTLES (founder 2026-08-29: widening the docked strategy made the
    // cards "hacer dos redimensiones... a mitad de ensanchar se reinicia el
    // tamaño"). Live container queries switched columns the exact frame the
    // dock's animation crossed a threshold; now cards compress fluidly during
    // the gesture and reflow once, on the layout springs they already carry.
    version: '0.9.105',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // The hand of strategy cards no longer gets guillotined by its own row
    // (founder 2026-08-29: "las cards siguen saliendo del límite"). The row is
    // a scroll container and clipped at its edge: the chosen card's scale left
    // it amputated against the left rim, and hovering pushed the first card
    // 16px into the cut. Classic bleed pattern — padding for the theatrics,
    // equal negative margin so resting cards keep the page's reading margin.
    version: '0.9.104',
    date: '2026-08-29',
    items: [{ kind: 'visual' }],
  },
  {
    // The agent grows into a real window (founder 2026-08-29): talking to the
    // bar opens it PINNED to the right like any strategy — minimizable to its
    // pill, surviving navigation — and it does NOT count toward the three-
    // operation cap (three strategies plus the agent). Its replies render as
    // real chat now: proper bold, lists and tables instead of raw markdown
    // symbols, a subtle emoji at most per section (never to favour an
    // option), prompt-idea chips above the composer that react to the mouse
    // — and it answers in YOUR language: writing in English gets English
    // back (the hard language rule the cages were missing).
    version: '0.9.103',
    date: '2026-08-29',
    items: [
      {
        kind: 'defi',
        es: 'El agente es ahora una ventana de verdad: se abre anclado a la derecha como una estrategia, no cuenta para el tope de tres, y sus respuestas llegan como un chat de verdad — tablas y negritas renderizadas, en tu idioma.',
        en: 'The agent is now a real window: it opens pinned to the right like a strategy, does not count toward the three-op cap, and its replies arrive as a real chat — rendered tables and bold, in your language.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // The agent becomes a LAYER, not a place (founder 2026-08-29: the open
    // chat inside each menu was too blunt; command bar chosen over four
    // doors). One calm line — the spark, a surface-tuned invitation, the
    // arrow — on the hub and inside both menus; sending unfolds the
    // conversation in place, seeded with your phrase, and it folds back.
    // Same compiler, same rule printed on the bar itself: it compiles — you
    // sign. The door scenes went figurative too, readable in half a second:
    // motes falling into a sun that brightens (earning), the asset wearing a
    // padlock while a beam resolves into a coin-star with a chain back
    // (borrow), and an astral helm turning around the capital (managed).
    version: '0.9.102',
    date: '2026-08-29',
    items: [
      {
        kind: 'defi',
        es: 'El agente es ahora una barra de mando: una línea en Earn y en cada menú — escribe lo que quieres y la conversación se despliega ahí mismo. Él compila; tú firmas.',
        en: 'The agent is now a command bar: one line on Earn and inside each menu — type what you want and the conversation unfolds right there. It compiles; you sign.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Earn splits into TWO menus (founder 2026-08-28): one for putting tokens
    // to work (no debt) and one for borrowing against them — each door opens
    // only its own strategies, on both the hand and the phone accordion, and
    // the sister-route jump crosses menus instead of dead-ending. The agent
    // lost its own door and moved INSIDE each menu, framed for its typology
    // (same compiler, same rule: it never signs). And every door's scene now
    // tells its mechanism instead of decorating: an accretion disk gathering
    // matter (earning, nothing pulls on it), the asset held in a closed ring
    // while a stream of light flows out but stays tethered (borrow — it can
    // be called back), and a walled ring with graduation marks around the
    // steward's fixed track (managed — the limits you signed, visible).
    version: '0.9.101',
    date: '2026-08-28',
    items: [
      {
        kind: 'defi',
        es: 'Earn se parte en dos menús — poner a trabajar (sin deuda) y pedir prestado contra tus tokens — con el agente dentro de cada uno, afinado a su tipología. Compila; la firma siempre es tuya.',
        en: 'Earn splits into two menus — put tokens to work (no debt) and borrow against them — with the agent inside each one, tuned to its typology. It compiles; the signature is always yours.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // The wallet cards stop crowding when an operation is docked (founder
    // 2026-08-28). The grid counted its columns by VIEWPORT width — and the
    // viewport cannot see that the docked panel ate 800px of it, so three
    // columns fought over the space of one. The grid now measures ITS OWN
    // panel (container queries, the same cure the rings and the operation
    // bodies already took): dock open, it settles into two comfortable
    // columns — or one — and grows back to three or four when the panel
    // closes, responding live to the resize handle. No card ever drops below
    // ~260px, the floor under which the number, the holder and the money
    // start stepping on each other.
    version: '0.9.100',
    date: '2026-08-28',
    items: [{ kind: 'visual' }],
  },
  {
    // The strategy hand fits its box, ALWAYS (founder 2026-08-28: cards were
    // colliding with the frame edge and getting sliced when the detail sheet
    // narrowed the column). The overlap stops being fixed: the hand now
    // measures its row and deals the visible face per card between honest
    // caps (max = the usual breathing room, min = icon + title start), with
    // slack reserved for the hover fan-out. The horizontal scroll survives
    // only as a safety net below the readable minimum.
    version: '0.9.99',
    date: '2026-08-28',
    items: [{ kind: 'visual' }],
  },
  {
    // The wallet card's touch, corrected on founder review (2026-08-27,
    // evening). The WHOLE card flips now — press anywhere, front or back —
    // with a rotate hint appearing top-right on hover; the only exceptions
    // are the surfaces with a job of their own: the card number copies, and
    // the back's buttons each do exactly their thing (a hidden-face bug made
    // every back-press expand the card — the unseen face was still catching
    // clicks; it no longer listens). The full address moved into a proper
    // signature strip with its own one-tap copy. Expanding is a PREFERENCE
    // now: several cards can stay open and the choice survives between
    // visits. And the MetaMask fox is the original mark, polygon for polygon
    // — not a redrawing that almost passed.
    version: '0.9.98',
    date: '2026-08-27',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy inputs turn legible (founder 2026-08-28): every text box in the
    // Legacy family styled itself without a text colour — and <input> does
    // not inherit, so the UA painted the typed address BLACK on the dark
    // surface. The whole family (inputCls ×5, Movements ×6, CageBirth,
    // YieldPanel, Propose, FormalPositions) now declares text-ink + caret +
    // placeholder from the house tokens, so it follows theme and product.
    version: '0.9.97',
    date: '2026-08-28',
    items: [{ kind: 'visual' }],
  },
  {
    // Toasts become legible (founder 2026-08-28): the Toaster was styling
    // itself with raw HSL-triplet tokens (`var(--background)`) — invalid CSS,
    // so every toast rendered TRANSPARENT and drowned behind whatever card
    // was open. Now on the house elevation ladder (surface-2 + ink + shadow)
    // and stacked above the whole operation system, so the "three operations
    // already open" notice reads crisply on top of the card that caused it.
    version: '0.9.96',
    date: '2026-08-28',
    items: [{ kind: 'visual' }],
  },
  {
    // The wallet cards become REAL cards (founder 2026-08-27, second pass) —
    // smaller, with the money they hold on the face, the address set like a
    // card number with one-tap copy, and a FLIP: the back carries the
    // magnetic stripe, the full address on the signature strip, and the three
    // most frequent gestures (Movements · Manage/Govern · Open). The
    // watermark criterion changed too: it is now the account's own identity —
    // the council's seal, or the provider's real mark — never a generic
    // doodle poking out of a corner. Also in this window: the day labels
    // under the Portfolio's big chart are back (they had been pushed off the
    // canvas by a transform bug) and the curve draws itself once on arrival.
    version: '0.9.95',
    date: '2026-08-27',
    items: [
      {
        kind: 'defi',
        es: 'Las tarjetas de Wallets son ahora tarjetas de verdad: el dinero en la cara, la dirección como número de tarjeta con copia al toque, y un DORSO que se gira — banda magnética, dirección completa y los tres gestos más frecuentes.',
        en: 'Wallet cards are now real cards: the money on the face, the address set like a card number with one-tap copy, and a BACK you can flip to — magnetic stripe, full address and the three most frequent gestures.',
      },
      { kind: 'visual' },
      { kind: 'behavior' },
    ],
  },
  {
    // Reinforce leaves the Legacy costume behind (founder 2026-08-27): the
    // ceremony now opens as an OPERATION — popup/pinnable/pill, counting as
    // one of the three — in the personal GOLD, with its own artwork (beacon
    // and signature scenes, no pantheon, no council stars) because a
    // reinforced account never stops being a personal wallet. The process
    // also got shorter: the rules/constitution station is optional — once
    // the door closes the rail goes straight to done.
    version: '0.9.94',
    date: '2026-08-27',
    items: [
      {
        kind: 'defi',
        es: 'Reforzar una cuenta abre ahora como una operación más, en oro y con su propia cara — y el proceso es más corto: las reglas escritas son opcionales, cerrada la puerta ya está hecho.',
        en: 'Reinforcing an account now opens as a regular operation, in gold with its own face — and the process is shorter: written rules are optional, once the door closes it is done.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Multi-op (founder 2026-08-27): up to THREE operations live at once —
    // one unfolded (window or pinned), the rest waiting as pills in a row at
    // the bottom edge, browser-taskbar style; every one keeps its full state
    // (amounts, review, ceremony) while folded, and constituting a Legacy
    // counts as one of the three. Closing gained a calm second step: the X
    // now unfolds a small confirm beside itself — click it to really close,
    // click the X again (or wait) and nothing happens.
    version: '0.9.93',
    date: '2026-08-27',
    items: [
      {
        kind: 'defi',
        es: 'Hasta tres operaciones vivas a la vez: una desplegada y las demás esperando como píldoras abajo, cada una con su estado intacto — constituir un Legacy cuenta como una de las tres.',
        en: 'Up to three live operations at once: one unfolded and the rest waiting as pills at the bottom, each holding its full state — constituting a Legacy counts as one of the three.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // Three founder asks (2026-08-27, afternoon). The Portfolio's four rings
    // line up again: only Assets Earning carried the working/idle split line,
    // which pushed its ring two lines below its neighbours — the slot is now
    // reserved on every card, empty when there is nothing to say. The strategy
    // hand stays inside its frame: the lifted card no longer pokes out of the
    // section, the squeeze loosened to ~88px of visible face per card, and the
    // cards gained real touch — they sink when pressed and spring back. And
    // Wallets debuts CREDIT-CARD mode: each account rests as a small card —
    // its mark, its name, the tokens it holds — and grows IN PLACE into the
    // full management card when tapped; a council wears the same face in
    // indigo with its seal and quorum.
    version: '0.9.92',
    date: '2026-08-27',
    items: [
      {
        kind: 'defi',
        es: 'Las cuentas de Wallets descansan ahora como tarjetas pequeñas —su marca, su nombre y los tokens que tienen— y se agrandan en el sitio al tocarlas; un Legacy viste la misma cara en índigo con su sello y su quórum.',
        en: 'Wallet accounts now rest as small cards — their mark, their name and the tokens they hold — and grow in place when tapped; a Legacy wears the same face in indigo with its seal and quorum.',
      },
      { kind: 'visual' },
      { kind: 'behavior' },
    ],
  },
  {
    // Three founder asks in one pass (2026-08-27). The grey button explains
    // itself: when an operation's continue button is disabled — no amount,
    // wrong wallet, balance short, a dry-run that proved a revert — hovering
    // it now says exactly what is blocking, in the same words the form
    // already uses. The co-pilot popup follows the rail: collapsed rail, the
    // chat opens beside it instead of floating where the wide rail used to
    // be — and it opens with the house genie, unfolding out of its own
    // launcher button. The same genie plays when an operation is minimized:
    // the window folds into its pill instead of the pill just appearing.
    version: '0.9.91',
    date: '2026-08-27',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Founder pass 2026-08-26 (night): (1) FIX — the Constitute-a-Legacy
    // operation died when switching sidebar tabs: it was mounted inside the
    // Wallets page (the same original sin strategy and positions already
    // paid for). It now lives in the global operation host — pin it,
    // minimize it, browse everywhere with the ceremony alive. (2) Operation
    // bodies now measure THEIR OWN panel (container queries): the two-column
    // pairs — collateral/debt, disclosure/verdict, ratio/HF — go single-file
    // in the narrow pinned panel and pair up in the wide window, responding
    // live to the resize handle.
    version: '0.9.90',
    date: '2026-08-26',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The ship log tells a story now (founder 2026-08-26): DeFi milestones
    // keep their full line, and everything generic BETWEEN milestones folds
    // into one counted row — «12 behaviour · 7 visual» with its version and
    // date span — instead of a wall of identical «Behaviour improvements»
    // lines. The window widened to 40 versions: weeks of work fit the same
    // panel.
    version: '0.9.89',
    date: '2026-08-26',
    items: [{ kind: 'visual' }],
  },
  {
    // The Legacy form joins the operation system (founder 2026-08-26: «el
    // form del legacy no se mantiene anclado»). The council-order composer —
    // both its doors: the governed strategy entry in Earn and the cage
    // modal in the strategies hub — now lives on the same dual surface as
    // every operation: pin it, minimize it, and browse the dashboard with it
    // open; it survives navigation from the global host like the rest.
    version: '0.9.88',
    date: '2026-08-26',
    items: [{ kind: 'behavior' }],
  },
  {
    // FIX (founder 2026-08-26): navigating from the collapsed rail closed a
    // PINNED position operation. Same root cause as the strategy modal two
    // days ago — it lived inside its page, and navigation unmounts pages.
    // The position close/repay/withdraw now lives in the global operation
    // host too (both its doors: the positions board and the strategies hub's
    // Kinetic withdraw): browse the whole dashboard with it pinned or
    // minimized. One tenant at a time — opening one operation closes the
    // other; two signing surfaces at once would be two competing truths.
    version: '0.9.87',
    date: '2026-08-26',
    items: [{ kind: 'behavior' }],
  },
  {
    // The open strategy sheet stops leaving dead space (founder 2026-08-26,
    // same afternoon, three corrections in one): the columns swap roles — the
    // compressed hand takes the width it actually needs and the SHEET is what
    // grows to fill the rest; the cards stop over-collapsing (same card width,
    // deeper overlap, ~80px of each face visible so every route stays
    // readable); and the blur on the non-chosen cards is gone — with the sheet
    // in its own column, dimming the others only stopped you comparing, which
    // is the whole point of keeping them on screen.
    version: '0.9.86',
    date: '2026-08-26',
    items: [{ kind: 'visual' }],
  },
  {
    // CONSTITUTE AS AN OPERATION (founder 2026-08-26: «que cuente como otra
    // operación normal... formato popup... anclable a la derecha»). The
    // Constitute-a-Legacy door on Wallets no longer swaps the whole shell to
    // the governed theme — it opens the SAME six-station ceremony inside the
    // house operation surface: a short window you can pin to the right (or
    // minimize to the pill) with the dashboard live beside it. Indigo lives
    // INSIDE the panel (local governed stamp), gold stays outside. The
    // full-page /app/legacy workshop and its deep-links are untouched.
    version: '0.9.85',
    date: '2026-08-26',
    items: [
      {
        kind: 'defi',
        es: 'Constituir un Legacy es ahora una operación más: se abre en ventana corta desde Wallets, se ancla a la derecha o se minimiza a la píldora — con el dashboard vivo al lado durante toda la ceremonia.',
        en: 'Constituting a Legacy is now just another operation: it opens as a short window from Wallets, pins to the right or minimizes to the pill — with the dashboard live beside it through the whole ceremony.',
      },
      { kind: 'visual' },
    ],
  },
  {
    // MINIMIZE the operation (founder idea, 2026-08-26): besides pinning, an
    // in-flight operation can now fold into a small pill at the bottom-right
    // — like a browser window minimized to the page's edge. The operation
    // stays ALIVE underneath (amounts, review, everything as you left it);
    // the dashboard takes back its full room; the pill pulses, says the
    // operation's name, restores on click — back to exactly the mode it was
    // in (floating or pinned) — and carries its own close. Works on both the
    // strategy entry and the position close/repay/withdraw.
    version: '0.9.84',
    date: '2026-08-26',
    items: [
      {
        kind: 'defi',
        es: 'Una operación en curso se puede MINIMIZAR: queda como píldora viva abajo a la derecha — el dashboard entero vuelve, y al restaurarla está exactamente como la dejaste.',
        en: 'An in-flight operation can now be MINIMIZED: it folds into a live pill at the bottom-right — the whole dashboard returns, and restoring brings it back exactly as you left it.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // The landing comes alive on phones (founder 2026-08-26: "se ve sin
    // ningún tipo de animación en el móvil"). The stacked journey — what every
    // phone renders instead of the pinned scrollytelling — was born honest but
    // dead: plain divs, every artifact switched off. Now the hero, each stop
    // and the closing principle reveal on scroll with the landing's own
    // grammar, the artifacts play their orbits and pulses WHILE on screen
    // (and pause off-screen — that is battery on a phone), and the hero's
    // planets breathe their glow, each on its own tempo. Reduced motion still
    // gets the fully still page — this variant is also that branch.
    version: '0.9.83',
    date: '2026-08-26',
    items: [{ kind: 'visual' }],
  },
  {
    // One signature, one ceremony (founder 2026-08-26). Signing in Xaman used
    // to play the autograph twice — once over the spent QR, once again in the
    // settlement view the moment the QR closed. The QR now only ticks off its
    // spent code with a quiet check, and the ceremony plays exactly once,
    // where the operation keeps settling — refined while at it: the stroke
    // signs onto its own signature line, the seal lands with a single ink
    // pulse, and the confetti stars are gone. A signature certifies; it does
    // not celebrate.
    version: '0.9.82',
    date: '2026-08-26',
    items: [{ kind: 'visual' }],
  },
  {
    // FIX (founder 2026-08-26): hovering a pinned operation made it flicker
    // into the middle of the screen. The pinned panel lived inside the card
    // that opened it — and that card's hover lift (translate) turns the
    // ancestor into the containing block of any `fixed` child, so the panel
    // jumped to card-relative coordinates, lost the pointer, snapped back,
    // and looped. Pinned panels now portal to <body>, where no foreign
    // transform can capture them (scroll stays unlocked — the dashboard
    // remains live, which is the whole point of pinning).
    version: '0.9.81',
    date: '2026-08-26',
    items: [{ kind: 'behavior' }],
  },
  {
    // Dock polish, founder-directed (2026-08-26). (1) The pinned operation is
    // RESIZABLE: drag its left edge (360–720px, remembered between sessions);
    // the dashboard's margin follows live, with the slide transition parked
    // while you drag so the handle feels like a handle, not a rubber band.
    // (2) The collapsed icon rail stopped hiding what matters: signatures
    // waiting show as a counter badge (opens the full To-sign page) and
    // operations settling on-chain show as a live pulse — same data sources
    // as the big cards, never a second truth.
    version: '0.9.80',
    date: '2026-08-26',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Opening a strategy stops covering the rest (founder 2026-08-26). The
    // detail used to open as a fixed panel dead-centre — on top of exactly the
    // cards you were comparing it with. It now settles into the RIGHT column,
    // in the page's own flow (nothing pinned), and the hand of cards tightens
    // its overlap to fit whole on the left: every route stays in sight while
    // one is open, and the squeeze plays as one smooth gesture of the hand.
    version: '0.9.79',
    date: '2026-08-26',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // The docked operation SURVIVES navigation (founder 2026-08-25: «que el
    // usuario pueda moverse por la web con la estrategia abierta»). The
    // strategy modal used to live inside the Earn page — clicking any sidebar
    // destination unmounted the page and took the pinned operation with it.
    // It now lives in a global host above the routes (operationStore +
    // EarnOperationHost in the shell, lazy-loaded): browse the whole app with
    // the strategy pinned to the side. Also: the collapsed icon rail wears
    // the REAL brand asteroid (the PNG, gold or indigo with the product) —
    // not a redrawn stand-in.
    version: '0.9.78',
    date: '2026-08-25',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Founder pass 2026-08-25 (night): (1) the strategy entry modal joins the
    // DOCK — the pin button the founder missed on the Kinetic entry is there
    // now, same recipe as the positions pilot; (2) the entry amount gains the
    // 0→max SLIDER (same component as the close flow — its top is the same
    // max as the MAX button, gas/carrier reserves included); (3) the
    // browser's native number-input spinners (the white up/down arrows that
    // fought the theme on every amount box) are gone app-wide — MAX and the
    // slider do that job.
    version: '0.9.77',
    date: '2026-08-25',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Second pass on the pop (founder 2026-08-25: "se sigue viendo todo
    // popear: los números, las posiciones, las wallets"). The first pass fixed
    // the ROUTE entrance — but the pop lives in the other layer: async data
    // landing into an already-visible page with no transition at all. A new
    // shared primitive (Arrive) plays exactly there — where a skeleton or an
    // empty state is replaced by the real thing — and the surfaces named all
    // use it now: wallet cards and rows, position cards, token rows, the
    // allocation rings, the big chart and the health cards. The health figures
    // count up to their value on arrival, like every other figure of the house.
    version: '0.9.76',
    date: '2026-08-25',
    items: [{ kind: 'visual' }],
  },
  {
    // Two founder ideas land (2026-08-25). (1) DOCK THE OPERATION: the
    // in-flight operation can pin to the right edge — the whole dashboard
    // slides left, the sidebar folds to an icon rail, and the page stays LIVE
    // under your hands while the signature is being prepared (no more
    // following the process blind under a full-screen modal). Piloted on the
    // position close/repay/withdraw surface; the shell system is generic and
    // the rest of the operations join next. (2) KNOW HOW: the Xaman multisig
    // tutorial folds behind one big button — eight pages, one step per page
    // with its screenshot, at the learner's pace. The red master-key warning
    // stays on the card, always visible: safety is never paginated.
    version: '0.9.75',
    date: '2026-08-25',
    items: [
      {
        kind: 'defi',
        es: 'La operación en curso se puede ANCLAR al lado: el dashboard se desliza, el menú se pliega a iconos y la página sigue viva mientras preparas la firma.',
        en: 'An in-flight operation can now DOCK to the side: the dashboard slides over, the menu folds to icons, and the page stays live while you prepare the signature.',
      },
      { kind: 'behavior' },
      { kind: 'visual' },
    ],
  },
  {
    // Pages stop flashing on arrival (founder 2026-08-25: every card appeared
    // at once, "aggressive, ugly, intrusive"). The cause was a double opacity
    // ramp — the shell already fades the whole page, and every card faded from
    // zero on top of it — plus a revisit stagger of 20ms, which is simultaneous
    // in practice. Cards now start already visible and arrive IN ORDER, so the
    // shell owns the fade and the cards own the sequence. One shared change, so
    // every screen inherits it. The Portfolio also stops fading its lens on top
    // of both. And its chart no longer redraws when you change range: the time
    // axis is what moves now — denser, with ticks, and each label slides in.
    version: '0.9.74',
    date: '2026-08-25',
    items: [{ kind: 'visual' }],
  },
  {
    // Crossing v3.1 (founder 2026-08-25, second pass: «no destello — el
    // cambio del centro y el color de la página cambiando lentamente»). The
    // overlay's radial colour flash is gone; instead the PAGE ITSELF crosses
    // colour slowly: for ~1s around every product flip the whole token tree
    // (gold↔indigo surfaces, borders, text) transitions instead of jumping
    // (.authority-retint, self-removing — zero cost outside the crossing).
    // The overlay keeps only the centre: the mark you leave, the arrow, the
    // mark you enter. Simple, and the page itself is the animation.
    version: '0.9.74',
    date: '2026-08-25',
    items: [{ kind: 'visual' }],
  },
  {
    // Founder pass 2026-08-25, four pieces. (1) FIX: clicking a structure on
    // the Portfolio chained TWO crossings (indigo, then gold) just to land on
    // Wallets — it routed through the retired /app/legacy landing; it goes
    // straight to Wallets now, structure preselected. (2) The crossing itself
    // was rebuilt to SAY the change: the wallet mark (gold) → arrow → the
    // pantheon (indigo), light moving from the side you leave to the side you
    // enter, over a colour wash that crossfades — no blur, nothing darkens.
    // (3) The Legacy account station wears its own mark: the pantheon draws
    // itself in under the north star (the generic orb left). (4) The wallet
    // cards' corner watermarks stopped reading as a bug: side-centred now,
    // fading out through a radial mask — never a hard clip.
    version: '0.9.73',
    date: '2026-08-25',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // The Portfolio's big chart now actually answers the date filter (founder
    // 2026-08-25). Picking a short range used to make the whole chart VANISH
    // and claim there was no history — there was, just outside the window; the
    // line now carries the last known reading into the window and says plainly
    // when the window itself is empty. The time axis follows the filter too:
    // hours on 24h, weekdays on 7d, months on a year — before, every 24h label
    // read the same date. And changing range redraws the curve with its axis
    // instead of swapping the labels in place.
    version: '0.9.72',
    date: '2026-08-25',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Two fixes. The allocation donuts were BROKEN everywhere they appear —
    // Home and Portfolio alike — because the new card-width layout rules had
    // been pasted inside the prefers-reduced-motion query, so on any machine
    // without "reduce motion" they simply did not exist: the ring drew nothing,
    // the dashed orbit stretched into a capsule and the legend landed on top of
    // the total. They now live outside it, where layout belongs. And the Home's
    // travelling light goes back to the hero card alone, at the same speed.
    version: '0.9.71',
    date: '2026-08-25',
    items: [{ kind: 'visual' }],
  },
  {
    // Step 3 of the guided close stops fighting physics (founder 2026-08-25:
    // MAX after the repay left a crumb of debt → the node always refuses a
    // 100% collateral withdraw → a raw «Something went wrong»). The step now
    // SAYS what it is («this WITHDRAWS your collateral — you are not
    // depositing anything» — the founder himself misread it as topping up),
    // warns about the retained backing while any debt remains, MAX already
    // discounts that part (conservative reserve, never a revert), and if the
    // node still refuses, the error explains the physics and the way out
    // instead of a generic shrug.
    version: '0.9.68',
    date: '2026-08-25',
    items: [{ kind: 'behavior' }],
  },
  {
    // The ring cards learned to measure THEMSELVES (founder 2026-08-25: the
    // legends spilled out of the four-up Portfolio strip). The donut+legend
    // row used a viewport breakpoint to go side-by-side — but in a 4-up grid
    // the CARD is narrow while the window is wide, so the fixed-size ring ate
    // the row and the legend died past the edge. Native container queries
    // now decide by the card's own width: wide card = ring beside legend;
    // narrow card = ring on top, legend below at full width.
    version: '0.9.67',
    date: '2026-08-25',
    items: [{ kind: 'visual' }],
  },
  {
    // The Home's light goes back to the version that felt right (founder
    // 2026-08-24) — the original slow diagonal sweep — now relayed across all
    // four panels with no overlap and no dead time: each takes a quarter of the
    // cycle, so one leaves as the next arrives. Two defects an adversarial pass
    // caught before it shipped: without animation-fill-mode the light sat
    // PARKED and lit across three panels for up to 36s after every load, and
    // two thirds of each panel's time was being spent off-card, which is why it
    // still read fast. Both fixed; the crossing is now genuinely slow.
    version: '0.9.66',
    date: '2026-08-25',
    items: [{ kind: 'visual' }],
  },
  {
    // Second founder pass on the carry card (2026-08-24): (1) FIX — the
    // step-by-step's auto-skip could freeze on «Moving on…»: the skipped-mark
    // was set when SCHEDULING the jump, so a dependency flicker (the legs
    // refresh) inside the half-second window killed the timer and the re-run
    // said «already skipped» without ever skipping. The mark now lands when
    // the jump EXECUTES — a flicker just re-waits. The gold sign button no
    // longer paints under a skipped step. (2) The merged carry card gains its
    // two surgical doors: «Pay off the loan» (the borrow closes, collateral
    // stays) and «Withdraw collateral» (for when the price runs up), next to
    // the full step-by-step close.
    version: '0.9.65',
    date: '2026-08-24',
    items: [
      {
        kind: 'defi',
        es: 'La tarjeta del carry gana sus dos puertas quirúrgicas: pagar solo el préstamo, o retirar colateral si el precio sube — sin desmontar la estrategia entera.',
        en: 'The carry card gains its two surgical doors: pay off just the loan, or withdraw collateral when the price runs up — without unwinding the whole strategy.',
      },
      { kind: 'behavior' },
    ],
  },
  {
    // The signing flows calmed down (founder 2026-08-24: «los menús que opera
    // el usuario son un caos»). ONE strategy = ONE card: the lend and borrow
    // legs of a carry (Kinetic ISO / the Ethereum market) merge into a single
    // card with both legs on its face, one close door, and a plain-words «two
    // legs, one close» explainer — no more guessing which of two cards to
    // close. The step-by-step close now SKIPS empty steps by itself (a step
    // with nothing to do says why for half a second and moves on), hides the
    // irrelevant form under a skipped step, folds the technical essay behind
    // «How it runs, exactly» (every disclosed number stays visible), and the
    // steps glide in instead of snapping.
    version: '0.9.64',
    date: '2026-08-24',
    items: [
      {
        kind: 'defi',
        es: 'Cerrar un carry ya es UNA tarjeta y UN paso a paso: las dos piernas juntas, los pasos vacíos se saltan solos, y cada número sigue a la vista antes de firmar.',
        en: 'Closing a carry is now ONE card and ONE step-by-step: both legs together, empty steps skip themselves, and every number stays visible before you sign.',
      },
      { kind: 'behavior' },
      { kind: 'visual' },
    ],
  },
  {
    // Right correction, wrong knob last time (founder 2026-08-24): "slower"
    // meant the light moving slower ACROSS each card, not taking longer to
    // reach the next one. The spacing between cards goes back to what it was
    // (4.25s), and the crossing itself is now as slow as that spacing allows —
    // plus a wider, softer band, which reads slower still at the same clock.
    version: '0.9.63',
    date: '2026-08-24',
    items: [{ kind: 'visual' }],
  },
  {
    // My strategies gets its own pass (founder 2026-08-24). MoneyFlows, the
    // Running/Saved toggle and the recurring-payment card are hidden — the
    // engines stay wired, only their shop windows go. The health reading is
    // rebuilt around its verdict, and the door that matters now sits right
    // next to the health factor: PROTECT THIS POSITION opens the same
    // rule-building card the rest of the app uses (HF ladder, repay by % of
    // live debt). And because a page that can CREATE protections must be able
    // to show a broken one, the rules' own health moved up beside it.
    version: '0.9.62',
    date: '2026-08-24',
    items: [
      {
        kind: 'defi',
        es: 'Proteger una posición se hace ahora desde el propio health factor: una escalera de HF que repaga por ti antes de la liquidación — y la pantalla te dice si alguna de tus protecciones falló su último disparo.',
        en: 'Protecting a position now starts at the health factor itself: an HF ladder that repays for you before liquidation — and the screen tells you if any of your protections failed its last run.',
      },
      { kind: 'behavior' },
      { kind: 'visual' },
    ],
  },
  {
    // The Home's travelling light slows down (founder 2026-08-24: "reduce la
    // velocidad, para dar un toque más relajante"): the sweep now takes ~5.5s
    // instead of ~3, the full round of the column 26s instead of 17, and it
    // eases in and out instead of crossing at machine speed. The rhythm also
    // stops being four hand-written delays: each panel just says its place in
    // the queue and the CSS derives the offset from the cycle, so changing the
    // tempo can no longer knock the relay out of phase.
    version: '0.9.61',
    date: '2026-08-24',
    items: [{ kind: 'visual' }],
  },
  {
    // The Home's light becomes a RELAY (founder 2026-08-24: "cuando la
    // animación termine en el cuadro de net worth que empiece en el card de
    // abajo y así sucesivamente"). One light now travels the whole column —
    // hero, then the accounts band, then each ring — instead of four panels
    // glinting on their own clock. They share the cycle and differ only in
    // their offset, so the relay stays in phase forever with nobody
    // coordinating it.
    version: '0.9.60',
    date: '2026-08-24',
    items: [{ kind: 'visual' }],
  },
  {
    // Two asks, one afternoon (founder 2026-08-24). The Home gets a pulse of
    // its own: a very slow light crosses the hero the way light crosses a
    // metal plate, the rows warm to gold under the pointer and their glyph
    // lifts, and the protections reading breathes — but only when something
    // is actually watching. Nothing here informs, so nothing here shouts.
    // And a council-governed account stops looking like a wallet in another
    // colour: its card wears a full-bleed CROWN with the seal and the fact
    // that defines it — the quorum, M of N, in dots and in words, read from
    // the ledger and never invented. Its shelf gets the same treatment.
    version: '0.9.59',
    date: '2026-08-24',
    items: [{ kind: 'visual' }],
  },
  {
    // Portfolio facelift, founder-directed (2026-08-24). OVERVIEW: the value
    // chart takes the full operative width; below it a strip of FOUR rings —
    // what you hold, what earns, where it works, how it sits (the old bar
    // breakdown row retired into them); the positions table left for its own
    // tab; the structures band shows under Overview only. ACTIVITY: one quiet
    // toolbar — date range (now filtering the visible list too), the
    // thirteen type chips folded into one animated dropdown, a clear-filters
    // button, export at the right — and the lecture up top is gone.
    version: '0.9.58',
    date: '2026-08-24',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Founder's third pass (2026-08-23): (1) FIX — Govern/Movements on a
    // Legacy card bounced back to Wallets: the workshop's no-destination
    // redirect raced the page's param reader (child effects run before the
    // parent's) and always won; it now stands down when the URL carries an
    // entry. (2) The indigo crossing softened — 0.9s, lighter blur and bloom
    // — now that governing navigates on every click. (3) The Legacy card
    // dresses as an institutional PLAQUE: engraved seal watermark (column,
    // two rings, five stars), squared Landmark chip, double frame and a
    // LEGACY eyebrow — separated shelves no longer read as «a normal wallet
    // in another colour».
    version: '0.9.57',
    date: '2026-08-23',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Founder's second pass on the Wallets redesign (2026-08-22): (1) the
    // card's Manage panel opens as a DIALOG above the grid — the inline
    // expansion stretched every card in its row (grid rows share a height by
    // construction); (2) Legacy governance moved back to its own PAGE
    // (/app/legacy, workshop-only — the My Legacies list stays gone; entry is
    // each account's card and «back» returns to Wallets), recovering the full
    // indigo crossing; (3) the view lenses returned SIMPLE: Cards or List —
    // same shelves, same order, same doors.
    version: '0.9.56',
    date: '2026-08-22',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The wallet-identity batch (founder 2026-08-22): a wallet's name is
    // NEVER its address again — the login wallet learns which app signed it
    // (the fox, not a bare 0x…), unnamed wallets read «MetaMask» /
    // «MetaMask 2», and every box a wallet appears in wears its personal
    // colour (councils always the Legacy indigo). The Wallets screen was
    // rebuilt: identity up front, everything else behind a Manage panel, two
    // shelves (Personal / Legacy), and the whole Legacy governance — council,
    // constitution, proposals, reinforce — now opens as a dialog from each
    // account's own card; the old My Legacies page forwards here. A new
    // Legacy is born with an editable example name.
    version: '0.9.55',
    date: '2026-08-22',
    items: [
      {
        kind: 'defi',
        es: 'Cada cuenta se reconoce a la primera: nombre de su app (jamás su código), su color en todo el recuadro, Legacy siempre índigo — y la gobernanza entera se abre desde la tarjeta de cada cuenta en Wallets.',
        en: 'Every account reads at a glance: its app’s name (never its code), its colour on the whole box, Legacy always indigo — and full governance opens from each account’s own card in Wallets.',
      },
      { kind: 'behavior' },
      { kind: 'visual' },
    ],
  },
  {
    // The access ritual is back (founder 2026-08-23: "al quitar el login
    // convencional y solo dejar el xrp identity se ha perdido la magia del
    // ritual de login"). It was never deleted — it lost its moment: the single
    // door leaves Astryum with a full-page redirect, so the card was gone from
    // the browser the instant you clicked. The ceremony now plays where the
    // credentials are actually verified — on the way BACK from the provider,
    // while the code is redeemed — with its decoding manifest, its terminal
    // log, its live UTC clock and the session countersigned with your own
    // stroke and the gold seal. The door itself answers the click too: the
    // fingerprint's ridges draw themselves and a reader sweeps the pad while
    // the channel opens. Reduced motion still collapses all of it.
    version: '0.9.54',
    date: '2026-08-23',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    // The Home is a glance again (founder 2026-08-22, fifth pass). It always
    // shows the whole fleet — the per-row lens and its button are gone — and
    // the account list is back to one compact line each: what is working, how
    // it stands, what it is worth. Clicking a row goes to Wallets, which is a
    // destination again and took Legacy's slot in the menu: a council-governed
    // account is a wallet, so its governance — council, constitution,
    // proposals, movements — now hangs off its own card there, and
    // constituting a new one is that screen's door. The allocation rings stop
    // being squeezed: the row that holds them has a floor, so the ring can
    // never spill over its own title again.
    version: '0.9.53',
    date: '2026-08-22',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Choosing a strategy stops being a wall of cards (founder 2026-08-22).
    // The catalogue now opens with an interactive path that is really a
    // FILTER: pick what you want to happen (earn simply · get cash without
    // selling · back the network) and then the asset, and the list narrows
    // live underneath — no "Guide me" button, no separate result block, and
    // a small ordering menu (rate · without debt first · market) that never
    // reorders by default, because ordering is a gesture and not a ranking.
    // And the routes that share a market now say so: Kinetic's two cards are
    // the same route with one extra step, and Morpho's two are the opposite
    // sides of one market — each card carries the shared-market chip and a
    // line that jumps to its sister.
    version: '0.9.52',
    date: '2026-08-22',
    items: [
      {
        kind: 'defi',
        es: 'El catálogo de estrategias se elige por lo que quieres que pase, no por jerga — y las rutas que comparten mercado lo dicen: la de Kinetic es la misma con un paso más, y las de Morpho son las dos caras del mismo mercado.',
        en: 'The strategy catalogue is now chosen by what you want to happen, not by jargon — and routes sharing a market say so: Kinetic’s two are one route with an extra step, and Morpho’s two are opposite sides of one market.',
      },
      { kind: 'behavior' },
      { kind: 'visual' },
    ],
  },
  {
    // Legacy stops being a separate product and becomes what it always was:
    // one more account (founder 2026-08-22, "el legacy simplemente sea una
    // wallet más… no que sea seleccionable como producto distinto, porque no
    // lo es"). Council-governed accounts now sit in the SAME single list as
    // every other wallet — in the Summary band and on the Wallets screen —
    // and their capital counts in the fleet total by default instead of
    // hiding behind a switch. The indigo theme and its crossing survive where
    // they mean something: entering the Legacy screen to govern, reinforce or
    // constitute. Nothing else can repaint the app, and nothing can leave a
    // session scoped to an account it never chose.
    version: '0.9.51',
    date: '2026-08-22',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Entering Astryum from a fresh browser no longer opens with a wallet
    // dialog (founder 2026-08-22). Signing in with a wallet used to force the
    // network to Flare BEFORE the signature — so a first-time visitor, whose
    // MetaMask sits on Ethereum by default, met a "switch network" popup as
    // their first interaction. It protected nothing: the server signs identity
    // on any EVM chain and the message never carried chain 14 anyway. Flare is
    // still required where it actually matters — linking an EVM wallet and
    // signing an operation — and the network banner now lives inside the app
    // instead of greeting people on /login, /privacy or /proof.
    version: '0.9.50',
    date: '2026-08-22',
    items: [{ kind: 'behavior' }],
  },
  {
    // The Summary is itself again (founder 2026-08-22, fourth pass: "ponlo
    // como estaba antes, pero dividiendo a la mitad el apartado de wallets").
    // The hero, the wallet band and the two allocation rings share one
    // viewport again; the band is now split — Personal on the left, Legacy on
    // the right — and picking a row, a half or "the whole fleet" re-reads the
    // net worth, the health and both rings for THAT selection, instantly and
    // without leaving the page. The whole fleet is what it shows by default.
    version: '0.9.49',
    date: '2026-08-22',
    items: [{ kind: 'behavior' }, { kind: 'visual' }, { kind: 'performance' }],
  },
  {
    // The fleet cards get their meters back (founder 2026-08-22, third pass):
    // each wallet row inside the Personal and Legacy boxes wears the old
    // band's anatomy — the working-capital bar, its % label, the health word
    // — and each structure reads its two legs as ONE bar. Verified
    // adversarially: the Ethereum-rail debt regression the old band had
    // already paid for was caught and fixed before shipping.
    version: '0.9.48',
    date: '2026-08-22',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Fusion v2, on founder review: the small scope pill and the row band
    // died — the retired Home's TWO PRODUCT SHELVES (Personal gold · Legacy
    // indigo, each with its wallet cards, live values and add door) now live
    // in the Summary under the hero; selection is the theme and never leaves
    // the page. The Portfolio's left rail was retired the same day it was
    // born (it starved the data of room) — the horizontal spine returns,
    // keeping the two detail donuts. No-wallet states got a finished face
    // (living beacon scenes, real doors), and the Add Wallet dialog arrives
    // on a spring with the REAL brand marks (the fox and the X, redrawn).
    version: '0.9.47',
    date: '2026-08-22',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The great fusion (founder 2026-08-22): the Summary absorbed the Home —
    // it now reads the capital of EVERY fleet with an in-place scope toggle
    // (all fleets · personal · legacy) that never navigates away, replays a
    // welcome choreography on every re-scope, grew the wallet band into the
    // room the detail charts left (legacy structures listed with their two
    // legs), and inherited the hidden Wallets surface and the first-run
    // tour. The detail charts moved to the Portfolio's Overview, and the
    // Portfolio gained a fixed LEFT command rail (View · Scope · Filters) so
    // the centre is pure data. /app/home now redirects to /app.
    version: '0.9.46',
    date: '2026-08-22',
    items: [
      {
        kind: 'defi',
        es: 'El Summary lee todas tus flotas: alterna en el sitio entre todo junto, Personal o Legacy — cada estructura con sus dos patas (consejo + Smart Account) y su capital trabajando.',
        en: 'The Summary reads all your fleets: toggle in place between everything, Personal or Legacy — each structure with its two legs (council + Smart Account) and its working capital.',
      },
      { kind: 'behavior' },
      { kind: 'visual' },
    ],
  },
  {
    // The landing breathes (founder 2026-08-20, after studying morpho.org):
    // a living nebula — FBM clouds, halftone dots and grain in ONE WebGL
    // fragment shader at quarter resolution — replaces the two giant blurred
    // aurora layers that were the page's heaviest steady compositing cost,
    // re-tinting smoothly with the product. The journey's chips also dropped
    // their persistent backdrop blurs over the 60fps star canvas.
    version: '0.9.45',
    date: '2026-08-20',
    items: [{ kind: 'visual' }, { kind: 'performance' }],
  },
  {
    // Founder batch 2026-08-19 (2/2): (1) Wallets drops the added-by-you /
    // from-the-platform filter and shelves — origin stopped carrying
    // information once Legacy legs and empty orphan PAs left the list; the
    // TYPE labels still explain each row. (2) Portfolio face wash: the boxed
    // do-everything filter bar is gone — the tabs stand alone as the spine,
    // wallets+networks live in one quiet scope row (global to every lens),
    // the time range moved next to the chart it controls and search/dust
    // into the Tokens lens they filter. (3) The Earn hand deals in softly
    // (staggered entrance, calmer springs) and closing a route glides the
    // viewport back to the hand instead of snapping to the top.
    version: '0.9.44',
    date: '2026-08-19',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The Structures band (the governed fleet) moved from the Summary to the
    // Portfolio's close (founder 2026-08-19) — the Summary keeps one calm
    // viewport; the structures read next to the capital they hold.
    version: '0.9.43',
    date: '2026-08-19',
    items: [{ kind: 'behavior' }],
  },
  {
    // Founder batch 2026-08-19: (1) the Earn routes are ONE overlapping hand
    // — bigger cards laid across the table, the hand opens around the cursor
    // and the chosen route steps in front while the rest blur behind it;
    // (2) empty ORPHAN Smart Accounts (old deployments' leftovers the fold
    // could not attach to an owner) leave every personal wallet list — one
    // holding value always stays; (3) the Summary's wallet band is capped at
    // the top wallets by value with a "see all" row that expands in place —
    // the charts below can never be crushed again, however many wallets a
    // user connects.
    version: '0.9.42',
    date: '2026-08-19',
    items: [
      {
        // The fold turned FUNCTIONAL (founder: "cuando se necesite usar la
        // FSA se tendrá que pasar por la main wallet"): Receive on an XRPL
        // wallet with a Smart Account asks WHICH asset and routes it — XRP
        // shows the r… address, FXRP shows the Smart Account's Flare address.
        kind: 'defi',
        es: 'Recibir pregunta el activo y enruta a la pata correcta: XRP a tu dirección XRPL, FXRP a la Smart Account de esa misma wallet (con su red y aviso).',
        en: 'Receive asks which asset and routes it: XRP to your XRPL address, FXRP to that same wallet’s Smart Account (with its network and warning).',
      },
      { kind: 'behavior' },
      { kind: 'visual' },
    ],
  },
  {
    // Founder batch 2026-08-12 (2/2): the FXRP a strategy exit leaves on the
    // Smart Account stops being a dead end. (1) An "Unmint to XRP" button on
    // the Smart Account card/row opens the existing FAssets redemption flow
    // NAMED as what it is (it hid inside Movements → Send → r-address);
    // (2) the strategy entries (carry, lend-only, vaults) accept that FXRP
    // directly — a "Pay with XRP / FXRP already minted" toggle rides the
    // same 0xFE carrier-payment machinery as every Smart Account action, so
    // holding FXRP no longer forces you to source fresh XRP first.
    version: '0.9.41',
    date: '2026-08-12',
    items: [
      {
        kind: 'defi',
        es: 'La Smart Account gana su botón de Unmint (FXRP → XRP nativo) y las estrategias aceptan el FXRP ya minteado de la cuenta — sin obligarte a traer XRP nuevo.',
        en: 'The Smart Account gains its Unmint button (FXRP → native XRP) and strategies now accept the FXRP already minted in the account — no fresh XRP required.',
      },
    ],
  },
  {
    // Founder batch 2026-08-12: (1) wallet rows/cards show EVERY readable
    // token with its money in plain sight (qty when priced + USD on the
    // chip) — a wallet holding ~10 FXRP no longer reads «0 FLR» and nothing
    // else; (2) clicking a wallet on Home lands Portfolio on Overview with
    // the wallet pre-selected (tab=overview explicit — the page used to
    // restore the last lens); (3) the strategy finder gained a result step
    // that TEACHES each matching route (plain sentence, live rate with
    // source, risk fact, answers echoed back) before landing on the cards.
    version: '0.9.40',
    date: '2026-08-12',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy pointers now have an owner: switching to a different signed-in
    // account wipes the previous user's on-device Legacy traces (pointers,
    // nicknames, drafts, plans) BEFORE the registry sync runs — a second
    // email no longer inherits, nor registers as its own, the first
    // account's Legacies. Same clean-start philosophy as the wallet-session
    // release on account switch.
    version: '0.9.39',
    date: '2026-08-11',
    items: [{ kind: 'security' }, { kind: 'behavior' }],
  },
  {
    // Removing a Legacy from "My Legacies" now removes ALL its local traces
    // — nickname, constitution draft, council plan — so re-adding it starts
    // clean instead of resurrecting half-written work. The ledger side is
    // untouched by design: the wizard still honestly resumes whatever the
    // chain says is done.
    version: '0.9.38',
    date: '2026-08-11',
    items: [{ kind: 'behavior' }],
  },
  {
    // The constitution is born in the page's language: template bodies are
    // bilingual now (Spanish untouched; faithful English twins), the builder
    // assembles in the active language, the [PENDING]/[PENDIENTE] marker and
    // linguistic defaults follow along. The user still rewrites the document
    // freely — the anchored text is whatever they edit.
    version: '0.9.37',
    date: '2026-08-11',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The constitution builder speaks one language at a time: its field
    // placeholders were Spanish literals leaking into the English UI — now
    // they are t() keys like the labels, English page shows English hints,
    // Spanish page keeps the exact hints it always had.
    version: '0.9.36',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The signature ceremony moved INSIDE each operation (founder: the
    // full-screen blur takeover felt bolted-on): SignedMark — the same
    // stroke + seal, compact — now plays once in the operation's own
    // progress view (SettlementIndicator on every EVM/Flare flow, the QR
    // cover in Xaman signatures) and rests there as the signed emblem while
    // settlement continues. The shell-level overlay is retired.
    version: '0.9.35',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The "XRPL 1" mystery solved at the root: the backend used to INVENT a
    // "<Chain> n" nickname for every unnamed wallet, and since the nickname
    // wins the display rule, it shadowed the provider name on every surface.
    // The generator is retired (nickname stays NULL), and rows already
    // carrying the machine pattern are neutralised at display time — the
    // founder's Xaman reads "Xaman" again in Wallets, Summary and Portfolio.
    version: '0.9.34',
    date: '2026-08-08',
    items: [{ kind: 'behavior' }],
  },
  {
    // Sidebar slimmed (founder): the search row is gone — questions go to the
    // Co-pilot (⌘K survives as a keyboard-only shortcut) — and the ES/EN
    // toggle moved into Settings › Preferences, next to the theme.
    version: '0.9.33',
    date: '2026-08-08',
    items: [{ kind: 'behavior' }],
  },
  {
    // Founder batch 2026-08-08: (1) the floating bottom-right settlement
    // cards moved into the sidebar under "To sign" as a minimised "In
    // progress" card that also picks up ops signed mid-session; (2) a
    // signature ceremony (login-manifest vocabulary: self-drawing stroke +
    // seal) plays on every successful signature and points at that card;
    // (3) Earn's pick view gained the two-question StrategyFinder that
    // FILTERS the six routes (never recommends); (4) the Wallets screen now
    // shows what each wallet holds (shared walletHoldings reading) and every
    // surface resolves wallet names through ONE rule (nickname → provider →
    // short address; dedupe merges identity across duplicate rows — the
    // "Xaman here, XRPL 1 there" split is gone).
    version: '0.9.32',
    date: '2026-08-08',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Full i18n pass (founder: "hay textos que no se traducen"): 352 t() keys
    // that fell back to English in ES got their Spanish (Legacy vault/cage
    // surfaces, founders panel, position modals, governed movements…), and 12
    // components whose copy was HARDCODED (security settings, chain matrix,
    // error boundary, shell a11y labels, charts, access gates) now go through
    // t() — the AST audit reports 0 missing keys. The Orbit System log shows
    // the last 12 versions instead of 4, so DeFi entries stop vanishing.
    version: '0.9.31',
    date: '2026-08-08',
    items: [{ kind: 'behavior' }],
  },
  {
    // The gold standalone mark is now the neon-glow asteroid (cropped square
    // from astryum_logo-nobackground.png, founder's pick) in the copilot
    // avatar, the cream footer and the to-personal crossing — new filename
    // so no cache can keep serving the old crop.
    version: '0.9.30',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // First-wallet guide for exchange-only users: a step-by-step wizard
    // (Xaman·XRPL / MetaMask·Flare — install, guard the secret, withdraw from
    // the exchange, connect) opened from the Summary's welcome panel and from
    // Add Wallet's "I don't have a wallet yet" row; /app/wallets?add=1 lands
    // with the connect door already open. Plus the brand third pass (founder
    // review): marks re-cropped square and TEXT-FREE (the gold one carried a
    // sliver of the wordmark's "A" — visible in the copilot avatar, footer
    // and crossing), the crossing choreography re-aired for the bigger marks,
    // and the Legacy sun re-composed to the gold hero's exact geometry so
    // both suns render the same size.
    version: '0.9.29',
    date: '2026-08-08',
    items: [
      {
        kind: 'defi',
        es: 'Guía interactiva de primera wallet: de un exchange a tu propia wallet conectada, paso a paso (Xaman en XRPL o MetaMask en Flare).',
        en: 'Interactive first-wallet guide: from an exchange to your own connected wallet, step by step (Xaman on XRPL or MetaMask on Flare).',
      },
      { kind: 'visual' },
    ],
  },
  {
    // Brand pass, round two (founder review): the crossing marks are BIGGER
    // (tight crops — the huge transparent canvases read tiny), the abstract
    // homeward comet is gone (the gold mark IS the centre), the landing's
    // solar-system sun follows the product (blue asteroid in Legacy), the
    // cream footer wears the real mark per product, and the copilot avatar
    // shows its product's asteroid.
    version: '0.9.28',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The brand dresses for the product: in Legacy the sidebar/mobile lockup
    // (and the landing header) turn to the blue asteroid, and each crossing
    // now carries its destination's own mark — the blue asteroid ignites at
    // the constellation's heart entering Legacy; the gold one blooms at the
    // centre riding home.
    version: '0.9.27',
    date: '2026-08-08',
    items: [{ kind: 'visual' }],
  },
  {
    // The ceremony holds your hand: a fixed station header (n/6 · name ·
    // purpose · honest effort estimate), a first-contact orientation card
    // ("six stations, one irreversible moment — gated"), a folded 60-second
    // "never created a Xaman account" primer on station 0, and a Continue
    // button waiting wherever a station completes.
    version: '0.9.26',
    date: '2026-08-05',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // First-run tour, polished: the popover lost its top hairline (read as a
    // glitch), rises in with a spring instead of popping, and each step's
    // title/body cascade one beat apart; progress rail refined.
    version: '0.9.25',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // The landing's gold CTAs open the beta itself (/login) — registration is
    // open (BETA_REGISTRATION_OPEN=true), so the door stops asking for early
    // access. The demo-list secondary path keeps pointing at /early-access.
    version: '0.9.24',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // The Council station, rebuilt from the founder's own run: the council is
    // created in Xaman, so the page is now the illustrated tutorial (real
    // Xaman captures at the steps they belong to), each block in its own
    // card — no more one giant rectangle with the scene floating in reserved
    // emptiness — and the "enter the wallets" plan form is folded as the
    // optional scratchpad it always was.
    version: '0.9.23',
    date: '2026-08-05',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The Guía moved into the co-pilot: in Legacy mode the sidebar guide IS
    // the Legacy guide (same public endpoint, journey-aware), and the
    // ceremony takes the full width its embedded column used to eat. Station
    // briefs breathe (numbered chips, shorter Council copy), stations slide
    // toward the direction of travel, the rail marks completion with a snap,
    // Movements pops on the house curve, and the Legacy cards cascade in.
    version: '0.9.22',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // The authority palette now stamps <html> (ThemeApplier), not only the
    // shell div — the copilot and every body portal (tour, gate modals,
    // Xaman QR) wore gold inside Legacy because they sat outside the stamp.
    version: '0.9.21',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // The lobby no longer leaks: in Legacy mode with nothing constituted,
    // the shared pages (Home, Portfolio, Earn…) show the lobby invitation —
    // never Personal capital under the indigo shell. /app/legacy, admin and
    // settings keep working; a loading beat shows neither product's data.
    version: '0.9.20',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // The ceremony explains itself: every Constitute station opens with a
    // numbered "what you do here" brief — starting with the truth nobody
    // wrote down (create a NEW Xaman account first; it becomes the Legacy's
    // main account). On phones and for screen readers the ceremony now comes
    // before the helper chat instead of below it.
    version: '0.9.19',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy, reorganized for first contact: the workspace is titled after the
    // Legacy it holds, a Constitute ↔ Govern switcher lives in its chrome (no
    // more walking back to the list to change surface), the card doors say
    // where they go (Constitute / Govern / Movements), Info shows the anchored
    // constitution with a jump to its station, and the whole surface got its
    // accessibility pass — tablist semantics, keyboard navigation, focus trap
    // + Escape on the Movements dialog, visible focus everywhere.
    version: '0.9.18',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy is a first-class product now: flipping the toggle ALWAYS enters
    // it — with a governed account when one exists, or as the LOBBY (indigo
    // shell, crossing, Legacy nav, the constitute door) when nothing is
    // constituted yet. A fresh account's toggle is no longer a dead switch.
    version: '0.9.17',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Legacy entry, done right: clicking the toggle while accounts were still
    // loading no longer bounces to the panel in Personal tint — the intent is
    // parked and the REAL flip (re-tint, crossing, nav swap) completes the
    // moment the registry answers. Panel only when truly nothing governed.
    version: '0.9.16',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // Legacy gate dead-end fixed: an allowlisted account with no governed
    // account yet clicked the toggle into pure silence (no popup — access is
    // fine — and no switch — nothing to activate). Now it lands on the
    // Legacy panel, whose door offers Constitute.
    version: '0.9.15',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // The overview at /app is now NAMED "Home" (Inicio) — sidebar, ⌘K, tour,
    // copilot and the landing's journey labels all follow. Routes untouched.
    version: '0.9.14',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // Home page REMOVED (founder): the Summary already welcomes a wallet-less
    // account with its connect panel — two front doors confused more than
    // they calmed. Nav/login/copilot/tour all point back at /app.
    version: '0.9.13',
    date: '2026-08-04',
    items: [{ kind: 'behavior' }],
  },
  {
    // Earn's highlight, final take: position only. Both colored treatments
    // (tint, solid) are retired — the row is normal again, sitting above
    // Wallets. Gold in the nav belongs to the selected state alone.
    version: '0.9.12',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // Earn's highlight, take two: the soft gold tint read as "selected" and
    // confused testers — now a SOLID gold button (copilot recipe), ring when
    // it is the active page. Selected rows keep tint + rail untouched.
    version: '0.9.11',
    date: '2026-08-04',
    items: [{ kind: 'visual' }],
  },
  {
    // Accessibility pass, round 2: landing buttons lose their arrows (the
    // scroll cue is the page's ONE arrow — now a big symbol-only chevron),
    // and Earn becomes the sidebar's highlighted action row (volt tint,
    // above Wallets/Legacy). Behaviour + visual; nothing DeFi-new.
    version: '0.9.10',
    date: '2026-08-03',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // First-user accessibility pass: Home page as the dashboard's calm front
    // door (+ nav reorder), Wallets re-organized (list default, origin
    // shelves, origin/balance selectors), landing scroll cue made page-long
    // and the closing links row. Behaviour + visual; nothing DeFi-new.
    version: '0.9.9',
    date: '2026-08-03',
    items: [{ kind: 'behavior' }, { kind: 'visual' }],
  },
  {
    // Founder portraits on /about — the trust page now has the real faces.
    version: '0.9.8',
    date: '2026-07-27',
    items: [{ kind: 'visual' }],
  },
  {
    // Demo terms as public docs (/demo-terms) + notice-line acceptance on
    // sign-up (recorded server-side) + live on-chain transparency feed on
    // /what-we-offer. Landing + registro: behavior; recorded acceptance +
    // server-enforced literal: security.
    version: '0.9.7',
    date: '2026-07-26',
    items: [{ kind: 'behavior' }, { kind: 'security' }],
  },
  {
    // Legacy gate v2: the toggle shows for every beta account; without access
    // it opens the in-development popup instead of hiding the product.
    version: '0.9.6',
    date: '2026-07-26',
    items: [{ kind: 'behavior' }],
  },
  {
    version: '0.9.5',
    date: '2026-07-26',
    items: [
      {
        kind: 'defi',
        es: 'Net APY por posición: interés base, recompensas y coste de deuda en una sola cifra, con su fuente.',
        en: 'Net APY per position: base interest, rewards and debt cost in one figure, with its source.',
      },
      {
        kind: 'defi',
        es: 'Cada operación se ensaya on-chain antes de pedirte la firma — la wallet solo se abre si el ensayo pasa.',
        en: 'Every operation is rehearsed on-chain before asking for your signature — the wallet only opens if the rehearsal passes.',
      },
      {
        kind: 'defi',
        es: 'Una firma en curso sobrevive a recargar la página: los pendientes se rehidratan con su reloj original.',
        en: 'An in-flight signature survives a page reload: pendings rehydrate with their original clock.',
      },
      { kind: 'performance' },
      { kind: 'visual' },
    ],
  },
  {
    version: '0.9.4',
    date: '2026-07-25',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
  {
    version: '0.9.3',
    date: '2026-07-25',
    items: [
      {
        kind: 'defi',
        es: 'Las reglas de protección activas se editan en sitio: umbral, importe y cooldown.',
        en: 'Active protection rules are editable in place: threshold, amount and cooldown.',
      },
      {
        kind: 'defi',
        es: 'El repay de protección puede salir del propio agente — la pierna sin wallet.',
        en: 'Protection repay can run from the agent account itself — the walletless leg.',
      },
      {
        kind: 'defi',
        es: 'Los avisos de trigger llegan con firma Xaman a un toque.',
        en: 'Trigger alerts arrive with one-tap Xaman signing.',
      },
    ],
  },
  {
    version: '0.9.2',
    date: '2026-07-24',
    items: [{ kind: 'visual' }],
  },
  {
    version: '0.9.1',
    date: '2026-07-23',
    items: [{ kind: 'security' }],
  },
  {
    version: '0.9.0',
    date: '2026-07-22',
    items: [{ kind: 'visual' }, { kind: 'behavior' }],
  },
];

/** The chip the Orbit System card wears — always the newest entry's version. */
export const PLATFORM_VERSION = `v${CHANGELOG[0].version}`;
