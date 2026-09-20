/**
 * XrplPermissionedDomainService — composición SIN FIRMAR de las transacciones
 * XLS-80 (Permissioned Domains) del perímetro regulado del exchange.
 */

import { encodeCredentialType, CredentialCeremonyError } from './XrplCredentialCeremony';

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
/** DomainID es un hash de 256 bits (64 hex). */
const DOMAIN_ID_RE = /^[0-9A-Fa-f]{64}$/;
/** XLS-80 capa la lista de credenciales aceptadas a 10. */
export const MAX_ACCEPTED_CREDENTIALS = 10;

export class PermissionedDomainError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_OWNER'
      | 'INVALID_DOMAIN_ID'
      | 'NO_CREDENTIALS'
      | 'TOO_MANY_CREDENTIALS'
      | 'INVALID_ISSUER'
      | 'INVALID_CREDENTIAL_TYPE',
    detail: string,
  ) {
    super(detail);
    this.name = 'PermissionedDomainError';
  }
}

/** Una credencial aceptada, en la forma anidada de XLS-80. */
export interface AcceptedCredential {
  Credential: { Issuer: string; CredentialType: string };
}

export interface PermissionedDomainSetTx {
  TransactionType: 'PermissionedDomainSet';
  Account: string; // el DUEÑO (exchange) firma
  DomainID?: string; // omitir = crear; presente = modificar
  AcceptedCredentials: AcceptedCredential[];
}

export interface PermissionedDomainDeleteTx {
  TransactionType: 'PermissionedDomainDelete';
  Account: string;
  DomainID: string;
}

/**
 * El txjson que firmará el exchange para crear/actualizar su perímetro regulado.
 * `acceptedCredentials`: normalmente UNA — {emisor KYC del exchange, tipo "KYC"}.
 */
export function composePermissionedDomainSet(params: {
  owner: string;
  acceptedCredentials: Array<{ issuer: string; credentialType?: string }>;
  domainID?: string;
}): PermissionedDomainSetTx {
  if (!XRPL_ADDRESS_RE.test(params.owner)) {
    throw new PermissionedDomainError('INVALID_OWNER', 'el dueño no es una r-address válida');
  }
  if (params.domainID !== undefined && !DOMAIN_ID_RE.test(params.domainID)) {
    throw new PermissionedDomainError('INVALID_DOMAIN_ID', 'DomainID debe ser un hash de 64 hex');
  }
  const creds = params.acceptedCredentials ?? [];
  if (creds.length === 0) {
    throw new PermissionedDomainError('NO_CREDENTIALS', 'un dominio necesita al menos una credencial aceptada');
  }
  if (creds.length > MAX_ACCEPTED_CREDENTIALS) {
    throw new PermissionedDomainError('TOO_MANY_CREDENTIALS', `máximo ${MAX_ACCEPTED_CREDENTIALS} credenciales aceptadas`);
  }

  const AcceptedCredentials: AcceptedCredential[] = creds.map((c) => {
    if (!XRPL_ADDRESS_RE.test(c.issuer)) {
      throw new PermissionedDomainError('INVALID_ISSUER', 'el emisor de una credencial aceptada no es una r-address válida');
    }
    let CredentialType: string;
    try {
      CredentialType = encodeCredentialType(c.credentialType ?? 'KYC');
    } catch (e) {
      throw new PermissionedDomainError('INVALID_CREDENTIAL_TYPE', (e as CredentialCeremonyError).message);
    }
    return { Credential: { Issuer: c.issuer, CredentialType } };
  });

  const tx: PermissionedDomainSetTx = {
    TransactionType: 'PermissionedDomainSet',
    Account: params.owner,
    AcceptedCredentials,
  };
  if (params.domainID !== undefined) tx.DomainID = params.domainID;
  return tx;
}

/** El txjson para retirar el dominio (solo el dueño). */
export function composePermissionedDomainDelete(params: { owner: string; domainID: string }): PermissionedDomainDeleteTx {
  if (!XRPL_ADDRESS_RE.test(params.owner)) {
    throw new PermissionedDomainError('INVALID_OWNER', 'el dueño no es una r-address válida');
  }
  if (!DOMAIN_ID_RE.test(params.domainID)) {
    throw new PermissionedDomainError('INVALID_DOMAIN_ID', 'DomainID debe ser un hash de 64 hex');
  }
  return { TransactionType: 'PermissionedDomainDelete', Account: params.owner, DomainID: params.domainID };
}
