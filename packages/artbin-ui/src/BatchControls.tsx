import { useState, type ReactNode } from "react";

export interface BatchControlsProps {
  selectedCount: number;
  onClear: () => void;
  children: (opts: { close: () => void }) => ReactNode;
}

export function BatchControls({ selectedCount, children }: BatchControlsProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (selectedCount === 0) return null;

  const close = () => setIsOpen(false);

  return (
    <>
      {/* Fixed button in bottom right */}
      <button
        type="button"
        className="btn btn-primary fixed bottom-6 right-6 shadow-lg z-100"
        onClick={() => setIsOpen(true)}
      >
        Import {selectedCount} selected
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Batch import</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="mb-4 text-text-muted">
                Import <strong>{selectedCount}</strong>{" "}
                {selectedCount === 1 ? "item" : "items"}. Choose a destination
                below. Archive contents and loose files keep their relative
                folder structure.
              </p>

              {children({ close })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
