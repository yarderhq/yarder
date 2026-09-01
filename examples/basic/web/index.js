import http from "node:http";

const port = Number(process.env.PORT || 3000);
const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const server = http.createServer(async (_req, res) => {
  let api = "unreachable";
  try {
    const response = await fetch(`${apiUrl}/health`);
    api = await response.text();
  } catch (err) {
    api = err instanceof Error ? err.message : String(err);
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`yarder example web on ${port}\nAPI_URL=${apiUrl}\napi: ${api}\n`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`web listening on ${port}`);
});
