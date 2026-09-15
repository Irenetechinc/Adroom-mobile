---
name: OAuth connect flow stale state
description: Two bugs in AgentChatScreen that block Facebook/Instagram/WhatsApp OAuth from opening the browser.
---

## The Problem
When the user navigates to the standalone `AgentChat` stack screen (line 144 in AppNavigator) with a connect param (`connectFacebook`, `connectInstagram`, `connectWhatsApp`), the browser never opens. The service files (facebook.ts, instagram.ts, whatsapp.ts) are fine — the block is in AgentChatScreen.

## Root Causes

**Bug 1 — Stale `connectionState` guard**
`useEffect([route.params])` has `if (connectionState !== 'IDLE') return;` at the top. If the user previously started (but did not complete) an OAuth flow, `connectionState` stays at `'CONNECTING'`. On subsequent navigation with connect params the guard fires, `initiateConnection` is never called, and no connect dialog appears.

**Bug 2 — Large `streamDelay` for interactive cards**
`streamDelay = charsBeforeMe * 2` sums ALL preceding new-agent-message chars (including long strategy outputs). An interactive card message (with a connect button) wouldn't render the button until all that "virtual streaming" completes — potentially many seconds.

## Fix Applied (AgentChatScreen.tsx)

**Fix 1** — In `useEffect([route.params])`, detect `hasConnectParam` and, if present with stale state, reset via `useAgentStore.setState({ connectionState: 'IDLE', isTyping: false, isInputDisabled: false })` before calling `initiateConnection`.

**Fix 2** — `streamDelay` is now `0` for any message whose `uiType` is in `INTERACTIVE_TYPES`. Plain text bubbles keep the sequential delay for natural feel.

**Why:**
- The guard exists to prevent double-initiation during an active flow, but it must not block when the user deliberately navigates back with params.
- Interactive cards must appear immediately after their text streams; waiting for all preceding chat history to "virtually stream" is invisible to the user but blocks the button.

**How to apply:**
- Any future change to the connect flow `useEffect` should respect the `hasConnectParam` distinction.
- Any new interactive-card `uiType` should be added to `INTERACTIVE_TYPES` so it also gets `streamDelay = 0`.
