# Next.js production image for energybot (single Node process + SQLite).
# Build the full app in the build stage; runtime carries only production deps
# and the compiled app. The build image can also run scripts/migrate-from-legacy.ts.

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/data/energybot.db \
    PORT=8000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 8000
CMD ["npm", "start"]
