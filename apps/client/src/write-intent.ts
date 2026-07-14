export type IdempotencyKeyFactory = () => string;

export function createIdempotencyKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function stableSignature(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSignature).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSignature(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export class WriteIntentRegistry {
  readonly #createKey: IdempotencyKeyFactory;
  readonly #keys = new Map<string, string>();

  constructor(createKey: IdempotencyKeyFactory = createIdempotencyKey) {
    this.#createKey = createKey;
  }

  keyFor(payload: unknown): string {
    const signature = stableSignature(payload);
    const existing = this.#keys.get(signature);
    if (existing) return existing;
    const key = this.#createKey();
    this.#keys.set(signature, key);
    return key;
  }

  complete(payload: unknown): void {
    this.#keys.delete(stableSignature(payload));
  }
}
