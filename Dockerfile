# Adapted from https://logfetch.com/docker-typescript-production/
FROM node:20-alpine3.19 AS ts-compiler
WORKDIR /usr/app
COPY package.json package-lock.json ./
COPY tsconfig.json ./
RUN npm install
COPY . ./
RUN npm run build

FROM node:20-bookworm AS ts-remover
WORKDIR /usr/app
COPY --from=ts-compiler /usr/app/package.json /usr/app/package-lock.json ./
COPY --from=ts-compiler /usr/app/build ./
# Following is required for sqlite driver
RUN apt-get update && apt-get install libsqlite3-dev && apt-get clean autoclean && apt-get autoremove --yes && rm -rf /var/lib/{apt,dpkg,cache,log}/
RUN npm install --only=production

FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /usr/app
COPY --from=ts-remover /usr/app ./
USER 1000
CMD ["index.js"]