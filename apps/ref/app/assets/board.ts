import type {
  BoardItem,
  BoardOperation,
  BoardServerFrame,
  BoardSnapshot,
  LinkPreview,
} from "../data/protocol.ts";
import {
  displayFilename,
  displaySiteName,
  renderItemInspector,
} from "./inspector.ts";
import { boardImages } from "./board-images.ts";

const app = document.querySelector<HTMLElement>("#board-app");
if (!app) throw new Error("Board root is missing");
const boardId = app.dataset.boardId!;
const viewport = required<HTMLElement>("#viewport");
const world = required<HTMLElement>("#world");
const empty = required<HTMLElement>("#empty-state");
const fileInput = required<HTMLInputElement>("#file-input");
const inspector = required<HTMLElement>("#inspector-content");
const connection = required<HTMLElement>("#connection");
const inspectorPanel = required<HTMLElement>("#inspector");
const zoomLabel = required<HTMLElement>("#zoom-label");
const toastElement = required<HTMLElement>("#toast");
const linkMenu = required<HTMLDetailsElement>("#link-menu");
const linkForm = required<HTMLFormElement>("#link-form");
const linkInput = required<HTMLInputElement>("#link-url");

type Point = { x: number; y: number };
type Drag =
  | { kind: "pan"; start: Point; startOffset: Point; moved: boolean }
  | {
      kind: "move" | "resize" | "rotate";
      start: Point;
      original: BoardItem;
      moved: boolean;
    };
const items = new Map<string, BoardItem>();
const elements = new Map<string, HTMLElement>();
const pending = new Map<string, BoardOperation>();
const imageObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target as HTMLElement;
      const image = element.querySelector<HTMLImageElement>("img[data-src]");
      if (image?.dataset.src) {
        boardImages.load(image, image.dataset.src);
        delete image.dataset.src;
      }
      imageObserver.unobserve(element);
    }
  },
  { root: viewport, rootMargin: "80px" },
);
let socket: WebSocket | null = null;
let reconnectTimer = 0;
let reconnectDelay = 500;
let heartbeatTimer = 0;
let lastHeard = 0;
let selectedId: string | null = null;
let spaceHeld = false;
let drag: Drag | null = null;
let offsetX = 0;
let offsetY = 0;
let scale = 1;
let didInitialFit = false;
let sequence = 0;
let toastTimer = 0;
let viewFrame = 0;
let zoomLabelTimer = 0;
let lastZoomLabelAt = -Infinity;
let imageDetailTimer = 0;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function setConnection(value: "online" | "offline" | "connecting") {
  connection.className = `connection ${value}`;
  required<HTMLElement>(".connection-text").textContent =
    value === "online"
      ? "Live"
      : value === "offline"
        ? "Reconnecting"
        : "Connecting";
}

function toast(message: string) {
  toastElement.textContent = message;
  toastElement.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => toastElement.classList.remove("visible"),
    3400,
  );
}

function connect() {
  clearTimeout(reconnectTimer);
  clearInterval(heartbeatTimer);
  setConnection("connecting");
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${protocol}//${location.host}/api/boards/${boardId}/ws`,
  );
  socket = ws;
  ws.addEventListener("open", () => {
    if (socket !== ws) return;
    reconnectDelay = 500;
    lastHeard = Date.now();
    setConnection("online");
    heartbeatTimer = window.setInterval(() => {
      if (Date.now() - lastHeard > 12_000) {
        if (socket === ws) {
          socket = null;
          clearInterval(heartbeatTimer);
          setConnection("offline");
          void scheduleReconnect();
        }
        if (ws.readyState === WebSocket.OPEN)
          ws.close(4000, "Connection timed out");
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "ping" }));
    }, 4_000);
  });
  ws.addEventListener("message", (event) => {
    if (socket !== ws) return;
    lastHeard = Date.now();
    try {
      receive(JSON.parse(String(event.data)) as BoardServerFrame);
    } catch (error) {
      console.error("Could not read board update", error);
    }
  });
  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    clearInterval(heartbeatTimer);
    socket = null;
    setConnection("offline");
    void scheduleReconnect();
  });
  ws.addEventListener("error", () => ws.close());
}

async function scheduleReconnect() {
  try {
    const response = await fetch(`/api/boards/${boardId}/snapshot`, {
      cache: "no-store",
    });
    if (response.status === 404 || response.status === 401) {
      required<HTMLElement>(".connection-text").textContent = "Access ended";
      toast("Your board access ended. Return to your boards.");
      return;
    }
  } catch {
    /* network may recover */
  }
  reconnectTimer = window.setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.8, 8000);
}

