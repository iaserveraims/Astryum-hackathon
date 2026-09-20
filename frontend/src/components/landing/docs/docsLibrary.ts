/**
 * LA BIBLIOTECA — los datos de /docs, en un solo sitio.
 *
 * Esto vivía dentro del `<script>` de `public/docs/index.html`, la página
 * estática con la que se publicó la biblioteca. Al pasar /docs a una
 * página de Next con la carcasa de las demás (`SubpageShell`: el mismo cielo,
 * la misma cabecera y el mismo pie que /about y /proof), los datos salen del
 * HTML y entran aquí tipados. Los ficheros no se mueven: las diapositivas
 * siguen en `/docs/pages/<id>/pNN.jpg` y los PDF en `/docs/files/`.
 *
 * Las imágenes llevan `?v=<rev>` porque las .jpg se sirven con
 * `Cache-Control: immutable`: subir `rev` es la única forma de que un deck
 * regenerado llegue a quien ya lo vio.
 */

export type DocLink = readonly [label: string, href: string];

export interface DocDeck {
  id: string;
  tab: string;
  kind: string;
  title: string;
  context: string;
  date: string;
  lang: string;
  pdf: string;
  filename: string;
  size: string;
  pageDir: string;
  rev: number;
  links: readonly DocLink[];
  /** [nombre del grupo, primera diapositiva, última diapositiva] — 1-based. */
  groups: ReadonlyArray<readonly [string, number, number]>;
  /** [titular, subtítulo] por diapositiva, en orden. */
  slides: ReadonlyArray<readonly [string, string]>;
}

export const PROOF_LINK: DocLink = ["astryum.xyz/proof","https://astryum.xyz/proof"];
export const CODE_LINK: DocLink = ["Source code (GitHub)","https://github.com/iaserveraims/Astryum-hackathon"];

/** La URL de una diapositiva, con su versión de caché. */
export function slideSrc(doc: DocDeck, n: number): string {
  return `${doc.pageDir}p${String(n).padStart(2, "0")}.jpg?v=${doc.rev || 1}`;
}

