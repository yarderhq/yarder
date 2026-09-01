import http from "node:http";

const port = Number(process.env.PORT || 4000);
const databaseUrl = process.env.DATABASE_URL || "";

const server = http.createServer((req, res) => {
  if ((req.url || "/") === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok\n");
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`ok db=${databaseUrl ? "set" : "missing"}\n`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`api listening on ${port}`);
  console.log(`DATABASE_URL=${databaseUrl ? "set" : "missing"}`);
});