function receive(frame: BoardServerFrame) {
  if (frame.type === "ready") {
    loadSnapshot(frame.snapshot);
    if (!didInitialFit) {
      didInitialFit = true;
      fitBoard();
      if (items.size > 12 && scale < 0.65)
        zoomAt(0.65 / scale, {
          x: viewport.clientWidth / 2,
          y: viewport.clientHeight / 2,
        });
      requestAnimationFrame(() => {
        for (const element of elements.values()) observeImage(element);
      });
    }
    for (const operation of pending.values())
      send({ type: "operation", operation });
    return;
  }
  if (frame.type === "pong") return;
  if (frame.type === "applied") {
    pending.delete(frame.operationId);
    if (frame.sequence <= sequence) return;
    if (frame.sequence > sequence + 1) {
      void refreshSnapshot();
      return;
    }
    sequence = frame.sequence;
    if (frame.item) {
      items.set(frame.itemId, frame.item);
      renderItem(frame.item);
    } else {
      items.delete(frame.itemId);
      removeElement(frame.itemId);
      if (selectedId === frame.itemId) selectedId = null;
    }
    empty.hidden = items.size > 0;
    if (selectedId === frame.itemId || !frame.item) renderInspector();
    return;
  }
  if (frame.type === "rejected") {
    pending.delete(frame.operationId);
    loadSnapshot(frame.snapshot);
    toast(frame.reason);
    return;
  }
  if (frame.type === "error") {
    toast(frame.message);
    if (frame.message.includes("Session ended"))
      socket?.close(4001, "Session ended");
  }
}

async function refreshSnapshot() {
  try {
    const response = await fetch(`/api/boards/${boardId}/snapshot`);
    if (response.ok) loadSnapshot((await response.json()) as BoardSnapshot);
  } catch {
    /* reconnect provides a fresh snapshot */
  }
}

function loadSnapshot(snapshot: BoardSnapshot) {
  if (snapshot.sequence < sequence) return;
  sequence = snapshot.sequence;
  items.clear();
  for (const item of snapshot.items) items.set(item.id, item);
  if (selectedId && !items.has(selectedId)) selectedId = null;
  renderItems();
}

function send(frame: unknown): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(frame));
  return true;
}

function submit(operation: BoardOperation) {
  pending.set(operation.operationId, operation);
  if (!send({ type: "operation", operation }))
    toast("Working offline. Your change will sync when reconnected.");
}