export const DOCS: readonly DocDeck[] = [
  {
    id: 'pitch-deck',
    tab: 'Pitch deck',
    kind: 'Deck',
    title: 'Astryum pitch deck',
    context: 'The project in 26 slides: the team, the mechanism, the six products, mainnet traction, what we do not claim, the roadmap and how Astryum earns.',
    date: '2026-09-19',
    lang: 'English',
    pdf: '/docs/files/Astryum_Pitch_Deck.pdf',
    filename: 'Astryum_Pitch_Deck.pdf',
    size: '847 KB',
    pageDir: '/docs/pages/pitch-deck/',
    rev: 2,
    links: [
      [
        'astryum.xyz/app',
        'https://astryum.xyz/app'
      ],
      [
        'astryum.xyz/proof',
        'https://astryum.xyz/proof'
      ],
      [
        'Source code (GitHub)',
        'https://github.com/iaserveraims/Astryum-hackathon'
      ]
    ],
    groups: [
      [
        'Introduction',
        1,
        4
      ],
      [
        'Mechanism',
        5,
        9
      ],
      [
        'Products',
        10,
        18
      ],
      [
        'Traction and evidence',
        19,
        23
      ],
      [
        'Roadmap and economics',
        24,
        26
      ]
    ],
    slides: [
      [
        'Cover',
        'Astryum — non-custodial capital control plane for XRP.'
      ],
      [
        'The team',
        'Two founders. The gap between them is the product.'
      ],
      [
        'The problem',
        'Three things people say about their XRP — and none of them is about crypto.'
      ],
      [
        'What Astryum is',
        'One web app. The wallet you already have. Rules the ledger enforces.'
      ],
      [
        'The mechanism',
        'XRPL governs. Flare executes. The user signs.'
      ],
      [
        'Rail A · the personal path',
        'One XRPL signature. N actions on Flare. No FLR, no EVM wallet.'
      ],
      [
        'Rail B · the council order',
        'A group governs a contract without anyone holding a key to it.'
      ],
      [
        'Why XRPL is load-bearing',
        'Remove the ledger — which capability disappears?'
      ],
      [
        'Why it takes both networks',
        'The product exists only in the overlap.'
      ],
      [
        'The products',
        'One kernel. Each product is a small rule module.'
      ],
      [
        'Personal account',
        'Your XRPL wallet commands your account on Flare. Self-custody, one signature.'
      ],
      [
        'Reinforced account',
        'A personal wallet where no single key moves anything.'
      ],
      [
        'Legacy',
        'A family governs by quorum. Nobody moves the capital alone — not a member, not us.'
      ],
      [
        'Managed vaults',
        'Delegate the decision, not the possession.'
      ],
      [
        'Exchange',
        'The structure of an exchange, on the ledger. Custodied by the exchange — shares in the client’s name.'
      ],
      [
        'Credentials · MoneyFlows · /proof',
        'The layer every product shares: who may act, rules that never sign, and proof anyone can check.'
      ],
      [
        'Accounts and legal vehicles',
        'One root per legal vehicle. The credential on the root decides the account type.'
      ],
      [
        'The infrastructure',
        'Nothing here is ours except the contracts and the backend. That is the point.'
      ],
      [
        'Traction · live on mainnet',
        'Not a prototype. Real councils, real cages, real capital — small on purpose.'
      ],
      [
        'Traction · Source Tag 2607090002',
        'Few signatures — each one a ceremony or a movement of real capital.'
      ],
      [
        'The five-minute check',
        'Open the app, walk the three doors, then read the ledger.'
      ],
      [
        'Evidence',
        'Every claim is on a ledger. /proof verifies it in your browser.'
      ],
      [
        'What we do not claim',
        'The honesty is the argument.'
      ],
      [
        'Next, and after',
        'One web, one kernel, N account types — and two things we wait for.'
      ],
      [
        'How Astryum earns',
        'Whoever gains from the flow pays. Never the person who puts in the capital.'
      ],
      [
        'Closing',
        'Your capital. Your control. Your signature.'
      ]
    ]
  },
  {
    id: 'legacy',
    tab: 'Legacy',
    kind: 'Product deck',
    title: 'Legacy',
    context: 'A family, a group or a foundation holds XRP under a council of real people, with a constitution anchored on the ledger and a vault on Flare that only obeys it.',
    date: '2026-09-19',
    lang: 'English',
    pdf: '/docs/files/Astryum_Legacy_Deck.pdf',
    filename: 'Astryum_Legacy_Deck.pdf',
    size: '700 KB',
    pageDir: '/docs/pages/legacy/',
    rev: 1,
    links: [
      [
        'astryum.xyz/app/legacy',
        'https://astryum.xyz/app/legacy'
      ],
      [
        'astryum.xyz/proof',
        'https://astryum.xyz/proof'
      ],
      [
        'Source code (GitHub)',
        'https://github.com/iaserveraims/Astryum-hackathon'
      ]
    ],
    groups: [
      [
        'Introduction',
        1,
        3
      ],
      [
        'Ceremony and orders',
        4,
        8
      ],
      [
        'Structure and legal vehicles',
        9,
        11
      ],
      [
        'Mainnet and trust',
        12,
        13
      ],
      [
        'Roadmap and evidence',
        14,
        16
      ]
    ],
    slides: [
      [
        'Cover',
        'Legacy — capital under rules: a council of real people, and nobody moves it alone.'
      ],
      [
        'The problem',
        'Capital outlives the people who manage it. Keys don’t.'
      ],
      [
        'What a Legacy is',
        'A council on XRPL. A constitution anchored on the ledger. A vault on Flare that only obeys the constitution.'
      ],
      [
        'The constitution ceremony',
        'Six steps, each signed by the people it binds.'
      ],
      [
        'Signing without a coordinator',
        'Each member signs their part, when they can. The browser combines. The backend never touches a signature.'
      ],
      [
        'Birth of the cage',
        'One signature deploys the stack and makes the first deposit.'
      ],
      [
        'Orders · rail B',
        'The council decides on XRPL. The contract on Flare obeys — or refuses.'
      ],
      [
        'The vault’s rules',
        'What the contract cannot do is the product.'
      ],
      [
        'The whole structure',
        'People → council → bridge → vault → venues. Yield → lineage and beneficiaries.'
      ],
      [
        'Legal vehicles',
        'The same ceremony, seven legal shapes. The link lives on the root.'
      ],
      [
        'Where Astryum stops',
        'What a structure has to settle: ten axes, one perimeter.'
      ],
      [
        'Live on mainnet',
        'A real council, real orders, real capital — read on 15 September 2026.'
      ],
      [
        'Trust model',
        'Who can move the family’s capital alone? Nobody.'
      ],
      [
        'Next and after',
        'Ceremonies still to build — and the arm that reaches other chains.'
      ],
      [
        'Evidence',
        'Check it on an explorer. /proof does it in your browser.'
      ],
      [
        'Closing',
        'Governance on the XRP Ledger. Rules on Flare. Nobody moves the capital alone.'
      ]
    ]
  },
  {
    id: 'managed-vaults',
    tab: 'Managed vaults',
    kind: 'Product deck',
    title: 'Managed vaults',
    context: 'A manager whose credential is verified on the ledger directs capital inside a contract that cannot pay principal to anyone. The client signs their own exit, whenever they want.',
    date: '2026-09-19',
    lang: 'English',
    pdf: '/docs/files/Astryum_Managed_Vaults_Deck.pdf',
    filename: 'Astryum_Managed_Vaults_Deck.pdf',
    size: '652 KB',
    pageDir: '/docs/pages/managed-vaults/',
    rev: 1,
    links: [
      [
        'astryum.xyz/app/manager',
        'https://astryum.xyz/app/manager'
      ],
      [
        'astryum.xyz/proof',
        'https://astryum.xyz/proof'
      ],
      [
        'Source code (GitHub)',
        'https://github.com/iaserveraims/Astryum-hackathon'
      ]
    ],
    groups: [
      [
        'Introduction',
        1,
        3
      ],
      [
        'Mechanism',
        4,
        8
      ],
      [
        'Structure and legal vehicle',
        9,
        10
      ],
      [
        'Mainnet, doctrine and trust',
        11,
        14
      ],
      [
        'Roadmap and evidence',
        15,
        17
      ]
    ],
    slides: [
      [
        'Cover',
        'Managed vaults — delegate the decision, not the possession.'
      ],
      [
        'The problem',
        'Delegating management today means one of two bad trades.'
      ],
      [
        'What it is',
        'Two users, one contract, no custodian.'
      ],
      [
        'The credential gate',
        'Without valid credentials on the root, the cage is not born.'
      ],
      [
        'Birth · rail A',
        'One XRPL signature from the root deploys the cage and its first pote.'
      ],
      [
        'Orders · rail B',
        'Every manager order is a council order. The bridge verifies; the cage obeys or reverts.'
      ],
      [
        'The contract’s rules',
        '“The director is never approved” is not a rule. It is unrepresentable.'
      ],
      [
        'The registry',
        'Which venues a cage may reach is a governed list, not a setting.'
      ],
      [
        'The whole structure',
        'Issuer → root → factory → cage → pote → venues. The client talks only to the pote.'
      ],
      [
        'Legal vehicle',
        'A company that manages third-party capital — and the personal variant of the same pote.'
      ],
      [
        'Live on mainnet',
        'Deployed 3–8 September. Full cycle proven. Read on 15 September.'
      ],
      [
        'Composition is not autonomy',
        'A person decides. The code decides what they can’t.'
      ],
      [
        'Economics',
        'The client receives no less because Astryum is in the middle.'
      ],
      [
        'Trust model',
        'Who can harm whom — and what stops them.'
      ],
      [
        'Next and after',
        'A third generation of the contract, an audit, and a machine that certifies venues.'
      ],
      [
        'Evidence',
        'Read it on flarescan and xrpscan.'
      ],
      [
        'Closing',
        'Delegate the decision. Keep the possession.'
      ]
    ]
  },
  {
    id: 'exchange',
    tab: 'Exchange',
    kind: 'Product deck',
    title: 'Exchange',
    context: 'The structure of a custodial exchange on the ledger: the client enters with a tag, leaves with Face ID and holds shares in their own name from the first block.',
    date: '2026-09-19',
    lang: 'English',
    pdf: '/docs/files/Astryum_Exchange_Deck.pdf',
    filename: 'Astryum_Exchange_Deck.pdf',
    size: '578 KB',
    pageDir: '/docs/pages/exchange/',
    rev: 1,
    links: [
      [
        'astryum.xyz/app/exchange',
        'https://astryum.xyz/app/exchange'
      ],
      [
        'astryum.xyz/proof',
        'https://astryum.xyz/proof'
      ],
      [
        'Source code (GitHub)',
        'https://github.com/iaserveraims/Astryum-hackathon'
      ]
    ],
    groups: [
      [
        'Introduction',
        1,
        3
      ],
      [
        'Mechanism',
        4,
        8
      ],
      [
        'Operator and legal vehicle',
        9,
        10
      ],
      [
        'State and economics',
        11,
        12
      ],
      [
        'Roadmap and evidence',
        13,
        15
      ]
    ],
    slides: [
      [
        'Cover',
        'Exchange — the structure of an exchange on the ledger; the client enters with a tag and leaves with Face ID.'
      ],
      [
        'The problem',
        'Exchanges have lost their clients’ assets. The client had no way to know, and no way out.'
      ],
      [
        'What it is',
        'Astryum is not an exchange. It is the structure of one.'
      ],
      [
        'Two accounts, always',
        'K1 governs. K2 holds the till. A credential on the ledger binds them.'
      ],
      [
        'The client’s path',
        'A tag to enter. Face ID to leave. No wallet, no reserves, no gas, no fees.'
      ],
      [
        'Who custodies what',
        'Two kinds of exit, and they differ in who holds the key.'
      ],
      [
        'The bounded key',
        'The operator’s key is limited by code, not by policy. The DENIED is the proof.'
      ],
      [
        'KYC per box',
        'A notarized record of the exchange’s own process. Not consent. Not enforced by the ledger.'
      ],
      [
        'The operator’s path',
        'An exchange is born by stations, from its own Xaman.'
      ],
      [
        'Legal vehicle',
        'A company that custodies for clients — an enterprise account with a custody credential.'
      ],
      [
        'State, precisely',
        'The structure is on mainnet. The client circuit is rehearsed. Nobody but us has run it.'
      ],
      [
        'Economics',
        'The client pays nothing. The operator pays its reserves. Astryum charges at cost or per act.'
      ],
      [
        'Next and after',
        'From a rehearsed structure to a product an operator adopts — and then private, verifiable operations.'
      ],
      [
        'Evidence and what we don’t claim',
        'Verify the structure; don’t take the circuit on faith.'
      ],
      [
        'Closing',
        'The structure of an exchange, on the ledger. Shares in the client’s name. An exit nobody can block.'
      ]
    ]
  }
];

