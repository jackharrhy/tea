import { on, type Handle, type RemixNode } from "remix/component";

import {
  modalBodyStyle,
  modalFooterStyle,
  modalHeaderStyle,
  modalOverlayStyle,
  modalStyle,
  modalTitleStyle,
} from "./styles.ts";

export function ModalFrame(
  handle: Handle<{
    title: string;
    children?: RemixNode;
    closeControl?: RemixNode;
    footer?: RemixNode;
    onDismiss?: () => void;
  }>,
) {
  return () => {
    const { title, children, closeControl, footer } = handle.props;
    const titleId = `${handle.id}-title`;
    return (
      <div
        mix={[
          modalOverlayStyle,
          handle.props.onDismiss
            ? on("click", handle.props.onDismiss)
            : undefined,
        ]}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          mix={[modalStyle, on("click", (event) => event.stopPropagation())]}
        >
          <header mix={modalHeaderStyle}>
            <h2 id={titleId} mix={modalTitleStyle}>
              {title}
            </h2>
            {closeControl}
          </header>
          <div mix={modalBodyStyle}>{children}</div>
          {footer ? <footer mix={modalFooterStyle}>{footer}</footer> : null}
        </section>
      </div>
    );
  };
}
