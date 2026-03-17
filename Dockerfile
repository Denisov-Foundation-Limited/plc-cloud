FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src
COPY proto.json ./proto.json

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV WEB_PORT=80
ENV PORT=3001

EXPOSE 80
EXPOSE 3001

CMD ["npm", "start"]
