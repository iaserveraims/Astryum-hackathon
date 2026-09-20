/**
 * contractDocs — el código del contrato, VISIBLE, con qué permite y qué no.
 *
 * Extractos REALES de los contratos (AstryumVault, XrplCouncilBridge,
 * ExchangeKycRegistry, PasskeyAccount) — las líneas que definen el enforcement,
 * no todo el fichero. Cada regla dice, en llano, qué puede y qué NO puede el
 * exchange y el user. Es lo que hace el vídeo creíble: el espectador lee el
 * código y ve por qué la garantía es verdad, no una promesa.
 *
 * Las cadenas de `plain*` van por t() (i18n). El `code` es Solidity literal.
 */

export interface ContractRule {
  /** Título corto de la regla. */
  title: string;
  /** Solidity REAL — el fragmento que la hace cumplir. */
  code: string;
  /** Qué significa para el exchange (puede / no puede). */
  plainExchange: string;
  /** Qué significa para el user (puede / no puede). */
  plainUser: string;
}

export interface ContractDoc {
  key: string;
  name: string;
  file: string;
  /** Una línea de qué es el contrato. */
  summary: string;
  rules: ContractRule[];
}

export const CONTRACT_DOCS: ContractDoc[] = [
  {
    key: 'vault',
    name: 'AstryumVault',
    file: 'contracts/src/AstryumVault.sol',
    summary: 'The vault (ERC-4626): cages the capital and only moves it to a fixed list of venues.',
    rules: [
      {
        title: 'No function extracts the principal',
        code: `// WHAT DOES NOT EXIST IN THIS CODE:
//  - No function pays principal to an arbitrary address (I1).
//  - No successor/migrate. No protocol fee hook. No proxy.
// The principal only moves: vault <-> allowlisted venue, or out
// through the HOLDER's own redemption.`,
        plainExchange: 'The exchange cannot withdraw the capital to any address — the function does not exist.',
        plainUser: 'Nobody can take your capital out except you, through your own redemption.',
      },
      {
        title: 'The director moves capital only within a typed allowlist',
        code: `enum VenueKind { ERC4626, CompoundV2, ERC4626Queued }

function directTo(uint256 venueId, uint256 amount, bytes32 ref)
    external onlyDirectorOrCouncil withRef(ref)
{
    _allocate(venueId, amount, true); // cap + buffer floor enforced
}`,
        plainExchange: 'The exchange puts capital to work ONLY in venues on the allowlist, capped by concentration and above the idle buffer. No generic call, ever.',
        plainUser: 'Your money can only work in the venues the policy names — nowhere else.',
      },
      {
        title: 'Redemption is the holder\'s, and unwinds by itself',
        code: `function requestRedeem(uint256 shares, address receiver)
    external nonReentrant returns (uint256 ticketId)
{
    // burns shares NOW, fixes assets, and unwinds venues by itself
    // if the buffer can't cover — no director cooperation needed.
    ...
}`,
        plainExchange: 'The exchange cannot block, delay or redirect a client\'s exit. It is not needed for the client to leave.',
        plainUser: 'You exit on your own signature; the vault unwinds the positions for you. The cooldown is the one you accepted at entry.',
      },
      {
        title: 'The on-chain KYC gate (entry only)',
        code: `function _deposit(address caller, address receiver, ...) internal override {
    IUserGate gate = userGate;
    if (address(gate) != address(0) && !gate.isApproved(receiver))
        revert ReceiverNotApproved();
    super._deposit(...);
}`,
        plainExchange: 'Only clients the exchange approved (its KYC\'d users) may receive shares. Set by council order. Entry only — never the exit.',
        plainUser: 'You can only enter if your exchange approved you (KYC). Leaving is never gated.',
      },
      {
        title: 'The operator\'s cut is public and capped at birth',
        code: `uint16 public immutable MAX_PAYEE_BPS;   // fixed when the pote is born
uint16 public constant OPEN_PAYEE_BPS_CAP = 2000;   // a pote open to third
                                                    // parties: 20% of yield
// setPayees reverts above MAX_PAYEE_BPS. Never a cut of the principal —
// there is no hook that could take one. Astryum's own fee: 0.`,
        plainExchange:
          'This pote is open to clients, so the exchange earns at most 20% of the YIELD — never the principal — at public bps fixed when the pote was born and unchangeable after. Astryum takes 0.',
        plainUser:
          'The operator\'s cut is on-chain, capped, and was fixed before you entered; the rest of the yield is yours. Nobody takes a cut of your principal.',
      },
    ],
  },
  {
    key: 'bridge',
    name: 'XrplCouncilBridge',
    file: 'contracts/src/XrplCouncilBridge.sol',
    summary: 'Makes "XRPL governs" literal: only the exchange\'s XRPL council can command its vault.',
    rules: [
      {
        title: 'Only THIS council\'s signed order executes',
        code: `bytes32 public immutable COUNCIL_ADDRESS_HASH; // set at birth, frozen

function execute(IXRPPayment.Proof calldata proof, bytes calldata orderData) {
    if (!verifier.verifyXRPPayment(proof)) revert InvalidProof();
    if (proof.data.responseBody.sourceAddressHash != COUNCIL_ADDRESS_HASH)
        revert WrongCouncil();
    ... // replay + nonce, then forward to the ONE vault
}`,
        plainExchange: 'Only the wallet that created the vault (its XRPL council, proven by FDC) can operate it as the exchange. No other wallet, for ever.',
        plainUser: 'The exchange that controls your vault is fixed at birth and can never be swapped.',
      },
    ],
  },
  {
    key: 'registry',
    name: 'ExchangeKycRegistry',
    file: 'contracts/src/ExchangeKycRegistry.sol',
    summary: 'The exchange\'s on-chain list of its KYC\'d clients — the vault\'s user gate.',
    rules: [
      {
        title: 'The exchange approves its own clients',
        code: `mapping(address => bool) public approved;

function setApproved(address user, bool ok) external onlyAdmin {
    approved[user] = ok;
    emit Approved(user, ok);
}
function isApproved(address user) external view returns (bool) {
    return approved[user];
}`,
        plainExchange: 'The exchange marks a client approved (KYC done). Only it (the admin) can. This is the tag/memo of its own users, on-chain.',
        plainUser: 'You appear here only if your exchange KYC\'d you — that is what lets you into its vault.',
      },
    ],
  },
  {
    key: 'passkey',
    name: 'PasskeyAccount',
    file: 'contracts/src/PasskeyAccount.sol',
    summary: 'The user\'s account on Flare, controlled by their passkey (Face ID). Only they can move it.',
    rules: [
      {
        title: 'One face, any action — and nobody else',
        code: `function executeBatch(Call[] calldata calls, WebAuthnSig calldata sig)
    external returns (bytes[] memory)
{
    _verifyAndConsume(challengeForBatch(calls), sig); // P256 / RIP-7212
    // runs every call; anyone may carry the tx, the SIGNATURE is the authority
}`,
        plainExchange: 'The exchange (its relayer) can only CARRY a signature the user already made — it can never move the user\'s money.',
        plainUser: 'You approve every action with your face; the signature commits the exact calls. No wallet, no gas, and only you can sign.',
      },
    ],
  },
];

export function contractDoc(key: string): ContractDoc | undefined {
  return CONTRACT_DOCS.find((d) => d.key === key);
}
