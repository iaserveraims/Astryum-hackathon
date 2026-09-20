'use client';

/**
 * ExchangeWelcome — LA PORTADA DEL EXCHANGE (fundador 2026-09-15: «una welcome
 * page que deja escoger entre entrar o create; son dos recuadros grandes donde
 * en cada uno hay entrar to exchange or client y crear exchange or client»).
 *
 * DOS RECUADROS GRANDES QUE NO SON BOTONES (fundador, misma tarde: «que sean
 * envoltorios donde dentro de cada uno haya las dos opciones a escoger»). El
 * recuadro no se pulsa: enmarca. Lo que se pulsa son las DOS opciones que viven
 * dentro, y por eso las cuatro puertas están a la vista de un golpe:
 *
 *   ┌ Entrar ───────────────────┐   ┌ Crear ────────────────────┐
 *   │ · Entrar al exchange      │   │ · Crear un exchange       │
 *   │ · Entrar como cliente     │   │ · Crear cuenta de cliente │
 *   └───────────────────────────┘   └───────────────────────────┘
 *
 * LO QUE NO HACE: no mueve nada de sitio. La mesa del operador sigue en
 * /app/exchange/operator, el alta sigue siendo la MISMA ventana de siempre
 * (openExchangeSetupOp → ExchangeSetupOperation) y la cuenta del cliente sigue
 * siendo ExchangeClientApp en esta misma página. Esto solo es la puerta.
 *
 * SALE SIEMPRE (fundador, mismo día): entrar a /app/exchange enseña la portada,
 * no la última elección. Elegir es un clic; adivinar mal, un rodeo.
 *
 * QUÉ ES ESTO — Y QUÉ NO ES (fundador 2026-09-15, rama de la ventana): antes de
 * las dos puertas, una descripción que deja claro que ASTRYUM NO ES UN
 * EXCHANGE. El producto es la ESTRUCTURA de uno, sobre la red, para que una
 * empresa con la credencial (y la autorización, que es suya) para atender
 * clientes cree aquí su propio exchange y lo opere con ellos. Astryum construye
 * y prepara; el operador firma con sus llaves, aprueba a sus clientes y lleva
 * sus libros. Cada frase de ese bloque afirma solo lo construido (el gate de
 * credencial del cliente corta en el backend — refuseWithoutCredential en
 * routes/demoExchange.ts; la credencial de la raíz es un objeto XLS-70 en el
 * ledger que la estación del alta lee; la salida del vault la firma la passkey
 * del cliente). Guardarraíl de copy de la casa: jamás «licenciado» ni
 * «regulado» como adjetivo de nadie en público — se dice DE QUIÉN es la
 * autorización, no que alguien la tenga.
 *
 * UNA SOLA PANTALLA, SIN SCROLL (fundador, misma tarde: «estática sin scroll…
 * el mismo tipo de UI —bordes, espacios y todo— pero más agrupado»). El mismo
 * contrato que el Home (app/page.tsx): en lg+ la columna toma el viewport
 * menos el py-8 del shell (min-h, no h — con pantalla baja la página crece y
 * hace scroll antes que recortar nada). Y para que quepa, todo se AGRUPA sin
 * cambiar de lenguaje: la cabecera es una línea (título a la izquierda, la
 * frase de las dos puertas a la derecha); la descripción es UN recuadro de
 * celdas con filete (HairlineGroup) — la declaración arriba, los tres hechos
 * debajo — en vez de una tarjeta con tres tarjetas dentro; y en cada puerta el
 * icono va en línea con el título y las opciones se aprietan un punto.
 */

import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, Landmark, Layers, LogIn, Plus, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { Card, HairlineCell, HairlineGroup, MicroLabel } from '../ui/primitives';
import { RevealGroup, RevealItem } from '../ui/motion';
import { useT } from '../../i18n/LanguageProvider';
import { useOperationStore } from '../../stores/operationStore';

/** Qué quiso el que entró — la pata del cliente lo hereda como intención. */
export type ClientIntent = 'enter' | 'create';

/* ── Una de las dos opciones de dentro: esto SÍ se pulsa ─────────────────── */
function DoorOption({
  icon: Icon,
  eyebrow,
  title,
  purpose,
  onClick,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  purpose: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-volt/40 hover:bg-volt/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-volt/25 bg-volt/[0.08] text-volt">
        <Icon className="h-4 w-4" strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <MicroLabel tone="muted">{eyebrow}</MicroLabel>
        <span className="mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold tracking-tight text-ink">
          {title}
          <ArrowRight className="h-3.5 w-3.5 text-volt opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink/50">{purpose}</span>
      </span>
    </button>
  );
}

/* ── El recuadro grande: enmarca, no se pulsa ────────────────────────────── */
function DoorFrame({
  icon: Icon,
  eyebrow,
  title,
  purpose,
  children,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  purpose: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col p-4 md:p-5">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-volt/30 bg-volt/10 text-volt">
          <Icon className="h-4 w-4" strokeWidth={1.6} />
        </div>
        <div className="min-w-0">
          <MicroLabel className="block">{eyebrow}</MicroLabel>
          <h2 className="mt-0.5 text-[19px] font-semibold leading-tight tracking-tight text-ink">{title}</h2>
        </div>
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-ink/55">{purpose}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </Card>
  );
}

