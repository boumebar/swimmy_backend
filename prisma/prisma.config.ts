import { defineConfig } from '@prisma/config';

export default defineConfig({
  datasource: {
    // Ici on met l'URL directe (Port 5432) pour les migrations
    url: process.env.DATABASE_URL,
  },
});
