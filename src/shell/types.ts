/**
 * Shell slice types.
 */

/** kubectl exec command parts — consumer controls the PTY */
export interface ShellCommand {
  command: string;
  args: string[];
  namespace: string;
}
