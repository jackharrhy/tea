import type { Handle } from "remix/component";

export function AdminBrand(
  handle: Handle<{ href: string; siteName?: string }>,
) {
  return () => (
    <a className="brand" href={handle.props.href}>
      <span className="brand-mark" aria-hidden="true">
        🍵
      </span>
      <span>
        teacms
        {handle.props.siteName && <small>{handle.props.siteName}</small>}
      </span>
    </a>
  );
}
