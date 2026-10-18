FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY db ./db
COPY tsconfig.json tsconfig.server.json ./
USER node
EXPOSE 3001
CMD ["npm", "run", "api"]
