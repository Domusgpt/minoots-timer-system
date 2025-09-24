import { createServer } from './app';
import { logger } from './telemetry/logger';

const port = parseInt(process.env.PORT ?? '4000', 10);
const app = createServer();

app.listen(port, () => {
  logger.info({ port }, 'MINOOTS control plane listening');
});
