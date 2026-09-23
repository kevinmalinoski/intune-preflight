import { setDefaultResultOrder } from "node:dns";
import { config } from "./config.js";
import { buildServer } from "./server.js";

// Prefer IPv4 when resolving Graph/login hosts. Many container and WSL2 setups
// advertise an IPv6 address but have no working IPv6 route, so MSAL's token call
// to login.microsoftonline.com fails with ENETUNREACH ("network is
// unreachable") even though IPv4 works fine. Preferring IPv4 avoids that on
// dual-stack hosts; the Docker image additionally disables IPv6 outright.
setDefaultResultOrder("ipv4first");

const app = await buildServer();

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
