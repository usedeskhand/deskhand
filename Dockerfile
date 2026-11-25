FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs ./
COPY lib ./lib
COPY public ./public
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production DOMAIN=deskhand.markets
EXPOSE 8080
CMD ["node", "./server.mjs"]
