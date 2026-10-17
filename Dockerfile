# ChattyLAN — single-file web UI + zero-dependency Node.js backend (login & multi-user).
FROM node:22-alpine
WORKDIR /app
COPY index.html server.js ./
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
VOLUME /data
EXPOSE 8080
# PORT 8080 (not 80): unprivileged, so the container works even where
# net.ipv4.ip_unprivileged_port_start=1024 (the default on most NAS Docker
# daemons). The compose file maps host 8080 -> container 8080.
# NOTE: intentionally runs as root — NAS bind mounts (./data:/data) are
# typically root-owned and a non-root container user could not write them.
# busybox wget is in the base image — no extra deps needed
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/status || exit 1
CMD ["node", "server.js"]
