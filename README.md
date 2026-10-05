<div align="center">

# 🎓 ClassRoom

### Anonymous, Discord-style chat room for college classes

Sign up with just a **username and password**. Chat in real time, share notes, and get announcements from admins.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![Status](https://img.shields.io/badge/Status-College%20Project-6366f1)

</div>

---

## 📖 About

**ClassRoom** is a clean, light-themed chat platform built as a college project. It gives a class a private, anonymous place to talk, with no email, phone number or real name required. Everyone uses a unique username, and admins (such as a teacher or class representative) can post official announcements and manage subgroups.

The app is intentionally simple: no database server, no build step, and no front-end framework. Anyone can clone it, run two commands and start extending it.

## ✨ Features

| Area | What you get |
|---|---|
| 🔐 **Authentication** | Username and password only. Unique usernames (case-insensitive), bcrypt-hashed passwords, JWT sessions |
| 🏫 **Main class group** | `announcements` (admin-only posting), `general` (open chat), `notes` (notes only) |
| 🧩 **Subgroups** | Admins create or delete subgroups. Each can be **Chat**, **Notes only** or **Announcements** |
| 📝 **Notes sharing** | Notes channels require a title plus content or a link (Drive, GitHub, etc.), keeping them organised |
| 📢 **Announcements** | Only admins can post, and they are highlighted visually |
| 💬 **Real-time chat** | Instant message delivery with Socket.IO |
| 🎭 **Avatars** | Pick an emoji and a background colour |
| 🏷️ **Flairs** | Reddit-style flair pills: Student, CR, Topper, Coder, Artist, Gamer, Night Owl (plus a red **Admin** flair) |
| 🛡️ **Moderation** | Admins can delete any message or subgroup. Users can delete their own messages |
| 🎨 **Clean UI** | Light theme, responsive layout, colours editable from one CSS block |

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, Socket.IO
- **Auth:** bcryptjs (password hashing) and jsonwebtoken (JWT)
- **Storage:** JSON file (`data.json`), auto-created on first run
- **Frontend:** HTML, CSS and vanilla JavaScript

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) **v18 or newer**
- [Git](https://git-scm.com/) (only needed to clone)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/student-chatroom.git
cd student-chatroom

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Open **http://localhost:3000** in your browser.

> **Tip:** use `npm run dev` for auto-restart while editing the backend.

### Try it on other devices
Find your computer's local IP address and open `http://<your-ip>:3000` on any phone or laptop connected to the same Wi-Fi.

### Default admin account

| Username | Password |
|---|---|
| `admin` | `admin123` |

> ⚠️ **Change this before real use.** Edit the default admin in `server.js`, then delete `data.json` so it is recreated.

## ⚙️ Configuration

Set these environment variables, or edit the defaults in `server.js`:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `JWT_SECRET` | `change-this-secret` | Secret used to sign login tokens. **Set a long random value in production** |

Example:
```bash
JWT_SECRET=my-long-random-secret PORT=4000 npm start
```

## 👥 Roles and Permissions

| Action | Student | Admin |
|---|:---:|:---:|
| Register / log in | ✅ | ✅ |
| Read all channels | ✅ | ✅ |
| Chat in chat channels | ✅ | ✅ |
| Share notes in notes channels | ✅ | ✅ |
| Post in announcement channels | ❌ | ✅ |
| Create / delete subgroups | ❌ | ✅ |
| Delete own messages | ✅ | ✅ |
| Delete anyone's messages | ❌ | ✅ |
| Change own avatar and flair | ✅ | ✅ |

## 📁 Project Structure

```
student-chatroom/
├── server.js          # Backend: REST API, auth, permissions, Socket.IO, JSON storage
├── package.json       # Dependencies and scripts
├── public/
│   ├── index.html     # Page layout (login screen + chat app + modal)
│   ├── style.css      # Light theme (colours defined in :root)
│   └── app.js         # Front-end logic (auth, channels, messages, profile)
├── data.json          # Auto-created database (git-ignored)
├── .gitignore
├── LICENSE
└── README.md
```

## 🔌 API Overview

All routes except register and login need the header `Authorization: Bearer <token>`.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/register` | Public | Create an account |
| POST | `/api/login` | Public | Log in and receive a token |
| GET | `/api/me` | User | Get own profile |
| PUT | `/api/me` | User | Update avatar and flair |
| GET | `/api/channels` | User | List channels |
| POST | `/api/channels` | Admin | Create a subgroup |
| DELETE | `/api/channels/:id` | Admin | Delete a subgroup |
| GET | `/api/messages/:channelId` | User | Last 100 messages of a channel |
| DELETE | `/api/messages/:id` | Owner or Admin | Delete a message |

**Socket.IO events**

| Event | Direction | Description |
|---|---|---|
| `send` | client to server | Send a message `{ channelId, title?, text }` |
| `message` | server to clients | New message broadcast |
| `deleted` | server to clients | A message was removed |
| `channels` | server to clients | Channel list changed |

## 🎬 Demo Walkthrough

1. Open two browser windows (one normal, one incognito) and register two different users.
2. Chat in `#general` and show messages arriving instantly.
3. Open the profile card (bottom-left) and change the avatar, colour and flair.
4. In `notes`, share a note with a title and a link.
5. Show a student cannot post in `announcements`.
6. Log in as `admin`, post an announcement, create a new subgroup and delete a message.

## 🖼️ Screenshots

> Add your screenshots to a `screenshots/` folder and link them here:
>
> `![Login](screenshots/login.png)`
> `![Chat](screenshots/chat.png)`

## 🔒 Security Notes

- Passwords are hashed with bcrypt and never stored in plain text.
- All messages are escaped before rendering, which protects against XSS.
- Change the default admin password and set a strong `JWT_SECRET` before deploying.
- This is a college project. For production, add rate limiting, HTTPS and a real database.

## 🗺️ Roadmap

- [ ] File upload for notes (PDF, images) using `multer`
- [ ] Dark mode toggle
- [ ] Typing indicators and online users list
- [ ] Message reactions and replies
- [ ] Pinned messages
- [ ] Switch storage to SQLite or MongoDB
- [ ] Deploy on Render or Railway

### Customising

- **Add a flair:** add it to the `FLAIRS` list in **both** `server.js` and `public/app.js`, then give it a colour in `public/style.css` (`.flair.YourFlair`).
- **Change the theme:** edit the colour variables in `:root` at the top of `public/style.css`.
- **Add default channels:** edit the `db.channels` list in `server.js` (delete `data.json` to apply).

## 🤝 Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push the branch: `git push origin feature/my-feature`
5. Open a Pull Request

## 📄 License

Released under the [MIT License](LICENSE).

## 👤 Author

**Your Name**
- GitHub: [@your-username](https://github.com/your-username)
- College: Your College Name, Department, Year

---

<div align="center">

⭐ If you found this project useful, please give it a star!

</div>