/**
 * LOS DOCUMENTOS WEB — páginas propias, no decks.
 *
 * Al pasar /docs a página de la app,
 * `DocDeck` solo sabía de diapositivas y estos dos se quedaron sin listar:
 * respondían por URL, pero desde /docs no se llegaba a ellos — mientras que en
 * producción sí estaban enlazados. El texto es el mismo que tenía allí.
 *
 * No tienen portada ni lector: se abren en su propia página, o se descargan.
 */
export interface DocPaper {
  id: string;
  kind: string;
  title: string;
  context: string;
  date: string;
  lang: string;
  /** La URL limpia de la página (rewrite → public/docs/<id>.html). */
  page: string;
  /** Lo que mide el documento, en vez de «N diapositivas». */
  facts: readonly string[];
  pdf: string;
  filename: string;
  size: string;
}

export const PAPERS: readonly DocPaper[] = [
  {
    id: 'explained',
    kind: 'Technical paper',
    title: 'Astryum, explained whole',
    context: 'The master document: what exists today on the XRP Ledger and Flare, how the infrastructure works from the inside, each product, what comes next and what comes after — every claim labelled, every number dated.',
    date: '2026-09-15',
    lang: 'English',
    page: '/docs/explained',
    facts: ['16 sections', '9 diagrams'],
    pdf: '/docs/files/Astryum_Explained_Whole.pdf',
    filename: 'Astryum_Explained_Whole.pdf',
    size: '1.4 MB',
  },
  {
    id: 'mainnet-evidence',
    kind: 'Evidence',
    title: 'Astryum on mainnet, transaction by transaction',
    context: 'Every transaction Astryum’s accounts signed on the XRP Ledger since July and every transaction it caused on Flare, grouped by product and in order — each one linked to its explorer, so every circuit can be followed on-chain.',
    date: '2026-09-19',
    lang: 'English',
    page: '/docs/mainnet-evidence',
    facts: ['204 XRPL transactions', '524 Flare transactions', '112 circuits'],
    pdf: '/docs/files/Astryum_Mainnet_Evidence.pdf',
    filename: 'Astryum_Mainnet_Evidence.pdf',
    size: '2.2 MB',
  },
];
