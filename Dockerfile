FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npx prisma generate
RUN npm run build

RUN mkdir -p /app/storage/private && chown -R node:node /app/storage
USER node

VOLUME ["/app/storage/private"]
EXPOSE 4000
CMD ["sh", "-c", "npm run prisma:deploy && npm start"]
