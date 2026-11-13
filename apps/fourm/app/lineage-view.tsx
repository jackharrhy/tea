import type { Handle } from "remix/component";
import type { LineageNode } from "./lineage.ts";
export function LineageTree(handle: Handle<{ nodes: LineageNode[] }>) {
  return () => (
    <ul class="tree">
      {handle.props.nodes.map((node) => (
        <li id={`user-${node.username}`}>
          <a href={`/u/${node.username}`}>{node.display_name}</a>{" "}
          <span class="muted">@{node.username}</span>
          {node.children.length ? <LineageTree nodes={node.children} /> : null}
        </li>
      ))}
    </ul>
  );
}
