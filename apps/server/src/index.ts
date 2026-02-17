import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Set DATABASE_URL relative to the server's prisma directory if not already set
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '../prisma/dev.db');
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${dbPath}`;
}

// Dynamic imports after env is set
const { default: Fastify } = await import('fastify');
const { default: cors } = await import('@fastify/cors');
const { toolRoutes } = await import('./routes/tools.js');
const { receiptRoutes } = await import('./routes/receipts.js');

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

await app.register(toolRoutes);
await app.register(receiptRoutes);

app.get('/health', async () => ({ status: 'ok' }));

const port = parseInt(process.env.PORT ?? '3001', 10);

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Server listening on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
