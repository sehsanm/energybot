let cached: string | null = null;
export function setCsrf(t: string | null) { cached = t; }
export function getCsrf(): string | null { return cached; }
