import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderServerBlock, nginxSiteName, projectCertName } from "./nginx.ts";

describe("renderServerBlock", () => {
  it("emits a local HTTP proxy block", () => {
    const block = renderServerBlock("api.basic.test", 4007);
    assert.match(block, /listen 80;/);
    assert.match(block, /server_name api\.basic\.test;/);
    assert.match(block, /proxy_pass http:\/\/127\.0\.0\.1:4007;/);
    assert.doesNotMatch(block, /listen 443/);
  });

  it("emits ACME + TLS blocks for production", () => {
    const block = renderServerBlock("api.example.com", 4007, {
      acmeRoot: "/var/lib/yarder/acme",
      tls: { cert: "/etc/letsencrypt/live/yarder-basic/fullchain.pem", key: "/etc/letsencrypt/live/yarder-basic/privkey.pem" },
      redirectHttp: true,
    });
    assert.match(block, /listen 443 ssl;/);
    assert.match(block, /ssl_certificate \/etc\/letsencrypt\/live\/yarder-basic\/fullchain\.pem;/);
    assert.match(block, /acme-challenge/);
    assert.match(block, /return 301 https:\/\/\$host\$request_uri;/);
  });
});

describe("nginx naming", () => {
  it("prefixes site files with yarder-project-service", () => {
    assert.equal(nginxSiteName("My App", "api"), "yarder-my-app-api.conf");
    assert.equal(projectCertName("My App"), "yarder-my-app");
  });
});
