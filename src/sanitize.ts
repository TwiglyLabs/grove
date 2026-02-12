const MAX_SANITIZED_LENGTH = 50;

/**
 * Collision-resistant branch name sanitization.
 *
 * Key design: slashes become `--` (double hyphen) so that
 * `feat/auth-fix` and `feat-auth-fix` produce distinct outputs.
 *
 * Rules:
 * - Slashes → `--`
 * - Dots, underscores, and other non-alphanumeric chars → `-`
 * - Lowercase
 * - Collapse consecutive hyphens (except the `--` from slashes)
 * - Max 50 chars, strip leading/trailing hyphens
 */
export function sanitizeBranchName(branch: string): string {
  if (!branch) return '';

  // Step 1: Lowercase
  let result = branch.toLowerCase();

  // Step 2: Replace slashes with a placeholder that won't be collapsed
  // Use a sentinel that can't appear in branch names
  const SLASH_SENTINEL = '\x00';
  result = result.replace(/\//g, SLASH_SENTINEL);

  // Step 3: Replace non-alphanumeric chars (except sentinel) with hyphens
  result = result.replace(/[^a-z0-9\x00]/g, '-');

  // Step 4: Collapse consecutive hyphens (but not sentinels)
  result = result.replace(/-{2,}/g, '-');

  // Step 5: Replace sentinels with double hyphens
  result = result.replace(/\x00/g, '--');

  // Step 6: Clean up hyphens around double-hyphens (e.g., `---` from `-/` or `/-`)
  // A hyphen directly adjacent to `--` is redundant
  result = result.replace(/-?(--)-?/g, '$1');

  // Step 7: Strip leading and trailing hyphens
  result = result.replace(/^-+|-+$/g, '');

  // Step 8: Truncate
  if (result.length > MAX_SANITIZED_LENGTH) {
    result = result.slice(0, MAX_SANITIZED_LENGTH);
    // Strip trailing hyphens after truncation
    result = result.replace(/-+$/, '');
  }

  return result;
}
