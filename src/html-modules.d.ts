// Wrangler's `[[rules]] type = "Text"` lets us import *.html files as string
// modules (see wrangler.toml). Used to serve the admin console page.
declare module "*.html" {
  const content: string;
  export default content;
}
