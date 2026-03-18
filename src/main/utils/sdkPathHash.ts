/** Match the SDK's project-path hashing (Cx function in cli.js) */
export function sdkPathHash(p: string): string {
  const hash = p.replace(/[^a-zA-Z0-9]/g, '-')
  if (hash.length <= 200) return hash
  // SDK truncates long paths and appends a simple hash
  let h = 0
  for (let i = 0; i < p.length; i++) {
    h = (h << 5) - h + p.charCodeAt(i)
    h |= 0
  }
  return `${hash.slice(0, 200)}-${Math.abs(h).toString(36)}`
}
