export type UnauthorizedListener = () => void;

export class UnauthorizedChannel {
  #listener: UnauthorizedListener | null = null;
  #pending = false;

  notify(): void {
    if (this.#listener) {
      this.#listener();
      return;
    }
    this.#pending = true;
  }

  subscribe(listener: UnauthorizedListener): () => void {
    this.#listener = listener;
    if (this.#pending) {
      this.#pending = false;
      listener();
    }

    return () => {
      if (this.#listener === listener) this.#listener = null;
    };
  }
}

export const unauthorizedChannel = new UnauthorizedChannel();
