const CAPTURE_LOSS_GRACE_MS = 250;

/** Shared input termination for every viewport tool. Capture loss is not a release. */
export function connectDragLifecycle<
  Drag extends { readonly pointerId: number; readonly button: number },
>(options: {
  readonly canvas: HTMLCanvasElement;
  readonly signal: AbortSignal;
  readonly current: () => Drag | null;
  readonly release: (event: PointerEvent) => void;
  readonly cancel: () => void;
}): void {
  const { canvas, signal, current, release, cancel } = options;
  const host = canvas.ownerDocument.defaultView!;
  let pendingLoss: ReturnType<typeof setTimeout> | undefined;
  let mousePointerId: number | null = null;
  const clearLoss = () => {
    clearTimeout(pendingLoss);
    pendingLoss = undefined;
  };
  const finish = (event: PointerEvent) => {
    const drag = current();
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      drag.button !== event.button
    )
      return;
    clearLoss();
    release(event);
  };
  const listeners = { signal, capture: true };
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      clearLoss();
      mousePointerId = event.pointerType === "mouse" ? event.pointerId : null;
    },
    listeners,
  );
  host.addEventListener("pointerup", finish, listeners);
  // Some embedded browsers lose/retarget pointerup but still deliver its compatibility mouseup.
  // Route it through exactly the same final-position sampling and commit path; the cleared drag
  // makes subsequent pointerup/mouseup delivery a no-op.
  host.addEventListener(
    "mouseup",
    (event) => {
      const drag = current();
      if (
        !drag ||
        mousePointerId !== drag.pointerId ||
        event.button !== drag.button
      )
        return;
      finish(
        new PointerEvent("pointerup", {
          pointerId: drag.pointerId,
          pointerType: "mouse",
          button: event.button,
          buttons: event.buttons,
          clientX: event.clientX,
          clientY: event.clientY,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        }),
      );
    },
    listeners,
  );
  host.addEventListener(
    "pointercancel",
    (event) => {
      if (current()?.pointerId !== event.pointerId) return;
      clearLoss();
      cancel();
    },
    listeners,
  );
  canvas.addEventListener(
    "lostpointercapture",
    (event) => {
      const drag = current();
      if (!drag || drag.pointerId !== event.pointerId) return;
      clearLoss();
      // Releases may arrive in a later browser task. Keep a bounded recovery window rather than
      // cancelling in the very next task, which races both pointerup and compatibility mouseup.
      pendingLoss = setTimeout(() => {
        pendingLoss = undefined;
        if (!signal.aborted && current() === drag) cancel();
      }, CAPTURE_LOSS_GRACE_MS);
    },
    { signal },
  );
  host.addEventListener(
    "blur",
    () => {
      clearLoss();
      cancel();
    },
    { signal },
  );
  signal.addEventListener("abort", clearLoss, { once: true });
}
