"use client";

import { useChainCapabilities, type ChainCapabilityRow } from "../../hooks/useChainCapabilities";

const CAPS: Array<{ key: keyof ChainCapabilityRow; label: string }> = [
  { key: "discovery", label: "Discover" },
  { key: "balances", label: "Balances" },
  { key: "positions", label: "Positions" },
  { key: "prepare", label: "Prepare" },
  { key: "sign", label: "Sign" },
  { key: "reconcile", label: "Reconcile" },
];

/**
 * Renders the honest per-chain capability matrix (audit P2-3). A ✓ means the
 * capability is actually wired for that chain — never a blanket "supported".
 */
export function ChainCapabilitiesPanel() {
  const { chains, loading, error } = useChainCapabilities();

  if (loading) return <div className="text-sm text-white/50">Loading supported chains…</div>;
  if (error) return <div className="text-sm text-red-400">Couldn&apos;t load chain capabilities.</div>;

  const rows = Object.values(chains)
    .filter((c) => c.enabled)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  if (rows.length === 0) return <div className="text-sm text-white/50">No chains available.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-white/50">
            <th className="py-2 pr-4">Chain</th>
            {CAPS.map((c) => (
              <th key={c.key} className="px-2 text-center font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.name} className="border-t border-white/10">
              <td className="py-2 pr-4 font-medium">{c.name}</td>
              {CAPS.map((cap) => (
                <td key={cap.key} className="px-2 text-center">
                  {c[cap.key] ? (
                    <span className="text-emerald-400" aria-label="supported">✓</span>
                  ) : (
                    <span className="text-white/20" aria-label="not supported">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-white/30">
        Honest support frontier — a ✓ means that capability is actually wired for the chain, not just
        &quot;enabled&quot;. Execution-side capabilities on Flare depend on FLARE_DEFI_ENABLED.
      </p>
    </div>
  );
}
