/**
 * La puerta del ancla — compuesta sin firmar, probada en seco.
 *
 * Tres transacciones y una regla: el ledger decide, nosotros solo componemos.
 * Lo que aquí se fija es que cada txjson tenga EXACTAMENTE la forma que XRPL
 * exige (xrpl.js la valida), y que lo que no cabe se rechace antes de firmar.
 */
import {
  ASF_DEPOSIT_AUTH,
  AnchorGateError,
  MAX_CREDENTIALS,
  composeAuthorizeCredentials,
  composeEnableDepositAuth,
  credentialTypeToHex,
  withCredentialIds,
} from '../XrplAnchorGateService';

const ANCHOR = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const ISSUER = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const ID = 'A'.repeat(64);

describe('1. encender DepositAuth en el ancla', () => {
  it('es un AccountSet con SetFlag = asfDepositAuth (9)', () => {
    const tx = composeEnableDepositAuth(ANCHOR);
    expect(tx.TransactionType).toBe('AccountSet');
    expect(tx.Account).toBe(ANCHOR);
    expect(tx.SetFlag).toBe(ASF_DEPOSIT_AUTH);
    expect(ASF_DEPOSIT_AUTH).toBe(9);
  });

  it('rechaza un ancla que no es r-address', () => {
    expect(() => composeEnableDepositAuth('0xabc')).toThrow(AnchorGateError);
  });
});

describe('2. preautorizar por credencial', () => {
  it('compone DepositPreauth con AuthorizeCredentials {Issuer, CredentialType hex}', () => {
    const tx = composeAuthorizeCredentials(ANCHOR, [{ issuer: ISSUER, credentialType: 'KYC' }]);
    expect(tx.TransactionType).toBe('DepositPreauth');
    expect(tx.Account).toBe(ANCHOR);
    const list = tx.AuthorizeCredentials as Array<{ Credential: { Issuer: string; CredentialType: string } }>;
    expect(list).toHaveLength(1);
    expect(list[0].Credential.Issuer).toBe(ISSUER);
    expect(list[0].Credential.CredentialType).toBe('4B5943'); // "KYC" en hex
    expect(tx.UnauthorizeCredentials).toBeUndefined();
  });

  it('modo unauthorize retira el acceso de un emisor entero — inmediato, sin tocar capital', () => {
    const tx = composeAuthorizeCredentials(ANCHOR, [{ issuer: ISSUER, credentialType: 'KYC' }], 'unauthorize');
    expect(tx.UnauthorizeCredentials).toBeDefined();
    expect(tx.AuthorizeCredentials).toBeUndefined();
  });

  it('acepta el tipo ya en hex y lo normaliza', () => {
    const tx = composeAuthorizeCredentials(ANCHOR, [{ issuer: ISSUER, credentialType: '4b5943' }]);
    const list = tx.AuthorizeCredentials as Array<{ Credential: { CredentialType: string } }>;
    expect(list[0].Credential.CredentialType).toBe('4B5943');
  });

  it('rechaza lista vacía, más de 8, repetidos y emisores inválidos', () => {
    expect(() => composeAuthorizeCredentials(ANCHOR, [])).toThrow(/al menos una/);
    const nine = Array.from({ length: MAX_CREDENTIALS + 1 }, (_, i) => ({ issuer: ISSUER, credentialType: `T${i}` }));
    expect(() => composeAuthorizeCredentials(ANCHOR, nine)).toThrow(/como mucho/);
    expect(() =>
      composeAuthorizeCredentials(ANCHOR, [
        { issuer: ISSUER, credentialType: 'KYC' },
        { issuer: ISSUER, credentialType: '4B5943' },
      ]),
    ).toThrow(/repetida/);
    expect(() => composeAuthorizeCredentials(ANCHOR, [{ issuer: 'nope', credentialType: 'KYC' }])).toThrow(/issuer/);
  });
});

describe('3. CredentialIDs en el pago de la orden', () => {
  const payment = { TransactionType: 'Payment', Account: ISSUER, Destination: ANCHOR, Amount: '1' };

  it('adjunta los IDs en mayúsculas', () => {
    const tx = withCredentialIds(payment, [ID.toLowerCase()]);
    expect(tx.CredentialIDs).toEqual([ID]);
    expect(tx.Destination).toBe(ANCHOR);
  });

  it('una lista vacía deja el Payment tal cual (sin título, sin campo)', () => {
    const tx = withCredentialIds(payment, []);
    expect(tx).toEqual(payment);
    expect((tx as Record<string, unknown>).CredentialIDs).toBeUndefined();
  });

  it('rechaza IDs que no son 64 hex, repetidos, o más de 8', () => {
    expect(() => withCredentialIds(payment, ['zz'])).toThrow(/64 hex/);
    expect(() => withCredentialIds(payment, [ID, ID])).toThrow(/repetidos/);
    expect(() => withCredentialIds(payment, Array.from({ length: 9 }, (_, i) => i.toString(16).padStart(64, '0')))).toThrow(
      /como mucho/,
    );
  });
});

describe('credentialTypeToHex', () => {
  it('texto → hex mayúsculas; hex → normalizado; vacío y > 64 bytes rechazados', () => {
    expect(credentialTypeToHex('KYC')).toBe('4B5943');
    expect(credentialTypeToHex('4b5943')).toBe('4B5943');
    expect(() => credentialTypeToHex('')).toThrow(/vacío/);
    expect(() => credentialTypeToHex('x'.repeat(65))).toThrow(/64 bytes/);
  });
});
