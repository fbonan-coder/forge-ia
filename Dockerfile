FROM node:24-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8787
ENV DATA_DIR=/data
ENV WORKSPACES_DIR=/workspaces

EXPOSE 8787

CMD ["npm", "start"]
