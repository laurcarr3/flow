---
id: export-conversation
status: draft
group: conversations
depends_on: []
---
# Export a conversation

## Outcome

A user can keep a readable local copy of a conversation.

## Requirements

- Add an Export Markdown action to the conversation menu.
- Include message roles and message text in chronological order.
- Download a UTF-8 Markdown file named after the conversation ID.

## Acceptance criteria

- Exporting a conversation downloads a Markdown file containing every visible message in order.
- A conversation with no messages exports its title without an error.
- Export does not modify the conversation.

## Out of scope

Attachments, bulk export, PDF output, and importing exported files.

## Open questions

Should tool messages be included? Resolve this before approval, or explicitly acknowledge it when approving.
