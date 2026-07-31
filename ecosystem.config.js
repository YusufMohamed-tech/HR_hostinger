module.exports = {
  apps: [
    {
      name: "hr-app",
      script: ".next/standalone/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
    },
  ],
};
