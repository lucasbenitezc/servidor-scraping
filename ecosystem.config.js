module.exports = {
  apps: [{
    name: "scraper-service",
    script: "server.js",
    env: {
      NODE_ENV: "production",
      PORT: 443,
      CLIENT_URL: "https://v0-notificaciones-abogados.vercel.app/",
    }
  }]
}
