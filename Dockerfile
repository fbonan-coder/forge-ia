FROM node:24-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

ENV PORT=8787
ENV DATA_DIR=/data
ENV WORKSPACES_DIR=/workspaces
EXPOSE 8787

CMD ["npm", "start"]
