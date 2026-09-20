/**
 * resumeNotice — what the one-time toast says when a ceremony lands beyond
 * its first station because the ledger already had the earlier ones done.
 *
 * The FACT (this station is done, this is what was read) now lives inside
 * the station (StationDoneStrip); the EVENT (you were resumed further in) is
 * a toast, once per opening. Pure: the hook in StationDoneNotice wires it.
 */

export interface ResumeStation {
  label: string;
  done: boolean;
}

export interface ResumeSummary {
  /** The station the ceremony landed on. */
  label: string;
  /** How many stations before it were already done. */
  doneBefore: number;
}

/**
 * null = nothing to say: landed on the first station, or nothing before the
 * landing station was done (a landing that skipped nothing is not a resume).
 */
export function resumeSummary(landed: number | null, stations: readonly ResumeStation[]): ResumeSummary | null {
  if (landed === null || landed <= 0 || landed >= stations.length) return null;
  const doneBefore = stations.slice(0, landed).filter((s) => s.done).length;
  if (doneBefore === 0) return null;
  return { label: stations[landed].label, doneBefore };
}
