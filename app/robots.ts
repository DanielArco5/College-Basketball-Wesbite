import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Query-string pages render on demand and cost ~30 queries each.
      // Re-open these once they're static paths.
      disallow: ["/shot-chart", "/rankings$", "/rankings?*"],
    },
  };
}
