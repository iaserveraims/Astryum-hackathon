import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

/**
 * Validación de dirección clásica XRPL (base58 con alfabeto ripple + doble
 * SHA-256 de checksum), escrita aquí a propósito: es la única ruta de API que
 * necesitaba `xrpl` en el servidor, y meter ese paquete entero en el bundle
 * de una ruta por veinte líneas es lo que podía romper el build sin que el
 * chip dijera nada (caería a la X en silencio).
 */
const RIPPLE_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
function isValidClassicAddress(address: string): boolean {
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return false;
  let n = BigInt(0);
  for (const ch of address) {
    const i = RIPPLE_ALPHABET.indexOf(ch);
    if (i < 0) return false;
    n = n * BigInt(58) + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let lead = 0;
  for (const ch of address) {
    if (ch === 'r') lead++;
    else break;
  }
  const bytes = Buffer.concat([Buffer.alloc(lead, 0), Buffer.from(hex, 'hex')]);
  // AccountID = 0x00 + 20 bytes + 4 de checksum = 25 bytes
  if (bytes.length !== 25 || bytes[0] !== 0x00) return false;
  const payload = bytes.subarray(0, 21);
  const check = bytes.subarray(21);
  const h = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest();
  return h.subarray(0, 4).equals(check);
}

/**
 * /api/xaman/avatar/{address}.png — el avatar público de una cuenta XRPL tal
 * como lo sirve Xaman (su hashicon, o la imagen que puso), PEDIDO DESDE
 * NUESTRO SERVIDOR.
 */
export async function GET(_req: NextRequest, { params }: { params: { address: string } }) {
  // El chip pide la ruta SIN «.png» (ver XamanAvatar); se sigue admitiendo con
  // extensión por si alguien la enlaza así.
  const address = (params.address ?? '').replace(/\.png$/i, '');
  const refuse = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!isValidClassicAddress(address)) return refuse();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const upstream = await fetch(`https://xumm.app/avatar/${address}.png`, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { accept: 'image/png,image/*;q=0.8' },
    });
    const type = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !type.startsWith('image/')) return refuse();
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    // Sin respuesta (caído, lento) el chip cae a la marca del proveedor.
    return refuse();
  } finally {
    clearTimeout(timer);
  }
}
