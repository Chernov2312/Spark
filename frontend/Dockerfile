FROM node:22-alpine AS development

WORKDIR /app

RUN addgroup -g 65532 spark && adduser -D -u 65532 -G spark spark && chown spark:spark /app
ENV HOME=/home/spark
USER 65532:65532
COPY package.json package-lock.json ./
RUN npm ci --include=dev --prefer-offline --no-audit --no-fund

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM development AS build

ARG VITE_API_URL=/api/v1
ARG VITE_CALLS_WS_URL=/v1/calls/ws
RUN npm run build

FROM nginx:alpine AS production

RUN sed -i -e '/^user[[:space:]]/d' -e 's|^pid[[:space:]].*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf && \
    chown -R 65532:65532 /var/cache/nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/

USER 65532:65532
EXPOSE 5173
