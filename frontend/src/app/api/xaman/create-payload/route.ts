import { NextRequest, NextResponse } from 'next/server';
import { lookupPushToken } from '../pushTokens';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Server-only credentials. NEXT_PUBLIC_* is never read here — secrets must
    // not be exposed to the client bundle.
    const apiKey = process.env.XAMAN_API_KEY;
    const apiSecret = process.env.XAMAN_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        {
          error: 'Xaman API keys not configured',
          details: {
            missing: [!apiKey && 'XAMAN_API_KEY', !apiSecret && 'XAMAN_API_SECRET'].filter(Boolean),
          },
        },
        { status: 400 }
      );
    }

    // PUSH instead of QR: if this signer has already signed something of ours,
    // Xaman gave us a token that delivers the request straight to their phone.
    // Read it server-side and inject it — the token never reaches the browser.
    // `pushPayloadFor` is the signer we are asking (the council flow sends it);
    // without a token the payload is identical and the QR is the way in.
    const requested = (body ?? {}) as Record<string, unknown> & { pushPayloadFor?: unknown };
    const signerAddress = typeof requested.pushPayloadFor === 'string' ? requested.pushPayloadFor : undefined;
    delete requested.pushPayloadFor; // ours, not Xaman's — never forward it
    const userToken = await lookupPushToken(signerAddress, req.headers.get('authorization'));

    const upstream = await fetch('https://xumm.app/api/v1/platform/payload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-API-Secret': apiSecret,
      },
      body: JSON.stringify(
        requested && Object.keys(requested).length
          ? { ...requested, ...(userToken ? { user_token: userToken } : {}) }
          : {
              txjson: { TransactionType: 'SignIn' },
              options: { submit: false, expire: 300 },
            },
      ),
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      // Xaman answers with its own {error:{code,reference}} envelope. A refusal
      // here breaks signing, so name the cause instead of bubbling a bare status
      // the browser console has to decode (2026-08-03: "Xaman payload failed
      // (401)" cost a debugging session for what was a documented permission).
      const err = (data as { error?: { code?: unknown; reference?: unknown } } | null)?.error;
      const xamanCode = typeof err?.code === 'number' ? err.code : null;
      const txType = (body as { txjson?: { TransactionType?: unknown } })?.txjson?.TransactionType;

      // 1217 = "No permission to create this type of sign request". Xaman gates
      // account-security transaction types (SignerListSet, AccountSet flags,
      // SetRegularKey…) per app: a Payment goes through while the very tx that
      // changes who governs the account does not. It is granted by Xaman
      // support, never by anything we can change in this code.
      const noPermission = xamanCode === 1217;
      const message = noPermission
        ? `Xaman does not allow this app to create ${typeof txType === 'string' ? `${txType} ` : ''}sign requests. Account-security transaction types are granted per app by Xaman support (in-app). Meanwhile the quorum can sign this transaction with its own multisign tool — see "Prefer your own multisign tool?".`
        : upstream.status === 401 || upstream.status === 403
          ? 'Xaman refused the request (auth). Check XAMAN_API_KEY / XAMAN_API_SECRET against the Xaman Developer Console — the pair may have been rotated or the app suspended.'
          : 'Upstream error';

      return NextResponse.json(
        {
          error: message,
          status: upstream.status,
          xamanCode,
          reference: err?.reference ?? null,
          data,
        },
        { status: upstream.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

