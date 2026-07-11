# Vibed Export Pipeline Skill

## When to use
Load this skill when debugging or extending:
- Video export (Revideo render to MP4 via AWS Lambda)
- NLE export (FCPXML, xmeml, OTIO)
- Clip URL resolution and GCS signing
- Lambda invocation, webhook handling, job polling
- HLS proxy generation

## Export flow (video)

```
1. User clicks Export in ExportModal.jsx
2. Frontend POSTs timeline state to POST /api/revideo/render
   (route: routes/revideoRenderRoutes.js)

3. Railway route normalizes the payload:
   a. Iterates every clip in every track
   b. blob: URL → build GCS path from clip.name:
        raw/{userId}/{projectId}/{encodeURIComponent(filename)}
   c. undefined URL → same GCS path build using clip.name as fallback
   d. Signs all GCS paths (v4 signed URL, 1hr expiry)
   e. Encodes spaces in filenames: encodeURIComponent per path SEGMENT
      (never encodeURI on the full URL — that misses internal spaces)

4. Railway invokes AWS Lambda asynchronously:
   LambdaClient.send(new InvokeCommand({
     FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
     InvocationType: 'Event',   // fire-and-forget
     Payload: JSON.stringify({ tracks, webhookUrl, jobId })
   }))
   Returns immediately with jobId. Client begins polling GET /api/revideo/status/:jobId.

5. AWS Lambda (render-lambda/index.ts):
   a. Receives event with { tracks, webhookUrl, jobId }
   b. Calls renderVideo() — Revideo + Puppeteer/Chromium renders timeline.tsx scene
   c. Output MP4 written to /tmp/output/
   d. Uploads MP4 to GCS bucket (viral-pilot_bucket)
   e. POSTs completion to webhookUrl:
        POST /api/revideo/webhook?jobId=<jobId>
        Body: { status: 'done', outputUrl: '<signed GCS URL>' }
      (or { status: 'error', message: '...' } on failure)

6. Railway /api/revideo/webhook route:
   a. Validates jobId
   b. Updates job status in memory / BullMQ
   c. Client poller picks up status 'done' → triggers download from outputUrl
```

## Export flow (NLE)

```
1. Frontend POSTs to POST /api/nle-export with { format, timeline }
   (route: routes/nleExport.js)
2. Route converts timeline to FCPXML / xmeml / OTIO
3. Returns file as download
```

## Common failure modes

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| `blob:` URLs in Lambda logs | Frontend URL not resolved before invoking Lambda | Build GCS path from `clip.name` in revideoRenderRoutes.js |
| `undefined` URL error in renderer | Silence segments have no `url` field | Use `clip.name`-based GCS path as fallback |
| 403 / video won't load in Chromium | Unsigned GCS URL or expired signature | Re-sign with v4, 1hr expiry, just before Lambda invocation |
| Spaces in GCS paths cause 404 | Filename has spaces, not encoded | `encodeURIComponent(segment)` on each path part |
| "Scene not available" in Revideo | Chromium can't load video (403/network) | Verify signing; Lambda VPC/egress must reach GCS |
| "Frame detached" error | Same as above, or Lambda OOM | Increase Lambda memory; add `--disable-dev-shm-usage` to Puppeteer args |
| Lambda invocation 400 | Wrong function name or IAM permissions | Check `AWS_LAMBDA_FUNCTION_NAME` env var; verify Railway IAM role |
| Webhook never fires | Lambda crashed before POSTing back | Check Lambda CloudWatch logs; verify `webhookUrl` is reachable from Lambda |
| Job stuck in polling | Webhook POSTed but Railway missed it | Check Railway logs for `/api/revideo/webhook` request; verify jobId match |
| HLS proxy missing | videoProcessor job failed silently | Check BullMQ job logs, Redis connection health |

## Environment variables

**Railway:**
```
AWS_REGION                 = us-east-1  (or wherever Lambda is deployed)
AWS_LAMBDA_FUNCTION_NAME   = revideo-render-lambda
AWS_ACCESS_KEY_ID          = <IAM key with lambda:InvokeFunction>
AWS_SECRET_ACCESS_KEY      = <IAM secret>
GCS_BUCKET_NAME            = viral-pilot_bucket
GCS_PROJECT_ID             = <gcp project>
GOOGLE_APPLICATION_CREDENTIALS = /path/to/service-account.json
FRONTEND_URL               = https://vibedstudio.com
SUPABASE_URL               = https://<project>.supabase.co
SUPABASE_SERVICE_KEY       = <service role key>
REDIS_URL                  = redis://<railway-redis-host>:6379
```

**AWS Lambda (render-lambda/):**
```
PUPPETEER_EXECUTABLE_PATH        = /usr/bin/chromium  (or bundled in container)
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = true
GCS_BUCKET_NAME                  = viral-pilot_bucket
GOOGLE_APPLICATION_CREDENTIALS   = /var/task/service-account.json
```

## Key files
- `routes/revideoRenderRoutes.js`         — URL normalization + signing + Lambda invocation + /webhook handler
- `routes/exportRoutes.js`                — export orchestration
- `routes/nleExport.js`                   — FCPXML / xmeml / OTIO generation
- `render-lambda/index.ts`                — Lambda entry point (TypeScript handler)
- `render-lambda/revideo/src/project.ts`  — Revideo project config
- `render-lambda/revideo/src/scenes/timeline.tsx` — Revideo scene (reads tracks → MP4)

> `render-worker/` (contains fly.toml + server.js) is **dead code** — not deployed, not invoked.
> The live render path is exclusively `render-lambda/`.

## GCS path convention
```
raw/{userId}/{projectId}/{encodeURIComponent(filename)}

Examples:
  raw/usr_abc/proj_xyz/my%20podcast%20ep1.mp4   ← spaces encoded
  raw/anon_session123/proj_xyz/recording.mp4    ← anonymous session
```

Signing must happen on Railway — the Lambda container has its own GCS service account credentials
baked in (or passed via env), separate from Railway's credentials.
