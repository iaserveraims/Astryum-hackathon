import { NextRequest, NextResponse } from 'next/server';

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

    const upstream = await fetch('https://xumm.app/api/v1/platform/payload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-API-Secret': apiSecret,
      },
      body: JSON.stringify(body && Object.keys(body).length ? body : {
        txjson: { TransactionType: 'SignIn' },
        options: { submit: false, expire: 300 },
      }),
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream error', status: upstream.status, data },
        { status: upstream.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

