import { defineConfig } from 'vite'

// GitHub Pages serves a project site from https://<username>.github.io/<repo>/,
// so every built asset URL must start with /<repo>/ (Vite's `base` option).
//
//   npm run dev       command 'serve'                    -> base '/'
//   npm run build     command 'build'                    -> base '/<repo>/'
//   npm run preview   command 'serve' AND isPreview true -> base '/<repo>/'
// The preview case matters: it serves the built files, which expect /<repo>/.
// (Checking only `command === 'build'` breaks preview: every asset 404s.)
//
// If you rename the GitHub repository, change REPO to match.
const REPO = 'kmeans-visualizer'

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? `/${REPO}/` : '/',
}))