function positionElement(element: HTMLElement, item: BoardItem) {
  const image =
    item.link && element.querySelector<HTMLImageElement>(".link-card-image");
  let width = item.width;
  let height = item.height;
  if (image?.naturalWidth && image.naturalHeight) {
    const fit = Math.min(
      width / image.naturalWidth,
      height / image.naturalHeight,
    );
    width = image.naturalWidth * fit;
    height = image.naturalHeight * fit;
  }
  element.style.left = `${item.x + (item.width - width) / 2}px`;
  element.style.top = `${item.y + (item.height - height) / 2}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.zIndex = String(item.z);
  element.style.transform = `rotate(${item.rotation}deg)`;
}

function renderItems() {
  for (const item of items.values()) renderItem(item);
  for (const id of elements.keys()) if (!items.has(id)) removeElement(id);
  empty.hidden = items.size > 0;
  renderInspector();
  scheduleImageDetail();
}

function renderItem(item: BoardItem) {
  let element = elements.get(item.id);
  const previewKey = item.link ? JSON.stringify(item.link) : "";
  if (element && element.dataset.preview !== previewKey) {
    removeElement(item.id);
    element = undefined;
  }
  if (!element) {
    element = document.createElement("article");
    element.className = "board-item";
    element.dataset.itemId = item.id;
    element.dataset.preview = previewKey;
    if (item.link) {
      element.classList.add("link-item");
      element.appendChild(linkCard(item.id, item.link));
    } else {
      const image = document.createElement("img");
      image.dataset.src = `/media/${boardId}/${item.assetId}`;
      image.alt = displayFilename(item.filename);
      image.loading = "lazy";
      image.decoding = "async";
      image.draggable = false;
      image.addEventListener("error", () => {
        if (image.src.startsWith("blob:") && image.dataset.original)
          image.src = image.dataset.original;
      });
      element.appendChild(image);
    }
    const resize = document.createElement("span");
    resize.className = "resize-handle";
    resize.dataset.action = "resize";
    const rotate = document.createElement("span");
    rotate.className = "rotate-handle";
    rotate.dataset.action = "rotate";
    element.appendChild(resize);
    element.appendChild(rotate);
    world.appendChild(element);
    elements.set(item.id, element);
    if (didInitialFit) observeImage(element);
  }
  positionElement(element, item);
  element.classList.toggle("selected", selectedId === item.id);
}

function observeImage(element: HTMLElement) {
  if (element.querySelector("img[data-src]")) imageObserver.observe(element);
}

function removeElement(id: string) {
  const element = elements.get(id);
  if (element) {
    imageObserver.unobserve(element);
    const image = element.querySelector("img");
    if (image) boardImages.forget(image);
    element.remove();
  }
  elements.delete(id);
}

function linkCard(itemId: string, link: LinkPreview): HTMLElement {
  const card = document.createElement("div");
  card.className = "link-card";
  if (link.imageUrl) {
    const image = document.createElement("img");
    image.className = "link-card-image";
    image.alt = displaySiteName(link);
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.draggable = false;
    image.addEventListener("load", () => {
      const element = card.closest<HTMLElement>(".board-item");
      const current = items.get(itemId);
      if (element && current) positionElement(element, current);
    });
    image.addEventListener("error", () => {
      if (image.src.startsWith("blob:") && image.dataset.original) {
        image.src = image.dataset.original;
        return;
      }
      image.remove();
      card.appendChild(linkFallback(link));
      const element = card.closest<HTMLElement>(".board-item");
      const current = items.get(itemId);
      if (element && current) positionElement(element, current);
    });
    image.dataset.src = link.imageUrl;
    card.appendChild(image);
  } else {
    card.appendChild(linkFallback(link));
  }
  return card;
}

function linkFallback(link: LinkPreview): HTMLElement {
  const body = document.createElement("div");
  body.className = "link-card-body";
  const site = document.createElement("span");
  site.className = "link-card-site";
  site.textContent = displaySiteName(link);
  const title = document.createElement("strong");
  title.className = "link-card-title";
  title.textContent = displaySiteName(link) === "Twitter" ? "Post" : link.title;
  body.appendChild(site);
  body.appendChild(title);
  return body;
}

function renderInspector() {
  const changed = inspector.dataset.itemId !== (selectedId ?? "");
  renderItemInspector(
    inspectorPanel,
    inspector,
    selectedId ? (items.get(selectedId) ?? null) : null,
    boardId,
    removeSelected,
    refreshSelectedLink,
  );
  if (changed && selectedId && !drag) revealSelected();
}

async function refreshSelectedLink(): Promise<void> {
  const link = selectedId ? items.get(selectedId)?.link : null;
  if (!link) return;
  const form = new FormData();
  form.set("url", link.url);
  form.set("refresh", "1");
  toast("Refreshing preview…");
  try {
    const response = await fetch(`/api/boards/${boardId}/links`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) throw new Error(await response.text());
    await refreshSnapshot();
    toast("Preview refreshed");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not refresh preview");
  }
}

function select(id: string | null) {
  if (selectedId !== id) {
    if (selectedId) elements.get(selectedId)?.classList.remove("selected");
    if (id) elements.get(id)?.classList.add("selected");
  }
  selectedId = id;
  renderInspector();
}

function screenPoint(event: MouseEvent): Point {
  const rect = viewport.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function worldPoint(point: Point): Point {
  return { x: (point.x - offsetX) / scale, y: (point.y - offsetY) / scale };
}
function updateZoomLabel() {
  zoomLabelTimer = 0;
  lastZoomLabelAt = performance.now();
  const value = `${Math.round(scale * 100)}%`;
  if (zoomLabel.textContent !== value) zoomLabel.textContent = value;
}
function scheduleZoomLabel() {
  const remaining = 100 - (performance.now() - lastZoomLabelAt);
  if (remaining <= 0) {
    clearTimeout(zoomLabelTimer);
    updateZoomLabel();
  } else if (!zoomLabelTimer) {
    zoomLabelTimer = window.setTimeout(updateZoomLabel, remaining);
  }
}
function scheduleImageDetail() {
  clearTimeout(imageDetailTimer);
  imageDetailTimer = window.setTimeout(() => {
    const rect = viewport.getBoundingClientRect();
    const left = (-offsetX - 160) / scale;
    const top = (-offsetY - 160) / scale;
    const right = (rect.width - offsetX + 160) / scale;
    const bottom = (rect.height - offsetY + 160) / scale;
    for (const [id, element] of elements) {
      const image = element.querySelector("img");
      const item = items.get(id);
      if (!image?.dataset.original || !item) continue;
      const centerX = item.x + item.width / 2;
      const centerY = item.y + item.height / 2;
      const radius = Math.hypot(item.width, item.height) / 2;
      const visible =
        centerX + radius >= left &&
        centerX - radius <= right &&
        centerY + radius >= top &&
        centerY - radius <= bottom;
      boardImages.setDetail(image, scale > 1.35 && visible);
    }
  }, 160);
}
function applyView() {
  if (viewFrame) return;
  viewFrame = requestAnimationFrame(() => {
    viewFrame = 0;
    world.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
    scheduleZoomLabel();
    scheduleImageDetail();
  });
}
function shift(start: number, end: number, min: number, max: number): number {
  if (end - start > max - min) return (min + max - start - end) / 2;
  if (start < min) return min - start;
  if (end > max) return max - end;
  return 0;
}

function revealSelected() {
  if (!selectedId || drag || !matchMedia("(max-width: 760px)").matches) return;
  const id = selectedId;
  requestAnimationFrame(() => {
    if (selectedId !== id) return;
    const element = elements.get(id);
    if (!element) return;
    const board = viewport.getBoundingClientRect();
    const item = element.getBoundingClientRect();
    const nextX = shift(
      item.left,
      item.right,
      board.left + 16,
      board.right - 16,
    );
    const nextY = shift(
      item.top,
      item.bottom,
      board.top + 16,
      board.bottom - 16,
    );
    if (!nextX && !nextY) return;
    offsetX += nextX;
    offsetY += nextY;
    applyView();
  });
}
function zoomAt(factor: number, point: Point) {
  const at = worldPoint(point);
  scale = Math.max(0.1, Math.min(5, scale * factor));
  offsetX = point.x - at.x * scale;
  offsetY = point.y - at.y * scale;
  applyView();
}
function fitBoard() {
  const rect = viewport.getBoundingClientRect();
  if (!items.size) {
    scale = 1;
    offsetX = rect.width / 2;
    offsetY = rect.height / 2;
    applyView();
    return;
  }
  const all = [...items.values()];
  const left = Math.min(...all.map((item) => item.x));
  const top = Math.min(...all.map((item) => item.y));
  const right = Math.max(...all.map((item) => item.x + item.width));
  const bottom = Math.max(...all.map((item) => item.y + item.height));
  scale = Math.max(
    0.1,
    Math.min(
      1.5,
      Math.min(
        (rect.width - 130) / Math.max(1, right - left),
        (rect.height - 130) / Math.max(1, bottom - top),
      ),
    ),
  );
  offsetX = rect.width / 2 - ((left + right) / 2) * scale;
  offsetY = rect.height / 2 - ((top + bottom) / 2) * scale;
  applyView();
}

function placeItem(width: number, height: number, point?: Point): Point {
  const center = worldPoint(
    point ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 },
  );
  const stepX = width + 28;
  const stepY = height + 28;
  for (let ring = 0; ring < 10; ring++) {
    const offsets: Point[] =
      ring === 0
        ? [{ x: 0, y: 0 }]
        : [
            { x: ring, y: 0 },
            { x: -ring, y: 0 },
            { x: 0, y: ring },
            { x: 0, y: -ring },
            { x: ring, y: ring },
            { x: -ring, y: ring },
            { x: ring, y: -ring },
            { x: -ring, y: -ring },
          ];
    for (const offset of offsets) {
      const x = center.x - width / 2 + offset.x * stepX;
      const y = center.y - height / 2 + offset.y * stepY;
      if (
        [...items.values()].every(
          (item) =>
            x + width + 20 <= item.x ||
            item.x + item.width + 20 <= x ||
            y + height + 20 <= item.y ||
            item.y + item.height + 20 <= y,
        )
      ) {
        return { x, y };
      }
    }
  }
  return { x: center.x - width / 2, y: center.y - height / 2 };
}

function handlePointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 1) return;
  const target = event.target as HTMLElement;
  if (target.closest("a, button, input, summary")) return;
  const element = target.closest<HTMLElement>(".board-item");
  const item = element ? items.get(element.dataset.itemId!) : null;
  const start = screenPoint(event);
  if (event.button === 1 || spaceHeld || !item) {
    if (!item && !spaceHeld) select(null);
    drag = {
      kind: "pan",
      start,
      startOffset: { x: offsetX, y: offsetY },
      moved: false,
    };
    viewport.classList.add("panning");
  } else {
    const action = target.dataset.action;
    drag = {
      kind:
        action === "resize"
          ? "resize"
          : action === "rotate"
            ? "rotate"
            : "move",
      start,
      original: { ...item },
      moved: false,
    };
    select(item.id);
  }
  viewport.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function handlePointerMove(event: PointerEvent) {
  const point = screenPoint(event);
  if (!drag) return;
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
  if (drag.kind === "pan") {
    offsetX = drag.startOffset.x + dx;
    offsetY = drag.startOffset.y + dy;
    applyView();
    return;
  }
  const original = drag.original;
  const item = items.get(original.id);
  if (!item) return;
  if (drag.kind === "move") {
    item.x = original.x + dx / scale;
    item.y = original.y + dy / scale;
  }
  if (drag.kind === "resize") {
    const horizontal = dx / (original.width * scale);
    const vertical = dy / (original.height * scale);
    const change =
      Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
    const factor = Math.max(
      48 / original.width,
      48 / original.height,
      1 + change,
    );
    item.width = original.width * factor;
    item.height = original.height * factor;
  }
  if (drag.kind === "rotate") {
    const center = {
      x: (original.x + original.width / 2) * scale + offsetX,
      y: (original.y + original.height / 2) * scale + offsetY,
    };
    const before = Math.atan2(drag.start.y - center.y, drag.start.x - center.x);
    const after = Math.atan2(point.y - center.y, point.x - center.x);
    item.rotation = Math.round(
      original.rotation + ((after - before) * 180) / Math.PI,
    );
  }
  const element = elements.get(item.id);
  if (element) positionElement(element, item);
}

function handlePointerUp(event: PointerEvent) {
  if (!drag) return;
  viewport.releasePointerCapture(event.pointerId);
  viewport.classList.remove("panning");
  const reveal = drag.kind !== "pan" && !drag.moved;
  if (drag.kind !== "pan" && drag.moved) {
    const item = items.get(drag.original.id);
    if (item)
      submit({
        kind: "transform",
        operationId: crypto.randomUUID(),
        itemId: item.id,
        baseRevision: drag.original.revision,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        z: item.z,
      });
    renderInspector();
  }
  drag = null;
  if (reveal) revealSelected();
}

function removeSelected() {
  if (!selectedId) return;
  const item = items.get(selectedId);
  if (!item) return;
  submit({
    kind: "remove",
    operationId: crypto.randomUUID(),
    itemId: item.id,
    baseRevision: item.revision,
  });
  items.delete(item.id);
  selectedId = null;
  renderItems();
}

function addBoardItem(
  asset: {
    assetId: string;
    filename: string;
    width: number;
    height: number;
    link?: LinkPreview;
  },
  point?: Point,
) {
  const position = placeItem(asset.width, asset.height, point);
  const item: BoardItem = {
    id: crypto.randomUUID(),
    assetId: asset.assetId,
    filename: asset.filename,
    ...(asset.link ? { link: asset.link } : {}),
    ...position,
    width: asset.width,
    height: asset.height,
    rotation: 0,
    z: Math.max(0, ...[...items.values()].map((entry) => entry.z)) + 1,
    revision: 0,
  };
  items.set(item.id, item);
  selectedId = item.id;
  renderItems();
  submit({
    kind: "create",
    operationId: crypto.randomUUID(),
    item: {
      id: item.id,
      assetId: item.assetId,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      rotation: item.rotation,
      z: item.z,
    },
  });
}

async function uploadFiles(files: FileList | File[]) {
  const list = [...files].filter((file) => file.type.startsWith("image/"));
  if (!list.length) {
    toast("Choose a PNG, JPEG, GIF, or WebP image.");
    return;
  }
  for (const file of list) {
    if (file.size > 20 * 1024 * 1024) {
      toast(`${file.name} is larger than 20 MB.`);
      continue;
    }
    try {
      toast(`Adding ${file.name}…`);
      const dimensions = await imageDimensions(file);
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/boards/${boardId}/assets`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
      const uploaded = (await response.json()) as {
        assetId: string;
        filename: string;
      };
      const width = Math.min(460, Math.max(180, dimensions.width));
      const height = Math.max(
        80,
        (width * dimensions.height) / dimensions.width,
      );
      addBoardItem({ ...uploaded, width, height });
      toast(`Added ${file.name}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not add image");
    }
  }
  fileInput.value = "";
}

async function addLink(url: string, point?: Point) {
  const form = new FormData();
  form.set("url", url);
  try {
    toast("Adding link…");
    const response = await fetch(`/api/boards/${boardId}/links`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) throw new Error(await response.text());
    const saved = (await response.json()) as {
      assetId: string;
      preview: LinkPreview;
      existingItemId: string | null;
    };
    if (saved.existingItemId) {
      await refreshSnapshot();
      select(saved.existingItemId);
      toast("Already on this board");
      return;
    }
    const dimensions = saved.preview.imageUrl
      ? await imageDimensionsFromUrl(saved.preview.imageUrl).catch(() => null)
      : null;
    const ratio = dimensions ? dimensions.width / dimensions.height : null;
    const useRatio = ratio !== null && ratio >= 0.04 && ratio <= 15;
    const width = useRatio ? Math.min(360, 600 * ratio) : 360;
    const height = useRatio ? width / ratio : 220;
    addBoardItem(
      {
        assetId: saved.assetId,
        filename: saved.preview.title,
        link: saved.preview,
        width,
        height,
      },
      point,
    );
    linkMenu.open = false;
    linkInput.value = "";
    toast("Link added");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not add link");
  }
}

function pastedUrl(value: string): string | null {
  const text = value.trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  try {
    return new URL(text).href;
  } catch {
    return null;
  }
}

function imageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener("load", () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    });
    image.src = url;
  });
}

function imageDimensionsFromUrl(
  src: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(
      () => reject(new Error("Could not read link image")),
      4000,
    );
    image.addEventListener("load", () => {
      clearTimeout(timeout);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    });
    image.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not read link image"));
    });
    image.src = src;
  });
}

viewport.addEventListener("pointerdown", handlePointerDown);
viewport.addEventListener("pointermove", handlePointerMove);
viewport.addEventListener("pointerup", handlePointerUp);
viewport.addEventListener("pointercancel", handlePointerUp);
viewport.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? viewport.clientHeight
          : 1;
    if (event.ctrlKey) {
      zoomAt(Math.exp(-event.deltaY * unit * 0.01), screenPoint(event));
    } else {
      offsetX -= event.deltaX * unit;
      offsetY -= event.deltaY * unit;
      applyView();
    }
  },
  { passive: false },
);
viewport.addEventListener("dragover", (event) => {
  event.preventDefault();
  viewport.classList.add("drag-over");
});
viewport.addEventListener("dragleave", () =>
  viewport.classList.remove("drag-over"),
);
viewport.addEventListener("drop", (event) => {
  event.preventDefault();
  viewport.classList.remove("drag-over");
  if (event.dataTransfer?.files.length) {
    void uploadFiles(event.dataTransfer.files);
    return;
  }
  const uri = event.dataTransfer
    ?.getData("text/uri-list")
    .split("\n")
    .find((line) => line && !line.startsWith("#"));
  const url = pastedUrl(uri || event.dataTransfer?.getData("text/plain") || "");
  if (url) void addLink(url, screenPoint(event));
});
document.addEventListener("paste", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  )
    return;
  if (event.clipboardData?.files.length) {
    void uploadFiles(event.clipboardData.files);
    return;
  }
  const url = pastedUrl(event.clipboardData?.getData("text/plain") ?? "");
  if (url) {
    event.preventDefault();
    void addLink(url);
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  )
    return;
  if (event.code === "Space") {
    event.preventDefault();
    spaceHeld = true;
  }
  if (event.key === "Delete" || event.key === "Backspace") removeSelected();
  if (event.key === "Escape") select(null);
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space") spaceHeld = false;
});
window.addEventListener("blur", () => {
  spaceHeld = false;
});
required("#tool-fit").addEventListener("click", fitBoard);
required("#zoom-in").addEventListener("click", () =>
  zoomAt(1.2, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }),
);
required("#zoom-out").addEventListener("click", () =>
  zoomAt(1 / 1.2, {
    x: viewport.clientWidth / 2,
    y: viewport.clientHeight / 2,
  }),
);
required("#inspector-close").addEventListener("click", () => select(null));
window.addEventListener("resize", revealSelected);
required("#tool-add").addEventListener("click", () => fileInput.click());
linkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void addLink(linkInput.value);
});
document
  .querySelector("#empty-add")
  ?.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files) void uploadFiles(fileInput.files);
});
connect();
