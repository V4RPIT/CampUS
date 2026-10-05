# 💬 CampUS
A lightweight, real-time chat and collaboration platform designed for students. Create communities with dedicated channels (e.g., #general, #notes, #memes), send private direct messages, and customize user profiles with avatars, flairs, and bios. 

## 📸 Screenshots

> **Note:** Replace the placeholder links below by dragging and dropping your actual screenshot images directly into this README on GitHub.

| Community Channels | Direct Messages | Profile & Settings |
| :---: | :---: | :---: |
| ![Channels](https://via.placeholder.com/300x200?text=Channel+View) | ![DMs](https://via.placeholder.com/300x200?text=DM+View) | ![Profile](https://via.placeholder.com/300x200?text=Profile+View) |

## ✨ Features

* **Workspaces & Channels:** Editable channel names and owner-managed subgroup deletion.
* **Rich Messaging:** File attachments (up to 50 MB), nested replies, and message deletion by sender or owner.
* **Real-Time Experience:** Live typing indicators and in-app unread notifications for both channels and DMs.
* **User Customization:** Avatars, custom flairs, bios, and community pictures.
* **Responsive UI:** Material You-inspired styling built for seamless navigation across desktop and mobile.
* **Simplified Stack:** Node.js + Express + Socket.IO + SQLite (one-file DB) with a plain HTML/CSS/JS frontend (no build step).

## 🚀 Run Locally

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET (or just export the variables)
npm start                 # http://localhost:3000
