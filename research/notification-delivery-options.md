# Delivery options for in-app Notifications

Research for [issue #3](https://github.com/josepclaro/cohort-005-project-fork-01/issues/3). Facts only, no recommendation. Checked on 2026-11-09 against vendor pricing pages, vendor docs and the npm registry. Pricing pages change often, so check them again before deciding.

Context: Cadence is a single-process React Router app (`react-router` 8.3.0 in `package.json`) with one SQLite file opened through `better-sqlite3` and Drizzle ([ADR 0006](../docs/adr/0006-one-sqlite-file-through-drizzle.md)). It runs locally only. Constraints: a third-party service needs a free tier and must work in local dev without a public URL or inbound webhook.

## Comparison

| Option | Free tier (in-app relevant) | Works locally without a public URL | React inbox package | Realtime | State model it imposes | Node server SDK | Lock-in / data |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Knock** | 10,000 messages/mo, in-app feed and prebuilt components included, 30-day log retention, Knock branding. No hard cap: they contact you about billing if you exceed it. | Yes. Server calls the Knock API outbound, browser opens a websocket to Knock. | `@knocklabs/react` (MIT) | Websocket, managed by Knock | `seen`, `read`, `interacted`, `archived` (+ `link_clicked`). Independent timestamps. | `@knocklabs/node` | Hosted only. Notifications and engagement state live at Knock. |
| **Novu (Cloud)** | 10,000 workflow runs/mo, all channels incl. in-app, **inbox feed retention 24 hours**, 20 workflows, 3 team members, Novu branding. | Yes for workflows built in the dashboard and triggered by API. The code-first **Novu Framework** "bridge endpoint" must be publicly reachable; locally that means the `npx novu dev` tunnel (`*.novu.sh`) or your own ngrok. | `@novu/react` (MIT): `<Inbox />`, Bell, Notifications, Preferences | WebSocket | `read`/`unread`, `seen` (one-way, no unseen), `archived`/`unarchived`, `snoozed` (cloud only) | `@novu/api` | Hosted, or self-hosted (see below). |
| **Novu (self-hosted)** | No usage fee. Repo is MIT outside `enterprise/` packages, which are proprietary. | Yes, it runs on your machine. | Same `@novu/react` | WebSocket (socket.io for self-hosted) | Same, minus snooze (cloud only) | `@novu/api` with your `serverURL` | You own the data, but it lives in MongoDB + Redis + object storage next to the app, not in SQLite. Some features are cloud only. |
| **MagicBell** | Builder plan: **1,000 deliveries/mo** (one delivery per channel per user), 1 project. | Yes. Server calls the API outbound, browser holds a persistent connection to MagicBell. | `@magicbell/react`: `ContextProvider`, `FloatingInbox`, `Inbox` | "Persistent connection", transport not documented | `read`/`unread`, archive, delete (no `seen` documented) | `magicbell-js` (`magicbell-js/project-client`) | Hosted only. |
| **SuprSend** | 10,000 notifications/mo, inbox included with SuprSend branding. No batching/digest, preferences or throttling on Free. Going over requires a paid plan. | Yes. Outbound API calls and a browser socket. | `@suprsend/react` (MIT). The old `@suprsend/react-inbox` is no longer supported. | Socket ("feed socket"), transport not named | `seen_on`, `read_on` (unread reversible), `interacted_on`, `archived`, `is_pinned`, optional expiry | `@suprsend/node-sdk` | Hosted only. |
| **Courier** | Developer plan: 10,000 sends/mo. The pricing page does not say Inbox is on it, but Courier's own pages say inbox components are included and in-app counts as a send. | Yes. Backend mints a JWT via the API, browser connects to Courier. | `@trycourier/courier-react` (v9, React 18+): `CourierInbox`, `useCourier()` | Real-time socket, state syncs across devices | `read`, `opened`, `archived`, unread counts | `@trycourier/courier` | Hosted only. |
| **In-house** (Drizzle table + loader, optional SSE) | Free | Yes | None, you build it | None (fetch on load / revalidate), polling, or SSE from a resource route | Whatever columns you define | Not needed, it is a Drizzle insert | Data stays in `data.db`. No vendor. |

Engagespot also has an in-app inbox (`@engagespot/react-component`) and is listed by aggregator sites with a free "Launch" tier of 10,000 event triggers a month. Its own pricing page (`engagespot.co/pricing`) returned 404 when checked, so those limits are not confirmed from a primary source.

## Notes per option

### Knock

- **Free plan:** $0, 10,000 messages a month, unlimited feeds per recipient, Feed API, prebuilt components and custom feed filtering included. Knock branding stays, 30-day log retention, no i18n or per-tenant branding. "Knock doesn't hard-cap messages": if you go over, they contact you about billing. Next tier is Starter at $250 a month. [knock.app/pricing](https://knock.app/pricing)
- **React:** `@knocklabs/react` provides `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton` (unread/unseen badge). It replaces `@knocklabs/react-notification-feed`. [React overview](https://docs.knock.app/in-app-ui/react/overview)
- **Realtime:** clients connect to Knock's managed real-time service, which "receives notifications over a websocket when new messages are sent to an in-app feed channel." [Feeds overview](https://docs.knock.app/in-app-ui/feeds/overview)
- **State model:** engagement statuses are independent and each has a timestamp: `seen_at` (fetched for display), `read_at`, `link_clicked_at`, `interacted_at` (cell clicked), `archived_at`. You can set them explicitly with the Message status API. [Message statuses](https://docs.knock.app/send-notifications/message-statuses)
- **Auth / local dev:** the client authenticates with the public API key plus user id. "Enhanced security mode" (backend signs an RS256 JWT with `sub` = user id) is off by default and recommended for production, so local dev can use only the public key. [Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- **Node:** `@knocklabs/node` ("The official TypeScript library for the Knock API", npm).

### Novu

- **Cloud free plan:** $0, no card, 10,000 workflow runs a month, all channels, **in-app inbox feed retention of 24 hours** (Pro, from $30 a month, gives 7 days), up to 20 workflows, dev and prod environments, 3 team members, US/EU residency, Novu branding. [novu.co/pricing](https://novu.co/pricing)
- **React:** `@novu/react` offers a drop-in `<Inbox />` plus composable Bell, Notifications, InboxContent and Preferences. Framework-agnostic `@novu/js` sits underneath. [Inbox overview](https://docs.novu.co/platform/inbox/overview)
- **Realtime:** WebSocket. `socketType` is `'cloud'` (PartySocket) or `'self-hosted'` (socket.io). Events include `notifications.notification_received`, `notifications.unread_count_changed` and `notifications.unseen_count_changed`. [JS SDK reference](https://docs.novu.co/platform/sdks/javascript)
- **State model:** fields `isRead`, `isSeen`, `isArchived`, `isSnoozed` (+ `readAt`, `firstSeenAt`, `archivedAt`, `snoozedUntil`). Methods `read/unread`, `seen` (one-way, no unseen), `archive/unarchive`, `snooze/unsnooze`, `delete`, plus `readAll`, `archiveAll`, `seenAll`. [JS SDK reference](https://docs.novu.co/platform/sdks/javascript). Snooze "is only available for cloud workspaces". A snoozed item cannot be marked read, unread or archived. [Snooze](https://docs.novu.co/platform/inbox/features/snooze)
- **Auth:** `applicationIdentifier` + `subscriberId`, with an optional HMAC `subscriberHash` for production. [JS SDK reference](https://docs.novu.co/platform/sdks/javascript)
- **Local dev caveat:** the code-first Novu Framework runs workflows from a "Bridge Endpoint" in your app that Novu Cloud calls. Locally, `npx novu@latest dev` opens a tunnel at `https://<id>.novu.sh/api/novu`, or you pass your own (`--tunnel`). [Local Studio](https://docs.novu.co/framework/studio), [Bridge endpoint](https://docs.novu.co/framework/endpoint). Workflows built in the dashboard and triggered with `@novu/api` do not involve the bridge. That last point follows from how the system is built, not from a direct quote.
- **Node:** `@novu/api`, `novu.trigger({ workflowId, to: { subscriberId }, payload })`. `serverURL` can point to a self-hosted API. [TypeScript SDK](https://docs.novu.co/platform/sdks/server/typescript)
- **Self-hosting:** there is a community self-hosted edition, but "some features exclusive to Novu's cloud-managed solution will not be available" and there is no social login. It needs MongoDB, Redis with AOF, and S3-compatible storage. A single VM needs about 4 vCPU and 8 GB RAM for API, Worker and WS. [Self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview). License: MIT except `enterprise/packages`, which use a proprietary license (repo `LICENSE-ENTERPRISE`, [github.com/novuhq/novu](https://github.com/novuhq/novu)).

### MagicBell

- **Free plan:** "Builder", $0, **1,000 deliveries a month**. A delivery is counted per channel a user receives the notification on. 1 project, all integrations. Next tier is Startup at $249 a month (50,000 deliveries). [magicbell.com/pricing](https://www.magicbell.com/pricing)
- **React:** `@magicbell/react` provides `ContextProvider` (takes a User JWT `token`), `FloatingInbox`, `Inbox`, `InlineNotification`, `ToastContainer`, `UserPreferences` and `WebPushButton`. [React library](https://www.magicbell.com/docs/libraries/magicbell-react)
- **Realtime:** MagicBell "maintains a persistent connection to deliver notifications in real-time". The transport is not documented. [In-app channel](https://www.magicbell.com/docs/channels/in_app)
- **State model:** read/unread, archive, delete. No seen state is documented. [In-app channel](https://www.magicbell.com/docs/channels/in_app)
- **Node:** `magicbell-js`. Server side, `import { Client } from 'magicbell-js/project-client'` and `client.broadcasts.createBroadcast({ title, content, recipients })`. [magicbell-js](https://www.magicbell.com/docs/libraries/magicbell-js)

### SuprSend

- **Free plan:** $0, no card, 10,000 notifications a month, unlimited channels, inbox included **with SuprSend branding**. Batching/digest, user preferences, timezone sending, throttling and multi-tenant are not included. 30-day logs. Going over 10k requires a paid plan (Essentials, $100 a month). [suprsend.com/pricing](https://www.suprsend.com/pricing)
- **React:** `@suprsend/react`, with drop-in components or headless use. `@suprsend/react-inbox` is no longer supported. Inbox auth moved from HMAC `subscriber_id` to signed JWT user tokens. [React inbox](https://docs.suprsend.com/docs/inbox-react)
- **Realtime / state model:** the feed reports a live socket (`socket.status`, reconnect attempts). Items carry `seen_on`, `read_on`, `interacted_on`, `archived` (hidden by default), `is_pinned` and optional expiry. Tabs are driven by "stores" filtering on category and tags. [Headless inbox](https://docs.suprsend.com/docs/headless-inbox). Read/unread and archived/unarchived flip independently. [Bulk update API](https://docs.suprsend.com/reference/bulk-update-messages.md)
- **Node:** `@suprsend/node-sdk` ("Suprsend Node SDK to trigger workflow from backend", npm).

### Courier

- **Free plan:** "Developer", up to 10,000 sends a month. After that, Business is pay-as-you-go at $0.005 per send. The pricing page does not list Inbox per plan. [courier.com/pricing](https://www.courier.com/pricing). Courier's docs and guides say the Developer plan covers all channels including in-app. [Courier docs overview](https://www.courier.com/docs/overview)
- **React:** `@trycourier/courier-react` v9 (React 18+, `@trycourier/courier-react-17` for React 17) provides `CourierInbox` and `useCourier()` → `signIn({ userId, jwt })`. [Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview)
- **Realtime:** messages arrive in real time, and "every state change (read, opened, archived) syncs instantly across a user's signed-in devices". `signOut` "disconnects the real-time socket". [Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview), [Inbox auth](https://www.courier.com/docs/platform/inbox/authentication)
- **Auth:** the backend calls Issue Token with scopes like `user_id:… inbox:read:messages inbox:write:events` and an `expires_in`. The SDK does not refresh tokens. No JWT-less dev mode is documented. [Inbox auth](https://www.courier.com/docs/platform/inbox/authentication)
- **Node:** `@trycourier/courier` ("The official TypeScript library for the Courier API", npm, v10).

### In-house: Drizzle table + fetch on load, optional SSE

- **Storage:** a `notifications` table in `app/db/schema.ts` beside the rest of the data, written with a synchronous Drizzle insert in the same process ([ADR 0006](../docs/adr/0006-one-sqlite-file-through-drizzle.md)). The state model (for example `readAt`, `archivedAt`) is whatever columns you add.
- **Fetch on load:** a root or layout loader reads the unread count. React Router revalidates loaders after every action automatically. `useRevalidator` covers "reasons outside of normal data mutations like `Window` focus or polling on an interval." [useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)
- **SSE:** "A route becomes a resource route by convention when its module exports a loader or action but does not export a default component", and such a loader can return a raw `Response` [resource routes](https://reactrouter.com/how-to/resource-routes), so a `ReadableStream` body with `Content-Type: text/event-stream` works. The docs do not show SSE specifically. The browser side is `EventSource`, which reconnects on its own. Over HTTP/1.1, browsers allow only **6 connections per browser + domain**, which "can be especially painful when opening multiple tabs". HTTP/2 negotiates about 100 streams. [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events). Because Cadence is a single process, an in-memory event emitter is enough to fan new rows out to open streams. A multi-machine setup would need pub/sub, but ADR 0006 already rules that out.
- **What you build yourself:** the bell/feed UI, mark read/archive actions, any preferences, retention/cleanup. There are no vendor limits and no branding.

## Cross-cutting facts

- **Local dev:** none of the hosted services needs an inbound webhook for in-app delivery. The server calls the vendor API outbound, and the browser opens a socket to the vendor. The one exception found is the Novu Framework bridge, which the vendor calls inbound and which therefore needs a tunnel.
- **Identity mapping:** every hosted option keeps its own copy of users (Knock users, Novu subscribers, SuprSend `distinctId`, Courier `userId`, MagicBell users). Cadence's DevUI user switcher would need to map to those ids, and most production setups need a server-minted token (Knock RS256 JWT, Courier JWT, MagicBell User JWT, SuprSend JWT, Novu HMAC hash).
- **Retention:** Novu Free keeps in-app feed items for 24 hours, which matters for an inbox users come back to. The other vendors' pricing pages list log retention (Knock and SuprSend 30 days) but not an in-app feed retention limit.
- **Data ownership:** with every hosted option, the notification records and read/archive state live outside `data.db`. Self-hosted Novu keeps them on your machine but in MongoDB, a second datastore beside SQLite.

## Surprises

- **MagicBell's free tier is small:** 1,000 deliveries a month, against 10,000 for Knock, Novu, SuprSend and Courier.
- **Novu Free keeps in-app feed items for only 24 hours.**
- **SuprSend's `@suprsend/react-inbox` is no longer supported.** Use `@suprsend/react`.
- **Novu's repo is not purely MIT:** `enterprise/packages` use a proprietary license, and some features such as snooze are cloud only.
- **No vendor's free tier was found to be discontinued.** The Engagespot pricing page returned 404, so its free tier could not be confirmed from a primary source.
- **The project uses React Router 8.3.0**, not 7. The resource-route and `useRevalidator` APIs cited above are the current docs.
