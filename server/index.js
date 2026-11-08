import { createAppServer } from './api.js';

const rawPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(rawPort) || rawPort < 0 || rawPort > 65535) {
  console.error('PORT must be an integer between 0 and 65535');
  process.exit(1);
}
const host = process.env.HOST ?? '127.0.0.1';
const server = createAppServer();
server.listen(rawPort, host, () => {
  console.log(`Sprint Board running at http://${host}:${server.address().port}`);
});
