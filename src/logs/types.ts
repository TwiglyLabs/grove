/**
 * Logs slice types.
 */

/** A file-based log entry for a service */
export interface LogEntry {
  service: string;
  type: 'port-forward' | 'frontend';
  content: string;
}
