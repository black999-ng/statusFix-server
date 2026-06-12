# StatusFix — Server

This folder contains the backend service (FFmpeg processing) intended to be deployed to Render or any Node.js host.

Quick start (local):

```bash
cd server
npm install
cp .env.example .env
# edit .env: set CLIENT_URL to your frontend URL
npm run dev
```

Endpoints:
- `POST /process` — multipart form file field `media` (images/videos)
- `GET /health` — returns `{ status: "ok" }`

Deployment notes (Render):
- Create a new Web Service pointing to this repo/folder
- Build: `npm install`
- Start: `npm start`
- Set environment variable `CLIENT_URL` to your Vercel frontend URL
