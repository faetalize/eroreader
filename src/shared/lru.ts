// Map with a size cap that drops the least recently used entry first.
export class Lru<K, V> {
  readonly #map = new Map<K, V>();
  readonly #max: number;

  constructor(max: number) {
    this.#max = max;
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: K): V | undefined {
    const value = this.#map.get(key);
    if (value !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value!);
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  delete(key: K): void {
    this.#map.delete(key);
  }
}
