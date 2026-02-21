/**
 * Simulator slice types.
 */

/** Normalized simulator info returned by the public API */
export interface SimulatorInfo {
  udid: string;
  name: string;
  status: 'booted' | 'shutdown' | 'unknown';
  basedOn: string;
}
