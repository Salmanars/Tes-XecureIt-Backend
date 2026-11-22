import { app } from "./app";
import { prisma } from "./config/database";
import { env } from "./config/env";

const server = app.listen(env.PORT, () => {
  console.info(`Secure Document Sharing API listening on port ${env.PORT}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  console.error("Failed to start the HTTP server", error);
  process.exitCode = 1;
});

function shutdown(signal: NodeJS.Signals): void {
  console.info(`Received ${signal}; shutting down`);
  server.close(async (error) => {
    if (error) {
      console.error("Failed to close the HTTP server", error);
      process.exitCode = 1;
    }

    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error("Failed to disconnect from the database", disconnectError);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
