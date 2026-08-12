import { safeErrorDetail } from '../safeError';

// Los errores de ethers v6 arrastran en `message` el objeto info completo
// (requestUrl con la key de Alchemy incrustada + responseBody). Este test fija
// que NADA de eso llega al body de un 500: la parte descriptiva sí, la key no.
describe('safeErrorDetail', () => {
  const KEY = 'aBcD1234efGh5678ijKl';

  it('corta el mensaje estilo ethers y enmascara la key de la URL', () => {
    const ethersStyle =
      `server response 503 Service Unavailable (request={ }, response={ }, error=null, ` +
      `info={ "requestUrl": "https://eth-mainnet.g.alchemy.com/v2/${KEY}", ` +
      `"responseBody": "upstream connect error" }, code=SERVER_ERROR, version=6.13.0)`;
    const out = safeErrorDetail(new Error(ethersStyle));
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('responseBody');
    expect(out).toContain('server response 503 Service Unavailable');
  });

  it('enmascara /v2/<key>, apikey= y userinfo aunque no haya marcadores ethers', () => {
    expect(safeErrorDetail(new Error(`could not reach https://eth-mainnet.g.alchemy.com/v2/${KEY}`)))
      .toContain('/v2/***');
    expect(safeErrorDetail(new Error(`fetch failed: https://api.example.com/x?apikey=${KEY}&a=1`)))
      .toContain('apikey=***');
    expect(safeErrorDetail(new Error('bad gateway at https://user:s3cret@rpc.example.com/')))
      .toContain('https://***:***@rpc.example.com');
    expect(safeErrorDetail(new Error('bad gateway at https://user:s3cret@rpc.example.com/')))
      .not.toContain('s3cret');
  });

  it('deja pasar mensajes limpios y trunca a ~300 caracteres', () => {
    expect(safeErrorDetail(new Error('wallet_not_registered'))).toBe('wallet_not_registered');
    const long = safeErrorDetail(new Error('x'.repeat(500)));
    expect(long.length).toBeLessThanOrEqual(301);
  });

  it('tolera valores no-Error', () => {
    expect(safeErrorDetail('plain string')).toBe('plain string');
    expect(safeErrorDetail(undefined)).toBe('unknown_error');
    expect(safeErrorDetail(null)).toBe('unknown_error');
  });
});
