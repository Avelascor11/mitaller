FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/types/package.json packages/types/package.json
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build --workspace @mitaller/admin-web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/admin-web/package.json ./apps/admin-web/package.json
COPY --from=build /app/apps/admin-web/.next ./apps/admin-web/.next
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["sh", "-c", "npm run start --workspace @mitaller/admin-web -- -p ${PORT:-3000}"]
# cache bust Mon Jun  1 15:25:56 CEST 2026
