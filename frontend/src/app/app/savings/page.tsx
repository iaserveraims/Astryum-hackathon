import { redirect } from 'next/navigation';

// Savings lives INSIDE Earn since the 2026-07-12 UI reorg, and the door was
// renamed to Movements (send/receive + savings): the panel now lives at
// components/movements/MovementsPanel and renders as the `movements` view of
// /app/asset-production. This route only redirects so old links, bookmarks
// and ⌘K entries keep working.
export default function SavingsRedirect() {
  redirect('/app/asset-production?view=movements');
}
