import { loadConfig } from "./config.js";
import { createApp } from "./server.js";

const config = loadConfig();
const server = createApp(config);

server.listen(config.port, config.host, () => {
  console.log(`local OpenAI proxy listening on http://${config.host}:${config.port}`);
});
