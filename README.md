# Alias Online

A small dependency-free web version of Alias for private online rooms.

## Run

```powershell
node server.js
```

Open `http://localhost:3000`, create a room, paste your Ukrainian word pack, and send the room URL to the other player.

## Playing Online

Both players must be able to reach the same server. For local network play, use the host computer's LAN IP instead of `localhost`, for example `http://192.168.1.23:3000/?room=ABCDE`.

For internet play, deploy this folder to a Node-capable host, or expose port `3000` with a tunnel such as Cloudflare Tunnel or ngrok.

Rooms are kept in server memory, so restarting the server clears active rooms.
# alias-ukr
