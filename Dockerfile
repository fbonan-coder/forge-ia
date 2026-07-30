FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache \
    bash \
    git \
    libgcc \
    libstdc++ \
    ripgrep

ENV USE_BUILTIN_RIPGREP=0

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8787
ENV DATA_DIR=/data
ENV WORKSPACES_DIR=/workspaces

EXPOSE 8787

CMD ["npm", "start"]
