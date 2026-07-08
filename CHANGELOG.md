# Changelog

## 0.1.0

Initial release.

- BSUID (Business-Scoped User ID) support: trigger emits the always-present `fromUserId`/`userId` plus `username`, `parentUserId` and phone-change system events (`oldUserId`/`newUserId`); the Recipient field of all send operations auto-detects BSUIDs and parent BSUIDs and routes them to the API's `recipient` field; send responses expose `userId`; errors 131009/131062 surface actionable guidance.

- **360dialog** node — Message resource (Send Text, Send Media, Send Template with live template dropdown and automatic `components[]` assembly) and Account resource (Get Health Status).
- **360dialog Trigger** node — starts workflows on inbound WhatsApp messages, with webhook lifecycle management (previous webhook URL restored on deactivation), outbound-echo filtering, and message-ID deduplication.
- **360dialog API** credential — `D360-API-KEY` header auth with `/health_status` credential test.
