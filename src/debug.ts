export function debugLog(message: string, extra?: unknown): void {
  if (extra !== undefined) {
    console.log(`[saucership] ${message}`, extra);
  } else {
    console.log(`[saucership] ${message}`);
  }
}
