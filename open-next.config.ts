import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// `npm run build` runs `opennextjs-cloudflare build`, which in turn needs the plain Next build.
// Pointing it at `build:next` avoids an infinite build -> build loop.
export default {
  ...defineCloudflareConfig(),
  buildCommand: "npm run build:next",
};
