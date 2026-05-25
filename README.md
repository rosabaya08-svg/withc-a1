# A1 Developer Console

Next.js web console for A-PROJECT master control.

## Core scope

- A2, A3, A4, A5, B1 overview
- Branch and device monitoring
- A4 usage suspension control
- Firebase Storage `ad_videos/` ad file listing
- Firebase ad asset and playback event analytics
- A1 audit logs

## Cloudflare Pages

- Build command: `npm run pages:build`
- Build output directory: `out`
- Production branch: `main`

## Firebase collections

- `businesses/{bizNum}`
- `devices/{deviceId}`
- `ad_assets/{assetId}`
- `ad_campaigns/{campaignId}`
- `ad_play_events/{eventId}`
- `app_releases/a3`
- `app_release_files/{releaseFileId}`
- `app_release_history/{historyId}`
- `a1_audit_logs/{logId}`
- Firebase Storage `ad_videos/`
- Firebase Storage `app_releases/a3/`

## A4 suspension fields

```text
businesses/{bizNum}
- a4_status: active | suspended
- a4_suspended_reason
- a4_suspended_at
- a4_suspended_by
- a4_resumed_at
- a4_resumed_by
```
