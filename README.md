<div align="center">

# 🎓 CampUS

### The anonymous chat space for your class

Join with just a **username and password**. Talk in real time, share notes, and stay on top of announcements.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

</div>

---

## About

**CampUS** is a private, anonymous chat platform for a college class. There is no email, phone number or real name involved: students join with a unique username and password, pick an avatar and flair, and start talking.

Admins (a teacher or class representative) post official announcements and organise the class into subgroups for subjects, clubs or projects.

CampUS needs no database server and no build step. Install, run, and it works.

## Features

- **Anonymous accounts:** sign up with only a username and password. Usernames are unique (case-insensitive), passwords are hashed with bcrypt, and sessions use JWT.
- **Class group:** every student lands in the main class space, with an `announcements` channel, a `general` chat and a `notes` channel.
- **Announcements:** only admins can post. Announcements are visually highlighted so they never get lost.
- **Subgroups:** admins create or remove subgroups for subjects, clubs or projects. Each one can be a **Chat**, **Notes only** or **Announcements** channel.
- **Notes sharing:** notes channels require a title plus content or a link (Drive, GitHub, etc.), so shared material stays organised and easy to find.
- **Real-time messaging:** messages appear instantly for everyone, with no refreshing.
- **Avatars:** choose an emoji and a background colour to represent you.
- **Flairs:** show who you are with a profile flair: Student, CR, Topper, Coder, Artist, Gamer or Night Owl. Admins get a special **Admin** flair.
- **Moderation:** admins can delete any message or subgroup, and users can delete their own messages.
- **Clean, light interface:** a minimal responsive layout that works on desktop and mobile.

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js, Express |
| Real-time | Socket.IO |
| Auth | bcryptjs, jsonwebtoken (JWT) |
| Storage | JSON file (`data.json`), created automatically |
| Frontend | HTML, CSS, vanilla JavaScript |

## Getting Started

**Requirements:** [Node.js](https://nodejs.org/) v18 or newer.

```bash
git clone https://github.com/V4RPIT/campus.git
cd campus
npm install
npm start
```

Open **http://localhost:3000**.

To use it with classmates on the same Wi-Fi, open `http://<your-computer-ip>:3000` on their devices.

### Default admin account

| Username | Password |
|---|---|
| `admin` | `admin123` |

Change these in `server.js` and delete `data.json` before using CampUS with a real class.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server runs on |
| `JWT_SECRET` | `change-this-secret` | Secret used to sign login tokens |

```bash
JWT_SECRET=your-long-random-secret PORT=4000 npm start
```

## Roles

| Action | Student | Admin |
|---|:---:|:---:|
| Chat and share notes | ✅ | ✅ |
| Customise avatar and flair | ✅ | ✅ |
| Delete own messages | ✅ | ✅ |
| Post announcements | ❌ | ✅ |
| Create or delete subgroups | ❌ | ✅ |
| Delete any message | ❌ | ✅ |

## Project Structure

```
campus/
├── server.js          # API, authentication, permissions, real-time events, storage
├── package.json
├── public/
│   ├── index.html     # Layout
│   ├── style.css      # Theme (colours defined in :root)
│   └── app.js         # Client logic
├── data.json          # Created automatically (git-ignored)
└── LICENSE
```

## API

All routes except register and login need an `Authorization: Bearer <token>` header.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/register` | Public | Create an account |
| POST | `/api/login` | Public | Log in |
| GET / PUT | `/api/me` | User | View or update your profile |
| GET | `/api/channels` | User | List channels |
| POST | `/api/channels` | Admin | Create a subgroup |
| DELETE | `/api/channels/:id` | Admin | Delete a subgroup |
| GET | `/api/messages/:channelId` | User | Latest 100 messages |
| DELETE | `/api/messages/:id` | Owner / Admin | Delete a message |

**Real-time events:** `send` (client to server), `message`, `deleted` and `channels` (server to clients).

## Customising

- **Flairs:** edit the `FLAIRS` list in both `server.js` and `public/app.js`, then add a colour in `style.css`.
- **Theme:** change the colour variables in `:root` at the top of `public/style.css`.
- **Default channels:** edit `db.channels` in `server.js`, then delete `data.json` to apply.

## License

Released under the [MIT License](LICENSE).

## Author

**Your Name**
[GitHub](https://github.com/V4RPIT) ·

<div align="center">

If CampUS helped you, consider giving it a ⭐

</div>
