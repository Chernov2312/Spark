FROM node:20-alpine

WORKDIR /app

# Сначала копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем пакеты
RUN npm install

# Копируем оставшийся код проекта
COPY . .

EXPOSE 5173

# Команда по умолчанию
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
