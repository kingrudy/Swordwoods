FROM node:22-alpine
WORKDIR /app
COPY package.json server.js room.js ./
COPY public ./public
# Accounts en voortgang staan in /data (koppel hier een volume aan)
RUN mkdir -p /data && chown -R node:node /data
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
