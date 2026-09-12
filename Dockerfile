# ChattyLAN — single-file web UI + zero-dependency Node.js backend (login & multi-user).
FROM node:22-alpine
WORKDIR /app
COPY index.html server.js ./
ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data
VOLUME /data
EXPOSE 80
CMD ["node", "server.js"]
