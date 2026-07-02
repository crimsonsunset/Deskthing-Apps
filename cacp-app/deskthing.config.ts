import { defineConfig } from '@deskthing/cli'

export default defineConfig({
  development: {
    logging: {
      level: 'info',
      prefix: '[DeskThing Server]',
    },
    client: {
      logging: {
        level: 'info',
        prefix: '[DeskThing Client]',
        enableRemoteLogging: true,
      },
      clientPort: 3050,
      viteLocation: 'http://localhost',
      vitePort: 5050,
      linkPort: 8080,
    },
    server: {
      editCooldownMs: 1000,
    },
  },
})
