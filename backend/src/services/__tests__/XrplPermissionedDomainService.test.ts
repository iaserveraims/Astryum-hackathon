/**
 * XLS-80 Permissioned Domains — el perímetro regulado del exchange, gateado por
 * la credencial KYC. Lógica pura: composición sin firmar, sin red.
 */
import {
  composePermissionedDomainSet,
  composePermissionedDomainDelete,
  PermissionedDomainError,
  MAX_ACCEPTED_CREDENTIALS,
} from '../XrplPermissionedDomainService';

const EXCHANGE = 'rEXCHANGEowner11111111111111111111';
const ISSUER = 'rKYCissuer2222222222222222222222222';
const DOMAIN = 'A'.repeat(64);

describe('PermissionedDomainSet — perímetro regulado gateado por KYC', () => {
  it('compone la creación aceptando la credencial KYC del exchange (sin DomainID)', () => {
    const tx = composePermissionedDomainSet({ owner: EXCHANGE, acceptedCredentials: [{ issuer: ISSUER }] });
    expect(tx.TransactionType).toBe('PermissionedDomainSet');
    expect(tx.Account).toBe(EXCHANGE); // el exchange firma
    expect(tx.DomainID).toBeUndefined(); // crear
    expect(tx.AcceptedCredentials).toHaveLength(1);
    // KYC → hex mayúsculas, en la forma anidada de XLS-80
    expect(tx.AcceptedCredentials[0]).toEqual({ Credential: { Issuer: ISSUER, CredentialType: '4B5943' } });
  });

  it('con DomainID compone una actualización', () => {
    const tx = composePermissionedDomainSet({ owner: EXCHANGE, acceptedCredentials: [{ issuer: ISSUER }], domainID: DOMAIN });
    expect(tx.DomainID).toBe(DOMAIN);
  });

  it('rechaza un dueño inválido, sin credenciales, y más de 10', () => {
    expect(() => composePermissionedDomainSet({ owner: 'nope', acceptedCredentials: [{ issuer: ISSUER }] }))
      .toThrow(PermissionedDomainError);
    expect(() => composePermissionedDomainSet({ owner: EXCHANGE, acceptedCredentials: [] }))
      .toThrow(PermissionedDomainError);
    const eleven = Array.from({ length: MAX_ACCEPTED_CREDENTIALS + 1 }, () => ({ issuer: ISSUER }));
    expect(() => composePermissionedDomainSet({ owner: EXCHANGE, acceptedCredentials: eleven }))
      .toThrow(PermissionedDomainError);
  });

  it('rechaza un DomainID que no es un hash de 64 hex', () => {
    expect(() => composePermissionedDomainSet({ owner: EXCHANGE, acceptedCredentials: [{ issuer: ISSUER }], domainID: 'short' }))
      .toThrow(PermissionedDomainError);
  });

  it('delete exige un DomainID válido y lo firma el dueño', () => {
    const tx = composePermissionedDomainDelete({ owner: EXCHANGE, domainID: DOMAIN });
    expect(tx).toEqual({ TransactionType: 'PermissionedDomainDelete', Account: EXCHANGE, DomainID: DOMAIN });
    expect(() => composePermissionedDomainDelete({ owner: EXCHANGE, domainID: 'nope' })).toThrow(PermissionedDomainError);
  });
});
