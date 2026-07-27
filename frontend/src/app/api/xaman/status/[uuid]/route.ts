import { NextRequest, NextResponse } from 'next/server';

export async function GET(
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

