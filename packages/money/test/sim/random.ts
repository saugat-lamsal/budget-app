// Random numbers that come out the same every time for the same seed, so a
// simulated life can be played again exactly (the sfc32 generator). Whole
// numbers only: amounts in cents come straight from int().
export class Random {
  #a = 0x9e3779b9;
  #b = 0x243f6a88;
  #c = 0xb7e15162;
  #d: number;

  constructor(seed: number) {
    this.#d = seed >>> 0;
    for (let i = 0; i < 15; i++) this.next();
  }

  // A whole number from 0 to 4,294,967,295.
  next(): number {
    const t = (((this.#a + this.#b) | 0) + this.#d) | 0;
    this.#d = (this.#d + 1) | 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) | 0;
    this.#c = (this.#c << 21) | (this.#c >>> 11);
    this.#c = (this.#c + t) | 0;
    return t >>> 0;
  }

  // A whole number from min to max, both included.
  int(min: number, max: number): number {
    return min + (this.next() % (max - min + 1));
  }

  // True about `times` in every `outOf`.
  chance(times: number, outOf: number): boolean {
    return this.next() % outOf < times;
  }

  pick<T>(list: readonly T[]): T {
    const item = list[this.next() % list.length];
    if (item === undefined) throw new Error('picked from an empty list');
    return item;
  }
}