/* ── Qué es esto — y qué no es: la descripción del producto ──────────────── */
function WhatThisIs() {
  const { t } = useT();
  const facts: { icon: LucideIcon; title: string; body: string }[] = [
    {
      icon: Layers,
      title: t('What the company creates'),
      body: t('A root of authority on XRPL, an omnibus it names and controls with its own keys, a register of the clients it approves, and the potes on Flare where their capital works.'),
    },
    {
      icon: Landmark,
      title: t('What the company brings'),
      body: t("Its own authorisation to serve clients, its own keys, its own books and its own clients. Its credential is an object on the ledger, on the root account of the exchange, that anyone can verify; approving a client is the exchange's decision, never Astryum's."),
    },
    {
      icon: ShieldCheck,
      title: t('What Astryum does — and never does'),
      body: t("Astryum builds the structure and prepares every action for the operator to sign. It never signs, never holds anyone's funds and never approves a client."),
    },
  ];
  return (
    <HairlineGroup columns="grid-cols-1">
      {/* La declaración: título a la izquierda, la explicación a la derecha —
          una fila, no una torre. */}
      <HairlineCell className="grid gap-x-8 gap-y-2 p-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:px-5">
        <div>
          <MicroLabel>{t('What this is — and what it is not')}</MicroLabel>
          <h2 className="mt-1 text-[19px] font-semibold leading-tight tracking-tight text-ink">{t('Astryum is not an exchange.')}</h2>
        </div>
        <div className="space-y-1.5">
          <p className="text-[12.5px] leading-snug text-ink/60">
            {t('It is the structure of one, built on the network, so that a company holding the credential to serve clients can create its own exchange here and operate it with them.')}
          </p>
          <p className="text-[11.5px] leading-snug text-ink/45">
            {t("It runs on mainnet today: every deposit, every order and every exit leaves a receipt you can verify on-chain, and a client's way out of the vault is signed with the client's own passkey, not with the exchange's key.")}
          </p>
        </div>
      </HairlineCell>
      {/* Los tres hechos, tres celdas de la misma lámina — filete entre ellas,
          icono en línea con el título. */}
      <div className="grid gap-px md:grid-cols-3">
        {facts.map((f) => (
          <HairlineCell key={f.title} className="p-4 md:py-3.5 md:px-5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-volt/25 bg-volt/[0.08] text-volt">
                <f.icon className="h-3.5 w-3.5" strokeWidth={1.7} />
              </span>
              <p className="text-[12.5px] font-semibold tracking-tight text-ink">{f.title}</p>
            </div>
            <p className="mt-2 text-[12px] leading-snug text-ink/50">{f.body}</p>
          </HairlineCell>
        ))}
      </div>
    </HairlineGroup>
  );
}

export function ExchangeWelcome({ onClient }: { onClient: (intent: ClientIntent) => void }) {
  const { t } = useT();
  const router = useRouter();
  const openSetup = useOperationStore((s) => s.openExchangeSetupOp);

  return (
    <div className="flex flex-col gap-3 lg:min-h-[calc(100dvh-4rem)]">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-8 gap-y-1">
        <div className="min-w-0">
          <MicroLabel>{t('Exchange')}</MicroLabel>
          <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-ink md:text-[24px]">
            {t('What do you want to do?')}
          </h1>
        </div>
        <p className="max-w-[58ch] text-[12.5px] leading-snug text-ink/50">
          {t('Two doors, and behind each one the same two sides: the exchange that operates, and the client who uses it.')}
        </p>
      </div>

      <WhatThisIs />

      <RevealGroup className="grid items-stretch gap-3 lg:grid-cols-2">
        <RevealItem steady className="h-full">
          <DoorFrame
            icon={LogIn}
            eyebrow={t('Already there')}
            title={t('Enter')}
            purpose={t('Go into an exchange you already operate, or into the client account your passkey opens.')}
          >
            <DoorOption
              icon={Building2}
              eyebrow={t('Operator')}
              title={t('Enter the exchange')}
              purpose={t('The desk that operates it: clients, omnibus, potes, profile and audit.')}
              onClick={() => router.push('/app/exchange/operator')}
            />
            <DoorOption
              icon={UserRound}
              eyebrow={t('Client')}
              title={t('Enter as a client')}
              purpose={t('Your account at the exchange: deposit, vault, withdraw. Your passkey opens it.')}
              onClick={() => onClient('enter')}
            />
          </DoorFrame>
        </RevealItem>

        <RevealItem steady className="h-full">
          <DoorFrame
            icon={Plus}
            eyebrow={t('From scratch')}
            title={t('Create')}
            purpose={t('Bring a new exchange into being, or open your own client account at one of them.')}
          >
            <DoorOption
              icon={Building2}
              eyebrow={t('Operator')}
              title={t('Create an exchange')}
              purpose={t('The full setup, station by station — and then the rehearsal, before any real client.')}
              onClick={() => openSetup()}
            />
            <DoorOption
              icon={UserRound}
              eyebrow={t('Client')}
              title={t('Create a client account')}
              purpose={t('Your own account at an exchange that is taking clients. Your passkey is the key.')}
              onClick={() => onClient('create')}
            />
          </DoorFrame>
        </RevealItem>
      </RevealGroup>
    </div>
  );
}

export default ExchangeWelcome;
