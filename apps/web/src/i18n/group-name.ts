// A group's name for display: built-in groups (all users, public) are named
// in the viewer's language (their stored name is from when they were made);
// others by the name they were given. `t` is any translator over all keys.

type GroupLike = { name: string; builtIn: string | null };

export function groupName(t: (key: "builtInGroups.all_users" | "builtInGroups.public") => string, group: GroupLike): string {
  if (group.builtIn === "all_users" || group.builtIn === "public") return t(`builtInGroups.${group.builtIn}`);
  return group.name;
}
