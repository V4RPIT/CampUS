# 💬 Campus Chat
Lightweight Discord-style chat for students: communities with channels (#general, #notes, #memes…), private DMs,
profiles (avatar, flair, bio), editable channel names, owner-managed subgroup deletion, file attachments, replies,
message deletion, in-app notifications, live typing indicators, community pictures, Material You-inspired styling,
and Discord-inspired desktop and mobile navigation.
**Stack:** Node.js + Express + Socket.IO + SQLite (one file DB) · plain HTML/CSS/JS frontend (no build step).

## Run locally
```bash
npm install
cp .env.example .env      # then edit JWT_SECRET (or just export the variables)
npm start                 # http://localhost:3000
```

## Deploy (Render example)
1. Push this folder to GitHub.
2. Render → New **Web Service** → pick the repo. Build: `npm install` · Start: `npm start`.
3. Environment: `JWT_SECRET` (long random text), `NODE_ENV=production`, optional `SIGNUP_INVITE`.
4. **Data persistence:** SQLite is a file. Free tiers wipe disk on restart, so add a persistent disk
   (mount at `/data`) and set `DB_PATH=/data/chat.db`. Railway/Fly volumes work the same way.

## Project map (where to change things)
| File | What it does |
|---|---|
| `server.js` | API, auth, rate limits, database tables, realtime. Sections are numbered 1–7 |
| `public/index.html` | Page structure (login card, 4-column app, settings dialog) |
| `public/style.css` | All colours are CSS variables at the top → easy re-theming |
| `public/app.js` | Frontend logic, community controls, messages, and in-app dialogs |

## Spam & account recovery
**Already built in:** signup limit per IP (5/hour), login/recover attempt limits, hidden honeypot field,
optional `SIGNUP_INVITE` code, bcrypt password hashing, per-user message flood limit,
and a one-time **recovery code** shown at signup (lets users reset a forgotten password with no email).
Community owners can rename or delete subgroups from the channel list. Messages support replies and can be deleted by their sender or community owner.
Community owners can set a community picture; direct-message lists show each user's avatar. Unread message notifications work in channels and DMs, and live typing indicators are available in both. Chat attachments are stored in SQLite and support files up to 50 MB each.

**Good next steps:** CAPTCHA (Cloudflare Turnstile is free) on signup · college-email or roll-number verification ·
admin approval for new accounts · owner/moderator tools (kick, delete message) · report button.

## Known limitations / ideas
- Avatar, flair, and bio are saved on the server. The app uses a fixed dark Material You-inspired palette; theme switching and wallpaper options have been removed.
- In-app dialogs and toast notifications are used for confirmations and errors.
- Single server instance. For scaling, move to Postgres + Socket.IO Redis adapter.
