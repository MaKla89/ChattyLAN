# ChattyLAN — single-file web UI + zero-dependency Node.js backend (login & multi-user).
FROM node:22-alpine
WORKDIR /app
COPY index.html server.js ./
ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data
VOLUME /data
EXPOSE 80
# run as the unprivileged "node" user (uid 1000). For a bind mount (./data:/data),
# make the host folder writable by it once:  chown -R 1000:1000 data
USER node
# busybox wget is in the base image — no extra deps needed
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/api/status || exit 1
CMD ["node", "server.js"]
