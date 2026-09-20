'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, Check, ChevronRight, Trash2, User, Users } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useT } from '../../i18n/LanguageProvider';
import { Card, GhostButton, PrimaryButton, SectionTitle } from '../ui/primitives';

// Downscale an uploaded image to a small square data-URL so the avatar stays tiny
// (~15KB, well under the server's 150KB cap). Cover-crop to 160px, re-encode as
// JPEG. It is stored on the account (PATCH /auth/profile) plus a device-local copy.
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.85);
}

export default function ProfileCard() {
  const { t } = useT();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const address = user?.address;
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'dev';
  const [name, setName] = useState(user?.username ?? '');
  const [avatar, setAvatar] = useState(user?.avatar ?? '');
  // Which fields THIS session actually touched. Only touched fields travel in
  // the PATCH — an untouched '' must never clear the account avatar (the old
  // save() always sent both fields, so opening Settings on a fresh device
  // before /auth/me hydrated and hitting Save wiped the photo server-side).
  const [touched, setTouched] = useState({ name: false, avatar: false });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // /auth/me hydration lands AFTER this card mounts on a fresh device — follow
  // the account value for any field the user is not editing right now.
  useEffect(() => {
    if (!touched.name) setName(user?.username ?? '');
    if (!touched.avatar) setAvatar(user?.avatar ?? '');
  }, [user?.username, user?.avatar, touched.name, touched.avatar]);

  const dirty =
    (touched.name && name.trim() !== (user?.username ?? '')) ||
    (touched.avatar && avatar !== (user?.avatar ?? ''));
  const initials = (name.trim() || short).slice(0, 2).toUpperCase();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      setAvatar(await toAvatarDataUrl(file));
      setTouched((prev) => ({ ...prev, avatar: true }));
    } catch {
      /* ignore unreadable image */
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!touched.name && !touched.avatar) return;
    const patch: { username?: string; avatar?: string } = {};
    if (touched.name) patch.username = name;
    if (touched.avatar) patch.avatar = avatar;
    const accountSynced = await updateProfile(patch);
    setTouched({ name: false, avatar: false });
    setLocalOnly(!accountSynced);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <Card spotlight className="md:col-span-2">
      <SectionTitle hint={t('How you appear across Astryum. Saved to your account.')}>
        <span className="inline-flex items-center gap-2">
          <User className="w-4 h-4" strokeWidth={1.5} /> {t('Profile')}
        </span>
      </SectionTitle>

      <div className="flex flex-col sm:flex-row sm:items-center gap-5">
        {/* avatar — a small identity instrument: a gold halo warms on hover */}
        <div className="flex items-center gap-3">
          <div className="relative group/avatar">
            {/* the halo — decorative, behind the mark, never intercepts clicks */}
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-1.5 rounded-full bg-volt/10 blur-md opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-500 z-0"
            />
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                className="relative z-[1] w-16 h-16 rounded-full object-cover ring-1 ring-ink/10 group-hover/avatar:ring-volt/30 transition-all duration-300"
              />
            ) : (
              <div className="relative z-[1] w-16 h-16 rounded-full bg-gradient-to-br from-volt to-[hsl(var(--volt)/0.45)] text-volt-ink flex items-center justify-center text-lg font-bold ring-1 ring-ink/10 group-hover/avatar:ring-volt/30 transition-all duration-300">
                {initials}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="absolute z-[2] -bottom-1 -right-1 w-7 h-7 rounded-full bg-surface-3 border border-ink/15 text-ink/80 hover:text-ink hover:border-ink/30 grid place-items-center transition-colors disabled:opacity-50"
              aria-label={t('Change photo')}
              title={t('Change photo')}
            >
              <Camera className="w-3.5 h-3.5" strokeWidth={1.6} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          </div>
          {avatar ? (
            <button
              onClick={() => {
                setAvatar('');
                setTouched((prev) => ({ ...prev, avatar: true }));
              }}
              className="inline-flex items-center gap-1.5 text-xs text-ink/45 hover:text-red-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.6} /> {t('Remove')}
            </button>
          ) : null}
        </div>

        {/* name */}
        <div className="flex-1 min-w-0">
          <label className="block text-xs text-ink/45 mb-1.5">{t('Display name')}</label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouched((prev) => ({ ...prev, name: true }));
            }}
            maxLength={32}
            placeholder={short}
            className="w-full rounded-xl border border-ink/10 bg-ink/[0.03] px-3.5 py-2.5 text-sm text-ink placeholder-ink/25 focus:outline-none focus:border-volt/40 transition-colors"
          />
          <div className="mt-1.5 text-[11px] text-ink/35 font-mono truncate">{address ?? t('Not connected')}</div>
        </div>
      </div>

      {/* La comunidad de gestores: desde el perfil se llega a la
          comunidad, y desde ella a cualquier otro perfil. No vive en el sidebar. */}
      <div className="mt-4 border-t border-ink/5 pt-3">
        <Link href="/app/community" className="inline-flex items-center gap-1.5 text-xs font-medium text-volt hover:underline">
          <Users className="w-3.5 h-3.5" strokeWidth={1.8} /> {t('Community of managers')} <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="flex items-center justify-end gap-2 mt-5">
        {localOnly ? (
          <span className="mr-auto text-[11px] text-amber-300/80">
            {t("Saved on this device — the account copy didn't update.")}
          </span>
        ) : null}
        {dirty ? (
          <GhostButton
            onClick={() => {
              setName(user?.username ?? '');
              setAvatar(user?.avatar ?? '');
              setTouched({ name: false, avatar: false });
            }}
          >
            {t('Cancel')}
          </GhostButton>
        ) : null}
        <PrimaryButton onClick={save} disabled={!dirty && !saved}>
          {saved ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="w-4 h-4" strokeWidth={2} /> {t('Saved')}
            </span>
          ) : (
            t('Save profile')
          )}
        </PrimaryButton>
      </div>
    </Card>
  );
}
