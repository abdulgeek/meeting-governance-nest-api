# Product API: auth, meetings, MongoDB persistence (NestJS).
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4000
# Set MONGO_URI + JWT_SECRET via env in your deploy platform.
CMD ["node", "dist/main.js"]
