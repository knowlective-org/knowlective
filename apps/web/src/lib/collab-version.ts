// The version of what an editor in the browser has to know about a page's
// document: its block, inline and node types with their props, and the rules
// kept in it (block locks, lib/block-locks.ts). A browser still showing the
// app from before a change would drop the blocks it doesn't know (Yjs deletes
// unknown nodes from the shared document) or ignore the locks, so the server
// refuses to let it connect (getCollabToken, server/collab.ts) and it is asked
// to reload.
// Bump it whenever any of that changes; test/collab-version.test.mts fails
// until the recorded schema matches. No dependencies: the browser and the
// collab server both read it.
export const COLLAB_CLIENT_VERSION = 6;

// What getCollabToken returns instead of a token to an outdated editor.
export const OUTDATED_CLIENT = "outdated-client";
