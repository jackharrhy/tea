const CACHE_NAME = "ref-board-images-v1";

class BoardImages {
  private worker: Worker | null = null;
  private urls = new Map<string, string>();
  private waiting = new Map<string, Set<HTMLImageElement>>();
  private requested = new Set<string>();
  private detail = new WeakMap<HTMLImageElement, boolean>();

  constructor() {
    try {
      this.worker = new Worker("/assets/thumb-worker.js");
      this.worker.addEventListener(
        "message",
        (event: MessageEvent<{ source: string; image: Blob | null }>) => {
          const { source, image } = event.data;
          this.requested.delete(source);
          const group = this.waiting.get(source);
          if (!image || !group?.size) return;
          const url = this.saveUrl(source, image);
          for (const element of group) {
            if (element.isConnected) this.show(element, url);
          }
        },
      );
    } catch {}
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) return;
      this.worker?.terminate();
      for (const url of this.urls.values()) URL.revokeObjectURL(url);
    });
  }

  load(element: HTMLImageElement, source: string): void {
    element.dataset.original = source;
    if (!/^\/(?:media|previews)\//.test(source) || !("caches" in window)) {
      element.src = source;
      return;
    }
    let group = this.waiting.get(source);
    if (!group) {
      group = new Set();
      this.waiting.set(source, group);
    }
    group.add(element);
    const known = this.urls.get(source);
    if (known) {
      this.show(element, known);
      return;
    }
    const fallback = window.setTimeout(() => this.show(element, source), 80);
    void caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(source))
      .then(async (cached) => {
        if (!element.isConnected) return;
        if (cached) {
          const url = this.saveUrl(source, await cached.blob());
          this.show(element, url);
        } else {
          this.show(element, source);
          if (this.worker && !this.requested.has(source)) {
            this.requested.add(source);
            // Worker.postMessage does not take a target origin.
            // eslint-disable-next-line unicorn/require-post-message-target-origin
            this.worker.postMessage(source);
          }
        }
      })
      .catch(() => this.show(element, source))
      .finally(() => clearTimeout(fallback));
  }

  setDetail(element: HTMLImageElement, value: boolean): void {
    this.detail.set(element, value);
    const source = element.dataset.original;
    if (source) this.show(element, this.urls.get(source) ?? source);
  }

  forget(element: HTMLImageElement): void {
    const source = element.dataset.original;
    if (!source) return;
    const group = this.waiting.get(source);
    group?.delete(element);
    if (group?.size) return;
    this.waiting.delete(source);
    const url = this.urls.get(source);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(source);
    if (/^\/(?:media|previews)\//.test(source) && "caches" in window)
      void caches
        .open(CACHE_NAME)
        .then((cache) => cache.delete(source))
        .catch(() => {});
  }

  private saveUrl(source: string, image: Blob): string {
    const existing = this.urls.get(source);
    if (existing) return existing;
    const url = URL.createObjectURL(image);
    this.urls.set(source, url);
    return url;
  }

  private show(element: HTMLImageElement, preview: string): void {
    if (!element.isConnected) return;
    const desired = this.detail.get(element)
      ? element.dataset.original!
      : preview;
    if (element.getAttribute("src") !== desired) element.src = desired;
  }
}

export const boardImages = new BoardImages();
