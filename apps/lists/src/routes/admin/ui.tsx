/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { Children as Child } from "@kitajs/html";

// ---------------------------------------------------------------------------
// Form components
// ---------------------------------------------------------------------------

export function Label({
  for: htmlFor,
  children,
}: {
  for?: string;
  children: Child;
}) {
  return (
    <label for={htmlFor} class="block text-sm font-medium text-gray-700 mb-1">
      {children}
    </label>
  );
}

export function Input({ size, ...props }: Record<string, any>) {
  const base =
    "box-border border border-gray-300 rounded-md bg-white text-gray-900 font-[inherit] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500";
  const sizes: Record<string, string> = {
    sm: "px-2 py-1.5 text-sm",
    md: "w-full px-3 py-2 text-sm mb-3",
  };
  const s = sizes[size ?? "md"] ?? sizes.md;
  return <input {...props} class={`${base} ${s} ${props.class ?? ""}`} />;
}

export function Select({ children, size, ...props }: Record<string, any>) {
  const base =
    "box-border border border-gray-300 rounded-md bg-white text-gray-900 font-[inherit] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500";
  const sizes: Record<string, string> = {
    sm: "px-2 py-1.5 text-sm",
    md: "w-full px-3 py-2 text-sm mb-3",
  };
  const s = sizes[size ?? "md"] ?? sizes.md;
  return (
    <select {...props} class={`${base} ${s} ${props.class ?? ""}`}>
      {children}
    </select>
  );
}

export function Textarea(props: Record<string, any>) {
  return (
    <textarea
      {...props}
      class={`box-border w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 placeholder:text-gray-400 text-sm font-[inherit] mb-3 min-h-[200px] resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 ${props.class ?? ""}`}
    />
  );
}

export function FormGroup({ children }: { children: Child }) {
  return <div class="mb-4">{children}</div>;
}

// ---------------------------------------------------------------------------
// Button components
// ---------------------------------------------------------------------------

export function Button({
  children,
  variant = "primary",
  size = "md",
  ...props
}: Record<string, any>) {
  const base =
    "font-medium rounded-md cursor-pointer border-none no-underline whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60";
  const sizes = {
    sm: "px-2 py-1 text-xs rounded",
    md: "px-4 py-2 text-sm rounded-md",
    filter: "px-3 py-1.5 text-sm rounded-md",
  };
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    secondary:
      "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300",
    ghost: "bg-transparent text-red-600 hover:text-red-800 border-none p-0",
  };
  const s = sizes[size as keyof typeof sizes] ?? sizes.md;
  const v = variants[variant as keyof typeof variants] ?? variants.primary;
  return (
    <button
      hx-disabled-elt="this"
      {...props}
      class={`inline-block ${base} ${s} ${v} ${props.class ?? ""}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "md",
  ...props
}: Record<string, any>) {
  const base =
    "inline-block font-medium rounded-md cursor-pointer border-none no-underline whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:translate-y-px";
  const sizes: Record<string, string> = {
    sm: "px-2 py-1 text-xs",
    md: "px-4 py-2 text-sm",
  };
  const variants: Record<string, string> = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    secondary: "bg-white text-gray-700 hover:bg-gray-50 border border-gray-300",
  };
  const s = sizes[size as string] ?? sizes.md;
  const v = variants[variant as string] ?? variants.primary;
  return (
    <a href={href} {...props} class={`${base} ${s} ${v} ${props.class ?? ""}`}>
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Table components
// ---------------------------------------------------------------------------

export function Table({ children }: { children: Child }) {
  return (
    <div class="mb-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table class="admin-table w-full min-w-max text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children?: Child }) {
  return (
    <th class="bg-gray-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200">
      {children}
    </th>
  );
}

export function Td({
  children,
  class: cls,
  colspan,
}: {
  children?: Child;
  class?: string;
  colspan?: number;
}) {
  return (
    <td
      colspan={colspan}
      class={`px-4 py-3 border-b border-gray-100 ${cls ?? ""}`}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Layout components
// ---------------------------------------------------------------------------

export function Card({
  children,
  class: cls,
}: {
  children: Child;
  class?: string;
}) {
  return (
    <div
      class={`bg-white border border-gray-200 rounded-lg p-5 mb-6 ${cls ?? ""}`}
    >
      {children}
    </div>
  );
}

export function StatGrid({
  children,
  class: cls,
}: {
  children: Child;
  class?: string;
}) {
  return (
    <div class={`mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3 ${cls ?? ""}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: Child }) {
  return (
    <div class="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <strong class="block text-2xl font-bold text-blue-600">{value}</strong>
      <span safe class="text-xs text-gray-500">
        {label}
      </span>
    </div>
  );
}

export function SectionHeading({ children }: { children: Child }) {
  return <h2 class="mb-3 mt-6 text-xl font-semibold">{children}</h2>;
}

export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: Child;
}) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h1 safe class="text-2xl font-bold mt-0 mb-0">
        {title}
      </h1>
      {children}
    </div>
  );
}

export function Pagination({
  previousHref,
  nextHref,
  summary,
}: {
  previousHref?: string;
  nextHref?: string;
  summary: Child;
}) {
  return (
    <div class="flex items-center justify-between mt-2 pt-4 border-t border-gray-100">
      <div>
        {previousHref ? (
          <LinkButton href={previousHref} variant="secondary" size="sm">
            ← Previous
          </LinkButton>
        ) : (
          <span />
        )}
      </div>
      <span class="text-xs text-gray-400">{summary}</span>
      <div>
        {nextHref ? (
          <LinkButton href={nextHref} variant="secondary" size="sm">
            Next →
          </LinkButton>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
