"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { BLOCK_CONFIGS } from "./block-configs";
import { Chat } from "./chat-thread";

// Chat block: a chat (chat-thread.tsx) in the page, keyed by the block's id.
// The title is in the document (anyone who can edit the page can change it).
export const chatBlock = createReactBlockSpec(BLOCK_CONFIGS.chat, {
  render: ({ block, editor }) => (
    <Chat
      blockId={block.id}
      title={block.props.title}
      titleEditable={editor.isEditable}
      onTitle={(title) => editor.updateBlock(block, { props: { title } })}
    />
  ),
});

