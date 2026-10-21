---
kind: upgrade-guide
description: "Browser Flow result messages require the panel identity and matching Host and Client builds."
---
# Browser Flow result ownership

English | [中文](guide.zh.md)

## Change

`POST /api/browser-flow/result` requires a nonempty `instanceId`. The Host accepts a result only from the panel and generation that took that command, under the current authorization epoch. Missing identity is a protocol error; an unrelated or stale identity cannot settle current work.

One exact Agent and Session have one current control page. Successfully authorizing a different page ends the previous grant; a failed authorization preserves it. UI revocation suspends local control immediately, including when the Host request fails.

## Migration

1. Fully quit Desktop, build the linked plugin with `npm run build`, and restart through the existing Desktop profile so Host and Client load the same candidate.
2. Custom result producers must include their registered panel `instanceId` and echo the delivered command's lease, generation, epoch, ID and sequence. Reauthorization requires a fresh explicit user action.
3. Run the protocol and control-ownership tests, then verify revocation refuses new actions while the page remains open. A local test result does not replace real Desktop qualification.
