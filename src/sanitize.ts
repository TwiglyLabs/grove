export function sanitizeBranchName(branch: string): string {
  return branch
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase()
    .substring(0, 63);
}
