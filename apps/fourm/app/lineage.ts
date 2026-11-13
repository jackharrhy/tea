import type { Row } from "./data/community.ts";
export interface LineageNode {
  username: string;
  display_name: string;
  children: LineageNode[];
}
export function inviteTree(members: Row[]): LineageNode[] {
  const nodes = new Map(
    members.map((member) => [
      member.id,
      {
        username: String(member.username),
        display_name: String(member.display_name),
        children: [] as LineageNode[],
      },
    ]),
  );
  const roots: LineageNode[] = [];
  for (const member of members) {
    const node = nodes.get(member.id)!;
    const parent = member.invited_by_user_id
      ? nodes.get(member.invited_by_user_id)
      : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
