import { NextRequest, NextResponse } from 'next/server';
import { rememberPushToken } from '../../pushTokens';

export async function GET(
  req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  try {
    const { uuid } = params;

    // Server-only credentials — NEXT_PUBLIC_* is never read here.
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

    const upstream = await fetch(`https://xumm.app/api/v1/platform/payload/${uuid}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'X-API-Secret': apiSecret,
      },
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream error', status: upstream.status, data },
        { status: upstream.status }
      );
    }

    // A signature is also when Xaman hands us the token that lets the NEXT
    // request reach this person as a push instead of a QR. Capture it here,
    // server-side: it never travels to the browser. Fire-and-forget — a lost
    // token costs a QR, never a signature.
    const d = data as {
      meta?: { signed?: boolean };
      application?: { issued_user_token?: string };
      response?: { account?: string; signer?: string };
    } | null;
    if (d?.meta?.signed && d.application?.issued_user_token) {
      void rememberPushToken(
        d.response?.signer || d.response?.account,
        d.application.issued_user_token,
        req.headers.get('authorization'),
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { uuid: string } }
) {
  try {
    const { uuid } = params;

    // Server-only credentials — NEXT_PUBLIC_* is never read here.
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

    const upstream = await fetch(`https://xumm.app/api/v1/platform/payload/${uuid}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': apiKey,
        'X-API-Secret': apiSecret,
      },
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

