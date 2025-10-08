import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
    plugins: [tsconfigPaths()], // This plugin handles your "#/*" aliases
    test: {
        globals: true,
        environment: 'node',
        clearMocks: true,
    },
})